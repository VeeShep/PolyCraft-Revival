'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-online-world-'));
  let application;
  try {
    application = await electron.launch({ args: ['.'], env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await application.firstWindow();
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true, 'Automated window stays visible');
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('#new-name').fill('Online simulation test');
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    const canvas = page.locator('#turbulenz_game_engine_canvas');
    async function clickGui(x, y, anchor) {
      const point = await page.evaluate(({ x, y, anchor }) => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(x, y, anchor)), { x, y, anchor });
      const bounds = await canvas.boundingBox();
      await page.mouse.move(bounds.x + point[0], bounds.y + point[1]);
      await page.waitForTimeout(200);
      await page.mouse.click(bounds.x + point[0], bounds.y + point[1], { delay: 100 });
    }
    await clickGui(-220, -70);
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await page.evaluate(async () => {
      const controls = window.polycraft.controls, game = controls.manager();
      window.onlineCounts = { spaces: 0, actions: 0 };
      const spaces = game.updateGameSpaces, actions = game.actionManager.update;
      game.updateGameSpaces = function (...args) { window.onlineCounts.spaces++; return spaces.apply(this, args); };
      game.actionManager.update = function (...args) { window.onlineCounts.actions++; return actions.apply(this, args); };
      window.onlineHost = new window.PolycraftMultiplayer.HostSession();
      window.onlineWorld = await window.PolycraftOnlineWorld.startHostingWorld(controls, window.onlineHost);
      window.onlineProbe = () => ({ ...window.onlineCounts, time: game.globals.gameCurrentTime, frame: game.gameClock.getFrameIndex(), stopped: game.gameClock.isStopped });
    });
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()), false);
    async function advancing(label, delay = 900) {
      const before = await page.evaluate(() => window.onlineProbe());
      await page.waitForTimeout(delay);
      const after = await page.evaluate(() => window.onlineProbe());
      assert.ok(after.time > before.time + 0.2, label + ': clock keeps running');
      assert.ok(after.spaces > before.spaces, label + ': real entity simulation runs');
      assert.ok(after.actions > before.actions, label + ': action manager runs');
      assert.ok(after.spaces - before.spaces <= after.frame - before.frame, label + ': no duplicate world update per tick');
      assert.equal(after.stopped, false, label + ': game clock remains active');
      console.log('Running:', label);
    }
    await advancing('playing');
    const worldSnapshot = await page.evaluate(async () => {
      const snapshot = await window.onlineWorld.snapshot();
      const game = window.polycraft.controls.manager();
      const entities = snapshot.spaces.flatMap(space => space.entities);
      const hero = entities.find(entity => entity.id === snapshot.hero);
      window.firstWorldSnapshot = snapshot;
      return { tick: snapshot.tick, hero, spaces: snapshot.spaces.length,
        blocks: snapshot.spaces.reduce((sum, space) => sum + space.blocks.length, 0), entities: entities.length,
        unsavedHero: !game.getHero().shouldLevelSave && !game.getHero().shouldPlayerSave,
        bytes: new TextEncoder().encode(JSON.stringify(snapshot)).length };
    });
    assert.ok(worldSnapshot.spaces > 0 && worldSnapshot.blocks > 0 && worldSnapshot.entities > 0);
    assert.ok(worldSnapshot.hero.mesh && worldSnapshot.hero.health);
    assert.equal(worldSnapshot.unsavedHero, true, 'Replication includes the hero missing from ordinary save serialization');
    console.log('Full live world snapshot:', worldSnapshot);
    const capturedTick = await page.evaluate(async () => {
      const before = JSON.stringify(window.firstWorldSnapshot);
      const next = await window.onlineWorld.snapshot();
      return { immutable: before === JSON.stringify(window.firstWorldSnapshot), advanced: next.tick > window.firstWorldSnapshot.tick };
    });
    assert.deepEqual(capturedTick, { immutable: true, advanced: true });
    await canvas.focus(); await page.keyboard.type('moreamberplease');
    await page.locator('#cheat-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#cheat-pause').textContent(), /keeps running/);
    assert.equal(await page.evaluate(() => window.polycraft.controls.paused), true);
    await advancing('Cheats');
    await page.locator('#close-cheats').click();
    await page.evaluate(() => window.polycraft.controls.manager().togglePause());
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePaused');
    await advancing('original Pause');
    await clickGui(-220, -70);
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await clickGui(85, 113, 'topLeft');
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateShop');
    await advancing('Craft Resource');
    await clickGui(-100, 100, 'topRight');
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await page.evaluate(() => {
      const gui = window.polycraft.controls.manager().getIMGui(), original = gui.doButton;
      window.demolitionClicks = [];
      gui.doButton = function (options) { const result = original.call(this, options); if (options.id.startsWith('demolition') && result) window.demolitionClicks.push({ id: options.id, guiDown: this.controller.getGuiDown(), prevDown: this.prevDown, sx: this.controller.sx, sy: this.controller.sy }); return result; };
      window.demolitionCheck = window.polycraft.controls.confirmDemolition({ name: 'Test storage' });
    });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateDemolition');
    await advancing('Demolish confirmation');
    await clickGui(-100, 100, 'topRight');
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name !== 'GamestateDemolition', null, { timeout: 5000 });
    const demolitionResult = await page.evaluate(() => window.demolitionCheck);
    if (demolitionResult) console.log('Unexpected demolition click:', await page.evaluate(() => window.demolitionClicks));
    assert.equal(demolitionResult, false);
    await page.locator('#slots').click();
    await page.locator('#launcher').waitFor({ state: 'visible' });
    await advancing('save selection');
    await page.locator('#welcome').click(); await page.keyboard.type('moretips');
    await page.locator('#tips-dialog').waitFor({ state: 'visible' });
    await advancing('loading tips');
    await page.locator('#close-tips').click();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.evaluate(() => document.getElementById('error-dialog').showModal());
    await advancing('error dialog');
    await page.locator('#error-dialog button').click();
    const beforeSave = await page.evaluate(() => window.onlineProbe());
    await page.evaluate(() => window.polycraft.checkpoint());
    const save = JSON.parse(fs.readFileSync(path.join(directory, 'saves', fs.readdirSync(path.join(directory, 'saves')).find(name => name.endsWith('.json')))));
    assert.ok(save.state.userData.AdventureIncGameState);
    assert.equal(save.state.cheats.everEnabled, true);
    const afterSave = await page.evaluate(() => window.onlineProbe());
    assert.ok(afterSave.frame > beforeSave.frame, 'Checkpoint reaches a simulation boundary');
    await advancing('after online checkpoint');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    await advancing('background host', 1500);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.evaluate(async () => { await window.onlineWorld.close(); window.polycraft.controls.pause(true); });
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()), true);
    const paused = await page.evaluate(() => window.onlineProbe());
    await page.waitForTimeout(500);
    const later = await page.evaluate(() => window.onlineProbe());
    assert.equal(later.frame, paused.frame, 'Solo desktop pause restored');
    assert.equal(later.spaces, paused.spaces);
    assert.deepEqual(errors, []);
    console.log('PASS: real host simulation/action updates continue exactly once per tick through Cheats, Pause, Craft Resource, Demolish, save selection, tips, errors, saves and background focus; solo pause restored.');
    console.log('This tests the engine boundary on a disposable host, not guest rendering or co-op progression.');
  } catch (error) {
    if (application) {
      try {
        const page = await application.firstWindow();
        fs.mkdirSync('test-results', { recursive: true });
        await page.screenshot({ path: 'test-results/online-world-failure.png' });
        console.log('Failure state:', await page.evaluate(() => ({ state: window.polycraft?.controls.manager()?.activeGameState?.name, status: document.getElementById('status').textContent })));
      } catch (diagnosticError) { console.log('Failure capture unavailable:', diagnosticError.message); }
    }
    throw error;
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profile:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
