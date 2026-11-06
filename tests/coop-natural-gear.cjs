'use strict';
const assert = require('node:assert/strict');

module.exports = function naturalGear({ host, focus, headquarters = false, pendingTask = 'buildHq' }) {
  const solo = () => host.evaluate(headquarters => {
    const game = window.polycraft.controls.manager(), hero = game.getHero();
    return { held: hero.getEC('ECInventory').getHeldWeapon(), armed: hero.getEC('ECFirearm').hasWeapon(),
      primary: hero.getEC('ECFirearm').mainWeaponName, pickupComplete: game.getPlayerData().getTaskFlags().pickupWeapon, scripts: game.runScripts,
      ...(headquarters ? { world: {
        hq: game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false).filter(entity => !entity.getEC('ECScaffold')).map(entity => ({ name: entity.getName(), archetype: entity.getArchetypeName(), location: Array.from(entity.getv3Location()) })),
        lumbermills: game.getBuildingManager().getBuildingsAtMinLevel('Lumbermill', 1, false).filter(entity => !entity.getEC('ECScaffold')).map(entity => ({ name: entity.getName(), archetype: entity.getArchetypeName(), location: Array.from(entity.getv3Location()) })),
        flags: { goToVillage: game.getPlayerData().getTaskFlags().goToVillage, buildHq: game.getPlayerData().getTaskFlags().buildHq, buildLumbermill: game.getPlayerData().getTaskFlags().buildLumbermill === true },
        pending: JSON.parse(window.polycraft.bridge.state.userData.desktopQuests).pending,
        coop: JSON.parse(window.polycraft.bridge.state.userData.desktopCoop), everEnabled: window.polycraft.bridge.state.cheats.everEnabled
      } } : {}) };
  }, headquarters);
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
      if (headquarters) {
        assert.equal(returned.world.hq.length, 1); assert.equal(returned.world.hq[0].archetype, 'a_b_hq');
        assert.deepEqual(returned.world.flags, { goToVillage: true, buildHq: true, buildLumbermill: pendingTask === 'buildLumbermill' });
        assert.ok(returned.world.pending.some(task => task.task === pendingTask));
        if (pendingTask === 'buildLumbermill') assert.equal(returned.world.lumbermills.length, 1);
        assert.equal(returned.world.coop.players.length, 4); assert.equal(returned.world.everEnabled, false);
        assert.deepEqual(reloaded.world, returned.world, 'The completed HQ, pending reward, shared flags and saved party must survive native solo reload.');
        console.log('Completed HQ, pending shared reward, four saved party records and clean history survive native solo exit/reload.');
      }
    }
  };
};
