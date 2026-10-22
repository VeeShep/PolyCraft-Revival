'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-demolition-'));
  let application;
  try {
    application = await electron.launch({ args: ['.'], env: { ...process.env, POLYCRAFT_TEST_DATA: directory } });
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('#new-name').fill('Demolition check');
    await page.locator('#new-game button').click({ noWaitAfter: true });
    const ready = () => page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await ready();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateStartScreen');
    await page.waitForTimeout(1500);
    const canvas = page.locator('#turbulenz_game_engine_canvas'); const bounds = await canvas.boundingBox();
    const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await page.mouse.move(bounds.x + play[0], bounds.y + play[1]); await page.waitForTimeout(250);
    await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    await page.waitForTimeout(2000);
    const created = await page.evaluate(() => {
      const controls = window.polycraft.controls, game = controls.manager();
      const before = controls.amounts().woodCap;
      const faction = game.getFactionManager().getHeroFactionName();
      const parent = game.getFactionManager().getFactionByName(faction).getHQ();
      const position = Array.from(game.getHero().getv3Location()); position[0] += 6;
      const entity = game.getEntityFactory().createInactiveEntityInstance('DemolitionStorage', 'a_b_lumberstorage', position, 0);
      entity.getEC('ECBuilding').setBuildingParentEntity(parent);
      entity.getEC('ECFaction').setFaction(faction);
      entity.activate();
      const entry = controls.demolitionInfo(entity);
      if (!entry || entry.reason) throw new Error('Test building unavailable: ' + JSON.stringify(entry));
      return { id: entity.getName(), name: entry.name, before, after: controls.amounts().woodCap };
    });
    assert.ok(created.after > created.before);
    await page.evaluate(() => { const c = window.polycraft.controls, amounts = c.amounts(); c.setAmounts(500, amounts.woodCap, amounts.stoneCap); });
    await page.evaluate(id => {
      const gui = window.polycraft.controls.manager().getIMGui(); const original = gui.doButton;
      gui.doButton = function (options, ...args) {
        if (options.guiArchetype === 'demolish' && options.id.includes(id)) window.testDemolishButton = Array.from(options.v2ScreenLocation);
        const clicked = original.call(this, options, ...args);
        if (options.guiArchetype === 'demolish' && clicked) window.testDemolishClicks = (window.testDemolishClicks || 0) + 1;
        return clicked;
      };
    }, created.id);
    const chooseDemolish = async () => {
      const centre = await page.evaluate(id => Array.from(window.polycraft.controls.manager().getGameCamera().getv2ScreenLocationFromWorld(window.polycraft.controls.manager().getGameEntityByName(id).getv3Location(), false)), created.id);
      await page.mouse.move(bounds.x + centre[0], bounds.y + centre[1]);
      await page.evaluate(id => { window.testDemolishButton = null; window.polycraft.controls.manager().getGameEntityByName(id).getEC('ECSelectable').setActivated(true); }, created.id);
      await page.waitForFunction(() => window.testDemolishButton);
      const button = await page.evaluate(() => window.testDemolishButton);
      await page.mouse.move(bounds.x + button[0], bounds.y + button[1]); await page.waitForTimeout(250);
      fs.mkdirSync('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/demolition-radial.png' });
      await page.mouse.click(bounds.x + button[0], bounds.y + button[1], { delay: 100 });
      await page.waitForFunction(() => window.polycraft.controls.manager().getActiveGameState().name === 'GamestateDemolition');
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'test-results/demolition-confirmation.png' });
    };
    await chooseDemolish();
    const clickDialogButton = async cancel => {
      const point = await page.evaluate(cancel => Array.from(cancel ? window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-100, 100, 'topRight') : window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(0, 0)), cancel);
      await page.mouse.move(bounds.x + point[0], bounds.y + point[1]); await page.waitForTimeout(250);
      await page.mouse.click(bounds.x + point[0], bounds.y + point[1], { delay: 100 });
      await page.waitForFunction(() => window.polycraft.controls.manager().getActiveGameState().name === 'GamestatePlaying');
    };
    await clickDialogButton(true);
    assert.equal(await page.evaluate(id => !!window.polycraft.controls.manager().getGameEntityByName(id), created.id), true);
    await chooseDemolish();
    const beforeDemolition = await page.evaluate(() => window.polycraft.controls.amounts());
    await clickDialogButton(false);
    await page.waitForFunction(id => {
      const state = window.polycraft.slot().state.userData.AdventureIncGameState;
      return state && !JSON.parse(state).gameSpaceList.some(space => space.entityList.some(entity => entity.name === id));
    }, created.id);
    const amounts = await page.evaluate(() => window.polycraft.controls.amounts());
    assert.equal(amounts.woodCap, created.before); assert.equal(amounts.wood, created.before); assert.equal(amounts.amber, beforeDemolition.amber);
    await page.evaluate(() => sessionStorage.setItem('polycraft-slot', window.polycraft.slot().id));
    await page.reload(); await ready();
    assert.equal(await page.evaluate(id => !!window.polycraft.controls.manager().getGameEntityByName(id), created.id), false);
    assert.equal(await page.evaluate(() => window.polycraft.controls.amounts().woodCap), created.before);
    assert.deepEqual(errors, []);
    console.log('PASS: original in-game radial Demolish button, original canvas confirmation/cancel, real storage cleanup, resource capacity, immediate save and reload without resurrection');
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit());
    console.log('Temporary test saves:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
