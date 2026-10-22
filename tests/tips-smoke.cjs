'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-tips-'));
  let application;
  try {
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory } });
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('#new-name').pressSequentially('moretips');
    assert.equal(await page.locator('#tips-dialog').evaluate(dialog => dialog.open), false);
    await page.locator('#welcome').click(); await page.keyboard.type('moretips');
    await page.locator('#tips-dialog').waitFor({ state: 'visible' });
    const count = await page.evaluate(async () => Object.keys((await (await fetch('/mapping_table.json')).json()).urnmapping).filter(name => /^textures\/loading-.*\.jpg$/.test(name)).length);
    assert.ok(count > 1);
    const seen = new Set();
    for (let index = 0; index < count; index++) {
      await page.locator('#tip-image').evaluate(image => image.decode());
      assert.equal(await page.locator('#tip-image').evaluate(image => image.naturalWidth > 0 && image.naturalHeight > 0), true);
      seen.add(await page.locator('#tip-image').getAttribute('src'));
      await page.locator('#tip-next').click();
    }
    assert.equal(seen.size, count);
    assert.match(await page.locator('#tip-caption').textContent(), new RegExp('Tip 1 of ' + count));
    await page.keyboard.press('ArrowLeft');
    assert.match(await page.locator('#tip-caption').textContent(), new RegExp('Tip ' + count + ' of ' + count));
    await page.locator('#tip-previous').click();
    await page.locator('#tip-image').evaluate(image => image.decode());
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/loading-tips.png' });
    await page.keyboard.press('Escape');
    await page.locator('#tips-dialog').waitFor({ state: 'hidden' });
    await page.locator('#new-name').fill('Tips check');
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft && !window.polycraft.controls.ready());
    await page.locator('#turbulenz_game_engine_canvas').focus(); await page.keyboard.type('moretips');
    await page.locator('#tips-dialog').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.polycraft.controls.ready(), null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.polycraft.controls.paused), true);
    assert.equal(await page.evaluate(() => window.polycraft.slot().state.cheats.enabled), false);
    await page.locator('#close-tips').click();
    await page.waitForFunction(() => !window.polycraft.controls.paused);
    assert.equal(await page.evaluate(() => window.polycraft.controls.paused), false);
    assert.deepEqual(errors, []);
    console.log('PASS: moretips ignores text fields, opens on launcher/loading, displays all ' + count + ' original images, wraps navigation, closes with Escape/button, restores pause state and leaves cheats off');
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit());
    console.log('Temporary test saves:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
