'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-coop-identities-'));
  const applications = [], pages = [], errors = [], requests = [], originals = [];
  try {
    for (const role of ['host', 'guest-one', 'guest-two', 'guest-three']) {
      const application = await electron.launch({ args: ['.'], env: { ...process.env, POLYCRAFT_TEST_DATA: path.join(directory, role) }, timeout: 90000 });
      applications.push(application);
      const page = await application.firstWindow(); pages.push(page);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
      await application.evaluate(({ BrowserWindow }, role) => BrowserWindow.getAllWindows()[0].setTitle('PolyCraft temporary ' + role + ' — co-op identities test'), role);
      page.on('pageerror', error => errors.push(role + ': ' + error.message));
      page.on('request', request => requests.push(request.url()));
      await page.locator('#new-name').fill('Temporary identity ' + role);
      await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
      await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateStartScreen');
      await application.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
      const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
      const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
      await canvas.focus(); await page.mouse.move(10, 10);
      await page.mouse.move(bounds.x + play[0], bounds.y + play[1], { steps: 5 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay, null, { timeout: 5000 });
      await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying', null, { timeout: 10000 });
      const state = await page.evaluate(async () => {
        const game = window.polycraft.controls.manager();
        game.runScripts = false; game.setScriptLocked(false); game.activeGameState.setPlayState('PlayStateNormal');
        await window.polycraft.checkpoint(); return JSON.stringify(window.polycraft.bridge.state);
      });
      const saves = path.join(directory, role, 'saves'), file = path.join(saves, fs.readdirSync(saves).find(name => name.endsWith('.json')));
      originals.push({ state, file, bytes: fs.readFileSync(file) });
      console.log('Visible temporary game ready:', role);
    }
    const host = pages[0];
    async function focus(index) {
      const page = pages[index];
      for (let attempt = 0; attempt < 2; attempt++) {
        await applications[index].evaluate(({ app, BrowserWindow }) => {
          app.focus({ steal: true });
          const window = BrowserWindow.getAllWindows()[0]; window.show(); window.moveTop(); window.focus();
        });
        await page.bringToFront(); await page.locator('#turbulenz_game_engine_canvas').focus();
        try {
          await page.waitForFunction(() => document.hasFocus() && (!window.guestWorld || window.guestWorld.movement.nativeFocused), null, { timeout: 5000 });
          return;
        } catch (error) { if (attempt) throw error; }
      }
    }
    const ids = await host.evaluate(async () => {
      window.hostErrors = [];
      window.hostSession = new window.PolycraftMultiplayer.HostSession({ onError: (peer, error) => window.hostErrors.push(error.message) });
      window.hostWorld = await window.PolycraftOnlineWorld.startHostingWorld(window.polycraft.controls, window.hostSession);
      const players = await window.hostWorld.enablePlayers(window.polycraft.bridge);
      return ['One', 'Two', 'Three'].map(name => players.registry.addPlayer(name).id);
    });
    async function join(index) {
      const offer = await host.evaluate(id => window.hostWorld.createPlayerInvitation(id), ids[index - 1]);
      const joinedState = await pages[index].evaluate(async invitation => {
        const joined = await window.PolycraftMultiplayer.PeerLink.join(invitation);
        window.connection = joined.connection;
        window.connectionErrors = [];
        window.connection.onError = error => window.connectionErrors.push(error.message);
        const state = JSON.stringify(window.polycraft.bridge.state);
        window.guestWorld = new window.PolycraftGuestWorld.GuestWorld(window.polycraft.controls, joined.connection);
        return { reply: joined.reply, state };
      }, offer.invitation);
      originals[index].state = joinedState.state; originals[index].bytes = fs.readFileSync(originals[index].file);
      await host.evaluate(reply => window.hostSession.acceptReply(reply), joinedState.reply);
      await pages[index].waitForFunction(() => window.guestWorld.scene.snapshot || window.connection.closed, null, { timeout: 45000 });
      assert.equal(await pages[index].evaluate(() => window.connection.closed), false, await pages[index].evaluate(() => JSON.stringify(window.connectionErrors)));
      const result = await pages[index].evaluate(() => ({ identity: window.guestWorld.identity, hero: window.guestWorld.scene.snapshot.hero, tick: window.guestWorld.scene.tick }));
      assert.equal(result.identity.playerId, ids[index - 1]); assert.equal(result.hero, result.identity.entity);
      console.log('Assigned guest hero:', index, result.identity.playerId);
      return offer;
    }
    const offers = [];
    for (let index = 1; index <= 3; index++) offers.push(await join(index));
    const assigned = await host.evaluate(() => ({ count: window.hostWorld.players.active.size,
      peers: [...window.hostSession.peers.values()].map(connection => ({ id: window.hostWorld.playerFor(connection).id, hero: window.hostWorld.playerFor(connection).hero.getName() })) }));
    assert.equal(assigned.count, 4); assert.equal(new Set(assigned.peers.map(peer => peer.id)).size, 3);
    assert.deepEqual(assigned.peers.map(peer => peer.id), ids);
    const motionStart = await host.evaluate(() => {
      const game = window.hostWorld.game;
      window.motionHistory = new Map(); window.motionOriginalUpdate = game.updateSimulation;
      function positions() {
        return Object.fromEntries([...window.hostWorld.players.active.values()].map(({ hero }) => [hero.getName(), { location: Array.from(hero.getv3Location()), rotation: hero.getRotationY() }]));
      }
      game.updateSimulation = function (...args) {
        const result = window.motionOriginalUpdate.apply(game, args);
        window.motionHistory.set(game.gameClock.getFrameIndex(), positions());
        if (window.motionHistory.size > 2048) window.motionHistory.delete(window.motionHistory.keys().next().value);
        return result;
      };
      return { tick: game.gameClock.getFrameIndex(), positions: positions() };
    });
    for (let index = 1; index <= 3; index++) await pages[index].evaluate(start => {
      window.motionSamples = [];
      const receive = window.connection.onMessage, names = Object.keys(start.positions);
      window.connection.onMessage = (message, link) => {
        receive(message, link);
        if (['snapshot', 'update'].includes(message.kind) && message.payload.tick > start.tick) {
          const records = message.payload.spaces.flatMap(space => space.entities).filter(entity => names.includes(entity.id));
          const heroes = Object.fromEntries(records.map(record => [record.id, { location: record.location, rotation: record.rotation }]));
          const rendered = records.every(record => !record.mesh || JSON.stringify(Array.from(window.guestWorld.scene.entities.get(record.id).node.getLocalTransform())) === JSON.stringify(record.mesh.transform));
          window.motionSamples.push({ tick: message.payload.tick, heroes, rendered });
          if (window.motionSamples.length > 2048) window.motionSamples.shift();
        }
      };
    }, motionStart);
    await focus(0);
    for (const key of ['w', 'd', 's', 'a', 'w', 'd', 's', 'a']) {
      await host.keyboard.down(key); await host.waitForTimeout(500); await host.keyboard.up(key);
    }
    for (let index = 1; index <= 3; index++) {
      const guest = pages[index];
      await focus(index);
      if (index === 1) {
        await guest.keyboard.down('w'); await guest.waitForTimeout(500);
        const tick = await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex());
        await guest.evaluate(() => window.polycraft.controls.pause(true));
        await host.waitForFunction(id => !window.hostWorld.guestSlots.get(id).input.moving, ids[index - 1]);
        await guest.waitForTimeout(500);
        assert.ok(await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex()) > tick, 'Guest menus stop their input without stopping the shared world');
        await guest.keyboard.up('w'); await guest.evaluate(() => window.polycraft.controls.pause(false));
      }
      if (index === 2) await host.evaluate(() => window.polycraft.controls.pause(true));
      for (const key of index === 2 ? ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'] : ['w', 'd', 's', 'a']) {
        await guest.keyboard.down(key); await guest.waitForTimeout(500); await guest.keyboard.up(key);
      }
      if (index === 2) await host.evaluate(() => window.polycraft.controls.pause(false));
      if (index === 3) {
        await guest.keyboard.down('w'); await guest.waitForTimeout(500);
        await applications[index].evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
        await applications[0].evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
        // Playwright emulates document focus; check the native window signal instead.
        await guest.waitForFunction(() => !window.guestWorld.movement.nativeFocused);
        await host.waitForFunction(id => !window.hostWorld.guestSlots.get(id).input.moving, ids[index - 1]);
        await guest.keyboard.up('w');
      }
    }
    await host.waitForTimeout(1000);
    const samples = [];
    for (let index = 1; index <= 3; index++) samples.push(await pages[index].evaluate(() => window.motionSamples));
    const history = await host.evaluate(() => {
      const game = window.hostWorld.game, history = Object.fromEntries(window.motionHistory);
      for (const { hero } of window.hostWorld.players.active.values()) hero.getEC('ECLocomotion').clearDestination();
      game.updateSimulation = window.motionOriginalUpdate;
      return history;
    });
    const movement = {};
    for (const [name, start] of Object.entries(motionStart.positions)) {
      movement[name] = Math.max(...Object.values(history).map(frame => Math.hypot(frame[name].location[0] - start.location[0], frame[name].location[2] - start.location[2])));
      assert.ok(movement[name] > 0.2, name + ' must actually move horizontally, not just fall or remain stationary');
    }
    samples.forEach((received, index) => {
      const matched = received.filter(sample => history[sample.tick]);
      assert.ok(matched.length >= 8, 'Guest ' + (index + 1) + ' must receive multiple moving-world samples');
      for (const sample of matched) {
        assert.deepEqual(sample.heroes, history[sample.tick], 'Every hero position/rotation matches the authoritative host at tick ' + sample.tick);
        assert.equal(sample.rendered, true, 'Visible hero node transforms match their received poses');
      }
      for (const name of Object.keys(motionStart.positions)) {
        const first = matched[0].heroes[name].location;
        const distance = Math.max(...matched.map(sample => Math.hypot(sample.heroes[name].location[0] - first[0], sample.heroes[name].location[2] - first[2])));
        assert.ok(distance > 0.2, 'Guest ' + (index + 1) + ' must observe ' + name + ' actually moving');
      }
    });
    console.log('Moving-player sync passed:', { distances: movement, samples: samples.map(received => received.filter(sample => history[sample.tick]).length) });
    if (process.argv.includes('--movement-only')) {
      await host.evaluate(() => window.hostWorld.close());
      for (let index = 1; index <= 3; index++) {
        await pages[index].waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld);
        assert.equal(await pages[index].evaluate(() => JSON.stringify(window.polycraft.bridge.state)), originals[index].state);
        assert.deepEqual(fs.readFileSync(originals[index].file), originals[index].bytes);
      }
      assert.deepEqual(await host.evaluate(() => window.hostErrors), []);
      assert.deepEqual(errors, []);
      assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
      console.log('PASS: four visible games; keyboard movement; every guest observes all four moving heroes with exact same-tick host poses; menu/focus stops; guest saves unchanged on host exit. Same-Mac acceptance only.');
      return;
    }
    const resource = await host.evaluate(async id => window.hostWorld.atBoundary(() => {
      const game = window.hostWorld.game, hero = window.hostWorld.players.active.get(id).hero;
      const target = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECResourceDispenser')).find(entity => !entity.shouldBeDestroyed() && entity.getEC('ECInteractable')?.getActive() && entity.getEC('ECResourceDispenser').getResource() > 1 && entity.getEC('ECMesh'));
      if (!target) throw new Error('The temporary island needs a live resource for click acceptance.');
      const point = Array.from(target.getv3Location()); point[0] += 1;
      hero.teleport(point);
      window.gatherEvents = [];
      game.eventManager.subscribe('InteractWithResourceDispenser', event => { if (event.interactor === hero && event.resourceDispenser === target) window.gatherEvents.push(event.amount); });
      return { id: target.getName(), remaining: target.getEC('ECResourceDispenser').getResource() };
    }), ids[0]);
    const guest = pages[1];
    await focus(1);
    await guest.waitForTimeout(1000);
    const click = await guest.evaluate(id => {
      const world = window.guestWorld, globals = world.controls.app.globals;
      const record = world.scene.entities.get(id).record, point = globals.camera.worldToScreen(record.location);
      const canvas = document.getElementById('turbulenz_game_engine_canvas'), bounds = canvas.getBoundingClientRect();
      const event = { clientX: bounds.left + point[0] * bounds.width / globals.graphicsDevice.width, clientY: bounds.top + point[1] * bounds.height / globals.graphicsDevice.height };
      if (window.PolycraftCoopActions.pickTarget(world, event) !== id) throw new Error('Resource click must select the actual visible target.');
      return event;
    }, resource.id);
    await guest.mouse.click(click.clientX, click.clientY);
    await guest.waitForFunction(() => window.guestWorld.lastTargetResult);
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Resources gathered.');
    const gathered = await host.evaluate(id => ({ remaining: window.hostWorld.game.getGameEntityByName(id).getEC('ECResourceDispenser').getResource(), events: window.gatherEvents }), resource.id);
    assert.equal(gathered.events.length, 1); assert.ok(gathered.events[0] > 0);
    assert.equal(gathered.remaining, resource.remaining - gathered.events[0]);
    const protectedHero = await host.evaluate(() => {
      const players = window.hostWorld.players, hostHero = players.active.get(players.registry.data.host).hero;
      return hostHero.getName();
    });
    await guest.evaluate(target => window.connection.send('action', { type: 'target', sequence: ++window.guestWorld.targetSequence, target }), protectedHero);
    await guest.waitForFunction(() => window.guestWorld.lastTargetResult.sequence === 2);
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Friendly targets are protected.');
    console.log('Guest pointer gathered one original resource through the host; PvP-off rejects an allied hero attack.');
    const build = await host.evaluate(async id => window.hostWorld.atBoundary(() => {
      const world = window.hostWorld, game = world.game, hero = world.players.active.get(id).hero, builder = hero.getEC('ECPlayerBuilder');
      // Exercise placement in an unlocked disposable settlement, separately from tutorial progression.
      if (!game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false).length) {
        const position = Array.from(game.getHero().getv3Location()); position[2] += 6;
        const headquarters = game.getEntityFactory().createInactiveEntityInstance('TemporaryBuildHQ', 'a_b_hq', game.placeOnGround(position, 0.5), 0);
        headquarters.getEC('ECFaction').setFaction(game.getFactionManager().getHeroFactionName()); headquarters.activate();
      }
      window.SetBuildingTypeEnabled({ globals: game.globals, script: { add: command => command.update() } }, 'Wall', true);
      const amounts = window.polycraft.controls.amounts(); window.polycraft.controls.setAmounts(1000, amounts.woodCap, amounts.stoneCap);
      const sources = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECDispenser'));
      const diagnostics = [];
      for (const source of sources) {
        const dispenser = source.getEC('ECDispenser');
        const owner = source.getEC('ECAttach')?.getBaseEntity() || source;
        if (dispenser.archetype.destroySelfOnDispense || !owner.isFriendlyWith(hero)) continue;
        dispenser.evaluateProductInfo();
        for (let index = 0; index < dispenser.contents.length; index++) {
          diagnostics.push({ source: source.getName(), product: dispenser.getDispensedArchetypeName(index), valid: dispenser.getValid(index), affordable: dispenser.canAfford(hero, index) });
          if (!dispenser.getValid(index) || !dispenser.canAfford(hero, index)) continue;
          const archetype = dispenser.getDispensedArchetypeName(index);
          builder.placeInHand(archetype, 1, false, false, dispenser.buildingParentEntity, true);
          try {
            const center = source.getv3Location();
            for (let x = -10; x <= 10; x += 2) for (let z = -10; z <= 10; z += 2) {
              const location = [center[0] + x, center[1], center[2] + z];
              if (!world.construction.canPlace(builder) || !builder.canBuildAtPosition(builder.getv3BuildLocation(location))) continue;
              window.buildEvents = [];
              game.eventManager.subscribe('BuildingEvent', event => { if (event.reason === 'placed' && event.building === hero) window.buildEvents.push(event.scaffold.getName()); });
              return { source: source.getName(), index, location, archetype,
                costs: [dispenser.getResourceCost(index), dispenser.getSecondaryResourceCost(index), dispenser.getSoftCurrencyCost(index)],
                before: window.polycraft.controls.amounts() };
            }
          } finally { builder.clearInHand(); }
        }
      }
      throw new Error('No eligible original building placement in temporary fixture: ' + JSON.stringify(diagnostics));
    }), ids[0]);
    await host.evaluate(async ({ id, source }) => window.hostWorld.atBoundary(() => {
      const game = window.hostWorld.game, position = Array.from(game.getGameEntityByName(source).getv3Location()); position[0] += 3;
      window.hostWorld.players.active.get(id).hero.teleport(game.placeOnGround(position, 1));
    }), { id: ids[0], source: build.source });
    await guest.waitForTimeout(1000);
    const buildLocations = await host.evaluate(async ({ id, source, index }) => window.hostWorld.atBoundary(() => {
      const world = window.hostWorld, hero = world.players.active.get(id).hero, entity = world.game.getGameEntityByName(source), center = entity.getv3Location();
      const locations = [];
      for (let x = -10; x <= 10; x += 2) for (let z = -10; z <= 10; z += 2) {
        const point = [center[0] + x, hero.getv3Location()[1], center[2] + z];
        if (world.construction.preview(hero, entity, index, point).preview.valid) locations.push(point);
      }
      if (!locations.length) throw new Error('No valid preview after moving the temporary hero near its workshop.');
      return locations;
    }), { id: ids[0], source: build.source, index: build.index });
    await clickEntity(build.source);
    await guest.waitForFunction(source => window.guestWorld.construction.menu?.source === source, build.source);
    assert.deepEqual(await host.evaluate(() => window.polycraft.controls.amounts()), build.before, 'Opening the product menu spends nothing');
    await guest.waitForFunction(({ source, index }) => window.guestWorld.game.guiManager.prevDrawGuiMap['guest-build-' + source + '-' + index]?.scale > 0.95, { source: build.source, index: build.index });
    fs.mkdirSync('test-results', { recursive: true }); await guest.screenshot({ path: 'test-results/coop-build-menu.png' });
    await clickEntity(build.source);
    await guest.waitForFunction(() => window.guestWorld.construction.placement);
    const placementPoint = await guest.evaluate(locations => {
      const world = window.guestWorld, globals = world.controls.app.globals, hero = world.scene.entities.get(world.identity.entity).record;
      const bounds = world.movement.canvas.getBoundingClientRect();
      const candidates = locations.map(location => {
        const point = globals.camera.worldToScreen([location[0], hero.location[1], location[2]]);
        return point && { location, x: bounds.left + point[0] * bounds.width / globals.graphicsDevice.width, y: bounds.top + point[1] * bounds.height / globals.graphicsDevice.height };
      });
      const visible = candidates.find(point => point && point.x > bounds.left + 60 && point.x < bounds.right - 60 && point.y > bounds.top + 60 && point.y < bounds.bottom - 100);
      if (!visible) throw new Error('Need a host-valid footprint inside the guest canvas: ' + JSON.stringify({ bounds: bounds.toJSON(), candidates }));
      return { ...visible, firstCandidate: candidates[0], bounds: bounds.toJSON() };
    }, buildLocations);
    build.location = placementPoint.location;
    console.log('Visible placement candidate:', placementPoint);
    await guest.mouse.move(placementPoint.x, placementPoint.y);
    await guest.waitForFunction(location => {
      const cursor = window.guestWorld.construction.cursor();
      return cursor && Math.hypot(cursor[0] - location[0], cursor[2] - location[2]) < 0.15;
    }, build.location);
    await guest.waitForFunction(() => { const ui = window.guestWorld.construction; return ui.preview?.valid && ui.matches(ui.preview.location); });
    const expectedPlacement = await guest.evaluate(() => [...window.guestWorld.construction.preview.position]);
    assert.deepEqual(await host.evaluate(() => window.polycraft.controls.amounts()), build.before, 'Previewing a building spends nothing');
    await guest.screenshot({ path: 'test-results/coop-build-preview.png' });
    await guest.mouse.click(placementPoint.x, placementPoint.y, { delay: 100 });
    await guest.waitForFunction(() => window.guestWorld.construction.lastBuildResult);
    assert.equal(await guest.evaluate(() => window.guestWorld.construction.lastBuildResult.message), 'Building placed and saved.');
    assert.equal(await guest.evaluate(() => !!window.guestWorld.construction.placement), true, 'Original repeat-building products retain the local blueprint');
    await guest.keyboard.press('Escape');
    await guest.waitForFunction(() => !window.guestWorld.construction.placement);
    const built = await host.evaluate(() => ({ amounts: window.polycraft.controls.amounts(), pending: window.hostWorld.construction.pending.size, events: window.buildEvents }));
    assert.equal(built.pending, 0); assert.equal(built.events.length, 1);
    assert.equal(built.amounts.wood, build.before.wood - build.costs[0]); assert.equal(built.amounts.stone, build.before.stone - build.costs[1]);
    assert.equal(built.amounts.amber, build.before.amber - build.costs[2]);
    const builtSave = JSON.parse(fs.readFileSync(originals[0].file));
    const savedScaffold = JSON.parse(builtSave.state.userData.AdventureIncGameState).gameSpaceList.flatMap(space => space.entityList).find(entity => entity.name === built.events[0]);
    assert.ok(savedScaffold, 'The paid scaffold exists on disk before acceptance');
    assert.ok(Math.hypot(savedScaffold.v3Location[0] - expectedPlacement[0], savedScaffold.v3Location[2] - expectedPlacement[2]) < 0.01, 'The saved scaffold occupies the confirmed preview footprint');
    console.log('Original guest build accepted:', { archetype: build.archetype, costs: build.costs, scaffold: built.events[0], pending: built.pending });
    const storage = await host.evaluate(async id => window.hostWorld.atBoundary(() => {
      const controls = window.polycraft.controls, game = controls.manager(), before = controls.amounts().woodCap;
      const faction = game.getFactionManager().getHeroFactionName(), parent = game.getFactionManager().getFactionByName(faction).getHQ();
      const point = Array.from(window.hostWorld.players.active.get(id).hero.getv3Location()); point[0] += 3; point[2] += 3;
      const building = game.getEntityFactory().createInactiveEntityInstance('TemporaryCoopStorage', 'a_b_lumberstorage', point, 0);
      building.getEC('ECBuilding').setBuildingParentEntity(parent); building.getEC('ECFaction').setFaction(faction); building.activate();
      const after = controls.amounts().woodCap, info = controls.demolitionInfo(building);
      if (!info || info.reason || after <= before) throw new Error('Need an eligible temporary storage with real capacity.');
      return { id: building.getName(), before, after };
    }), ids[0]);
    await guest.waitForFunction(id => window.guestWorld.scene.entities.has(id), storage.id);
    async function clickEntity(id) {
      const point = await guest.evaluate(id => {
        const world = window.guestWorld, globals = world.controls.app.globals, record = world.scene.entities.get(id).record;
        const point = globals.camera.worldToScreen(record.location), bounds = world.movement.canvas.getBoundingClientRect();
        const result = { x: bounds.left + point[0] * bounds.width / globals.graphicsDevice.width, y: bounds.top + point[1] * bounds.height / globals.graphicsDevice.height };
        return { ...result, picked: window.PolycraftCoopActions.pickTarget(world, { clientX: result.x, clientY: result.y }), visible: record.mesh?.visible, available: world.movement.available() };
      }, id);
      if (!await guest.evaluate(() => window.guestWorld.localMenu())) assert.equal(point.picked, id, 'Visible target pick: ' + JSON.stringify(point));
      await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150); await guest.mouse.click(point.x, point.y, { delay: 100 });
    }
    async function openDemolition() {
      await clickEntity(storage.id);
      await guest.waitForFunction(id => window.guestWorld.selectedBuilding?.id === id, storage.id);
      await clickEntity(storage.id);
      await guest.waitForFunction(id => window.guestWorld.demolition?.id === id, storage.id);
      await guest.waitForFunction(() => window.guestWorld.game.guiManager.prevDrawGuiMap['demolition-dialog']?.scale > 0.95);
    }
    async function clickDemolition(cancel) {
      const point = await guest.evaluate(cancel => {
        const world = window.guestWorld, globals = world.controls.app.globals;
        const point = cancel ? globals.guiRenderer.getv2RenderLocation(-100, 100, 'topRight') : globals.guiRenderer.getv2RenderLocation(0, 0);
        const bounds = world.movement.canvas.getBoundingClientRect();
        return { x: bounds.left + point[0] * bounds.width / globals.graphicsDevice.width, y: bounds.top + point[1] * bounds.height / globals.graphicsDevice.height };
      }, cancel);
      await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150); await guest.mouse.click(point.x, point.y, { delay: 100 });
      await guest.waitForFunction(() => !window.guestWorld.localMenu());
    }
    await openDemolition();
    const menuTick = await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex());
    await guest.keyboard.down('w'); await guest.waitForTimeout(300); await guest.keyboard.up('w');
    assert.ok(await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex()) > menuTick, 'Original guest confirmation leaves the host simulation running');
    assert.equal(await host.evaluate(id => window.hostWorld.guestSlots.get(id).input.moving, ids[0]), false);
    fs.mkdirSync('test-results', { recursive: true }); await guest.screenshot({ path: 'test-results/coop-demolition-confirmation.png' });
    await clickDemolition(true);
    assert.equal(await host.evaluate(id => !!window.hostWorld.game.getGameEntityByName(id), storage.id), true);
    await openDemolition();
    await host.evaluate(() => {
      const controls = window.polycraft.controls, original = controls.checkpoint;
      const gate = new Promise(resolve => { window.releaseOlderSave = resolve; });
      controls.checkpoint = async function (...args) { const snapshot = await original.apply(this, args); window.olderCaptured = true; await gate; return snapshot; };
      window.restoreCheckpoint = () => { controls.checkpoint = original; };
      window.olderSave = window.polycraft.checkpoint();
    });
    await host.waitForFunction(() => window.olderCaptured);
    await clickDemolition(false);
    await host.waitForFunction(id => !window.hostWorld.game.getGameEntityByName(id), storage.id);
    assert.notEqual(await guest.evaluate(() => window.guestWorld.lastTargetResult.type), 'demolish', 'Do not acknowledge removal while an older checkpoint is still pending');
    await host.evaluate(async () => { window.releaseOlderSave(); await window.olderSave; window.restoreCheckpoint(); });
    await guest.waitForFunction(() => window.guestWorld.lastTargetResult.type === 'demolish');
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Building demolished and saved.');
    assert.equal(await host.evaluate(() => window.polycraft.controls.amounts().woodCap), storage.before);
    const savedHost = JSON.parse(fs.readFileSync(originals[0].file));
    assert.equal(JSON.parse(savedHost.state.userData.AdventureIncGameState).gameSpaceList.some(space => space.entityList.some(entity => entity.name === storage.id)), false);
    console.log('Original guest demolition UI: cancel preserves storage, confirm removes capacity, host keeps simulating, fresh disk save precedes acknowledgement despite an overlapping older capture.');
    await host.evaluate(async id => window.hostWorld.atBoundary(() => {
      const entry = window.hostWorld.players.active.get(id); entry.hero.getEC('ECPlayerData').adjustXP(33);
    }), ids[0]);
    const firstTick = await pages[2].evaluate(() => window.guestWorld.scene.tick);
    await pages[1].evaluate(other => window.connection.send('hello', { version: 1, playerId: other }), ids[1]);
    await pages[1].waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld);
    assert.equal(await pages[1].evaluate(() => JSON.stringify(window.polycraft.bridge.state)), originals[1].state);
    assert.deepEqual(fs.readFileSync(originals[1].file), originals[1].bytes);
    await host.waitForFunction(id => !window.hostWorld.guestSlots.has(id) && !window.hostWorld.players.active.has(id), ids[0]);
    assert.equal(await host.evaluate(id => window.hostWorld.players.registry.player(id).progress.xp, ids[0]), 33);
    await pages[2].waitForFunction(tick => window.guestWorld.scene.tick > tick, firstTick);
    assert.equal(await pages[2].evaluate(() => window.connection.closed), false);
    const returning = await join(1);
    assert.notEqual(returning.peer, offers[0].peer);
    assert.equal(await host.evaluate(id => window.hostWorld.players.active.get(id).model.getXP(), ids[0]), 33);
    await host.evaluate(() => window.hostWorld.close());
    for (let index = 1; index <= 3; index++) {
      await pages[index].waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld);
      assert.equal(await pages[index].evaluate(() => JSON.stringify(window.polycraft.bridge.state)), originals[index].state);
      assert.deepEqual(fs.readFileSync(originals[index].file), originals[index].bytes);
    }
    await host.evaluate(async () => {
      window.hostSession = new window.PolycraftMultiplayer.HostSession({ pvp: true, onError: (peer, error) => window.hostErrors.push(error.message) });
      window.hostWorld = await window.PolycraftOnlineWorld.startHostingWorld(window.polycraft.controls, window.hostSession);
      await window.hostWorld.enablePlayers(window.polycraft.bridge);
    });
    await join(1);
    const combat = await host.evaluate(async id => window.hostWorld.atBoundary(() => {
      const world = window.hostWorld, game = world.game, target = game.getHero(), attacker = world.players.active.get(id).hero;
      const position = Array.from(target.getv3Location());
      const destinations = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([x, z]) => [position[0] + x, position[1], position[2] + z]);
      const free = destinations.find(point => { const hit = game.getCollisionInfo(position, point, false, target); return !hit; });
      if (!free) throw new Error('Need a clear projectile path in this disposable island.');
      attacker.teleport(free); attacker.getEC('ECInventory').equipWeapon('wp_h_pistol');
      return { target: target.getName(), health: target.getEC('ECHealth').getHealth() };
    }), ids[0]);
    await pages[1].evaluate(target => window.connection.send('action', { type: 'target', sequence: ++window.guestWorld.targetSequence, target }), combat.target);
    await pages[1].waitForFunction(() => window.guestWorld.lastTargetResult);
    assert.equal(await pages[1].evaluate(() => window.guestWorld.lastTargetResult.message), 'Attack issued.');
    await host.waitForFunction(health => window.hostWorld.game.getHero().getEC('ECHealth').getHealth() < health, combat.health, { timeout: 10000 });
    await pages[1].waitForFunction(({ target, health }) => window.guestWorld.scene.entities.get(target).record.health.current < health, combat);
    console.log('PvP-on guest pistol hit damages the live host hero and replicates the reduced health.');
    await host.evaluate(() => window.hostWorld.close());
    await pages[1].waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld);
    assert.equal(await pages[1].evaluate(() => JSON.stringify(window.polycraft.bridge.state)), originals[1].state);
    assert.deepEqual(fs.readFileSync(originals[1].file), originals[1].bytes);
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    const rejected = await host.evaluate(() => window.hostErrors);
    assert.equal(rejected.length, 1); assert.match(rejected[0], /Guests cannot select heroes/);
    console.log('PASS: four visible Electron games; assigned heroes; all four heroes move; every guest matches same-tick host positions/rotations and visible mesh poses; original gathering; original guest build/cost/throw/scaffold/save; original guest demolition/cancel and fresh save ordering; PvP-off protection; real PvP-on pistol damage and replicated health; forged identity isolation; reconnect restores XP; host exit preserves guest saves.');
    console.log('Same-Mac acceptance only. Full HUD/actions, broader combat/PvP and real-network/platform acceptance remain open.');
  } catch (error) {
    fs.mkdirSync('test-results', { recursive: true });
    for (let index = 0; index < pages.length; index++) try {
      console.log('Failure state', index, JSON.stringify(await pages[index].evaluate(() => ({ hostErrors: window.hostErrors, connectionErrors: window.connectionErrors,
        connection: window.connection && { closed: window.connection.closed, state: window.connection.state }, focused: document.hasFocus(),
        movement: window.guestWorld?.movement && { keys: [...window.guestWorld.movement.keys], available: window.guestWorld.movement.available(), nativeFocused: window.guestWorld.movement.nativeFocused },
        identity: window.guestWorld?.identity, tick: window.guestWorld?.scene.tick,
        action: window.guestWorld && { sequence: window.guestWorld.targetSequence, selection: window.guestWorld.selectionRequest, result: window.guestWorld.lastTargetResult, menu: window.guestWorld.construction?.menu, placement: window.guestWorld.construction?.placement, preview: window.guestWorld.construction?.preview },
        slots: window.hostWorld && [...window.hostWorld.guestSlots.values()].map(binding => ({ id: binding.id, ready: binding.ready, joined: binding.joined, releasing: binding.releasing, input: { sequence: binding.input.sequence, move: binding.input.move, moving: binding.input.moving, age: performance.now() - binding.input.receivedAt } })) }))));
      await pages[index].screenshot({ path: 'test-results/coop-identities-failure-' + index + '.png' });
    } catch {}
    console.log('Renderer errors:', errors); throw error;
  } finally {
    for (const application of applications) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profiles:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
