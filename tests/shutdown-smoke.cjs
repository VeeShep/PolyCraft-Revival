'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { once } = require('node:events');
const { createRoomServer } = require('../server/rooms.cjs');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-shutdown-'));
  const service = createRoomServer();
  let application;
  try {
    service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await application.firstWindow();
    await application.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) throw new Error('The temporary shutdown test must be visible.');
      window.on('page-title-updated', event => event.preventDefault());
      window.setTitle('PolyCraft temporary island — native shutdown test');
      // Hold only this test process alive so late native callbacks can be inspected.
      app.on('before-quit', event => event.preventDefault());
    });
    await page.locator('#new-name').fill('Temporary shutdown island');
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await page.evaluate(url => window.desktop.room('open', { type: 'create', url, room: 'temporary-shutdown', password: 'disposable-test-password', runtime: 'shutdown-test' }), 'ws://127.0.0.1:' + service.server.address().port + '/signaling');
    assert.equal(service.rooms.size, 1);
    console.log('Visible disposable island connected through actual renderer IPC and native room socket.');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy());
    const deadline = Date.now() + 5000;
    while (service.rooms.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(service.rooms.size, 0, 'Destroying the window must close its real room connection.');
    await application.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
    const log = fs.readFileSync(path.join(directory, 'logs', 'game.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!log.some(row => ['main-exception', 'main-rejection', 'direct-cleanup-failed'].includes(row.event)), 'Late native cleanup must not throw after BrowserWindow destruction.');
    console.log('PASS: real destroyed BrowserWindow closes its native room; late callbacks do not throw, no window survives and main process remains responsive.');
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.exit()).catch(() => {});
      application.process().kill('SIGKILL');
    }
    await service.close();
    console.log('Disposable shutdown profile:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
