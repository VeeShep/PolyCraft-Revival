'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const Beta2Saves = require('../reference/beta-2-save-reader/saves.cjs').Saves;
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-coop-data-'));
  let application;
  const errors = [];
  try {
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await application.firstWindow();
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#new-name').fill('Temporary co-op data test');
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateStartScreen');
    await page.evaluate(() => window.polycraft.checkpoint());
    const savesDirectory = path.join(directory, 'saves');
    const file = path.join(savesDirectory, fs.readdirSync(savesDirectory).find(name => name.endsWith('.json')));
    const before = fs.readFileSync(file);
    assert.equal(JSON.parse(before).version, 2);
    const expected = await page.evaluate(async () => {
      const { controls, bridge } = window.polycraft, solo = controls.manager().getPlayerData();
      const before = { xp: solo.getXP(), amber: solo.getSoftCurrency(), wood: solo.getResource(0), stone: solo.getResource(1) };
      const registry = new window.PolycraftCoopData.CoopData(bridge.state), guest = registry.addPlayer('Friend');
      const hostModel = registry.createPlayerData(solo, registry.data.host), guestModel = registry.createPlayerData(solo, guest.id);
      hostModel.addXP(30); hostModel.saveProgress(); guestModel.addXP(55); guestModel.saveProgress();
      guestModel.setHeroUpgrade('movementSpeed', 2);
      hostModel.adjustSoftCurrency(40); guestModel.adjustSoftCurrency(-10);
      const after = { xp: solo.getXP(), amber: solo.getSoftCurrency(), wood: solo.getResource(0), stone: solo.getResource(1) };
      await window.polycraft.checkpoint();
      return { before, after, data: registry.data, id: window.polycraft.slot().id };
    });
    assert.deepEqual(expected.after, expected.before, 'Real engine solo progress and inventory remain unchanged');
    const migrated = JSON.parse(fs.readFileSync(file));
    assert.equal(migrated.version, 3); assert.equal(migrated.state.cheats.everEnabled, false);
    assert.deepEqual(JSON.parse(migrated.state.userData.desktopCoop), expected.data);
    assert.deepEqual(fs.readFileSync(file + '.pre-v3'), before, 'First co-op checkpoint keeps the exact original version 2 save');
    const old = new Beta2Saves(savesDirectory);
    assert.throws(() => old.load(expected.id), /Unsupported/);
    await page.evaluate(() => sessionStorage.setItem('polycraft-slot', window.polycraft.slot().id));
    await page.reload();
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    const reloaded = await page.evaluate(() => {
      const registry = new window.PolycraftCoopData.CoopData(window.polycraft.bridge.state), solo = window.polycraft.controls.manager().getPlayerData();
      const models = registry.data.players.map(player => registry.createPlayerData(solo, player.id));
      return { data: registry.data, xp: models.map(model => model.getXP()), upgrades: models[1].getHeroUpgrade('movementSpeed'),
        currency: models.map(model => model.getSoftCurrency()), solo: { xp: solo.getXP(), amber: solo.getSoftCurrency(), wood: solo.getResource(0), stone: solo.getResource(1) } };
    });
    assert.deepEqual(reloaded.data, expected.data); assert.deepEqual(reloaded.xp, [30, 55]);
    assert.equal(reloaded.upgrades, 2); assert.deepEqual(reloaded.currency, [30, 30]); assert.deepEqual(reloaded.solo, expected.before);
    assert.deepEqual(errors, []);
    console.log('PASS: visible real engine player-data instances retain independent co-op XP/upgrades, share only the co-op economy, preserve solo amounts/progress, migrate only this slot to format 3 with exact pre-v3 bytes, reject the actual older reader and survive full game reload.');
    console.log('This checks the data/persistence boundary, not separate controlled hero entities or playable co-op.');
  } catch (error) {
    if (application) try { const page = await application.firstWindow(); fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/coop-data-failure.png' }); } catch {}
    console.log('Renderer errors:', errors); throw error;
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profile:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
