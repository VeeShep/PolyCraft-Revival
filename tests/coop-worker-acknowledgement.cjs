'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const clickGround = require('./coop-ground-click.cjs');

module.exports = async function workerAcknowledgement({ host, fixture, directory, file, huts, errors, requests, closeHost, openHost, focusHost }) {
  const originals = new Map(), guests = [], applications = [];
  const party = JSON.parse(JSON.parse(fs.readFileSync(file)).state.userData.desktopCoop);
  const focus = async index => {
    const { page, app } = guests[index];
    await page.bringToFront(); await page.locator('#turbulenz_game_engine_canvas').focus();
    await app.evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; app.focus({ steal: true }); window.moveTop(); window.focus(); });
    await page.waitForTimeout(150);
    await page.waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && window.guestWorld.movement.nativeFocused, null, { timeout: 5000 });
  };
  const workerState = hut => host.evaluate(hut => {
    const entity = window.hostWorld.game.getGameEntityByName(hut).getEC('ECWildlingHouse').getWildling(), agent = entity.getEC('ECWildlingAgent');
    return { id: entity.getName(), waiting: agent.isWaitingForClick(), sleeping: agent.isSleeping(), location: Array.from(entity.getv3Location()) };
  }, hut);
  const connect = async index => {
    const { page } = guests[index];
    const offer = await host.evaluate(id => window.hostWorld.createPlayerInvitation(id), party.players[index + 1].id);
    const reply = await page.evaluate(async invitation => {
      const joined = await window.PolycraftMultiplayer.PeerLink.join(invitation); window.connection = joined.connection;
      window.guestWorld = new window.PolycraftGuestWorld.GuestWorld(window.polycraft.controls, joined.connection);
      return joined.reply;
    }, offer.invitation);
    await host.evaluate(reply => window.hostSession.acceptReply(reply), reply);
    await page.waitForFunction(() => window.guestWorld.scene.snapshot || window.connection.closed, null, { timeout: 45000 });
    assert.equal(await page.evaluate(() => window.connection.closed), false);
    await focus(index);
    try {
      await page.waitForFunction(() => window.guestWorld.hud.state && window.guestWorld.movement.available(), null, { timeout: 10000 });
    } catch (error) {
      console.log('Worker guest readiness diagnostics:', JSON.stringify(await page.evaluate(async () => {
        const w = window.guestWorld;
        return { focused: document.hasFocus(), nativeWindowFocused: await window.desktop.windowFocused(), nativeFocused: w.movement.nativeFocused, activeElement: document.activeElement?.id,
          paused: w.controls.paused, localMenu: w.localMenu(), resyncing: w.resyncing, connection: { state: w.connection.state, closed: w.connection.closed }, tick: w.scene.tick,
          life: w.lifeState, hud: w.hud.state, lifeRequest: w.lifeRequest, queryAge: performance.now() - w.lastLifeQuery, targetSequence: w.targetSequence, identity: w.identity };
      })));
      console.log('Worker host readiness diagnostics:', JSON.stringify(await host.evaluate(() => {
        const w = window.hostWorld;
        return { tick: w.game.gameClock.getFrameIndex(), paused: w.controls.paused, state: w.game.activeGameState.name, slots: [...w.peerPlayers.values()].map(b => ({ id: b.id, ready: b.ready, releasing: b.releasing, actionSequence: b.actions.sequence, queue: b.actions.queue.length })), errors: window.workerConnectionErrors };
      })));
      console.log('Worker test page errors:', JSON.stringify(errors));
      throw error;
    }
    assert.equal(await page.evaluate(() => window.guestWorld.identity.playerId), party.players[index + 1].id);
    await page.evaluate(() => {
      const world = window.guestWorld, close = world.close;
      world.close = function () { close.call(this); window.restoredWorkerSoloState = JSON.stringify(window.polycraft.bridge.state); this.close = close; };
    });
  };
  const join = async index => {
    const source = path.join(fixture, 'rejoin-' + index, 'saves');
    for (const name of fs.readdirSync(source)) originals.set(path.join(source, name), fs.readFileSync(path.join(source, name)));
    const profile = path.join(directory, 'worker-guest-' + index); assert.equal(fs.existsSync(profile), false);
    fs.cpSync(source, path.join(profile, 'saves'), { recursive: true });
    const app = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: profile }, timeout: 90000 });
    applications.push(app);
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await app.evaluate(({ app, BrowserWindow }, index) => {
      const window = BrowserWindow.getAllWindows()[0]; if (!window.isVisible()) throw new Error('Worker co-op test must be visible.');
      window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary island — worker guest ' + (index + 1)); app.focus({ steal: true }); window.moveTop(); window.focus();
    }, index);
    await page.bringToFront();
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#save-list article').first().getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
    const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await canvas.focus(); await page.mouse.move(10, 10); await page.mouse.move(bounds.x + play[0], bounds.y + play[1], { steps: 5 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
    await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await page.evaluate(() => window.polycraft.checkpoint(true));
    const ownFile = path.join(profile, 'saves', fs.readdirSync(path.join(profile, 'saves')).find(name => name.endsWith('.json'))), ownBytes = fs.readFileSync(ownFile);
    const ownState = await page.evaluate(() => JSON.stringify(window.polycraft.bridge.state));
    guests.push({ page, app, ownFile, ownBytes, ownState });
    await connect(index);
  };
  const reconnect = async () => {
    const row = guests[0], guest = row.page;
    assert.equal(await guest.evaluate(() => window.restoredWorkerSoloState), row.ownState, 'Disconnect must restore the guest solo state before reconnect.');
    await guest.evaluate(() => window.polycraft.checkpoint(true));
    row.ownState = await guest.evaluate(() => JSON.stringify(window.polycraft.bridge.state)); row.ownBytes = fs.readFileSync(row.ownFile);
    await connect(0);
  };
  const acknowledge = async (hut, cue) => {
    const worker = await workerState(hut), guest = guests[0].page;
    assert.equal(worker.waiting, true, 'The saved worker must actually be awaiting acknowledgement.');
    await focus(0);
    await guest.waitForFunction(({ id, cue }) => window.guestWorld.scene.entities.get(id)?.record.workerCue === cue, { id: worker.id, cue }, { timeout: 5000 });
    const route = await host.evaluate(({ hero, worker }) => {
      const world = window.hostWorld, actor = world.players.active.get(hero).hero, target = world.game.getGameEntityByName(worker);
      const path = world.game.getNavManager().getEntityToEntityPath(actor, target, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
      return path && path.getWaypointList().map(point => Array.from(point));
    }, { hero: party.players[1].id, worker: worker.id });
    assert.ok(route?.length, 'Native navigation must provide a route to the waiting worker.');
    console.log('Original worker approach route:', JSON.stringify({ worker: worker.id, route }));
    let waypoint = Math.min(1, route.length - 1), nearby = false, commandedLocation = null;
    for (let step = 0; step < 300; step++) {
      const next = await guest.evaluate(({ id, destination }) => {
        const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, target = w.scene.entities.get(id).record.location;
        return { ready: Math.hypot(target[0] - p[0], target[2] - p[2]) < 6.3 && p[1] - .5 <= target[1], distance: Math.hypot(destination[0] - p[0], destination[2] - p[2]), position: Array.from(p), available: w.movement.available(), navigation: w.scene.snapshot.camera };
      }, { id: worker.id, destination: route[waypoint] });
      if (next.ready) { nearby = true; break; }
      assert.equal(next.available, true, 'Guest movement must retain native focus and ordinary input.');
      if (next.distance < .65 && waypoint < route.length - 1) { waypoint++; commandedLocation = null; continue; }
      if (!commandedLocation || Math.hypot(next.position[0] - commandedLocation[0], next.position[2] - commandedLocation[2]) < .65) {
        const click = await clickGround(guest, route[waypoint]); commandedLocation = click.location;
      }
      if (step % 25 === 0) console.log('Guest native worker approach:', JSON.stringify({ step, waypoint, ...next }));
      await guest.waitForTimeout(200);
    }
    assert.ok(nearby, 'The guest must reach original worker smart-selection range by ordinary movement.');
    const cueId = 'idECWildlingAgentWaitingForClick' + worker.id;
    await guest.waitForFunction(id => window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap[id]?.scale > .95, cueId, { timeout: 5000 });
    await guest.keyboard.press('p');
    await guest.waitForFunction(id => {
      const w = window.guestWorld, map = w.game.getGuiManager().prevDrawGuiMap;
      return w.pauseMenu && map['guest-resume']?.scale > .95 && (!map[id] || map[id].scale < .01);
    }, cueId, { timeout: 5000 });
    const pausedAt = await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex());
    await guest.waitForTimeout(1500);
    assert.ok(await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex()) > pausedAt);
    assert.equal((await workerState(hut)).waiting, true, 'Opening a menu must not acknowledge the waiting worker.');
    await guest.screenshot({ path: path.join(directory, 'guest-worker-' + cue + '-pause.png'), timeout: 5000 });
    await guest.keyboard.press('p'); await guest.waitForFunction(() => !window.guestWorld.pauseMenu && window.guestWorld.movement.available(), null, { timeout: 5000 });
    let point;
    for (let turns = 0; turns <= 4; turns++) {
      await focus(0); await guest.waitForTimeout(150);
      await guest.waitForFunction(() => {
        const c = window.guestWorld.viewCamera.camera, delta = c.baseAngle - c.desiredBaseAngle;
        return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < .001 && ['Position', 'Focus'].every(key => { const a = c['currentV3' + key], b = c['desiredV3' + key]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < .01; }) && Math.abs(c.currentFOV - c.desiredFOV) < .001;
      }, null, { timeout: 5000 });
      point = await guest.evaluate(id => {
        const w = window.guestWorld, entry = w.scene.entities.get(id), p = w.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location), bounds = w.movement.canvas.getBoundingClientRect(), device = w.controls.app.globals.graphicsDevice;
        return { x: bounds.x + p[0] * bounds.width / device.width, y: bounds.y + p[1] * bounds.height / device.height, clear: p[0] > 20 && p[0] < device.width - 20 && p[1] > 20 && p[1] < device.height - 20 };
      }, worker.id);
      if (point.clear || turns === 4) break;
      await guest.keyboard.down('ArrowLeft'); try { await guest.waitForTimeout(500); } finally { await guest.keyboard.up('ArrowLeft'); }
    }
    assert.ok(point.clear, 'Worker must be on screen before a normal guest click.');
    const guiId = 'idECWildlingAgentWaitingForClick' + worker.id;
    await guest.waitForFunction(({ id, style }) => {
      const entry = window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap[id]; return entry?.archetypeName === style && entry.scale > .95;
    }, { id: guiId, style: cue === 'lumber' ? 'welcomeLumber' : 'welcomeStone' }, { timeout: 5000 });
    await guest.screenshot({ path: path.join(directory, 'guest-worker-' + cue + '.png'), timeout: 5000 });
    await guest.mouse.move(point.x, point.y);
    await guest.waitForFunction(({ id, event }) => window.guestWorld.movement.available() && window.PolycraftCoopActions.pickTarget(window.guestWorld, event) === id, { id: worker.id, event: { clientX: point.x, clientY: point.y } }, { timeout: 5000 });
    await guest.mouse.click(point.x, point.y, { delay: 100 });
    await host.waitForFunction(id => { const agent = window.hostWorld.game.getGameEntityByName(id).getEC('ECWildlingAgent'); return !agent.isWaitingForClick() && !agent.isSleeping(); }, worker.id, { timeout: 5000 });
    await guest.waitForFunction(id => window.guestWorld.scene.entities.get(id)?.record.workerCue === null, worker.id, { timeout: 5000 });
    console.log('PASS: ordinary guest click acknowledged the original waiting worker:', JSON.stringify({ participants: guests.length + 1, worker }));
  };
  try {
    await host.evaluate(async () => {
      window.workerConnectionErrors = [];
      window.hostSession = new window.PolycraftMultiplayer.HostSession({ onError: (_peer, error) => window.workerConnectionErrors.push(error.message) });
      window.hostWorld = await window.PolycraftOnlineWorld.startHostingWorld(window.polycraft.controls, window.hostSession);
    });
    const rewards = process.argv.includes('--reward-transitions') ? require('./coop-reward-transitions.cjs') : null;
    if (rewards) await rewards.stageSolo(host);
    await host.evaluate(() => window.hostWorld.enablePlayers(window.polycraft.bridge));
    if (rewards) await rewards.checkSolo(host);
    await join(0); assert.equal(await host.evaluate(() => window.hostWorld.players.active.size), 2);
    if (rewards) await rewards.guestDeparture({ host, guest: guests[0].page, hero: party.players[1].id, reconnect, hostFile: file });
    if (process.argv.includes('--xp-batch')) await require('./coop-xp-batch.cjs')({ host, guest: guests[0].page, hero: party.players[1].id, hostFile: file });
    if (process.argv.includes('--save-in-flight') || process.argv.includes('--disconnect-in-flight') || process.argv.includes('--disconnect-incoming')) {
      const guest = guests[0].page;
      const button = async id => {
        await focus(0);
        await guest.waitForFunction(id => window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap[id]?.scale > .95, id);
        const point = await guest.evaluate(id => {
          const c = window.polycraft.controls, args = c.manager().getGuiManager().prevDrawGuiMap[id].argumentObject, p = args.v2ScreenLocation || [args.x, args.y];
          const b = document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect(), d = c.app.globals.graphicsDevice;
          return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
        }, id);
        await guest.mouse.move(point.x, point.y); await guest.waitForFunction(id => window.polycraft.controls.manager().getIMGui().isHot(id), id);
        await guest.mouse.click(point.x, point.y, { delay: 100 });
      };
      const collectReward = async () => {
        const reward = await guest.evaluate(() => window.guestWorld.quests.state?.completed?.id);
        if (reward) { await button('guest-idAcceptTaskRewardButton' + reward); await guest.waitForFunction(id => window.guestWorld.quests.state?.completed?.id !== id, reward); }
      };
      const context = { host, guest, guests: guests.map(row => row.page), focusGuest: focus, focus: () => focus(0), button, hero: party.players[1].id, hostFile: file };
      let priorCarrier;
      for (let cycle = 0; cycle < 2; cycle++) {
        await collectReward();
        await require('./coop-natural-resources.cjs')({ ...context, gatherOnly: true, disconnectDuringPickup: cycle === 1 && process.argv.includes('--disconnect-incoming') ? reconnect : undefined });
        await collectReward();
        const carrier = await host.evaluate(id => window.hostWorld.players.active.get(id).hero.getName(), party.players[1].id);
        if (cycle === 1 && !process.argv.includes('--disconnect-incoming')) assert.equal(carrier, priorCarrier, 'The later save must use the carrier that made the previous delivery.');
        await require('./coop-natural-deposit.cjs')({ ...context, saveDuringFlight: cycle === 1 && process.argv.includes('--save-in-flight'), disconnectDuringFlight: cycle === 1 && process.argv.includes('--disconnect-in-flight') ? reconnect : undefined });
        priorCarrier = carrier;
      }
      console.log('PASS: a normal completed deposit followed by ' + (process.argv.includes('--disconnect-incoming') ? 'incoming-pickup disconnect/reconnect' : process.argv.includes('--disconnect-in-flight') ? 'outgoing disconnect/reconnect' : 'Save Now') + ' is accounted once and saved.');
    }
    if (process.argv.includes('--resource-highlights')) {
      const context = { host, guest: guests[0].page, guests: guests.map(row => row.page), focusGuest: focus, focus: () => focus(0), hero: party.players[1].id, hostFile: file };
      await require('./coop-natural-resources.cjs')({ ...context, stone: true, gatherOnly: true, checkHighlights: true });
      await require('./coop-natural-deposit.cjs')({ ...context, resource: 1 });
    }
    await acknowledge(huts[0], 'lumber');
    await join(1); await join(2); assert.equal(await host.evaluate(() => window.hostWorld.players.active.size), 4); await acknowledge(huts[1], 'stone');
    await host.waitForFunction(ids => ids.every(id => !window.hostWorld.game.getGameEntityByName(id).getEC('ECWildlingHouse').getWildling().getEC('ECResourceCarrier').hasAnyFlyingResource()), huts, { timeout: 15000 });
    await require('./coop-native-pause.cjs')({ host, guest: guests[0].page, focus: () => focus(0), focusHost, hostFile: file });
    await require('./coop-natural-workers.cjs')({ host, guest: guests[0].page, guests: guests.map(row => row.page), focusGuest: focus, focus: () => focus(0), hostFile: file });
    const finalReward = rewards ? await rewards.finalSaveRecovery({ host, guests: guests.map(row => row.page), focusGuest: focus, hostFile: file,
      departure: process.argv.includes('--final-save-departure'), hero: party.players[1].id, reconnect }) : null;
    const saved = JSON.parse(fs.readFileSync(file)).state, earned = JSON.parse(saved.userData.desktopCoop);
    assert.equal(saved.cheats.everEnabled, false); assert.equal(earned.players.length, 4);
    await host.evaluate(() => window.hostWorld.close());
    if (rewards) rewards.checkFinalDisk(file, finalReward);
    for (const row of guests) {
      await row.page.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld);
      assert.equal(await row.page.evaluate(() => window.restoredWorkerSoloState), row.ownState);
      const current = fs.readFileSync(row.ownFile);
      if (!current.equals(row.ownBytes)) {
        assert.deepEqual(fs.readFileSync(row.ownFile + '.bak'), row.ownBytes);
        const state = JSON.parse(current).state, before = JSON.parse(row.ownState);
        for (const key of ['progress', 'resource', 'softCurrency', 'heroUpgrades', 'taskFlags', 'desktopCoop']) assert.equal(state.userData[key], before.userData[key]);
      }
    }
    assert.deepEqual(await host.evaluate(() => window.workerConnectionErrors), []);
    await closeHost();
    const persisted = JSON.parse(JSON.parse(fs.readFileSync(file)).state.userData.desktopCoop);
    const reopened = await openHost();
    const restored = await reopened.evaluate(() => ({ party: JSON.parse(window.polycraft.bridge.state.userData.desktopCoop), history: window.polycraft.bridge.state.cheats.everEnabled }));
    assert.equal(restored.history, false);
    assert.deepEqual(restored.party, persisted);
    for (const resource of [0, 1]) assert.ok(restored.party.economy.resource[resource] >= earned.economy.resource[resource]);
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    await closeHost();
    console.log('PASS: two/four-player native guest worker acknowledgement, shared fresh income/all guest HUDs, non-pausing menus, normal host save/reopen and isolated guest solo restoration.');
  } catch (error) {
    for (const [index, row] of guests.entries()) await row.page.screenshot({ path: path.join(directory, 'worker-guest-failure-' + index + '.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally {
    await host.evaluate(() => window.hostWorld?.close()).catch(() => {});
    for (const app of applications) { const child = app.process(); await app.evaluate(({ app }) => app.exit()).catch(() => {}); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    for (const [name, bytes] of originals) assert.deepEqual(fs.readFileSync(name), bytes);
    console.log('Source guest fixture files unchanged:', originals.size);
  }
};
