'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

(async () => {
  assert.ok(process.argv.slice(2).every(argument => argument === '--backup'), 'Only --backup is supported.');
  const backup = process.argv.includes('--backup');
  const fixture = fs.realpathSync(process.env.POLYCRAFT_REWARD_FIXTURE || '');
  assert.ok(fixture.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(path.dirname(fixture)).startsWith('polycraft-session-ui-') && path.basename(fixture) === 'host', 'Only an existing disposable session-test host fixture is accepted.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-reward-recovery-'));
  fs.cpSync(path.join(fixture, 'saves'), path.join(directory, 'saves'), { recursive: true });
  const files = fs.readdirSync(path.join(directory, 'saves')).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const file = path.join(directory, 'saves', files[0]);
  const read = () => { const state = JSON.parse(fs.readFileSync(file)).state, data = state.userData; return { coop: JSON.parse(data.desktopCoop), rewards: JSON.parse(data.desktopCampaignRewards), everEnabled: state.cheats.everEnabled }; };
  const original = read(), reward = original.rewards.pending[0];
  assert.equal(original.rewards.pending.length, 1); assert.equal(reward.owner, original.coop.host);
  const before = original.coop.players.find(row => row.id === original.coop.host);
  if (backup) { fs.copyFileSync(file, file + '.bak'); fs.writeFileSync(file, '{broken disposable primary'); }
  let app, page;
  const errors = [];
  async function focus() {
    await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); const window = BrowserWindow.getAllWindows()[0]; window.moveTop(); window.focus(); });
    await page.bringToFront(); await page.waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused());
  }
  async function click(selector) { await focus(); await page.locator(selector).click(); }
  async function load() {
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#save-list article').first().getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await focus(); const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
    const point = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await canvas.focus(); await page.mouse.move(bounds.x + point[0], bounds.y + point[1]);
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
    await page.mouse.click(bounds.x + point[0], bounds.y + point[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await page.evaluate(() => { const game = window.polycraft.controls.manager(); game.runScripts = false; game.setScriptLocked(false); game.activeGameState.setPlayState('PlayStateNormal'); });
    assert.equal(await page.evaluate(() => window.polycraft.controls.manager().desktopCampaignRewards.current()), undefined, 'Solo must not claim the co-op host reward.');
  }
  async function host() {
    await click('#multiplayer'); await click('#host-island');
    await page.locator('#multiplayer-warning[open]').waitFor(); await click('#multiplayer-warning button[value="continue"]');
    await page.waitForFunction(() => !!window.polycraft.controls.onlineWorld?.players); await click('#close-multiplayer');
  }
  try {
    console.log('Disposable campaign recovery profile:', directory, 'backup:', backup);
    app = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (!window.isVisible()) throw new Error('Test window must be visible.'); window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary host — campaign reward recovery'); });
    if (backup) { await page.locator('#save-list article').first().waitFor(); assert.match(await page.locator('#save-list article').first().textContent(), /Recovery backup available/); }
    await load();
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.polycraft.bridge.state.userData.desktopCampaignRewards)), original.rewards);
    await host();
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateCampaignScore');
    assert.deepEqual(await page.evaluate(() => window.polycraft.controls.manager().desktopCampaignRewards.current()), reward);
    await focus();
    await page.waitForFunction(() => Object.values(window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap).some(row => row.archetypeName === 'infoPanelUpgradeButton' && row.scale > 0.95));
    const button = await page.evaluate(() => {
      const controls = window.polycraft.controls, game = controls.manager(), [id, row] = Object.entries(game.getGuiManager().prevDrawGuiMap).find(([, row]) => row.archetypeName === 'infoPanelUpgradeButton' && row.scale > 0.95);
      const args = row.argumentObject, point = args.v2ScreenLocation || [args.x, args.y], bounds = document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect(), device = controls.app.globals.graphicsDevice;
      return { id, x: bounds.left + point[0] * bounds.width / device.width, y: bounds.top + point[1] * bounds.height / device.height };
    });
    fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/campaign-recovery-pending.png' });
    await page.mouse.move(button.x, button.y); await page.waitForFunction(id => window.polycraft.controls.manager().getIMGui().isHot(id), button.id);
    await page.mouse.click(button.x, button.y, { delay: 100 });
    await page.waitForFunction(() => !window.polycraft.controls.manager().desktopCampaignRewards.current());
    await page.evaluate(() => window.polycraft.checkpoint(true));
    const awarded = read(), player = awarded.coop.players.find(row => row.id === awarded.coop.host);
    assert.equal(awarded.everEnabled, original.everEnabled);
    assert.equal(player.progress.xp, before.progress.xp + reward.score.xpBonus);
    assert.equal(awarded.coop.economy.resource[0], original.coop.economy.resource[0] + reward.score.resourceBonusList[0]);
    assert.equal(awarded.coop.economy.resource[1], original.coop.economy.resource[1] + reward.score.resourceBonusList[1]);
    assert.equal(awarded.rewards.pending.length, 0);
    await click('#multiplayer'); await click('#end-session'); await page.waitForFunction(() => !window.polycraft.controls.onlineWorld);
    await page.reload(); await load(); await host(); await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.polycraft.controls.manager().activeGameState.name), 'GamestatePlaying');
    assert.equal(await page.evaluate(id => window.polycraft.controls.manager().desktopCampaignRewards.award(id, () => { throw new Error('Duplicate reward callback'); }), reward.id), false);
    await page.evaluate(() => window.polycraft.checkpoint(true));
    const reloaded = read(); assert.deepEqual(reloaded.coop.economy, awarded.coop.economy);
    assert.equal(reloaded.everEnabled, original.everEnabled);
    assert.deepEqual(reloaded.coop.players.find(row => row.id === reloaded.coop.host).progress, player.progress); assert.equal(reloaded.rewards.pending.length, 0);
    assert.deepEqual(errors, []); console.log('PASS: original host reward panel restores after load/hosting; native click awards exact XP/resources once, disk/reload/rehost retain them and stale claim cannot repeat.');
  } catch (error) { if (page) await page.screenshot({ path: 'test-results/campaign-recovery-failure.png' }).catch(() => {}); throw error; }
  finally { if (app) { await app.evaluate(({ app }) => app.exit()).catch(() => {}); app.process().kill('SIGKILL'); } }
})().catch(error => { console.error(error); process.exitCode = 1; });
