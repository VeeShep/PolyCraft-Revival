'use strict';
(function (root) {
  const { validateSnapshot } = typeof module !== 'undefined' ? require('./world-state.js') : root.PolycraftWorldState;
  const { GuestMovement } = typeof module !== 'undefined' ? require('./coop-input.js') : root.PolycraftCoopInput;

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
      if (matrices) controller.output.setData(new Float32Array(matrices));
      else { controller?.output.destroy?.(); controller = null; }
      node.skinController = controller;
      function attach(child) {
        for (const renderable of child.renderables || []) if (renderable.isSkinned()) renderable.skinController = controller;
        for (const descendant of child.children || []) attach(descendant);
      }
      attach(node);
    }
    apply(value) {
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
      try {
        for (const { record, node } of next.values()) if (node) {
          node.setLocalTransform(new Float32Array(record.mesh.transform));
          node.enableHierarchy(record.mesh.visible);
          this.pose(node, record.mesh.skin);
        }
      } catch (error) {
        for (const node of created) this.remove(node);
        throw error;
      }
      for (const [id, previous] of this.entities) if (previous.node !== next.get(id)?.node) this.remove(previous.node);
      if (terrain !== this.terrain) for (const node of this.terrain) this.remove(node);
      this.terrain = terrain; this.terrainKey = terrainKey; this.entities = next;
      this.tick = snapshot.tick; this.snapshot = snapshot;
      return snapshot;
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      for (const node of this.terrain) this.remove(node);
      for (const { node } of this.entities.values()) this.remove(node);
      this.terrain = []; this.entities.clear(); this.snapshot = null;
    }
  }

  class GuestWorld {
    constructor(controls, connection) {
      if (!controls.ready() || controls.onlineWorld || controls.guestWorld || connection.role !== 'guest' || connection.closed) throw new Error('Joining needs a loaded renderer and an available guest connection.');
      this.controls = controls; this.connection = connection;
      this.game = controls.manager();
      const game = this.game, app = controls.app, globals = app.globals;
      const math = globals.mathDevice, camera = game.getGameCamera(), location = game.getHero().getv3Location();
      this.scene = new GuestScene(globals, game.getBlockFactory());
      this.original = {
        update: app.updateGame, draw: game.draw, draw2D: game.draw2D, save: game.saveLevel,
        time: globals.gameCurrentTime, dayTime: game.getGameDayTime(),
        paused: controls.paused,
        camera: Object.fromEntries(['desiredV3Focus', 'desiredV3Position', 'currentV3Focus', 'currentV3Position', 'currentV3Up', 'currentv3Direction'].filter(key => camera[key]).map(key => [key, Array.from(camera[key])])),
        fov: camera.currentFOV,
        lights: [game.gameLighting.worldDirectionLightNode, game.gameLighting.heroLightNode].filter(Boolean).map(node => ({ node, transform: Array.from(node.getLocalTransform()), disabled: node.disabled })),
        onMessage: connection.onMessage, onState: connection.onState,
        roots: globals.scene.rootNodes.filter(node => node !== game.gameLighting.worldDirectionLightNode && node !== game.gameLighting.heroLightNode)
      };
      this.focusOffset = math.v3Sub(camera.desiredV3Focus, location);
      this.positionOffset = math.v3Sub(camera.desiredV3Position, location);
      controls.guestWorld = this;
      for (const node of this.original.roots) globals.scene.removeRootNode(node);
      app.updateGame = () => this.update();
      game.draw = game.draw2D = () => {};
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
          this.scene.apply(message.payload);
          // A rank-up recreates the entity; the assigned saved player identity stays unchanged.
          if (this.identity) this.identity.entity = message.payload.hero;
        }
        else if (message.kind === 'end') this.close();
        this.original.onMessage?.(message, link);
      };
      connection.onState = (state, details) => {
        if (state === 'closed') this.close();
        this.original.onState?.(state, details);
      };
      this.movement = new GuestMovement(this);
    }
    update() {
      const game = this.game, globals = this.controls.app.globals;
      globals.simpleFontRenderer.clearFontList(); globals.simpleSpriteRenderer.clearSpriteList();
      globals.debugDraw.clearDebugLineList(); game.guiManager.clearDrawList();
      game.imgui.clearDrawList(); game.imgui.clearValidation(); globals.guiRenderer.clearShakeAmount();
      const state = this.scene.snapshot;
      if (!state) return;
      globals.gameCurrentTime = state.time;
      game.gameDayTime = state.dayTime;
      game.applyDayNightTime();
      const camera = game.getGameCamera(), math = globals.mathDevice;
      const hero = this.scene.entities.get(state.hero).record;
      camera.setDesiredFocus(math.v3Add(hero.location, this.focusOffset));
      camera.setDesiredPosition(math.v3Add(hero.location, this.positionOffset));
      camera.blendLerp(this.hasFrame ? camera.getTimeAdjustedBlendFactor(0.15) : 1);
      camera.apply(); game.gameLighting.update();
      const torch = game.gameLighting.heroLightNode;
      if (torch && state.torch) { torch.setLocalTransform(new Float32Array(state.torch.transform)); torch.setDisabled(!state.torch.visible); }
      this.hasFrame = true;
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.movement.close();
      const game = this.game, app = this.controls.app, original = this.original;
      this.connection.onMessage = original.onMessage; this.connection.onState = original.onState;
      this.connection.close(); this.scene.close();
      for (const node of original.roots) app.globals.scene.addRootNode(node);
      app.updateGame = original.update; game.draw = original.draw; game.draw2D = original.draw2D; game.saveLevel = original.save;
      app.globals.gameCurrentTime = original.time; game.gameDayTime = original.dayTime; game.applyDayNightTime(true);
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
  const api = { GuestScene, GuestWorld };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftGuestWorld = api;
})(globalThis);
