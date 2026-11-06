'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

(async () => {
  const fixture = fs.realpathSync(process.env.POLYCRAFT_HQ_FIXTURE || '');
  assert.ok(fixture.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(path.dirname(fixture)).startsWith('polycraft-coop-identities-') && path.basename(fixture) === 'host', 'Only a disposable co-op identities host fixture is accepted.');
  const files = fs.readdirSync(path.join(fixture, 'saves')).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const source = path.join(fixture, 'saves', files[0]), primary = fs.readFileSync(source), backup = fs.readFileSync(source + '.bak');
  const saved = JSON.parse(backup), data = saved.state.userData, level = JSON.parse(data.AdventureIncGameState);
  const expected = {
    hq: level.gameSpaceList.flatMap(space => space.entityList).filter(entity => entity.archetypeName === 'a_b_hq').map(entity => ({ name: entity.name, archetype: entity.archetypeName, location: entity.v3Location })),
    lumbermills: level.gameSpaceList.flatMap(space => space.entityList).filter(entity => entity.archetypeName === 'a_b_lumbermill').map(entity => ({ name: entity.name, archetype: entity.archetypeName, location: entity.v3Location })),
    flags: { goToVillage: JSON.parse(data.taskFlags).goToVillage, buildHq: JSON.parse(data.taskFlags).buildHq, buildLumbermill: JSON.parse(data.taskFlags).buildLumbermill === true },
    pending: JSON.parse(data.desktopQuests).pending, coop: JSON.parse(data.desktopCoop), everEnabled: saved.state.cheats.everEnabled
  };
  assert.equal(expected.hq.length, 1); assert.equal(expected.lumbermills.length, process.argv.includes('--lumbermill') ? 1 : 0);
  assert.deepEqual(expected.flags, { goToVillage: true, buildHq: true, buildLumbermill: expected.lumbermills.length === 1 });
  assert.ok(expected.pending.some(task => task.task === (expected.lumbermills.length ? 'buildLumbermill' : 'buildHq'))); assert.equal(expected.coop.players.length, 4); assert.equal(expected.everEnabled, false);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-hq-recovery-'));
  fs.mkdirSync(path.join(directory, 'saves'));
  const file = path.join(directory, 'saves', files[0]);
  fs.writeFileSync(file + '.bak', backup); fs.writeFileSync(file, '{truncated disposable primary');
  let app;
  const errors = [], requests = [];
  try {
    console.log('Disposable HQ recovery profile:', directory);
    app = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    await app.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) throw new Error('HQ recovery test must be visible.');
      window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary island — completed HQ backup recovery');
      app.focus({ steal: true }); window.moveTop(); window.focus();
    });
    const card = page.locator('#save-list article').first();
    await card.getByText(/Recovery backup available/).waitFor(); assert.match(await card.innerText(), /Clean/);
    await Promise.all([page.waitForEvent('domcontentloaded'), card.getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Island loaded from its recovery backup.');
    await page.bringToFront(); const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
    const point = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await canvas.focus(); await page.mouse.move(10, 10); await page.mouse.move(bounds.x + point[0], bounds.y + point[1], { steps: 5 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
    await page.mouse.click(bounds.x + point[0], bounds.y + point[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    const restored = await page.evaluate(() => {
      const game = window.polycraft.controls.manager(), state = window.polycraft.bridge.state, data = state.userData;
      return { world: {
        hq: game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false).filter(entity => !entity.getEC('ECScaffold')).map(entity => ({ name: entity.getName(), archetype: entity.getArchetypeName(), location: Array.from(entity.getv3Location()) })),
        lumbermills: game.getBuildingManager().getBuildingsAtMinLevel('Lumbermill', 1, false).filter(entity => !entity.getEC('ECScaffold')).map(entity => ({ name: entity.getName(), archetype: entity.getArchetypeName(), location: Array.from(entity.getv3Location()) })),
        flags: { goToVillage: game.getPlayerData().getTaskFlags().goToVillage, buildHq: game.getPlayerData().getTaskFlags().buildHq, buildLumbermill: game.getPlayerData().getTaskFlags().buildLumbermill === true },
        pending: JSON.parse(data.desktopQuests).pending, coop: JSON.parse(data.desktopCoop), everEnabled: state.cheats.everEnabled
      }, scripts: game.runScripts };
    });
    console.log('Recovered original HQ world:', JSON.stringify(restored));
    assert.equal(restored.scripts, true); assert.deepEqual(restored.world, expected);
    await page.evaluate(() => window.polycraft.checkpoint(true));
    const repaired = JSON.parse(fs.readFileSync(file));
    assert.equal(repaired.state.cheats.everEnabled, false); assert.deepEqual(JSON.parse(repaired.state.userData.desktopCoop), expected.coop);
    const buildings = JSON.parse(repaired.state.userData.AdventureIncGameState).gameSpaceList.flatMap(space => space.entityList);
    for (const entity of [...expected.hq, ...expected.lumbermills]) assert.ok(buildings.some(saved => saved.name === entity.name && saved.archetypeName === entity.archetype));
    assert.deepEqual(fs.readFileSync(file + '.bak'), backup, 'The real valid recovery checkpoint stays intact when repairing the primary.');
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    console.log('PASS: actual completed-HQ backup loaded through original launcher, same world/reward/party/history restored, valid primary saved, recovery bytes retained.');
    if (process.argv.includes('--rehost')) await require('./coop-recovered-party.cjs')({ host: page, expected, fixture, directory, file, errors, requests });
  } finally {
    if (app) { const child = app.process(); await app.evaluate(({ app }) => app.exit()).catch(() => {}); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    assert.deepEqual(fs.readFileSync(source), primary); assert.deepEqual(fs.readFileSync(source + '.bak'), backup);
    console.log('Source disposable island unchanged; recovery profile:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
