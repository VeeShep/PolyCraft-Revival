'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalWeapon({ host, guest, focus, button, hero, hostFile }) {
  await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'wakeUp');
  await button('guest-idAcceptTaskRewardButtontaskIdcrit_0');
  await guest.waitForFunction(() => window.guestWorld.lastTargetResult?.type === 'questReward');
  assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Quest reward dropped and saved.');
  await host.waitForFunction(() => window.hostWorld.game.getGameSpaceList().some(space => space.getEntitiesWithEC('ECPickup').some(entity => entity.getFamilyName() === 'tutorialgun')));
  const target = await host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
    const world = window.hostWorld, gun = world.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).find(entity => entity.getFamilyName() === 'tutorialgun');
    return { name: gun.getName(), location: Array.from(gun.getv3Location()), radius: gun.getEC('ECPickup').archetype.attractRadius, weapon: gun.getEC('ECPickup').item,
      before: world.players.captureHero(world.players.active.get(hero).hero).inventory };
  }), hero);
  console.log('Natural tutorial weapon before approach:', target);
  assert.equal(target.before.weapon, null, 'The new tutorial hero must not already hold the pickup weapon.');
  await focus();
  let steps = 0;
  for (; steps < 100; steps++) {
    const next = await guest.evaluate(location => {
      const world = window.guestWorld, p = world.scene.entities.get(world.identity.entity).record.location;
      const dx = location[0] - p[0], dz = location[2] - p[2], m = world.controls.app.globals.camera.matrix;
      const right = (dx * m[0] + dz * m[2]) / Math.hypot(m[0], m[2]);
      const forward = (-dx * m[6] - dz * m[8]) / Math.hypot(m[6], m[8]);
      return { distance: Math.hypot(dx, dz), key: Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's' };
    }, target.location);
    if (next.distance < target.radius * 0.85) break;
    await guest.keyboard.down(next.key);
    try { await guest.waitForTimeout(200); } finally { await guest.keyboard.up(next.key); }
    await guest.waitForTimeout(100);
  }
  assert.ok(steps < 100, 'Guest must reach the original tutorial gun through keyboard movement without teleporting.');
  console.log('Natural weapon within native collection radius:', await host.evaluate(({ hero, name }) => {
    const world = window.hostWorld, actor = world.players.active.get(hero).hero, gun = world.game.getGameEntityByName(name);
    return { location: Array.from(actor.getv3Location()), gun: gun && Array.from(gun.getv3Location()),
      canEquip: gun && actor.getEC('ECInventory').canEquipItem(gun.getEC('ECPickup').item),
      tasks: world.game.getTaskManager().criticalRenderInfoList.map(row => row.taskArchetypeName) };
  }, { hero, name: target.name }));
  await host.waitForFunction(() => window.hostWorld.game.getPlayerData().getTaskFlags().pickupWeapon === true, null, { timeout: 10000 });
  const after = await host.evaluate(async ({ hero, target }) => {
    await window.polycraft.checkpoint(true);
    return window.hostWorld.atRewardBoundary(() => {
      const world = window.hostWorld, entity = world.players.active.get(hero).hero;
      const inventory = world.players.captureHero(entity).inventory, data = JSON.parse(window.polycraft.bridge.state.userData.desktopCoop);
      return { inventory, saved: data.players.find(player => player.id === hero).inventory,
        scripts: world.game.runScripts, removed: !world.game.getGameEntityByName(target), flags: world.game.getPlayerData().getTaskFlags() };
    });
  }, { hero, target: target.name });
  assert.equal(after.inventory.weapon, target.weapon); assert.equal(after.inventory.mainWeapon, target.weapon);
  assert.deepEqual(after.saved, after.inventory); assert.equal(after.scripts, true); assert.equal(after.removed, true);
  const disk = JSON.parse(JSON.parse(fs.readFileSync(hostFile, 'utf8')).state.userData.desktopCoop);
  assert.deepEqual(disk.players.find(player => player.id === hero).inventory, after.inventory);
  await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'pickupWeapon');
  console.log('Natural tutorial weapon acquired, shared quest completed and native inventory checkpointed:', { steps, before: target.before, after });
};
