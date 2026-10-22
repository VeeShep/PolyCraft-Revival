'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-fullscreen-'));
  let application;
  try {
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory } });
    const page = await application.firstWindow();
    page.on('pageerror', error => console.error('Game error:', error.message));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    await page.locator('#new-name').fill('Fullscreen check');
    await page.locator('#new-game button').click({ noWaitAfter: true });
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await page.locator('#fullscreen').click();
    const nativeFullscreen = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
    for (let attempt = 0; attempt < 40 && !(await nativeFullscreen()); attempt++) await page.waitForTimeout(100);
    assert.equal(await nativeFullscreen(), true);
    await page.waitForTimeout(1000);
    await page.locator('#fullscreen').click();
    for (let attempt = 0; attempt < 40 && await nativeFullscreen(); attempt++) await page.waitForTimeout(100);
    assert.equal(await nativeFullscreen(), false);
    await page.waitForTimeout(1000);
    const canvas = page.locator('#turbulenz_game_engine_canvas');
    const clickCanvas = async (x, y, anchor) => {
      const point = await page.evaluate(({ x, y, anchor }) => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(x, y, anchor)), { x, y, anchor });
      const bounds = await canvas.boundingBox();
      await page.mouse.move(bounds.x + point[0], bounds.y + point[1]);
      await page.waitForTimeout(200);
      await page.mouse.click(bounds.x + point[0], bounds.y + point[1]);
    };
    await clickCanvas(-220, -70);
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    // Activate the original quest in this disposable island, then use the real button.
    await page.evaluate(() => {
      const group = window.polycraft.controls.manager().getTaskManager().fillerTaskGroup;
      const index = group.taskList.indexOf('goFullScreen');
      if (index < 0) throw new Error('Original fullscreen quest is missing');
      group.setTasksVisible([index]);
      if (group.getCompletedTasks([index]).length) throw new Error('Quest was already satisfied');
    });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await clickCanvas(54, 52, 'topLeft');
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/fullscreen-icon.png' });
    await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => {
      const group = window.polycraft.controls.manager().getTaskManager().fillerTaskGroup;
      const index = group.taskList.indexOf('goFullScreen');
      return group.taskCompleteStatusList[index] || group.getCompletedTasks([index]).includes(index);
    }), true, 'The original fullscreen quest must be satisfied by the game button');

    await page.waitForTimeout(1000);
    await clickCanvas(54, 52, 'topLeft');
    await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    const canvasBounds = await canvas.boundingBox();
    await page.mouse.move(canvasBounds.x + 200, canvasBounds.y + 200);
    await canvas.focus();
    await page.keyboard.press('f');
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.fullscreenElement.id), 'turbulenz_game_engine_canvas');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.fullscreenElement);
    console.log('PASS: desktop fullscreen, original icon, fullscreen quest, and F/escape');
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/fullscreen-exit.png' });
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit());
    console.log('Temporary test saves:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
