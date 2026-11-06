'use strict';
const assert = require('node:assert/strict');

module.exports = async function naturalBridge({ host, guest, focus, button, hero }) {
  await button('guest-idAcceptTaskRewardButtontaskIdcrit_2');
  await guest.waitForFunction(() => window.guestWorld.quests.state?.tasks.some(task => task.task === 'defeatWildlings'));
  const bridge = await host.evaluate(() => {
    const game = window.hostWorld.game, marker = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName('triggerBridge'))[0];
    if (!marker) throw new Error('The original bridge trigger is missing.');
    return { name: marker.getName(), location: Array.from(marker.getv3Location()), host: Array.from(game.getHero().getv3Location()) };
  });
  assert.ok(Math.hypot(...bridge.host.map((n, i) => n - bridge.location[i])) > 5, 'The host must stay outside the bridge trigger.');
  console.log('Natural guest bridge destination:', bridge);
  await focus();
  let steps = 0;
  for (; steps < 120; steps++) {
    const next = await guest.evaluate(location => {
      const world = window.guestWorld, p = world.scene.entities.get(world.identity.entity).record.location, m = world.controls.app.globals.camera.matrix;
      const dx = location[0] - p[0], dz = location[2] - p[2];
      const right = (dx * m[0] + dz * m[2]) / Math.hypot(m[0], m[2]), forward = (-dx * m[6] - dz * m[8]) / Math.hypot(m[6], m[8]);
      return { distance: Math.hypot(dx, location[1] - p[1], dz), key: Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's' };
    }, bridge.location);
    if (next.distance < 1.8) break;
    await guest.keyboard.down(next.key);
    try { await guest.waitForTimeout(200); } finally { await guest.keyboard.up(next.key); }
    await guest.waitForTimeout(100);
  }
  assert.ok(steps < 120, 'The guest must approach the native bridge trigger through ordinary keyboard movement.');
  const proximity = await host.evaluate(({ hero, location }) => {
    const world = window.hostWorld, actor = world.players.active.get(hero).hero;
    const distance = entity => Math.hypot(...Array.from(entity.getv3Location()).map((n, i) => n - location[i]));
    return { host: Array.from(world.game.getHero().getv3Location()), hostDistance: distance(world.game.getHero()), guestDistance: distance(actor),
      health: actor.getEC('ECHealth').getHealth(), scripts: world.game.runScripts, tasks: world.game.getTaskManager().criticalRenderInfoList.map(task => task.taskArchetypeName) };
  }, { hero, location: bridge.location });
  console.log('Natural bridge proximity with host left behind:', proximity);
  assert.ok(proximity.guestDistance < 2); assert.ok(proximity.hostDistance > 5); assert.ok(proximity.health > 0); assert.equal(proximity.scripts, true);
  assert.ok(Math.hypot(...proximity.host.map((n, i) => n - bridge.host[i])) < 0.1);
  await host.waitForFunction(() => window.hostWorld.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECAgent')).filter(entity => entity.getName().startsWith('TutorialBandit') && !entity.shouldBeDestroyed()).length >= 5, null, { timeout: 10000 });
  console.log('The original bridge script starts all five authored tutorial bandits from guest proximity:', { steps, proximity });
};
