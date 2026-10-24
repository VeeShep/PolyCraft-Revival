'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-progression-'));
  let application;
  try {
    application = await electron.launch({ args: ['.'], env: { ...process.env, POLYCRAFT_TEST_DATA: directory } });
    const page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (!window.isVisible()) throw new Error('The temporary progression test must be visible'); window.setTitle('PolyCraft temporary island — progression and totem test'); });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#new-name').fill('Progression check');
    await page.locator('#new-game button').click({ noWaitAfter: true });
    const ready = () => page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await ready();
    console.log('Island ready');
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateStartScreen');
    await page.waitForTimeout(1500);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    const point = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    const canvas = page.locator('#turbulenz_game_engine_canvas'); const bounds = await canvas.boundingBox();
    await page.evaluate(() => {
      window.__testMouseDowns = 0;
      window.polycraft.controls.app.globals.inputDevice.addEventListener('mousedown', () => { window.__testMouseDowns++; });
    });
    await page.mouse.move(bounds.x + point[0], bounds.y + point[1]);
    await page.waitForTimeout(250);
    await page.mouse.click(bounds.x + point[0], bounds.y + point[1], { delay: 100 });
    assert.equal(await page.evaluate(() => window.__testMouseDowns), 1, 'The canvas click must reach the original input exactly once');
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    console.log('Original Play entered');
    await page.locator('#turbulenz_game_engine_canvas').focus();
    await page.keyboard.type('moreamberplease');
    await page.locator('#cheat-dialog').waitFor({ state: 'visible' });
    await page.locator('#hero-level').fill('10');
    await page.locator('#hero-level').dispatchEvent('input');
    await page.locator('#hero-xp').fill('123');
    await page.locator('#hero-points').fill('50');
    await page.locator('#progression-form button').click();
    console.log('Progression form submitted');
    assert.deepEqual(await page.evaluate(() => window.polycraft.controls.progression()), { level: 10, xp: 123, points: 50, maxLevel: 40 });
    await page.locator('#close-cheats').click();
    await page.waitForTimeout(1000);
    const upgrade = await page.evaluate(() => {
      const c = window.polycraft.controls; const game = c.manager();
      const entity = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECHeroShrine'))[0];
      if (!entity) throw new Error('No totem found in the original island');
      const shrine = entity.getEC('ECHeroShrine');
      shrine.evaluateupgradeTypesValidity();
      if (!shrine.canLevelUp(game.getHero())) throw new Error('Totem does not accept the points');
      const type = shrine.getupgradeType(0);
      shrine.unlockUpgrade(game.getHero(), 0);
      return { points: c.progression().points, upgraded: game.getPlayerData().getHeroUpgrade(type), type };
    });
    assert.equal(upgrade.points, 49); assert.equal(upgrade.upgraded, 1);
    await canvas.focus();
    // Replay browser focus notifications, then verify real keyboard input still moves the hero.
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await page.evaluate(() => window.polycraft.controls.app.globals.inputDevice.isWindowFocused), false);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await page.evaluate(() => window.polycraft.controls.app.globals.inputDevice.isWindowFocused), true);
    }
    const before = await page.evaluate(() => Array.from(window.polycraft.controls.manager().getHero().getv3Location()));
    await canvas.focus();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.keyboard.down('w'); await page.waitForTimeout(800);
    await page.keyboard.up('w');
    const after = await page.evaluate(() => Array.from(window.polycraft.controls.manager().getHero().getv3Location()));
    assert.ok(Math.hypot(...after.map((v, i) => v - before[i])) > 0.1, 'W must move the actual hero');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.polycraft.controls.manager().gameController.desktopKeyboardMoving), false);
    await page.locator('#turbulenz_game_engine_canvas').focus();
    await page.keyboard.type('moreamberplease');
    await page.locator('#cheat-dialog').waitFor({ state: 'visible' });
    await page.locator('#totem-cheats summary').click();
    const totems = await page.evaluate(() => window.polycraft.controls.totemUpgrades());
    assert.equal(totems.length, 8);
    for (const value of [5, 0, 5]) {
      for (const upgrade of totems) await page.locator('#totem-' + upgrade.type).fill(String(value));
      await page.locator('#totem-form button').click();
      await page.waitForFunction(value => {
        const saved = JSON.parse(window.polycraft.slot().state.userData.heroUpgrades);
        return saved.total === value * 8 && window.polycraft.controls.totemUpgrades().every(upgrade => upgrade.level === value);
      }, value);
      assert.equal(await page.evaluate(() => window.polycraft.controls.progression().points), 49);
      assert.equal(await page.evaluate(() => {
        const health = window.polycraft.controls.manager().getHero().getEC('ECHealth');
        return health.getMaxHealth() / health.getBaseMaxHealth();
      }), value === 5 ? 1.2 : 1);
    }
    await page.locator('#close-cheats').click();
    for (const online of [false, true]) {
      const result = await page.evaluate(async online => {
        const controls = window.polycraft.controls, game = controls.manager();
        game.runScripts = false; game.setScriptLocked(false);
        let world;
        if (online) {
          const session = new window.PolycraftMultiplayer.HostSession();
          world = await window.PolycraftOnlineWorld.startHostingWorld(controls, session);
          await world.enablePlayers(window.polycraft.bridge);
        }
        try {
          controls.setTotemUpgrades(Object.fromEntries(controls.totemUpgrades().map(item => [item.type, item.type === 'movementSpeed' ? 1 : 0])));
          controls.setProgression(1, 0, 0);
          game.getHero().getEC('ECPlayerData').adjustSoftCurrency(150 - game.getHero().getEC('ECPlayerData').getSoftCurrency());
          const purchase = () => {
            const shrine = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECHeroShrine')).find(entity => entity.getEC('ECHeroShrine').getupgradeType(0) === 'movementSpeed').getEC('ECHeroShrine');
            shrine.evaluateupgradeTypesValidity();
            const old = game.getHero();
            shrine.doRadialMenuButton({ doButtonFromGuiArchetype: style => { if (style !== 'heroUpgradeUsingAmber') throw new Error('Expected the original paid-boost button'); return true; } }, old, [300, 300], 0);
            const hero = game.getHero(), upgrades = hero.getEC('ECHeroUpgrades');
            return { replaced: hero !== old, level: hero.getEC('ECPlayerData').getLevel(), points: hero.getEC('ECPlayerData').getUpgradePoints(), tier: upgrades.getHeroUpgrade('movementSpeed'), factor: hero.getEC('ECLocomotion').fastSpeedFactor, expectedFactor: upgrades.archetype.movementSpeedFactors[2], amber: hero.getEC('ECPlayerData').getSoftCurrency() };
          };
          const result = world ? await world.atBoundary(purchase) : purchase();
          await window.polycraft.checkpoint();
          return result;
        } finally { if (world) await world.close(); }
      }, online);
      assert.equal(result.replaced, true); assert.equal(result.level, 2); assert.equal(result.points, 0);
      assert.equal(result.tier, 2); assert.equal(result.factor, result.expectedFactor); assert.equal(result.amber, 75);
      console.log('Original paid-totem flow upgrades the live replacement hero:', online ? 'co-op host' : 'solo', result);
    }
    await page.evaluate(async () => {
      const controls = window.polycraft.controls;
      controls.setTotemUpgrades(Object.fromEntries(controls.totemUpgrades().map(item => [item.type, 5])));
      controls.setProgression(10, 123, 49);
      await window.polycraft.checkpoint();
    });
    await page.evaluate(() => window.polycraft.checkpoint());
    await page.evaluate(() => sessionStorage.setItem('polycraft-slot', window.polycraft.slot().id));
    await page.reload(); await ready();
    assert.deepEqual(await page.evaluate(() => window.polycraft.controls.progression()), { level: 10, xp: 123, points: 49, maxLevel: 40 });
    assert.equal(await page.evaluate(type => window.polycraft.controls.manager().getPlayerData().getHeroUpgrade(type), upgrade.type), 5);
    assert.equal(await page.evaluate(() => window.polycraft.controls.totemUpgrades().every(upgrade => upgrade.level === 5)), true);
    await page.evaluate(() => window.desktop.reportError('diagnostic self-check', 'test stack'));
    assert.ok(fs.readFileSync(path.join(directory, 'logs/game.log'), 'utf8').includes('diagnostic self-check'));
    assert.deepEqual(errors, []);
    console.log('PASS: progression UI, real totem purchase, focus-event recovery, actual W movement, direct totem stats/max/reset, saved reload and persistent diagnostics');
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit());
    console.log('Temporary test saves:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
