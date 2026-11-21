'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-muted-test-')));
  let application;
  try {
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const state = await application.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary island — muted audio check');
      return { visible: window.isVisible(), muted: window.webContents.isAudioMuted(), directory: app.getPath('userData') };
    });
    assert.deepEqual(state, { visible: true, muted: true, directory });
    console.log('PASS: visible temporary-data window is muted before gameplay; no island opened:', JSON.stringify(state));
    const closed = application.waitForEvent('close', { timeout: 15000 });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; application = null;
  } finally { if (application) await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
