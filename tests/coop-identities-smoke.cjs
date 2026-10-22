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
          if (window.motionSamples.length > 120) window.motionSamples.shift();
        }
      };
    }, motionStart);
    await applications[0].evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
    await host.locator('#turbulenz_game_engine_canvas').focus();
    await host.waitForFunction(() => document.hasFocus());
    for (const key of ['w', 'd', 's', 'a', 'w', 'd', 's', 'a']) {
      await host.keyboard.down(key); await host.waitForTimeout(500); await host.keyboard.up(key);
    }
    for (let index = 1; index <= 3; index++) {
      const guest = pages[index];
      await applications[index].evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
      await guest.locator('#turbulenz_game_engine_canvas').focus();
      await guest.waitForFunction(() => document.hasFocus());
      await guest.waitForFunction(() => window.guestWorld.movement.nativeFocused);
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
    });
    console.log('Moving-player sync passed:', { distances: movement, samples: samples.map(received => received.filter(sample => history[sample.tick]).length) });
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
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    const rejected = await host.evaluate(() => window.hostErrors);
    assert.equal(rejected.length, 1); assert.match(rejected[0], /Guests cannot select heroes/);
    console.log('PASS: four visible Electron games; assigned heroes; all four heroes move; every guest matches same-tick host positions/rotations and visible mesh poses; forged hero claim isolates its sender; reconnect restores saved XP; host exit restores unchanged guest islands.');
    console.log('Same-Mac keyboard/network/rendering only. Full HUD/actions, PvP and real-network/platform acceptance remain open.');
  } catch (error) {
    fs.mkdirSync('test-results', { recursive: true });
    for (let index = 0; index < pages.length; index++) try {
      console.log('Failure state', index, await pages[index].evaluate(() => ({ hostErrors: window.hostErrors, connectionErrors: window.connectionErrors,
        connection: window.connection && { closed: window.connection.closed, state: window.connection.state }, focused: document.hasFocus(),
        movement: window.guestWorld?.movement && { keys: [...window.guestWorld.movement.keys], available: window.guestWorld.movement.available(), nativeFocused: window.guestWorld.movement.nativeFocused },
        identity: window.guestWorld?.identity, tick: window.guestWorld?.scene.tick,
        slots: window.hostWorld && [...window.hostWorld.guestSlots.values()].map(binding => ({ id: binding.id, ready: binding.ready, joined: binding.joined, releasing: binding.releasing, input: { sequence: binding.input.sequence, move: binding.input.move, moving: binding.input.moving, age: performance.now() - binding.input.receivedAt } })) })));
      await pages[index].screenshot({ path: 'test-results/coop-identities-failure-' + index + '.png' });
    } catch {}
    console.log('Renderer errors:', errors); throw error;
  } finally {
    for (const application of applications) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profiles:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
