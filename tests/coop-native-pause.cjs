'use strict';
const assert = require('node:assert/strict'), path = require('node:path');

module.exports = async function nativePause({ host, guest, focus, focusHost, hostFile }) {
  const workers = await host.evaluate(() => {
    const game = window.hostWorld.game;
    return ['Lumberling Hut', 'Stoneling Hut'].map(type => {
      const house = game.getBuildingManager().getBuildingsAtMinLevel(type, 1, false).find(entity => !entity.getEC('ECScaffold'));
      const worker = house?.getEC('ECWildlingHouse')?.getWildling();
      if (!worker?.getEC('ECWildlingAgent') || worker.shouldBeDestroyed()) throw new Error('A living native worker is required for pause acceptance.');
      return worker.getName();
    });
  });
  const sample = () => host.evaluate(ids => {
    const game = window.hostWorld.game;
    return { tick: game.gameClock.getFrameIndex(), workers: ids.map(id => ({ id, updatedAt: game.getGameEntityByName(id).getEC('ECWildlingAgent').lastUpdateTime })) };
  }, workers);
  for (const role of ['guest', 'host']) {
    const page = role === 'guest' ? guest : host;
    await (role === 'guest' ? focus() : focusHost());
    try {
      await page.keyboard.press('p');
      await page.waitForFunction(role => {
        const controls = window.polycraft.controls, game = controls.manager(), id = role === 'guest' ? 'guest-resume' : 'Paused Resume';
        const open = role === 'guest' ? window.guestWorld.pauseMenu && !window.guestWorld.movement.available() : game.activeGameState.name === 'GamestatePaused';
        return open && game.getGuiManager().prevDrawGuiMap[id]?.scale > .95;
      }, role, { timeout: 5000 });
      const before = await sample();
      await page.waitForTimeout(1500);
      const after = await sample();
      assert.ok(after.tick > before.tick, role + ' pause menu must leave the host simulation clock running.');
      for (let index = 0; index < before.workers.length; index++) {
        assert.equal(after.workers[index].id, before.workers[index].id);
        assert.ok(after.workers[index].updatedAt > before.workers[index].updatedAt, role + ' pause menu must leave each original worker AI updating.');
      }
      assert.equal(await page.evaluate(role => role === 'guest' ? window.guestWorld.pauseMenu : window.polycraft.controls.manager().activeGameState.name === 'GamestatePaused', role), true);
      await page.screenshot({ path: path.join(path.dirname(hostFile), '..', 'native-' + role + '-pause.png'), timeout: 5000 });
      console.log('Native visible pause leaves simulation and worker AI running:', JSON.stringify({ role, before, after }));
    } finally {
      const open = await page.evaluate(role => role === 'guest' ? window.guestWorld?.pauseMenu : window.polycraft.controls.manager().activeGameState.name === 'GamestatePaused', role).catch(() => false);
      if (open) await page.keyboard.press('p').catch(error => console.log('Native pause cleanup failed:', error.message));
    }
    await page.waitForFunction(role => role === 'guest' ? !window.guestWorld.pauseMenu : window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying', role, { timeout: 5000 });
  }
  await focus();
  console.log('PASS: actual guest and host pause menus stay visible while native simulation and both worker AIs continue.');
};
