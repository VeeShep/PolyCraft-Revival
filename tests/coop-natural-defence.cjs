'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

module.exports = async function naturalDefence(context) {
  const { host, guest, hero, focus, hostFile, directory } = context;
  await focus();
  await guest.waitForFunction(() => window.guestWorld.quests.state?.tasks.some(task => task.task === 'buildDefenceFactory'));
  const button = async id => {
    await focus();
    await guest.waitForFunction(id => window.guestWorld.game.getGuiManager().prevDrawGuiMap[id]?.scale > .95, id);
    const point = await guest.evaluate(id => {
      const w = window.guestWorld, a = w.game.getGuiManager().prevDrawGuiMap[id].argumentObject, p = a.v2ScreenLocation || [a.x, a.y], b = w.movement.canvas.getBoundingClientRect(), d = w.controls.app.globals.graphicsDevice;
      return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
    }, id);
    await guest.mouse.move(point.x, point.y); await guest.waitForFunction(id => window.guestWorld.game.getIMGui().isHot(id), id);
    await guest.mouse.click(point.x, point.y, { delay: 100 });
  };
  const sample = () => host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, data = w.players.active.get(hero).hero.getEC('ECPlayerData');
    return { xp: data.getXP(), level: data.getLevel(), points: data.getUpgradePoints(), hostXP: w.game.getPlayerData().getXP(), amber: data.getSoftCurrency(), tick: w.game.gameClock.getFrameIndex(),
      pickups: w.game.getGameSpaceList().flatMap(s => s.getEntitiesWithEC('ECPickup')).map(e => e.getName()) };
  }), hero);
  const initial = await sample();
  await require('./coop-natural-building.cjs')({ ...context, button, defenceFactory: true });
  const before = await sample();
  assert.equal(before.xp, initial.xp); assert.equal(before.hostXP, initial.hostXP);
  const reward = await guest.evaluate(() => window.guestWorld.quests.state.completed);
  assert.equal(reward.task, 'buildDefenceFactory');
  const expected = await host.evaluate(() => window.hostWorld.game.getTaskManager().taskArchetypes.buildDefenceFactory);
  assert.equal(expected.xpReward, 20); assert.equal(expected.amberReward, 1);
  await button('guest-idAcceptTaskRewardButton' + reward.id);
  await guest.waitForFunction(id => window.guestWorld.quests.state?.completed?.id !== id, reward.id);
  const drops = await host.evaluate(old => window.hostWorld.game.getGameSpaceList().flatMap(s => s.getEntitiesWithEC('ECPickup')).filter(e => {
    const p = e.getEC('ECPickup');
    return !old.includes(e.getName()) && !e.shouldBeDestroyed() && (p.xp > 0 || p.archetype.softCurrency > 0);
  }).map(e => e.getName()), before.pickups);
  const bounds = await guest.locator('#turbulenz_game_engine_canvas').boundingBox();
  await guest.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .35);
  for (let step = 0; step < 80; step++) {
    const state = await host.evaluate(({ hero, drops, xp, amber }) => {
      const w = window.hostWorld, actor = w.players.active.get(hero).hero, data = actor.getEC('ECPlayerData'), position = actor.getv3Location();
      const pending = window.PolycraftCoopPlayers.CoopPlayers.hasPendingRewards(w.game, actor);
      if (data.getXP() === xp && data.getSoftCurrency() === amber && !pending) return { done: true };
      const pickup = drops.map(id => w.game.getGameEntityByName(id)).find(e => e && !e.shouldBeDestroyed() && !e.getEC('ECPickup').getCollectorName());
      return pickup ? { location: Array.from(pickup.getv3Location()), distance: Math.hypot(position[0] - pickup.getv3Location()[0], position[2] - pickup.getv3Location()[2]) } : { waiting: true };
    }, { hero, drops, xp: before.xp + expected.xpReward, amber: before.amber + expected.amberReward });
    if (state.done) break;
    if (state.waiting) { await guest.waitForTimeout(100); continue; }
    assert.ok(state.distance < 10, 'The original scattered quest reward must be nearby.');
    const keys = await guest.evaluate(location => {
      const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix, dx = location[0] - p[0], dz = location[2] - p[2];
      const right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8], size = Math.max(Math.abs(right), Math.abs(forward));
      return [...(Math.abs(right) > size * .4 ? [right > 0 ? 'd' : 'a'] : []), ...(Math.abs(forward) > size * .4 ? [forward > 0 ? 'w' : 's'] : [])];
    }, state.location);
    try { await guest.waitForFunction(() => window.guestWorld.movement.available() && !window.guestWorld.game.getIMGui().hasCapturedInput(), null, { timeout: 5000 }); }
    catch (error) {
      console.log('Natural reward input diagnostics:', JSON.stringify(await guest.evaluate(() => {
        const w = window.guestWorld;
        return { focused: document.hasFocus(), active: document.activeElement?.id, nativeFocused: w.movement.nativeFocused, available: !!w.movement.available(), captured: w.game.getIMGui().hasCapturedInput(), localMenu: w.localMenu(), paused: w.controls.paused,
          life: w.lifeState, construction: { menu: w.construction.menu, placement: w.construction.placement }, selected: w.selectedBuilding, quest: w.quests.state, hud: w.hud.state };
      })));
      await guest.screenshot({ path: path.join(directory, 'guest-natural-defence-input-failure.png') }); throw error;
    }
    const held = [];
    try { for (const key of keys) { await guest.keyboard.down(key); held.push(key); } await guest.waitForTimeout(100); }
    finally { for (const key of held) await guest.keyboard.up(key); }
    await guest.waitForTimeout(100);
  }
  const after = await sample();
  assert.equal(after.xp, before.xp + expected.xpReward); assert.equal(after.hostXP, before.hostXP); assert.equal(after.amber, before.amber + expected.amberReward); assert.ok(after.tick > before.tick);
  await guest.waitForFunction(xp => window.guestWorld.hud.state?.xp === xp, after.xp);
  await host.evaluate(() => window.polycraft.checkpoint(true));
  const state = JSON.parse(fs.readFileSync(hostFile)).state, party = JSON.parse(state.userData.desktopCoop);
  assert.equal(party.players.find(p => p.id === hero).progress.xp, after.xp); assert.equal(state.cheats.everEnabled, false);
  assert.ok(!JSON.parse(state.userData.desktopQuests).pending.some(task => task.task === reward.task));
  await guest.screenshot({ path: path.join(directory, 'guest-natural-defence.png') });
  console.log('PASS: original guest Defence Factory construction and native quest reward earn20XP/1Amber without progression assignments:', JSON.stringify({ initial, before, after, reward, drops }));
};
