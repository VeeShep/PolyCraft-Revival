'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-guest-world-'));
  const applications = [], pages = [], errors = [], requests = [];
  try {
    for (const role of ['host', 'guest']) {
      const application = await electron.launch({ args: ['.'], env: { ...process.env, POLYCRAFT_TEST_DATA: path.join(directory, role) }, timeout: 90000 });
      applications.push(application);
      const page = await application.firstWindow(); pages.push(page);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
      await application.evaluate(({ BrowserWindow }, role) => BrowserWindow.getAllWindows()[0].setTitle('PolyCraft temporary ' + role + ' — guest world test'), role);
      page.on('pageerror', error => errors.push(role + ': ' + error.message));
      page.on('request', request => requests.push(request.url()));
      await page.locator('#new-name').fill('Temporary ' + role + ' renderer test');
      await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
      await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateStartScreen');
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
      const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
      const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
      await canvas.focus();
      await page.mouse.move(10, 10);
      await page.mouse.move(bounds.x + play[0], bounds.y + play[1], { steps: 5 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay, null, { timeout: 5000 });
      await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
      try { await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying', null, { timeout: 5000 }); }
      catch (error) {
        const state = await page.evaluate(() => window.polycraft.controls.manager().activeGameState.name);
        if (state !== 'GamestateStartScreen') throw error;
        console.log('Original Play screen still active; refocusing and clicking Play again:', role);
        await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
        await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 200 });
        await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
      }
      await page.evaluate(async () => {
        const controls = window.polycraft.controls, game = controls.manager();
        game.runScripts = false; game.setScriptLocked(false); game.activeGameState.setPlayState('PlayStateNormal');
        controls.setProgression(10, 0, 10);
        await window.polycraft.checkpoint();
      });
      console.log('Visible temporary renderer ready:', role);
    }
    const [host, guest] = pages;
    await host.evaluate(async () => {
      window.hostSession = new window.PolycraftMultiplayer.HostSession();
      window.hostWorld = await window.PolycraftOnlineWorld.startHostingWorld(window.polycraft.controls, window.hostSession);
    });
    const invitation = await host.evaluate(() => window.hostSession.createInvitation());
    const reply = await guest.evaluate(async invitation => {
      const joined = await window.PolycraftMultiplayer.PeerLink.join(invitation);
      window.guestConnection = joined.connection;
      window.guestBefore = { frame: window.polycraft.controls.manager().gameClock.getFrameIndex(), state: JSON.stringify(window.polycraft.bridge.state) };
      window.guestWorld = new window.PolycraftGuestWorld.GuestWorld(window.polycraft.controls, joined.connection);
      return joined.reply;
    }, invitation.invitation);
    const savesDirectory = path.join(directory, 'guest', 'saves');
    const saveFile = path.join(savesDirectory, fs.readdirSync(savesDirectory).find(name => name.endsWith('.json')));
    const savedBytes = fs.readFileSync(saveFile);
    await host.evaluate(reply => window.hostSession.acceptReply(reply), reply);
    await guest.waitForFunction(() => window.guestConnection.state === 'connected', null, { timeout: 30000 });
    async function publish(kind) {
      const result = await host.evaluate(async ({ peer, kind }) => {
        const snapshot = await window.hostWorld.snapshot();
        await window.hostSession.peers.get(peer).send(kind, snapshot);
        return { tick: snapshot.tick, hero: snapshot.spaces.flatMap(space => space.entities).find(entity => entity.id === snapshot.hero),
          blocks: snapshot.spaces.reduce((sum, space) => sum + space.blocks.length, 0), entities: snapshot.spaces.reduce((sum, space) => sum + space.entities.length, 0) };
      }, { peer: invitation.peer, kind });
      await guest.waitForFunction(tick => window.guestWorld.scene.tick === tick, result.tick, { timeout: 30000 });
      return result;
    }
    const first = await publish('snapshot');
    const reconstructed = await guest.evaluate(() => {
      const view = window.guestWorld.scene, game = window.polycraft.controls.manager();
      const posed = [...view.entities.values()].filter(({ record }) => record.mesh?.skin);
      window.guestOriginalNode = view.entities.get(view.snapshot.hero).node;
      return { blocks: view.terrain.length, entities: view.entities.size, hero: view.entities.get(view.snapshot.hero).record,
        heroInScene: window.guestOriginalNode.isInScene(), rootsDetached: window.guestWorld.original.roots.every(node => !node.isInScene()),
        lightingAttached: game.gameLighting.worldDirectionLightNode.isInScene() && game.gameLighting.heroLightNode.isInScene(),
        posed: posed.length,
        skinsMatch: posed.every(({ record, node }) => JSON.stringify(Array.from(node.skinController.output)) === JSON.stringify(record.mesh.skin)),
        simulated: game.gameClock.getFrameIndex() !== window.guestBefore.frame };
    });
    assert.ok(reconstructed.blocks > 1000); assert.equal(reconstructed.entities, first.entities);
    assert.deepEqual(reconstructed.hero, first.hero); assert.equal(reconstructed.heroInScene, true);
    assert.equal(reconstructed.rootsDetached, true); assert.equal(reconstructed.simulated, false);
    assert.equal(reconstructed.lightingAttached, true); assert.ok(reconstructed.posed > 0, 'Real host island includes posed tree meshes'); assert.equal(reconstructed.skinsMatch, true);
    await guest.waitForTimeout(1000);
    fs.mkdirSync('test-results', { recursive: true });
    await guest.screenshot({ path: 'test-results/guest-world-initial.png' });
    await applications[0].evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await host.locator('#turbulenz_game_engine_canvas').focus();
    await host.keyboard.down('w'); await host.waitForTimeout(1000); await host.keyboard.up('w');
    const second = await publish('update');
    assert.ok(Math.hypot(...second.hero.location.map((value, index) => value - first.hero.location[index])) > 0.1, 'Actual host hero moves');
    assert.equal(await guest.evaluate(() => window.guestWorld.scene.entities.get(window.guestWorld.scene.snapshot.hero).node === window.guestOriginalNode), true, 'Updates reuse the existing hero node');
    await guest.evaluate(async () => { window.polycraft.controls.pause(true); await window.polycraft.checkpoint(); });
    const third = await publish('update');
    assert.ok(third.tick > second.tick);
    await host.evaluate(peer => { window.stopGuestStream = window.hostWorld.streamTo(window.hostSession.peers.get(peer)); }, invitation.peer);
    await guest.waitForFunction(tick => window.guestWorld.scene.tick > tick + 3, third.tick, { timeout: 15000 });
    await guest.waitForTimeout(500);
    assert.deepEqual(fs.readFileSync(saveFile), savedBytes, 'Guest checkpoint does not replace the local solo save');
    assert.equal(await guest.evaluate(() => JSON.stringify(window.polycraft.bridge.state) === window.guestBefore.state), true, 'Guest rendering does not mutate local bridge state');
    assert.equal(await guest.evaluate(() => window.polycraft.controls.manager().gameClock.getFrameIndex() === window.guestBefore.frame), true, 'Guest menus and updates do not run a second simulation');
    assert.equal(await guest.evaluate(() => Array.from(window.polycraft.controls.app.globals.camera.viewProjectionMatrix).every(Number.isFinite)), true);
    await guest.screenshot({ path: 'test-results/guest-world-updated.png' });
    await host.evaluate(() => window.hostWorld.close());
    await guest.waitForFunction(() => window.guestWorld.closed && !window.polycraft.controls.guestWorld);
    assert.equal(await guest.evaluate(() => window.guestWorld.original.roots.every(node => node.isInScene())), true);
    assert.equal(await guest.evaluate(() => window.polycraft.controls.ready()), true);
    assert.deepEqual(fs.readFileSync(saveFile), savedBytes);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(url => /^https?:/.test(url)), [], 'No external game service or signaling requests');
    console.log('PASS: two visible real games, manual WebRTC exchange, terrain/entities and host skin poses/lighting, moving host hero, node reuse, frozen guest simulation, untouched solo save/bridge, bounded automatic updates under local pause and cleanup on host exit.');
    console.log('Snapshot:', { blocks: first.blocks, entities: first.entities, posed: reconstructed.posed });
  } catch (error) {
    for (let index = 0; index < pages.length; index++) {
      try {
        fs.mkdirSync('test-results', { recursive: true }); await pages[index].screenshot({ path: 'test-results/guest-world-failure-' + index + '.png' });
        console.log('Failure state:', await pages[index].evaluate(() => {
          const controls = window.polycraft.controls, game = controls.manager(), input = controls.app.globals.inputDevice, controller = game.getGameController();
          return { state: game.activeGameState.name, readyToPlay: game.activeGameState.readyToPlay, hover: input.isHovering, focused: input.isWindowFocused,
            paused: controls.paused, sx: controller.sx, sy: controller.sy, capturedMouse: controller.capturedMouse,
            play: Array.from(controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)), canvas: document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect().toJSON() };
        }));
      } catch {}
    }
    console.log('Renderer errors:', errors);
    throw error;
  } finally {
    for (const application of applications) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profiles:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
