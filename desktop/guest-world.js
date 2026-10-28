'use strict';
(function (root) {
  const { GuestTotem } = typeof module !== 'undefined' ? require('./totems.js') : root.PolycraftTotems;
  const { validateSnapshot, validateDelta, applyDelta } = typeof module !== 'undefined' ? require('./world-state.js') : root.PolycraftWorldState;
  const { GuestMovement } = typeof module !== 'undefined' ? require('./coop-input.js') : root.PolycraftCoopInput;
  const { pickTarget } = typeof module !== 'undefined' ? require('./coop-actions.js') : root.PolycraftCoopActions;
  const { GuestConstruction } = typeof module !== 'undefined' ? require('./guest-construction.js') : root.PolycraftGuestConstruction;
  const { GuestQuests } = typeof module !== 'undefined' ? require('./quests.js') : root.PolycraftQuests;
  const { GuestHud } = typeof module !== 'undefined' ? require('./hud.js') : root.PolycraftHud;

  const same = (a, b) => a === b || !!(a && b && a.length === b.length && a.every((value, index) => value === b[index]));
  function transformParts(math, transform) {
    const normalized = new Float32Array(transform), scale = [0, 3, 6].map(offset => Math.hypot(...transform.slice(offset, offset + 3)));
    if (scale.some(value => value < 1e-6)) return null;
    if (math.m43Determinant(transform) < 0) scale[0] *= -1;
    for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) normalized[column * 3 + row] /= scale[column];
    for (const [a, b] of [[0, 3], [0, 6], [3, 6]]) if (Math.abs(normalized[a] * normalized[b] + normalized[a + 1] * normalized[b + 1] + normalized[a + 2] * normalized[b + 2]) > 1e-3) return null;
    return { rotation: math.quatFromM43(normalized), scale, position: transform.slice(9, 12) };
  }
  function blendTransform(math, motion, amount, output) {
    return math.m43FromRTS(math.quatSlerp(motion.from.rotation, motion.to.rotation, amount),
      math.v3Lerp(motion.from.position, motion.to.position, amount), math.v3Lerp(motion.from.scale, motion.to.scale, amount), output);
  }
  function transformMotion(math, from, to) {
    if (same(from, to)) return null;
    const start = transformParts(math, from), end = transformParts(math, to);
    // Keep the engine's near-angle slerp on the same quaternion hemisphere at yaw wrap.
    if (start && end && start.rotation.reduce((sum, value, index) => sum + value * end.rotation[index], 0) < 0) end.rotation = Array.from(end.rotation, value => -value);
    return start && end && start.scale.every((value, index) => value * end.scale[index] > 0) ? { from: start, to: end } : null;
  }

  // Guests create presentation nodes only: activating ECS archetypes would run host-owned AI and rewards.
  class GuestScene {
    constructor(globals, blocks) {
      this.globals = globals;
      this.blocks = blocks;
      this.terrain = [];
      this.entities = new Map();
      this.tick = -1;
      this.closed = false;
      const mapping = globals.simpleSceneLoader.pathRemapping;
      this.assets = {
        hasBlock: name => blocks.getArchetypeList().includes(name),
        hasMesh: path => Object.hasOwn(mapping, path) && /\.dae$/.test(path)
      };
    }
    remove(node) {
      if (!node) return;
      node.skinController?.output.destroy?.();
      if (node.isInScene()) this.globals.scene.removeRootNode(node);
      node.destroy();
    }
    load(path, transform) {
      if (!this.globals.simpleSceneLoader.assetCache[path]?.loaded) throw new Error('The guest renderer has not finished loading: ' + path);
      const node = this.globals.simpleSceneLoader.load(path, new Float32Array(transform), false);
      node.setDynamic();
      return node;
    }
    pose(node, matrices) {
      let controller = node.skinController;
      if (matrices && (!controller || controller.output.length !== matrices.length)) {
        controller?.output.destroy?.();
        controller = { output: this.globals.graphicsDevice.createTechniqueParameterBuffer({ numFloats: matrices.length, dynamic: true }), update() {} };
      }
      if (matrices) controller.output.setData(matrices instanceof Float32Array ? matrices : new Float32Array(matrices));
      else { controller?.output.destroy?.(); controller = null; }
      const changed = node.skinController !== controller;
      node.skinController = controller;
      function attach(child) {
        for (const renderable of child.renderables || []) if (renderable.isSkinned()) renderable.skinController = controller;
        for (const descendant of child.children || []) attach(descendant);
      }
      if (changed) attach(node);
    }
    apply(value, now = performance.now()) {
      if (this.closed) throw new Error('The guest scene has closed.');
      validateSnapshot(value, this.assets);
      if (value.tick <= this.tick) throw new Error('The host sent an outdated world snapshot.');
      const snapshot = structuredClone(value), created = [], next = new Map();
      const terrainKey = JSON.stringify(snapshot.spaces.map(space => space.blocks));
      let terrain = this.terrain;
      try {
        if (terrainKey !== this.terrainKey) {
          terrain = [];
          const math = this.globals.mathDevice;
          for (const space of snapshot.spaces) for (const block of space.blocks) {
            const archetype = this.blocks.getArchetype(block.archetype);
            if (!archetype.path) continue;
            let transform = math.m43BuildScale(block.scale);
            if (block.rotation) transform = math.m43Mul(transform, math.m43BuildRotationY(block.rotation));
            math.m43Translate(transform, block.location);
            const node = this.load(archetype.path, transform);
            created.push(node); terrain.push(node);
          }
        }
        for (const space of snapshot.spaces) for (const entity of space.entities) {
          const previous = this.entities.get(entity.id);
          let node = null;
          if (entity.mesh) {
            if (previous?.record.mesh?.path === entity.mesh.path) node = previous.node;
            else { node = this.load(entity.mesh.path, entity.mesh.transform); created.push(node); }
          }
          next.set(entity.id, { record: entity, node });
        }
      } catch (error) {
        for (const node of created) this.remove(node);
        throw error;
      }
      const gap = this.receivedAt === undefined ? 0 : now - this.receivedAt, duration = Math.min(250, Math.max(100, gap));
      try {
        this.render(now);
        for (const entry of next.values()) {
          const { record, node } = entry, previous = this.entities.get(record.id);
          entry.displayLocation = [...record.location];
          if (!node) continue;
          entry.displayTransform = new Float32Array(record.mesh.transform);
          entry.displaySkin = record.mesh.skin && new Float32Array(record.mesh.skin);
          // A large correction or stalled stream snaps instead of dragging actors across the island.
          const continuous = previous?.node === node && previous.record.mesh?.visible && record.mesh.visible && gap > 0 && gap <= 1000 && Math.hypot(...record.location.map((value, index) => value - previous.record.location[index])) <= 8;
          if (continuous) {
            const transform = transformMotion(this.globals.mathDevice, previous.displayTransform, record.mesh.transform);
            const skin = previous.displaySkin && entry.displaySkin && previous.displaySkin.length === entry.displaySkin.length && !same(previous.displaySkin, entry.displaySkin);
            if (transform || skin) {
              entry.motion = { start: now, duration, transform, location: [...previous.displayLocation], skin: skin ? new Float32Array(previous.displaySkin) : null };
              if (transform) { entry.displayTransform.set(previous.displayTransform); entry.displayLocation = [...previous.displayLocation]; }
              if (skin) entry.displaySkin.set(previous.displaySkin);
            }
          }
          node.setLocalTransform(entry.displayTransform);
          node.enableHierarchy(record.mesh.visible);
          this.pose(node, entry.displaySkin);
        }
      } catch (error) {
        for (const node of created) this.remove(node);
        throw error;
      }
      for (const [id, previous] of this.entities) if (previous.node !== next.get(id)?.node) this.remove(previous.node);
      if (terrain !== this.terrain) for (const node of this.terrain) this.remove(node);
      this.terrain = terrain; this.terrainKey = terrainKey; this.entities = next;
      const torch = snapshot.torch, before = this.torch;
      this.torchMotion = torch?.visible && before?.visible && gap > 0 && gap <= 1000 && Math.hypot(...torch.transform.slice(9).map((value, index) => value - before.transform[index + 9])) <= 8 ? transformMotion(this.globals.mathDevice, before.transform, torch.transform) : null;
      if (this.torchMotion) Object.assign(this.torchMotion, { start: now, duration });
      this.torch = torch && { visible: torch.visible, transform: new Float32Array(this.torchMotion ? before.transform : torch.transform) };
      this.receivedAt = now;
      this.tick = snapshot.tick; this.snapshot = snapshot;
      return snapshot;
    }
    render(now = performance.now()) {
      if (this.closed) return;
      const math = this.globals.mathDevice;
      for (const entry of this.entities.values()) {
        const motion = entry.motion;
        if (!motion) continue;
        const amount = Math.max(0, Math.min(1, (now - motion.start) / motion.duration));
        if (motion.transform) {
          if (amount === 1) entry.displayTransform.set(entry.record.mesh.transform);
          else blendTransform(math, motion.transform, amount, entry.displayTransform);
          entry.displayLocation = entry.record.location.map((value, index) => motion.location[index] + (value - motion.location[index]) * amount);
          entry.node.setLocalTransform(entry.displayTransform);
        }
        if (motion.skin) {
          // shortcut: blend received skin matrices; replicate local bone poses if fast joint turns visibly deform.
          if (amount === 1) entry.displaySkin.set(entry.record.mesh.skin);
          else for (let index = 0; index < entry.displaySkin.length; index++) entry.displaySkin[index] = motion.skin[index] + (entry.record.mesh.skin[index] - motion.skin[index]) * amount;
          this.pose(entry.node, entry.displaySkin);
        }
        if (amount === 1) entry.motion = null;
      }
      if (this.torchMotion) {
        const amount = Math.max(0, Math.min(1, (now - this.torchMotion.start) / this.torchMotion.duration));
        if (amount === 1) { this.torch.transform.set(this.snapshot.torch.transform); this.torchMotion = null; }
        else blendTransform(math, this.torchMotion, amount, this.torch.transform);
      }
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      for (const node of this.terrain) this.remove(node);
      for (const { node } of this.entities.values()) this.remove(node);
      this.terrain = []; this.entities.clear(); this.snapshot = this.torch = this.torchMotion = null;
    }
  }

  class GuestCamera {
    constructor(world) {
      this.world = world; this.actors = new Map(); this.lastFrame = performance.now();
      const original = world.game.getGameCamera(), globals = Object.assign(Object.create(world.controls.app.globals), { dynamicUI: null });
      const game = { getPlayFlags: () => ({ cameraMode: world.scene.snapshot.camera.mode }), getGameClock: () => ({ getTimeStep: () => globals.gameAppTimeStep }),
        getCurrentGameSpace: () => { const state = world.scene.snapshot, space = state.spaces.find(space => space.entities.some(entity => entity.id === state.hero)); return { extents: space.extents, getv3Location: () => state.camera.center }; },
        getFactionManager: () => ({ applyToEnemies: (hero, apply) => world.scene.snapshot.camera.enemies.forEach(id => apply(this.actor(id))) }),
        applyToHeroEntities: apply => world.scene.snapshot.camera.heroes.forEach(id => apply(this.actor(id))) };
      globals.gameManager = game;
      // Native init creates private vectors/zoomers; the suspended solo camera is only a method source.
      this.camera = Object.assign(Object.create(original), { globals, gameManager: game, heroEntity: null, zoomerBlend: false, continuousZoom: false, exitModeFunction: undefined });
      this.camera.init(); this.camera.setModeViewScene();
    }
    actor(id) {
      if (!this.actors.has(id)) {
        const world = this.world, entry = () => world.scene.entities.get(id), context = () => world.scene.snapshot.camera;
        this.actors.set(id, { get v3Location() { return entry().displayLocation || entry().record.location; }, getv3Location() { return this.v3Location; },
          getEC: name => name === 'ECPlayerLife' ? { isDead: () => context().dead } : name === 'ECPlayerBuilder' ? { getTimeSinceBuilding: () => context().buildingAge } : name === 'ECLocomotion' ? {
            getDestination: () => context().destination, getLookAhead: () => context().lookAhead && context().lookAhead.map((value, index) => value + (entry().displayLocation || entry().record.location)[index] - entry().record.location[index]), getTimeHeld: () => context().timeHeld
          } : null });
      }
      return this.actors.get(id);
    }
    update() {
      const now = performance.now(), state = this.world.scene.snapshot;
      if (this.world.resyncing) { this.resyncing = true; this.lastFrame = now; return; }
      this.camera.globals.gameAppTimeStep = Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000)); this.lastFrame = now;
      for (const id of this.actors.keys()) if (!this.world.scene.entities.has(id)) this.actors.delete(id);
      const hero = this.actor(state.hero), location = hero.getv3Location();
      if (this.resyncing || state.hero !== this.lastHero || this.lastLocation && Math.hypot(...location.map((value, index) => value - this.lastLocation[index])) > 8) { this.camera.sphereCentre = this.camera.globals.mathDevice.v3Copy(location); this.camera.setShouldSnap(); }
      this.resyncing = false; this.lastHero = state.hero; this.lastLocation = Array.from(location);
      if (this.world.movement?.available()) {
        const keys = this.world.movement.keys, turn = Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'));
        if (turn && this.camera.globals.gameAppTimeStep > 0) {
          this.camera.rotate(turn * 0.5 * Math.PI * this.camera.globals.gameAppTimeStep);
          if (!this.world.cameraRequest && now - (this.lastRotationNotice ?? -Infinity) >= 500) { this.lastRotationNotice = now; this.world.cameraRequest = this.world.sendTarget('rotateCamera', state.hero); }
        }
      }
      this.camera.setHero(hero); this.camera.update();
    }
  }
  class GuestWorld {
    constructor(controls, connection) {
      if (!controls.ready() || controls.onlineWorld || controls.guestWorld || connection.role !== 'guest' || connection.closed) throw new Error('Joining needs a loaded renderer and an available guest connection.');
      this.controls = controls; this.connection = connection;
      this.targetSequence = 0;
      this.uiRequests = new Map();
      this.lastLifeQuery = -Infinity;
      this.game = controls.manager();
      const game = this.game, app = controls.app, globals = app.globals;
      const camera = game.getGameCamera();
      this.scene = new GuestScene(globals, game.getBlockFactory());
      this.original = {
        update: app.updateGame, draw: game.draw, draw2D: game.draw2D, save: game.saveLevel, getCamera: game.getGameCamera, heroLightUpdate: game.gameLighting.updateHeroLightPosition,
        time: globals.gameCurrentTime, dayTime: game.getGameDayTime(),
        paused: controls.paused, guiController: game.imgui.controller,
        camera: Object.fromEntries(['desiredV3Focus', 'desiredV3Position', 'currentV3Focus', 'currentV3Position', 'currentV3Up', 'currentv3Direction'].filter(key => camera[key]).map(key => [key, Array.from(camera[key])])),
        fov: camera.currentFOV,
        lights: [game.gameLighting.worldDirectionLightNode, game.gameLighting.heroLightNode].filter(Boolean).map(node => ({ node, transform: Array.from(node.getLocalTransform()), disabled: node.disabled })),
        onMessage: connection.onMessage, onState: connection.onState,
        roots: globals.scene.rootNodes.filter(node => node !== game.gameLighting.worldDirectionLightNode && node !== game.gameLighting.heroLightNode)
      };
      const profile = game.getPlayerData();
      this.original.settings = { shadows: game.gameLighting.getShadowsEnabled(), sounds: game.gameSoundManager.getSoundsEnabled(), music: profile.getMusicEnabled() };
      // Session preferences must never save into the suspended local island.
      this.sessionSettings = Object.assign(Object.create(profile), { settings: { ...profile.settings }, saveSettings() {} });
      this.viewCamera = new GuestCamera(this);
      game.getGameCamera = () => this.viewCamera.camera;
      game.gameLighting.updateHeroLightPosition = () => this.updateTorch();
      controls.guestWorld = this;
      for (const node of this.original.roots) globals.scene.removeRootNode(node);
      app.updateGame = () => this.update();
      this.guiInput = { down: false, pendingDown: false, position: [0, 0], getGuiDown() { return this.down; }, getv2ScreenCoord() { return this.position; } };
      this.construction = new GuestConstruction(this); this.totem = new GuestTotem(this); this.hud = new GuestHud(this); this.quests = new GuestQuests(this);
      game.imgui.controller = this.guiInput;
      game.draw = () => {};
      game.draw2D = () => { game.imgui.draw2D(); game.updateInterfaceTweens(); game.getGuiManager().completeDraw(); globals.simpleFontRenderer.render(); };
      game.saveLevel = () => { throw new Error('The host saves this online island.'); };
      game.getGameController().clearInputs();
      connection.onMessage = (message, link) => {
        if (message.kind === 'welcome') {
          const value = message.payload;
          if (this.identity || this.scene.snapshot) throw new Error('Repeated or late host-assigned hero.');
          if (!value || Object.keys(value).length !== 5 || value.version !== 1 || typeof value.playerId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.playerId)) throw new Error('Invalid host-assigned hero identity.');
          if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || typeof value.entity !== 'string' || !value.entity.length || value.entity.length > 256 || typeof value.pvp !== 'boolean' || value.pvp !== connection.pvp) throw new Error('Invalid host-assigned hero details.');
          this.identity = { ...value };
        }
        if (message.kind === 'update' && !this.scene.snapshot) throw new Error('The host must send an initial world snapshot first.');
        if (message.kind === 'snapshot' || message.kind === 'update') {
          if (this.identity && !this.scene.snapshot && message.payload.hero !== this.identity.entity) throw new Error('The initial host snapshot selects a different hero.');
          if (message.kind === 'update') {
            if (this.resyncing) validateDelta(message.payload, this.scene.assets);
            else try { this.scene.apply(applyDelta(this.scene.snapshot, message.payload, this.scene.assets)); }
            catch (error) { if (error.code === 'WORLD_BASE_MISMATCH') this.requestResync(); else throw error; }
          } else {
            this.scene.apply(message.payload);
            if (this.resyncing) {
              this.resyncing = false; clearTimeout(this.resyncTimer);
              const status = root.document?.getElementById?.('status');
              if (status) status.textContent = 'World synchronized.';
            }
          }
          // A rank-up recreates the entity; the assigned saved player identity stays unchanged.
          if (this.identity) this.identity.entity = this.scene.snapshot.hero;
        }
        else if (message.kind === 'end') this.close();
        else if (message.kind === 'result') {
          const value = message.payload;
          const extras = value && ['building', 'construction', 'preview', 'totem', 'held', 'life', 'hud', 'quests'].filter(key => Object.hasOwn(value, key));
          if (!value || extras.length > 1 && !(value.type === 'life' && extras.length === 2 && extras.includes('life') && extras.includes('hud')) || Object.keys(value).length !== 3 + extras.length || !['target', 'demolish', 'build', 'preview', 'upgrade', 'held', 'cancelBuild', 'life', 'revive', 'move', 'repair', 'upgradeBuilding', 'cancelUpgrade', 'questOpen', 'questReward', 'rotateCamera', 'pauseGame', 'enterFullscreen'].includes(value.type) || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > this.targetSequence || typeof value.message !== 'string' || value.message.length > 160) throw new Error('Invalid interaction result.');
          if (value.type === 'life' && Object.hasOwn(value, 'life') !== Object.hasOwn(value, 'hud')) throw new Error('Incomplete hero status.');
          if (extras.length && !(extras[0] === 'held' && value.held === null) && (!value[extras[0]] || typeof value[extras[0]] !== 'object' || Array.isArray(value[extras[0]]))) throw new Error('Invalid interaction details.');
          if (value.type === 'repair' && value.sequence === this.repairRequest) this.repairRequest = null;
          if (value.type === 'rotateCamera' && value.sequence === this.cameraRequest) this.cameraRequest = null;
          if (['pauseGame', 'enterFullscreen'].includes(value.type) && this.uiRequests.get(value.type) === value.sequence) this.uiRequests.delete(value.type);
          if (['upgradeBuilding', 'cancelUpgrade'].includes(value.type) && value.sequence === this.upgradeRequest) this.upgradeRequest = null;
          const selected = value.type === 'target' && value.sequence === this.selectionRequest;
          if (value.building) {
            const building = value.building;
            if (value.type !== 'target' || Object.keys(building).length !== 4 || typeof building.movable !== 'boolean' || !['id', 'name', 'reason'].every(key => typeof building[key] === 'string' && building[key].length <= 256) || !building.id || !building.name) throw new Error('Invalid demolition selection.');
            if (selected) this.selectedBuilding = building.reason && !building.movable ? null : { ...building };
          }
          if (value.totem && !['target', 'upgrade'].includes(value.type)) throw new Error('Invalid totem result.');
          this.totem.receive(value, selected);
          this.construction.receive(value, selected);
          this.quests.receive(value);
          this.hud.receive(value, this.lifeRequest);
          this.receiveLife(value);
          if (selected) { this.selectionRequest = null; if (value.construction || value.totem) this.selectedBuilding = this.demolition = null; }
          if (!['held', 'life', 'rotateCamera', 'pauseGame', 'enterFullscreen'].includes(value.type)) {
            this.lastTargetResult = { ...value };
            const status = root.document?.getElementById?.('status');
            if (status) status.textContent = value.message;
          }
        }
        this.original.onMessage?.(message, link);
      };
      connection.onState = (state, details) => {
        if (state === 'closed') this.close();
        this.original.onState?.(state, details);
      };
      this.movement = new GuestMovement(this);
    }
    requestResync() {
      if (this.closed || this.resyncing || !this.scene.snapshot) return;
      this.resyncing = true; this.cancelLocalMenu(); this.movement.flush();
      const status = root.document?.getElementById?.('status');
      if (status) status.textContent = 'Resynchronizing world…';
      this.resyncTimer = setTimeout(() => { if (!this.closed && this.resyncing) this.connection.fail(new Error('World resync timed out. Rejoin the host for a fresh connection.')); }, 15000);
      this.connection.send('resync', { version: 1, tick: this.scene.tick }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
    }
    clickTarget(event) {
      const gui = this.game.getIMGui();
      if (gui.hasCapturedInput() || gui.isHot('guest-pause') || gui.isHot('guest-fullscreen')) return;
      const target = pickTarget(this, event);
      if (!target) return;
      this.selectionRequest = this.sendTarget('target', target);
    }
    sendTarget(type, target, archetype) {
      const sequence = ++this.targetSequence;
      this.connection.send('action', { type, sequence, target, ...(archetype === undefined ? {} : { archetype }) }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
      return sequence;
    }
    requestMove(target) {
      if (this.moveRequest) return;
      this.cancelLocalMenu(); this.moveRequest = this.sendTarget('move', target);
    }
    requestRepair(target, costs) {
      if (this.repairRequest) return;
      this.cancelLocalMenu();
      this.repairRequest = ++this.targetSequence;
      this.connection.send('action', { type: 'repair', sequence: this.repairRequest, target, costs: [...costs] }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
    }
    requestBuildingUpgrade(target, upgrade) {
      if (this.upgradeRequest) return;
      this.cancelLocalMenu(); this.upgradeRequest = ++this.targetSequence;
      this.connection.send('action', { type: upgrade.active ? 'cancelUpgrade' : 'upgradeBuilding', sequence: this.upgradeRequest, target, next: upgrade.next, ...(upgrade.active ? { episode: upgrade.episode } : { costs: [...upgrade.costs] }) }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
    }
    sendBuild(target, index, location, archetype) {
      return this.sendPlacement('build', target, index, location, archetype);
    }
    sendPlacement(type, target, index, location, archetype) {
      const sequence = ++this.targetSequence;
      this.connection.send('action', { type, sequence, target, index, location, ...(archetype === undefined ? {} : { archetype }) }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
      return sequence;
    }
    sendQuest(type, quest) {
      const sequence = ++this.targetSequence;
      this.connection.send('action', { type, sequence, target: this.identity.entity, quest }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
      return sequence;
    }
    sendUpgrade(target, index, level, amber) {
      const sequence = ++this.targetSequence;
      this.connection.send('action', { type: 'upgrade', sequence, target, index, level, amber }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
      return sequence;
    }
    receiveLife(value) {
      if (Object.hasOwn(value, 'life')) {
        const life = value.life;
        if (!['life', 'revive'].includes(value.type) || !life || Object.keys(life).length !== 5 || !['phase', 'remaining', 'episode', 'option', 'affordable'].every(key => Object.hasOwn(life, key)) || !['normal', 'dying', 'waiting'].includes(life.phase) || typeof life.remaining !== 'number' || !Number.isFinite(life.remaining) || life.remaining < 0 || life.remaining > 1e9 || ![null, 'amber', 'lumber'].includes(life.option) || typeof life.affordable !== 'boolean' || (life.phase !== 'waiting' && life.option !== null) || (life.phase === 'normal' && (life.remaining !== 0 || life.episode !== null)) || (life.phase !== 'normal' && (typeof life.episode !== 'number' || !Number.isFinite(life.episode) || Math.abs(life.episode) > 1e9)) || (life.option === null && life.affordable)) throw new Error('Invalid hero life state.');
        if (value.type === 'life' && value.sequence === this.lifeRequest || value.type === 'revive' && value.sequence === this.reviveRequest) {
          if (life.phase !== 'normal' && this.lifeState?.phase !== life.phase && !this.pauseMenu) this.cancelLocalMenu();
          this.lifeState = { ...life }; this.lifeReceivedAt = performance.now();
          if (life.phase === 'normal') this.game.getGuiManager?.()?.removeGameMessage?.('guest-revive');
        }
      }
      if (value.type === 'life' && value.sequence === this.lifeRequest) this.lifeRequest = null;
      if (value.type === 'revive' && value.sequence === this.reviveRequest) {
        this.reviveRequest = null; this.lastLifeQuery = -Infinity;
        if (!Object.hasOwn(value, 'life') && this.lifeState) { this.lifeState.option = null; this.lifeState.affordable = false; }
      }
    }
    updateLife() {
      if (!this.identity || !this.scene.snapshot || this.controls.paused || !this.movement.nativeFocused || this.resyncing) return false;
      const now = performance.now();
      if (!this.lifeRequest && !this.reviveRequest && now - this.lastLifeQuery >= 1000) {
        this.lastLifeQuery = now; this.lifeRequest = this.sendTarget('life', this.identity.entity);
      }
      const life = this.lifeState;
      if (!life || life.phase === 'normal') return false;
      const age = Math.max(0, (now - this.lifeReceivedAt) / 1000), remaining = Math.max(0, life.remaining - age);
      this.game.getGuiManager().addGameMessage('guest-revive', 'You have been knocked out', life.phase === 'dying' ? 'Recovering...' : remaining > 0 ? 'Revive in: ' + Math.ceil(remaining) + ' s' : 'Waiting for the host...', 2);
      if (age <= 2 && remaining > 0.200001 && life.option && life.affordable && !this.reviveRequest) {
        const amber = life.option === 'amber';
        if (this.game.getIMGui().doButton({ id: 'guest-revive', text1: 'BUY INSTANT REVIVE', text2: amber ? '10' : '50', v2ScreenLocation: this.controls.app.globals.guiRenderer.getv2RenderLocation(0, -140, 'bottom'), buttonType: this.controls.guiTypes.BUTTON_NORMAL, guiArchetype: amber ? 'respawnButtonAmber' : 'respawnButtonLumber' })) {
          const sequence = this.reviveRequest = ++this.targetSequence;
          this.connection.send('action', { type: 'revive', sequence, target: this.identity.entity, amber, episode: life.episode }).catch(error => { if (!this.connection.closed) this.connection.fail(error); });
        }
      }
      return true;
    }
    localMenu() { return !!(this.pauseMenu || this.selectedBuilding || this.demolition || this.construction?.menu || this.totem?.menu || this.quests?.description); }
    togglePauseMenu() {
      const open = !this.pauseMenu;
      this.cancelLocalMenu();
      this.pauseMenu = open;
      this.movement?.flush();
      if (open) this.recordUiEvent('pauseGame');
    }
    recordUiEvent(type) {
      if (this.closed || this.resyncing || !this.identity || !this.scene.snapshot || this.connection.closed || this.connection.state !== 'connected' || this.uiRequests.has(type)) return;
      this.uiRequests.set(type, this.sendTarget(type, this.identity.entity));
    }
    async toggleFullscreen() {
      const now = performance.now();
      if (this.closed || this.fullscreenChanging || now - (this.lastFullscreenRequest ?? -Infinity) < 500) return;
      this.fullscreenChanging = true; this.lastFullscreenRequest = now;
      try {
        if (root.document?.fullscreenElement) { await root.document.exitFullscreen(); if (this.controls.nativeFullscreen) await root.desktop.fullscreen(); }
        else await root.desktop.fullscreen();
      }
      catch (error) { console.error(error); const status = root.document?.getElementById?.('status'); if (!this.closed && status) status.textContent = 'Unable to change fullscreen: ' + error.message; }
      finally { this.fullscreenChanging = false; }
    }
    drawPauseMenu() {
      const gui = this.game.getIMGui(), renderer = this.controls.app.globals.guiRenderer;
      const location = (x, y, anchor) => renderer.getv2RenderLocation(x, y, anchor);
      if (this.pauseMenu) {
        gui.doBackground();
        this.game.getGuiManager().addDrawGui('bgPattern', { v2ScreenLocation: location(0, 0) }, 'guest-pause-background');
        this.game.getGuiManager().addDrawGui('polycraftLogo', { v2ScreenLocation: location(0, -260) }, 'guest-pause-logo');
        if (gui.doButton({ id: 'guest-resume', text: 'Resume', v2ScreenLocation: location(-220, -70), buttonType: this.controls.guiTypes.BUTTON_NORMAL, guiArchetype: 'buttonStart' })) this.cancelLocalMenu();
        this.controls.drawPauseSettings.call({ gameManager: this.game, globals: this.controls.app.globals }, this.sessionSettings);
        this.game.gameSoundManager.update();
      } else {
        if (gui.doButton({ id: 'guest-fullscreen', text: '', v2ScreenLocation: location(54, 52, 'topLeft'), buttonType: this.controls.guiTypes.BUTTON_IN_GAME_TINY, guiArchetype: this.controls.fullscreen ? 'minimize' : 'fullscreen', passive: true })) this.toggleFullscreen();
        if (gui.doButton({ id: 'guest-pause', text: '', v2ScreenLocation: location(116, 52, 'topLeft'), buttonType: this.controls.guiTypes.BUTTON_IN_GAME_TINY, guiArchetype: 'pause' })) this.togglePauseMenu();
      }
    }
    cancelLocalMenu() {
      this.pauseMenu = false;
      this.selectedBuilding = this.demolition = null;
      this.selectionRequest = null; this.construction?.cancel(); this.totem?.cancel(); this.quests?.cancel();
      this.guiInput.down = this.guiInput.pendingDown = false;
      this.movement?.keys.clear();
    }
    pointer(event, value) {
      const canvas = this.movement.canvas, bounds = canvas.getBoundingClientRect(), device = this.controls.app.globals.graphicsDevice;
      this.guiInput.position = [(value.clientX - bounds.left) * device.width / bounds.width, (value.clientY - bounds.top) * device.height / bounds.height];
      this.construction.pointer(event, value);
      if (value.button !== 0) return;
      if (event === (root.PointerEvent ? 'pointerdown' : 'mousedown')) this.guiInput.pendingDown = !this.controls.paused;
      if (event === (root.PointerEvent ? 'pointerup' : 'mouseup')) this.guiInput.pendingDown = false;
    }
    updateMenu() {
      if (this.updateLife()) return;
      if (this.quests?.update()) return;
      this.construction?.update(); this.totem?.update();
      const building = this.demolition || this.selectedBuilding;
      if (!building) return;
      const entry = this.scene.entities.get(building.id), record = entry?.record;
      if (!record || this.controls.paused || !this.movement.nativeFocused) { this.cancelLocalMenu(); return; }
      if (this.demolition) {
        const choice = this.controls.drawDemolitionPrompt(building);
        if (choice !== null) { this.cancelLocalMenu(); if (choice) this.sendTarget('demolish', building.id); }
        return;
      }
      const point = this.controls.app.globals.camera.worldToScreen(entry.displayLocation || record.location), gui = this.game.getIMGui();
      if (!point) { this.cancelLocalMenu(); return; }
      const count = (building.reason ? 0 : 1) + (building.movable ? 1 : 0), scale = gui.getRadialScaleFactor(count);
      const center = count > 1 ? gui.getRadialCentre(point, scale) : point;
      if (count > 1) this.game.getGuiManager().addDrawGui('radialFrame', { v2ScreenLocation: center, scale }, 'guest-building-frame');
      if (building.movable && gui.doButton({ id: 'guest-move-' + building.id, text: 'Move', v2ScreenLocation: count > 1 ? gui.addRadialOffset(center, 0, count, scale) : center, buttonType: this.controls.guiTypes.BUTTON_ROUND, guiArchetype: 'move' })) { this.requestMove(building.id); return; }
      if (!building.reason && gui.doButton({ id: 'guest-demolish-' + building.id, text: 'Demolish', v2ScreenLocation: count > 1 ? gui.addRadialOffset(center, count - 1, count, scale) : center, buttonType: this.controls.guiTypes.BUTTON_ROUND, guiArchetype: 'demolish' })) {
        this.demolition = building; this.selectedBuilding = null;
      }
    }
    drawHealth() {
      if (this.resyncing) return;
      const globals = this.controls.app.globals, elapsed = Math.max(0, (performance.now() - this.scene.receivedAt) / 1000);
      for (const entry of this.scene.entities.values()) {
        const health = entry.record.health;
        if (!health || !health.bar && !health.damage) continue;
        const location = () => entry.displayLocation || entry.record.location;
        const view = Object.assign(Object.create(this.controls.healthMethods), { globals, gameManager: this.game,
          entity: { globals, getName: () => entry.record.id, getv3Location: location, drawProgressBarFromFraction: this.controls.drawProgressBar },
          health: health.current, startHealth: health.maximum, getv3Location: location,
          archetype: { barLevel: health.bar?.level, drawOffScreenIconIfDamagedRecently: !!health.damage, onlyDrawIconIfOffScreen: health.damage?.onlyOffscreen, offScreenDamageIconArchetype: 'offScreenBuildingDamaged' },
          getTimeSinceHealthChange: () => Math.max(0, this.scene.snapshot.time - health.damage.changedAt) + elapsed });
        if (health.bar && health.maximum > 0) view.drawHealthBar(health.bar.row, health.bar.scale);
        if (health.damage && view.shouldDrawOffScreenIcon()) view.drawOffScreenIcon();
      }
    }
    drawCombatTarget() {
      if (this.resyncing) return;
      const combat = this.scene.snapshot?.combat, target = combat && this.scene.entities.get(combat.target);
      if (!target) return;
      this.controls.drawTargetCross.call({ gameManager: this.game, isWithinDamageRange: () => combat.inDamageRange,
        targetEntity: { getName: () => combat.target, getv3Location: () => target.displayLocation || target.record.location } });
    }
    updateTorch() {
      const lighting = this.game.gameLighting, node = lighting.heroLightNode, state = this.scene.torch;
      if (!node) return;
      if (state) {
        node.setLocalTransform(state.transform);
        const radius = lighting.heroLight.radius + 2;
        lighting.heroLight.halfExtents[0] = lighting.heroLight.halfExtents[1] = lighting.heroLight.halfExtents[2] = radius;
      }
      node.setDisabled(!state?.visible);
    }
    update() {
      const game = this.game, globals = this.controls.app.globals;
      globals.simpleFontRenderer.clearFontList(); globals.simpleSpriteRenderer.clearSpriteList();
      globals.debugDraw.clearDebugLineList(); game.guiManager.clearDrawList();
      game.imgui.clearDrawList(); game.imgui.clearValidation(); globals.guiRenderer.clearShakeAmount();
      this.guiInput.down = this.guiInput.pendingDown;
      const state = this.scene.snapshot;
      if (!state) return;
      this.scene.render();
      globals.gameCurrentTime = state.time;
      game.gameDayTime = state.dayTime;
      game.applyDayNightTime();
      this.viewCamera.update(); game.gameLighting.update();
      this.updateTorch();
      this.hasFrame = true;
      this.drawHealth();
      this.drawCombatTarget();
      this.hud.draw();
      if (!this.controls.paused && this.movement.nativeFocused) this.drawPauseMenu();
      if (!this.pauseMenu) this.updateMenu();
    }
    close() {
      if (this.closed) return;
      this.quests?.close();
      this.closed = true;
      this.game.getGuiManager?.()?.removeGameMessage?.('guest-revive');
      clearTimeout(this.resyncTimer); this.resyncing = false;
      this.movement.close();
      this.cancelLocalMenu(); this.game.imgui.controller = this.original.guiController;
      const game = this.game, app = this.controls.app, original = this.original;
      game.gameLighting.setShadowsEnabled(original.settings.shadows);
      game.gameSoundManager.setSoundsEnabled(original.settings.sounds);
      game.setMusicVolume(original.settings.music ? 1 : 0, 0);
      game.gameLighting.updateHeroLightPosition = original.heroLightUpdate;
      this.connection.onMessage = original.onMessage; this.connection.onState = original.onState;
      this.connection.close(); this.scene.close();
      for (const node of original.roots) app.globals.scene.addRootNode(node);
      app.updateGame = original.update; game.draw = original.draw; game.draw2D = original.draw2D; game.saveLevel = original.save;
      app.globals.gameCurrentTime = original.time; game.gameDayTime = original.dayTime; game.applyDayNightTime(true);
      game.getGameCamera = original.getCamera;
      const camera = game.getGameCamera();
      for (const [key, vector] of Object.entries(original.camera)) camera[key] = new Float32Array(vector);
      camera.currentFOV = original.fov; camera.apply();
      for (const light of original.lights) { light.node.setLocalTransform(new Float32Array(light.transform)); light.node.setDisabled(light.disabled); }
      game.gameClock.prevEngineTime = app.globals.appCurrentTime;
      camera.setShouldSnap(); game.getGameController().clearInputs();
      delete this.controls.guestWorld;
      this.controls.pause(original.paused);
    }
  }
  const api = { GuestScene, GuestWorld, GuestCamera };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftGuestWorld = api;
})(globalThis);
