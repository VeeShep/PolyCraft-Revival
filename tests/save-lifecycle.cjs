'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-lifecycle-'));
  const backup = path.join(directory, 'export.json');
  let application;
  const launch = async () => {
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory } });
    // Deterministic native dialog choices; all renderer, IPC and disk paths remain real.
    await application.evaluate(({ dialog }, backup) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    return application.firstWindow();
  };
  const ready = page => page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
  try {
    let page = await launch();
    await page.locator('#new-name').fill('Lifecycle island');
    await page.locator('#new-game button').click({ noWaitAfter: true });
    await ready(page);
    await page.evaluate(() => window.polycraft.controls.setAmounts(2468, 0, 0));
    await page.locator('#slots').click();
    await page.locator('#save-list button', { hasText: 'Rename' }).click();
    await page.locator('#rename-value').fill('Renamed island');
    await page.locator('#name-dialog button[value="save"]').click();
    await page.locator('#save-list h2', { hasText: 'Renamed island' }).waitFor();
    await page.locator('#save-list button', { hasText: 'Export backup' }).click();
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Backup exported.');
    assert.equal(JSON.parse(fs.readFileSync(backup)).name, 'Renamed island');
    await page.locator('#import').click();
    await page.waitForFunction(() => document.querySelectorAll('#save-list article').length === 2);
    await page.locator('#save-list article').first().getByRole('button', { name: /Resume|Continue/ }).click({ noWaitAfter: true });
    await ready(page);
    await page.evaluate(() => window.polycraft.controls.setAmounts(3579, 0, 0));
    const closed = new Promise(resolve => application.process().once('exit', resolve));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    application = null;
    const files = fs.readdirSync(path.join(directory, 'saves')).filter(name => name.endsWith('.json'));
    assert.equal(files.length, 2);
    page = await launch();
    await page.locator('#save-list article').first().getByRole('button', { name: 'Continue' }).click({ noWaitAfter: true });
    await ready(page);
    assert.equal(await page.evaluate(() => window.polycraft.controls.amounts().amber), 3579, 'Normal close must save latest progress');
    await page.locator('#slots').click();
    await page.locator('#save-list article').filter({ has: page.getByRole('button', { name: 'Resume' }) }).getByRole('button', { name: 'Delete', exact: true }).click({ noWaitAfter: true });
    await page.waitForFunction(() => !window.polycraft && document.querySelectorAll('#save-list article').length === 1);
    assert.equal(fs.readdirSync(path.join(directory, 'saves')).filter(name => name.endsWith('.json')).length, 1);
    console.log('PASS: rename, backup export/import, normal-close saving, reload and active-slot deletion');
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit());
    console.log('Temporary test saves:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
