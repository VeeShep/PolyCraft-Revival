'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-graphics-'));
  let application;
  try {
    application = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await application.firstWindow();
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    const errors = [], warnings = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) warnings.push(message.text()); });
    await page.addInitScript(() => {
      window.compiledGameShaders = [];
      const getContext = HTMLCanvasElement.prototype.getContext, seen = new WeakSet();
      HTMLCanvasElement.prototype.getContext = function (...args) {
        const gl = getContext.apply(this, args);
        if (gl?.shaderSource && !seen.has(gl)) {
          seen.add(gl);
          const shaderSource = gl.shaderSource;
          gl.shaderSource = function (shader, source) { window.compiledGameShaders.push({ gl, shader, source }); return shaderSource.call(this, shader, source); };
        }
        return gl;
      };
    });
    await page.locator('#new-name').fill('Graphics compatibility test');
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateStartScreen');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
    const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await page.mouse.move(bounds.x + play[0], bounds.y + play[1]); await page.waitForTimeout(200);
    await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await page.waitForTimeout(1000);
    const shaders = await page.evaluate(() => {
      const shaders = window.compiledGameShaders;
      return { count: shaders.length, failures: shaders.filter(({ gl, shader }) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS)).map(({ gl, shader }) => gl.getShaderInfoLog(shader)),
        shadow: shaders.filter(({ source }) => source.includes('shadowDepth')).length,
        mediumDefaults: shaders.filter(({ source }) => /precision\s+mediump\s+float\s*;/.test(source)).length };
    });
    const diagnostics = await page.evaluate(() => window.PolycraftGraphics.diagnostics(window.polycraft.controls.manager()));
    assert.ok(shaders.count > 20 && shaders.shadow > 0, 'Real game and shadow shader sources were compiled');
    assert.deepEqual(shaders.failures, []);
    assert.equal(diagnostics.floatPolicy, 'highp'); assert.equal(shaders.mediumDefaults, 0);
    assert.ok(diagnostics.shadersPromoted > 0 && diagnostics.defaultDepthBits > 0);
    console.log('Actual graphics diagnostics:', diagnostics, 'Shaders:', shaders);
    const cancelled = await page.evaluate(() => {
      const canvas = document.getElementById('turbulenz_game_engine_canvas');
      window.polycraft.controls.app.globals.inputDevice.setEventHandlersMouseEnter();
      const event = new WheelEvent('mousewheel', { bubbles: true, cancelable: true, deltaY: 120 });
      canvas.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(cancelled, true, 'The original root wheel listener can cancel scrolling');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 180); await page.mouse.wheel(0, -180);
    // Skip the opening sleeping-hero sequence only on this disposable graphics island.
    await page.evaluate(() => {
      const controls = window.polycraft.controls, game = controls.manager();
      game.runScripts = false;
      game.setScriptLocked(false);
      game.activeGameState.setPlayState('PlayStateNormal');
      controls.setProgression(10, 0, 10);
    });
    await canvas.focus();
    const before = await page.evaluate(() => ({ hero: Array.from(window.polycraft.controls.manager().getHero().getv3Location()), camera: Array.from(window.polycraft.controls.app.globals.camera.viewProjectionMatrix) }));
    await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(1000); await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('w'); await page.waitForTimeout(750); await page.keyboard.up('w');
    const after = await page.evaluate(() => ({ hero: Array.from(window.polycraft.controls.manager().getHero().getv3Location()), camera: Array.from(window.polycraft.controls.app.globals.camera.viewProjectionMatrix) }));
    assert.ok(Math.hypot(...after.hero.map((value, index) => value - before.hero[index])) > 0.1, 'Keyboard input moves the real hero');
    assert.notDeepEqual(after.camera, before.camera, 'The real camera changes while rotating and moving');
    assert.equal(await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.camera.viewProjectionMatrix).every(Number.isFinite)), true);
    await page.evaluate(() => window.polycraft.controls.manager().gameLighting.setShadowsEnabled(false));
    await page.waitForTimeout(500);
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/graphics-shadows-off.png' });
    await page.evaluate(() => window.polycraft.controls.manager().gameLighting.setShadowsEnabled(true));
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/graphics-shadows-on.png' });
    await page.evaluate(() => window.polycraft.checkpoint());
    const log = fs.readFileSync(path.join(directory, 'logs', 'game.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(log.some(entry => entry.event === 'graphics-info' && entry.details.floatPolicy === 'highp'));
    assert.deepEqual(warnings.filter(message => /passive|preventDefault|shader.*(fail|error)|link.*(fail|error)/i.test(message)), []);
    assert.deepEqual(errors, []);
    console.log('PASS: real high-precision game/shadow shaders compile, wheel cancellation works without passive warnings, movement/rotation render and graphics diagnostics reach the local log.');
    console.log('This Mac check does not establish a Linux/Nvidia visual fix.');
  } catch (error) {
    if (application) {
      try {
        const page = await application.firstWindow();
        fs.mkdirSync('test-results', { recursive: true });
        await page.screenshot({ path: 'test-results/graphics-failure.png' });
        console.log('Graphics failure state:', await page.evaluate(() => ({ state: window.polycraft?.controls.manager()?.activeGameState?.name, status: document.getElementById('status').textContent, error: document.getElementById('error-text').textContent })));
      } catch (diagnosticError) { console.log('Failure capture unavailable:', diagnosticError.message); }
    }
    throw error;
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profile:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
