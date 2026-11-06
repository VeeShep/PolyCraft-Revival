'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalVillage({ host, guest, focus, button, hero, hostFile }) {
  await button('guest-idAcceptTaskRewardButtontaskIdcrit_3');
  await guest.waitForFunction(() => window.guestWorld.quests.state?.tasks.some(task => task.task === 'goToVillage'));
  const destination = await host.evaluate(hero => {
    const game = window.hostWorld.game, entities = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName('workshop'));
    if (!entities.length) throw new Error('The original village workshop is missing.');
    const actor = window.hostWorld.players.active.get(hero).hero;
    const path = game.getNavManager().getEntityToEntityPath(actor, entities[0], actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
    if (!path) throw new Error('The original navigation grid has no route to the village.');
    return { name: entities[0].getName(), location: Array.from(entities[0].getv3Location()), host: Array.from(game.getHero().getv3Location()), route: path.getWaypointList().map(point => Array.from(point)) };
  }, hero);
  assert.ok(Math.hypot(...destination.host.map((n, i) => n - destination.location[i])) > 12, 'The host must remain outside the original village radius.');
  console.log('Natural guest village destination:', destination);
  await focus();
  let steps = 0, waypoint = 1;
  for (; steps < 500; steps++) {
    if (await host.evaluate(() => window.hostWorld.game.getPlayerData().getTaskFlags().goToVillage === true)) break;
    const next = await guest.evaluate(location => {
      const world = window.guestWorld, p = world.scene.entities.get(world.identity.entity).record.location, m = world.controls.app.globals.camera.matrix;
      const dx = location[0] - p[0], dz = location[2] - p[2];
      const right = (dx * m[0] + dz * m[2]) / Math.hypot(m[0], m[2]), forward = (-dx * m[6] - dz * m[8]) / Math.hypot(m[6], m[8]);
      const largest = Math.max(Math.abs(right), Math.abs(forward));
      return { distance: Math.hypot(dx, dz), keys: [...(Math.abs(right) > largest * 0.4 ? [right > 0 ? 'd' : 'a'] : []), ...(Math.abs(forward) > largest * 0.4 ? [forward > 0 ? 'w' : 's'] : [])] };
    }, destination.route[waypoint]);
    if (next.distance < 0.65 && waypoint < destination.route.length - 1) { waypoint++; continue; }
    for (const key of next.keys) await guest.keyboard.down(key);
    try { await guest.waitForTimeout(100); } finally { for (const key of next.keys) await guest.keyboard.up(key); }
    await guest.waitForTimeout(100);
  }
  const result = await host.evaluate(async ({ hero, destination }) => {
    const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero;
    const distance = entity => Math.hypot(...Array.from(entity.getv3Location()).map((n, i) => n - destination.location[i]));
    await window.polycraft.checkpoint(true);
    return { complete: game.getPlayerData().getTaskFlags().goToVillage, scripts: game.runScripts,
      host: Array.from(game.getHero().getv3Location()), hostDistance: distance(game.getHero()), guestDistance: distance(actor),
      defenses: ['barricade_tutorial', 'barricadegate_tutorial', 'turret_tutorial'].flatMap(family => game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName(family))).filter(entity => !entity.shouldBeDestroyed()).map(entity => entity.getName()) };
  }, { hero, destination });
  console.log('Original village arrival:', JSON.stringify({ steps, result }));
  assert.equal(result.complete, true); assert.equal(result.scripts, true); assert.ok(result.guestDistance < 12); assert.ok(result.hostDistance > 12);
  assert.ok(Math.hypot(...result.host.map((n, i) => n - destination.host[i])) < 0.1); assert.deepEqual(result.defenses, []);
  await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'goToVillage');
  await button('guest-idAcceptTaskRewardButtontaskIdcrit_4');
  await guest.waitForFunction(() => window.guestWorld.quests.state?.tasks.some(task => task.task === 'buildHq'));
  await host.evaluate(() => window.polycraft.checkpoint(true));
  const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state;
  assert.equal(state.cheats.everEnabled, false);
  assert.equal(JSON.parse(state.userData.taskFlags).goToVillage, true);
  assert.ok(!JSON.parse(state.userData.desktopQuests).pending.some(task => task.task === 'goToVillage'));
  console.log('Guest native village arrival removes tutorial defenses and unlocks the original HQ quest; clean checkpoint saved.');
};
