'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

module.exports = async function recoveredParty({ host, application, expected, fixture, directory, file, errors, requests }) {
  const applications = [], guests = [], sourceBytes = new Map();
  let gear;
  try {
    await host.evaluate(async () => {
      window.recoveryErrors = [];
      window.hostSession = new window.PolycraftMultiplayer.HostSession({ onError: (_peer, error) => window.recoveryErrors.push(error.message) });
      window.hostWorld = await window.PolycraftOnlineWorld.startHostingWorld(window.polycraft.controls, window.hostSession);
      await window.hostWorld.enablePlayers(window.polycraft.bridge);
    });
    for (const [index, saved] of expected.coop.players.slice(1).entries()) {
      const source = path.join(path.dirname(fixture), ['guest-one', 'guest-two', 'guest-three'][index], 'saves');
      for (const name of fs.readdirSync(source)) sourceBytes.set(path.join(source, name), fs.readFileSync(path.join(source, name)));
      const profile = path.join(directory, 'rejoin-' + index);
      assert.equal(fs.existsSync(profile), false);
      fs.cpSync(source, path.join(profile, 'saves'), { recursive: true });
      const app = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: profile }, timeout: 90000 });
      applications.push(app);
      const page = await app.firstWindow();
      page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
      await app.evaluate(({ app, BrowserWindow }, name) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window.isVisible()) throw new Error('Recovered-party guests must be visible.');
        window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary island — recovered party ' + name);
        app.focus({ steal: true }); window.moveTop(); window.focus();
      }, saved.name);
      await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#save-list article').first().getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
      await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
      await page.bringToFront(); const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
      const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
      await canvas.focus(); await page.mouse.move(10, 10); await page.mouse.move(bounds.x + play[0], bounds.y + play[1], { steps: 5 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
      await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
      await page.evaluate(() => window.polycraft.checkpoint(true));
      const ownFile = path.join(profile, 'saves', fs.readdirSync(path.join(profile, 'saves')).find(name => name.endsWith('.json')));
      const ownBytes = fs.readFileSync(ownFile), ownState = await page.evaluate(() => JSON.stringify(window.polycraft.bridge.state));
      const offer = await host.evaluate(id => window.hostWorld.createPlayerInvitation(id), saved.id);
      const reply = await page.evaluate(async invitation => {
        const joined = await window.PolycraftMultiplayer.PeerLink.join(invitation);
        window.connection = joined.connection;
        window.guestWorld = new window.PolycraftGuestWorld.GuestWorld(window.polycraft.controls, joined.connection);
        return joined.reply;
      }, offer.invitation);
      await host.evaluate(reply => window.hostSession.acceptReply(reply), reply);
      await page.waitForFunction(() => window.guestWorld.scene.snapshot || window.connection.closed, null, { timeout: 45000 });
      assert.equal(await page.evaluate(() => window.connection.closed), false);
      const identity = await page.evaluate(() => window.guestWorld.identity);
      assert.equal(identity.playerId, saved.id); assert.equal(identity.name, saved.name);
      const buildings = await page.evaluate(() => window.guestWorld.scene.snapshot.spaces.flatMap(space => space.entities).map(entity => entity.id));
      for (const building of [...expected.hq, ...expected.lumbermills]) assert.ok(buildings.includes(building.name));
      await page.waitForFunction(wood => window.guestWorld.hud.state?.resources[0] === wood, expected.coop.economy.resource[0]);
      await page.evaluate(() => {
        const world = window.guestWorld, close = world.close;
        world.close = function () { close.call(this); window.recoveredOwnState = JSON.stringify(window.polycraft.bridge.state); this.close = close; };
      });
      guests.push({ page, ownFile, ownBytes, ownState });
      console.log('Recovered guest rejoined original hero:', saved.id, saved.name);
    }
    assert.equal(await host.evaluate(() => window.hostWorld.players.active.size), 4);
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const restored = JSON.parse(JSON.parse(fs.readFileSync(file)).state.userData.desktopCoop);
    assert.deepEqual(restored.economy, expected.coop.economy);
    assert.deepEqual(restored.players.map(player => player.id), expected.coop.players.map(player => player.id));
    for (const saved of expected.coop.players) {
      const actual = restored.players.find(player => player.id === saved.id);
      for (const key of ['name', 'progress', 'heroUpgrades', 'inventory', 'construction', 'life', 'numberOfGamesPlayed', 'shareData']) assert.deepEqual(actual[key], saved[key], saved.name + ': ' + key);
      assert.equal(actual.health.maximum, saved.health.maximum);
      // Health restoration rescales by old/new maxima; allow only floating-point rounding.
      assert.ok(Math.abs(actual.health.current - saved.health.current) <= Number.EPSILON * Math.max(1, saved.health.maximum) * 4, saved.name + ': health');
      for (const key of Object.keys(saved.gameStats)) key === 'totalTimePlayed' ? assert.ok(actual.gameStats[key] >= saved.gameStats[key]) : assert.equal(actual.gameStats[key], saved.gameStats[key]);
      for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual.location[axis] - saved.location[axis]) < 0.1, saved.name + ': saved position');
    }
    if (process.argv.includes('--resources')) {
      const guest = guests[0].page;
      const focus = async () => {
        await applications[0].evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; app.focus({ steal: true }); window.moveTop(); window.focus(); });
        await guest.bringToFront(); await guest.locator('#turbulenz_game_engine_canvas').focus();
        await guest.waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && window.guestWorld.movement.nativeFocused);
      };
      const button = async id => {
        await focus();
        await guest.waitForFunction(id => window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap[id]?.scale > 0.95, id);
        const point = await guest.evaluate(id => { const c = window.polycraft.controls, args = c.manager().getGuiManager().prevDrawGuiMap[id].argumentObject, p = args.v2ScreenLocation || [args.x, args.y], b = document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect(), d = c.app.globals.graphicsDevice; return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height }; }, id);
        await guest.mouse.move(point.x, point.y); await guest.waitForFunction(id => window.polycraft.controls.manager().getIMGui().isHot(id), id);
        await guest.mouse.click(point.x, point.y, { delay: 100 });
      };
      const stone = expected.lumbermills.length > 0;
      await require('./coop-natural-resources.cjs')({ host, guest, focus, button, hero: expected.coop.players[1].id, hostFile: file, stone });
      gear = require('./coop-natural-gear.cjs')({ host, headquarters: true, pendingTask: stone ? 'mineAStone' : 'chopATree', focus: async () => {
        await application.evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; app.focus({ steal: true }); window.moveTop(); window.focus(); });
        await host.bringToFront(); await host.locator('#turbulenz_game_engine_canvas').focus();
      } });
      await gear.before();
    }
    await host.evaluate(() => window.hostWorld.close());
    for (const guest of guests) {
      await guest.page.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld);
      assert.equal(await guest.page.evaluate(() => window.recoveredOwnState), guest.ownState);
      const current = fs.readFileSync(guest.ownFile);
      if (!current.equals(guest.ownBytes)) {
        assert.deepEqual(fs.readFileSync(guest.ownFile + '.bak'), guest.ownBytes);
        const before = JSON.parse(guest.ownState), after = JSON.parse(current).state;
        for (const key of ['progress', 'resource', 'softCurrency', 'heroUpgrades', 'taskFlags', 'desktopCoop']) assert.equal(after.userData[key], before.userData[key]);
      }
    }
    assert.deepEqual(await host.evaluate(() => window.recoveryErrors), []);
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    if (gear) await gear.after();
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    console.log('PASS: recovered island rehosts all four saved heroes; original identities/progression/inventories/economy/buildings survive, coherent host save passes and host exit restores all guest solo states.');
  } finally {
    await host.evaluate(() => window.hostWorld?.close()).catch(() => {});
    for (const app of applications) { const child = app.process(); await app.evaluate(({ app }) => app.exit()).catch(() => {}); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    for (const [file, bytes] of sourceBytes) assert.deepEqual(fs.readFileSync(file), bytes);
  }
};
