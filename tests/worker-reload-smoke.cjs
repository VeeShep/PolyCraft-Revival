'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

(async () => {
  assert.ok(!process.argv.includes('--final-save-departure') || process.argv.includes('--reward-transitions'), 'Final-save departure requires the reward transition phase.');
  assert.ok(!process.argv.includes('--pvp-lumber') || process.argv.includes('--pvp-death'), 'Lumber revival requires the PvP death phase.');
  assert.ok(!process.argv.includes('--pvp-rejoin') || process.argv.includes('--pvp-death'), 'Death rejoin requires the PvP death phase.');
  assert.ok(!(process.argv.includes('--pvp-rejoin') && process.argv.includes('--pvp-lumber')), 'Choose either death rejoin or paid lumber revival.');
  for (const flag of ['--save-in-flight', '--disconnect-in-flight', '--resource-highlights', '--disconnect-incoming', '--xp-batch', '--reward-transitions', '--health-item-transitions', '--pvp-death', '--pve-combat']) assert.ok(!process.argv.includes(flag) || process.argv.includes('--coop'), 'This phase requires the visible co-op case.');
  assert.ok(['--save-in-flight', '--disconnect-in-flight', '--disconnect-incoming', '--xp-batch', '--reward-transitions', '--health-item-transitions', '--pvp-death', '--pve-combat'].filter(flag => process.argv.includes(flag)).length <= 1, 'Choose one special phase per visible run.');
  const fixture = fs.realpathSync(process.env.POLYCRAFT_WORKER_FIXTURE || '');
  assert.ok(fixture.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(fixture).startsWith('polycraft-hq-recovery-'), 'Use only an existing disposable recovery-test checkpoint.');
  const source = path.join(fixture, 'saves'), names = fs.readdirSync(source), originals = new Map(names.map(name => [name, fs.readFileSync(path.join(source, name))]));
  const islands = names.filter(name => name.endsWith('.json')); assert.equal(islands.length, 1);
  const state = JSON.parse(originals.get(islands[0])).state, party = state.userData.desktopCoop;
  assert.equal(state.cheats.everEnabled, false); assert.equal(JSON.parse(party).players.length, 4);
  const pending = JSON.parse(state.userData.desktopQuests).pending;
  assert.equal(pending.length, 1); assert.equal(pending[0].task, 'buildStonelingHut');
  const buildings = JSON.parse(state.userData.AdventureIncGameState).gameSpaceList.flatMap(space => space.entityList);
  const huts = ['a_b_wildlinghouse_lumber', 'a_b_wildlinghouse_stone'].map(type => {
    const found = buildings.filter(entity => entity.archetypeName === type); assert.equal(found.length, 1); return found[0].name;
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-worker-reload-')), file = path.join(directory, 'saves', islands[0]);
  fs.cpSync(source, path.join(directory, 'saves'), { recursive: true });
  let application;
  const errors = [], requests = [];
  const focus = async () => {
    await application.evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; app.focus({ steal: true }); window.moveTop(); window.focus(); });
    const page = await application.firstWindow(); await page.bringToFront();
    const canvas = page.locator('#turbulenz_game_engine_canvas'); if (await canvas.count()) await canvas.focus();
  };
  const open = async () => {
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await application.evaluate(({ BrowserWindow }, label) => {
      const window = BrowserWindow.getAllWindows()[0]; if (!window.isVisible()) throw new Error('Worker restart test must be visible.');
      window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary island — ' + label);
    }, process.argv.includes('--pvp-death') ? 'co-op PvP lifecycle and worker save test' : process.argv.includes('--coop') ? 'co-op worker save test' : 'solo worker restart');
    await focus();
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#save-list article').first().getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await focus(); const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
    const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await canvas.focus(); await page.mouse.move(10, 10); await page.mouse.move(bounds.x + play[0], bounds.y + play[1], { steps: 5 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
    await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await page.waitForFunction(ids => ids.every(id => { const entity = window.polycraft.controls.manager().getGameEntityByName(id); return entity?.getEC('ECWildlingHouse')?.getWildling(); }), huts, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.polycraft.controls.manager().runScripts), true);
    return page;
  };
  const close = async () => {
    const closed = application.waitForEvent('close', { timeout: 20000 });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; application = null;
  };
  try {
    console.log('Disposable solo worker profile:', directory);
    const page = await open();
    const reward = 'idAcceptTaskRewardButton' + pending[0].id;
    await focus();
    await page.waitForFunction(id => window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap[id]?.scale > 0.95, reward);
    const point = await page.evaluate(id => {
      const controls = window.polycraft.controls, args = controls.manager().getGuiManager().prevDrawGuiMap[id].argumentObject;
      const location = args.v2ScreenLocation || [args.x, args.y], bounds = document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect(), device = controls.app.globals.graphicsDevice;
      return { x: bounds.left + location[0] * bounds.width / device.width, y: bounds.top + location[1] * bounds.height / device.height };
    }, reward);
    await page.mouse.move(point.x, point.y); await page.waitForFunction(id => window.polycraft.controls.manager().getIMGui().isHot(id), reward);
    await page.mouse.click(point.x, point.y, { delay: 100 });
    await page.waitForFunction(id => !JSON.parse(window.polycraft.bridge.state.userData.desktopQuests).pending.some(task => task.id === id), pending[0].id);
    const time = await page.evaluate(() => window.polycraft.controls.app.globals.gameCurrentTime);
    await page.waitForFunction(time => window.polycraft.controls.app.globals.gameCurrentTime > time, time, { timeout: 5000 });
    console.log('Original pending worker reward collected through its native button; solo game time advances.');
    if (process.argv.includes('--coop')) {
      await require('./coop-worker-acknowledgement.cjs')({ host: page, fixture, directory, file, huts, errors, requests, closeHost: close, openHost: open, focusHost: focus });
      return;
    }
    for (const hut of huts) {
      const worker = await page.evaluate(id => {
        const game = window.polycraft.controls.manager(), entity = game.getGameEntityByName(id).getEC('ECWildlingHouse').getWildling(), agent = entity.getEC('ECWildlingAgent');
        const selectable = entity.getEC('ECSelectable');
        return { id: entity.getName(), sleeping: agent.isSleeping(), waitingForClick: agent.isWaitingForClick(), canWork: game.getPlayFlags().wildlingsCanWork, inDanger: agent.isInDanger(), updatedAt: agent.lastUpdateTime,
          valid: selectable.getValid(), smartValid: selectable.isSmartValid(), selectable: selectable.isSelectable(), location: Array.from(entity.getv3Location()), hero: Array.from(game.getHero().getv3Location()) };
      }, hut);
      console.log('Restored native worker activation:', JSON.stringify(worker));
      assert.ok(worker.canWork && !worker.inDanger && worker.valid, 'The original mode must permit worker activity and selection.');
      if (!worker.sleeping && !worker.waitingForClick) continue;
      if (!worker.selectable) {
        const route = await page.evaluate(id => {
          const game = window.polycraft.controls.manager(), hero = game.getHero(), target = game.getGameEntityByName(id);
          const path = game.getNavManager().getEntityToEntityPath(hero, target, hero.getEC('ECFaction').getFactionName(), hero.getEC('ECNav').getMaxNavigableHeight(), true);
          return path && path.getWaypointList().map(point => Array.from(point));
        }, worker.id);
        assert.ok(route?.length, 'The native navigator must provide a route to the waiting worker.');
        let waypoint = Math.min(1, route.length - 1), nearby = false;
        await focus();
        for (let step = 0; step < 300; step++) {
          const next = await page.evaluate(({ id, location }) => {
            const controls = window.polycraft.controls, game = controls.manager(), hero = game.getHero(), position = hero.getv3Location(), entity = game.getGameEntityByName(id), selectable = entity.getEC('ECSelectable');
            const dx = location[0] - position[0], dz = location[2] - position[2], m = controls.app.globals.camera.matrix;
            const right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8], largest = Math.max(Math.abs(right), Math.abs(forward));
            return { ready: selectable.isSelectable(), distance: Math.hypot(dx, dz), hero: Array.from(position), smartValid: selectable.isSmartValid(), keys: [...(Math.abs(right) > largest * .4 ? [right > 0 ? 'd' : 'a'] : []), ...(Math.abs(forward) > largest * .4 ? [forward > 0 ? 'w' : 's'] : [])] };
          }, { id: worker.id, location: route[waypoint] });
          if (next.ready) { nearby = true; break; }
          if (step % 25 === 0) console.log('Normal worker approach:', JSON.stringify({ step, waypoint, ...next }));
          if (next.distance < .65 && waypoint < route.length - 1) { waypoint++; continue; }
          await page.waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && !window.polycraft.controls.manager().getIMGui().hasCapturedInput(), null, { timeout: 5000 });
          for (const key of next.keys) await page.keyboard.down(key);
          try { await page.waitForTimeout(100); } finally { for (const key of next.keys) await page.keyboard.up(key); }
          await page.waitForTimeout(100);
        }
        assert.ok(nearby, 'Ordinary movement must activate the original worker smart-selection range.');
      }
      let point;
      for (let turns = 0; turns <= 4; turns++) {
        await focus(); await page.waitForTimeout(150);
        await page.waitForFunction(() => {
          const c = window.polycraft.controls.manager().getGameCamera(), delta = c.baseAngle - c.desiredBaseAngle;
          return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < .001 &&
            ['Position', 'Focus'].every(key => { const a = c['currentV3' + key], b = c['desiredV3' + key]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < .01; }) && Math.abs(c.currentFOV - c.desiredFOV) < .001;
        }, null, { timeout: 5000 });
        point = await page.evaluate(id => {
        const controls = window.polycraft.controls, game = controls.manager(), entity = game.getGameEntityByName(id);
        const p = controls.app.globals.camera.worldToScreen(entity.getCentreLocation()), b = document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect(), device = controls.app.globals.graphicsDevice;
        const x = p[0] * b.width / device.width, y = p[1] * b.height / device.height;
        return { x: b.left + x, y: b.top + y, clear: x > 20 && x < b.width - 20 && y > 20 && y < b.height - 20, bounds: { width: b.width, height: b.height }, location: Array.from(entity.getv3Location()), hero: Array.from(game.getHero().getv3Location()) };
        }, worker.id);
        if (point.clear || turns === 4) break;
        await page.waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && window.polycraft.controls.manager().getGameController().isActive() && !window.polycraft.controls.manager().getIMGui().hasCapturedInput(), null, { timeout: 5000 });
        await page.keyboard.down('ArrowLeft');
        try { await page.waitForTimeout(500); } finally { await page.keyboard.up('ArrowLeft'); }
      }
      assert.ok(point.clear, 'The waiting worker must be visible before its normal activation click: ' + JSON.stringify(point));
      await focus();
      await page.waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && window.polycraft.controls.manager().getGameController().isActive() && !window.polycraft.controls.manager().getIMGui().hasCapturedInput(), null, { timeout: 5000 });
      await page.mouse.move(point.x, point.y);
      console.log('Native worker click projection:', JSON.stringify(point));
      await page.waitForFunction(async id => { const game = window.polycraft.controls.manager(), input = game.getGameController(), controller = input.controllerActionA; return document.hasFocus() && await window.desktop.windowFocused() && input.isActive() && !game.getIMGui().hasCapturedInput() && !controller.isIMGuiHot && controller.getNearestTarget(controller.getSelectionRadius())?.getName() === id; }, worker.id, { timeout: 5000 });
      await page.mouse.click(point.x, point.y, { delay: 100 });
      await page.waitForFunction(id => { const agent = window.polycraft.controls.manager().getGameEntityByName(id).getEC('ECWildlingAgent'); return !agent.isSleeping() && !agent.isWaitingForClick(); }, worker.id, { timeout: 5000 });
      console.log('Original worker resumed through its ordinary interaction click:', worker.id);
    }
    await page.waitForFunction(ids => ids.every(id => {
      const worker = window.polycraft.controls.manager().getGameEntityByName(id).getEC('ECWildlingHouse').getWildling();
      return worker && !worker.getEC('ECResourceCarrier').hasAnyFlyingResource();
    }), huts, { timeout: 15000 });
    console.log('Original acknowledgement-credit animations settled before fresh work-cycle observation.');
    await require('./coop-natural-workers.cjs')({ host: page, guest: page, focus, hostFile: file });
    const earned = JSON.parse(JSON.parse(fs.readFileSync(file)).state.userData.resource);
    assert.equal(JSON.parse(fs.readFileSync(file)).state.userData.desktopCoop, party, 'Solo worker income must preserve the saved co-op economy and heroes.');
    await close();
    const reopened = await open();
    const restored = await reopened.evaluate(() => { const game = window.polycraft.controls.manager(); return { resources: [0, 1].map(type => game.getPlayerData().getResource(type)), party: window.polycraft.bridge.state.userData.desktopCoop, history: window.polycraft.bridge.state.cheats.everEnabled }; });
    for (const resource of [0, 1]) assert.ok(restored.resources[resource] >= earned[resource], 'Normal exit/reopen must retain the earned solo worker income.');
    assert.equal(restored.party, party); assert.equal(restored.history, false);
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    await close();
    console.log('PASS: both workers resume native harvest/delivery from a saved checkpoint; solo income survives normal close/reopen, workers return and saved co-op economy/heroes remain unchanged.');
  } catch (error) {
    if (application) {
      await application.firstWindow().then(page => page.evaluate(async () => ({ focused: document.hasFocus(), nativeFocused: await window.desktop.windowFocused(), activeElement: document.activeElement?.id, flags: window.polycraft?.controls.manager()?.getPlayFlags() }))).then(state => console.log('Worker restart failure input state:', JSON.stringify(state))).catch(() => {});
      await application.firstWindow().then(page => page.screenshot({ path: path.join(directory, 'worker-reload-failure.png'), timeout: 5000 })).catch(() => {});
    }
    throw error;
  } finally {
    if (application) { const child = application.process(); await application.evaluate(({ app }) => app.exit()).catch(() => {}); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    for (const [name, bytes] of originals) assert.deepEqual(fs.readFileSync(path.join(source, name)), bytes);
    console.log('Source disposable worker checkpoint unchanged:', fixture);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
