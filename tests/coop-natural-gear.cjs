'use strict';
const assert = require('node:assert/strict');

module.exports = function naturalGear({ host, focus }) {
  const solo = () => host.evaluate(() => {
    const game = window.polycraft.controls.manager(), hero = game.getHero();
    return { held: hero.getEC('ECInventory').getHeldWeapon(), armed: hero.getEC('ECFirearm').hasWeapon(),
      primary: hero.getEC('ECFirearm').mainWeaponName, pickupComplete: game.getPlayerData().getTaskFlags().pickupWeapon, scripts: game.runScripts };
  });
  return {
    async before() {
      const party = await host.evaluate(() => {
        const world = window.hostWorld;
        return [...world.players.active].map(([id, entry]) => ({ id, name: world.players.registry.player(id).name,
          inventory: world.players.captureHero(entry.hero).inventory, armed: entry.hero.getEC('ECFirearm').hasWeapon() }));
      });
      console.log('Party gear after natural pickup:', JSON.stringify(party));
      assert.equal(party.length, 4);
      assert.ok(party.every(player => player.armed && player.inventory.weapon === player.inventory.mainWeapon), 'All four heroes regain their own unlocked starter firearm.');
    },
    async after() {
      const returned = await solo();
      console.log('Original solo hero immediately after co-op:', returned);
      await host.evaluate(() => window.polycraft.checkpoint());
      await host.reload(); await focus();
      await Promise.all([host.waitForEvent('domcontentloaded'), host.locator('#save-list article').first().getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
      await host.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
      await focus(); const canvas = host.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
      const point = await host.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
      await canvas.focus(); await host.mouse.move(bounds.x + point[0], bounds.y + point[1]);
      await host.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
      await host.mouse.click(bounds.x + point[0], bounds.y + point[1], { delay: 100 });
      await host.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
      const reloaded = await solo();
      console.log('Original solo hero after native save/reload:', reloaded);
      assert.equal(returned.pickupComplete, true); assert.equal(reloaded.pickupComplete, true);
      assert.equal(returned.scripts, true); assert.equal(reloaded.scripts, true);
      assert.equal(returned.held, reloaded.held, 'Ending co-op should restore the same native starter-weapon availability as normal solo reload.');
      assert.equal(returned.armed, reloaded.armed);
      assert.equal(returned.held, returned.primary);
    }
  };
};
