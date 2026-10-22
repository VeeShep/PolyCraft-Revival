'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Saves, emptyState } = require('../desktop/saves.cjs');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-history-'));
  const saves = new Saves(path.join(directory, 'saves'));
  const slot = saves.create('Legacy history');
  const state = emptyState(); delete state.cheats.everEnabled;
  const raw = JSON.stringify({ format: slot.format, version: 1, name: slot.name, updatedAt: slot.updatedAt, state }, null, 2) + '\n';
  fs.writeFileSync(saves.file(slot.id), raw);
  let application;
  try {
    application = await electron.launch({
      ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }),
      env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000
    });
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('.save').waitFor();
    assert.match(await page.locator('.save').textContent(), /Unknown history/);
    assert.equal(fs.existsSync(saves.file(slot.id) + '.pre-v2'), false);
    await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await page.evaluate(() => window.polycraft.checkpoint());
    assert.equal(saves.load(slot.id).version, 2);
    assert.equal(saves.load(slot.id).state.cheats.everEnabled, null);
    assert.equal(fs.readFileSync(saves.file(slot.id) + '.pre-v2', 'utf8'), raw);
    await page.locator('#turbulenz_game_engine_canvas').focus();
    await page.keyboard.type('moreamberplease');
    await page.locator('#cheat-dialog').waitFor({ state: 'visible' });
    assert.equal(saves.load(slot.id).state.cheats.everEnabled, true);
    await page.locator('#cheats-enabled').uncheck();
    await page.waitForFunction(() => !window.polycraft.slot().state.cheats.enabled && document.getElementById('status').textContent.startsWith('Saved locally'));
    await page.locator('#close-cheats').click();
    await page.locator('#slots').click();
    assert.match(await page.locator('.save').textContent(), /Cheats used/);
    assert.equal(saves.read(saves.file(slot.id) + '.bak').state.cheats.everEnabled, true);
    assert.equal(fs.readFileSync(saves.file(slot.id) + '.pre-v2', 'utf8'), raw);
    assert.deepEqual(errors, []);
    console.log('PASS: real legacy UI, unknown history, first-checkpoint migration, exact original backup, enable-only marking and sticky disabled history.');
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit());
    console.log('Temporary test saves:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
