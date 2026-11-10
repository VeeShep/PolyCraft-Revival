'use strict';
const assert = require('node:assert/strict');

module.exports = async function collectSoloQuestReward({ page, focus }) {
  await focus();
  const bounds = await page.locator('#turbulenz_game_engine_canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .35);
  for (let step = 0; step < 60; step++) {
    const state = await page.evaluate(() => {
      const game = window.polycraft.controls.manager(), hero = game.getHero(), xp = game.getPlayerData().getXP();
      const required = game.getTaskManager().taskArchetypes.buildStonelingHut.xpReward;
      const pending = window.PolycraftCoopPlayers.CoopPlayers.hasPendingRewards(game, hero);
      if (xp >= required || pending) return { done: true, xp, pending };
      const position = hero.getv3Location();
      const pickups = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup'))
        .filter(entity => !entity.shouldBeDestroyed() && entity.getEC('ECPickup').xp > 0 && !entity.getEC('ECPickup').getCollectorName())
        .sort((a, b) => Math.hypot(a.getv3Location()[0] - position[0], a.getv3Location()[2] - position[2]) - Math.hypot(b.getv3Location()[0] - position[0], b.getv3Location()[2] - position[2]));
      const pickup = pickups[0];
      if (!pickup) return { waiting: true, xp };
      const target = pickup.getv3Location(), dx = target[0] - position[0], dz = target[2] - position[2], m = window.polycraft.controls.app.globals.camera.matrix;
      const right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8], largest = Math.max(Math.abs(right), Math.abs(forward));
      return { xp, pickup: pickup.getName(), distance: Math.hypot(dx, dz), hero: Array.from(position), location: Array.from(target),
        keys: [...(Math.abs(right) > largest * .4 ? [right > 0 ? 'd' : 'a'] : []), ...(Math.abs(forward) > largest * .4 ? [forward > 0 ? 'w' : 's'] : [])] };
    });
    if (state.done) { console.log('Original solo quest reward collected or incoming before hosting:', JSON.stringify(state)); return; }
    if (state.waiting) { await page.waitForTimeout(100); continue; }
    assert.ok(state.distance <= 10, 'The retained solo reward must be nearby before this bounded approach: ' + JSON.stringify(state));
    if (step % 10 === 0) console.log('Ordinary solo quest reward approach:', JSON.stringify({ step, ...state }));
    await page.waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && window.polycraft.controls.manager().getGameController().isActive() && !window.polycraft.controls.manager().getIMGui().hasCapturedInput(), null, { timeout: 5000 });
    const held = [];
    try { for (const key of state.keys) { await page.keyboard.down(key); held.push(key); } await page.waitForTimeout(100); }
    finally { for (const key of held) await page.keyboard.up(key); }
    await page.waitForTimeout(100);
  }
  assert.fail('Normal solo input did not collect the original quest XP within the bounded approach.');
};
