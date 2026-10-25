'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-coop-heroes-'));
  let application;
  const errors = [];
  try {
    application = await electron.launch({ args: ['.'], env: { ...process.env, POLYCRAFT_TEST_DATA: directory }, timeout: 90000 });
    const page = await application.firstWindow();
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setTitle('PolyCraft temporary island — four co-op heroes test'));
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#new-name').fill('Temporary four hero test');
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestateStartScreen');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
    const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await canvas.focus(); await page.mouse.move(10, 10);
    await page.mouse.move(bounds.x + play[0], bounds.y + play[1], { steps: 5 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay, null, { timeout: 5000 });
    await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying', null, { timeout: 10000 });
    await page.evaluate(async () => {
      const { controls, bridge } = window.polycraft, game = controls.manager();
      game.runScripts = false; game.setScriptLocked(false); game.activeGameState.setPlayState('PlayStateNormal');
      controls.setProgression(10, 0, 10);
      window.soloModel = game.playerData;
      const hero = game.getHero(), soloAmmo = Math.max(0, hero.getEC('ECFirearm').getClipSize() - 1);
      hero.getEC('ECFirearm').ammo = soloAmmo;
      hero.getEC('ECResourceCarrier').adjustResource(0, 4);
      hero.getEC('ECHealth').health = hero.getEC('ECHealth').getMaxHealth() / 2;
      bridge.state.userItems['amber-crown'] = { amount: 1 };
      await window.polycraft.checkpoint();
      window.soloBefore = { progress: JSON.stringify(bridge.state.userData.progress), items: JSON.stringify(bridge.state.userItems), xp: game.playerData.getXP(), ammo: soloAmmo };
      window.coopTransport = new window.PolycraftMultiplayer.HostSession();
      window.coopWorld = await window.PolycraftOnlineWorld.startHostingWorld(controls, window.coopTransport);
      await window.coopWorld.enablePlayers(bridge);
      await window.coopWorld.atBoundary(() => {
        const players = window.coopWorld.players;
        for (const name of ['One', 'Two', 'Three']) {
          const record = players.registry.addPlayer(name); players.add(record.id);
        }
      });
    });
    const result = await page.evaluate(async () => window.coopWorld.atBoundary(() => {
      const { players } = window.coopWorld, game = players.game;
      const ids = [...players.active.keys()], host = game.getHero();
      let guestEntry = players.active.get(ids[1]);
      const oldGuest = guestEntry.hero, oldLevel = oldGuest.getEC('ECPlayerData').getLevel();
      const builder = oldGuest.getEC('ECPlayerBuilder');
      builder.placeInHand('a_b_amberwell', 1, false, false);
      oldGuest.getEC('ECPlayerData').levelUp();
      const deferred = guestEntry.hero === oldGuest && players.pendingRefresh.has(ids[1]);
      const heldBefore = players.captureConstruction(oldGuest);
      players.remove(ids[1]); players.add(ids[1]);
      guestEntry = players.active.get(ids[1]);
      const heldAfter = players.captureConstruction(guestEntry.hero);
      guestEntry.hero.getEC('ECPlayerBuilder').clearInHand(); players.flushRefreshes();
      const guest = guestEntry.hero, health = guest.getEC('ECHealth');
      guest.getEC('ECFirearm').setWeapon('wp_h_bombs', 13);
      guest.getEC('ECInventory').setHeldWeapon('wp_h_bombs'); guest.getEC('ECFirearm').ammo = 2;
      guest.getEC('ECResourceCarrier').adjustResource(0, 7);
      health.health = health.getMaxHealth() / 2;
      guest.setRotationY(0.6);
      const data = guest.getEC('ECPlayerData');
      const kill = { aggressor: guest, victim: { getEC: () => true } };
      for (const { hero } of players.active.values()) hero.getEC('ECPlayerData').addKill(kill);
      const pickup = game.getEntityFactory().createActiveEntityInstance('Temporary amber', 'a_r_amber', guest.getv3Location());
      const currency = pickup.getEC('ECPickup').archetype.softCurrency;
      pickup.getEC('ECPickup').onPickupSoftCurrency(guest); pickup.setToBeDestroyed();
      players.capture();
      const before = structuredClone(players.registry.player(ids[1]));
      players.remove(ids[1]); const reconnected = players.add(ids[1]); players.capture();
      const after = structuredClone(players.registry.player(ids[1]));
      return { count: players.active.size, selectedHost: game.getHero() === host, replacedGuest: guest !== oldGuest,
        deferred, heldBefore, heldAfter,
        levelUp: guestEntry.model.getXP() > 0 && data.getLevel() === oldLevel + 1,
        bindings: [...players.active.values()].map(entry => entry.hero.getEC('ECPlayerData').playerData === entry.model && entry.hero.getEC('ECHeroUpgrades').playerData === entry.model),
        soloUntouched: players.solo.model === window.soloModel && window.soloModel.getXP() === window.soloBefore.xp,
        before, after, currency, restoredHero: reconnected.getName(),
        kills: [...players.active.values()].map(entry => entry.model.getTotalEnemiesKilled()),
        found: [...players.active.values()].map(entry => entry.model.getSoftCurrencyFound()),
        soloItems: JSON.stringify(window.polycraft.bridge.state.userItems), originalItems: window.soloBefore.items };
    }));
    assert.equal(result.count, 4); assert.equal(result.selectedHost, true); assert.equal(result.replacedGuest, true); assert.equal(result.levelUp, true);
    assert.equal(result.deferred, true); assert.deepEqual(result.heldAfter, result.heldBefore);
    assert.deepEqual(result.bindings, [true, true, true, true]); assert.equal(result.soloUntouched, true);
    assert.deepEqual(result.after, result.before); assert.equal(result.soloItems, result.originalItems);
    assert.equal(result.kills.reduce((a, b) => a + b, 0), 1);
    assert.equal(result.found.reduce((a, b) => a + b, 0), result.currency);
    await page.evaluate(() => window.polycraft.checkpoint());
    const savesDirectory = path.join(directory, 'saves');
    const file = path.join(savesDirectory, fs.readdirSync(savesDirectory).find(name => name.endsWith('.json')));
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved.version, 6); assert.equal(JSON.parse(saved.state.userData.desktopCoop).players.length, 4);
    const restored = await page.evaluate(async () => {
      await window.coopWorld.close();
      const { controls, bridge } = window.polycraft, game = controls.manager(), hero = game.getHero();
      return { originalModel: game.playerData === window.soloModel, xp: game.playerData.getXP(), expectedXP: window.soloBefore.xp,
        ammo: hero.getEC('ECFirearm').ammo, expectedAmmo: window.soloBefore.ammo, carried: hero.getEC('ECResourceCarrier').getResource(0),
        healthFraction: hero.getEC('ECHealth').getHealth() / hero.getEC('ECHealth').getMaxHealth(),
        items: JSON.stringify(bridge.state.userItems), expectedItems: window.soloBefore.items,
        progress: JSON.stringify(bridge.state.userData.progress), expectedProgress: window.soloBefore.progress,
        scoped: Boolean(bridge.coopEconomy || game.desktopPlayers), closed: window.coopTransport.closed };
    });
    assert.equal(restored.originalModel, true); assert.equal(restored.xp, restored.expectedXP);
    assert.equal(restored.ammo, restored.expectedAmmo); assert.equal(restored.carried, 4); assert.equal(restored.healthFraction, 0.5);
    assert.equal(restored.items, restored.expectedItems); assert.equal(restored.progress, restored.expectedProgress);
    assert.equal(restored.scoped, false); assert.equal(restored.closed, true); assert.deepEqual(errors, []);
    console.log('PASS: four real bound heroes; guest-only level-up refresh; attributed kills/currency; exact ammo, carried resources and health on reconnect; format-4 checkpoint; solo model/inventory restored on host exit.');
    console.log('Development API test only: no guest input, invitation identity mapping or cross-platform gameplay acceptance.');
  } catch (error) {
    if (application) try { const page = await application.firstWindow(); fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/coop-heroes-failure.png' }); } catch {}
    console.log('Renderer errors:', errors); throw error;
  } finally {
    if (application) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profile:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
