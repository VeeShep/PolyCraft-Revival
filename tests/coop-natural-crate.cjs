'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalCrate({ host, guest, focus, button, hero, hostFile }) {
  await button('guest-idAcceptTaskRewardButtontaskIdcrit_1');
  await guest.waitForFunction(() => window.guestWorld.quests.state?.tasks.some(task => task.task === 'shootCrate'));
  const target = await host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
    const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero;
    const crate = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECHealth')).find(entity => entity.getFamilyName() === 'tutorialcrate');
    if (!crate) throw new Error('The original tutorial crate is missing.');
    const factory = game.getProjectileFactory(), create = factory.createProjectile;
    const actions = game.actionManager.actionFunctionMap, damage = actions.ApplyDamageToEntity;
    window.naturalCrateTrace = { projectiles: [], damage: [] };
    factory.createProjectile = function (...args) {
      const projectile = create.apply(this, args);
      if (args[0] === actor) window.naturalCrateTrace.projectiles.push({ name: projectile.getName(), archetype: projectile.getArchetypeName() });
      return projectile;
    };
    // The original shotgun applies arc damage, independently of its cosmetic pellet impacts.
    actions.ApplyDamageToEntity = function (args) {
      const row = args.victim === crate && args.aggressor === actor ? { before: crate.getEC('ECHealth').getHealth(), type: args.damageType } : null;
      const result = damage.call(this, args);
      if (row) window.naturalCrateTrace.damage.push({ ...row, after: crate.getEC('ECHealth').getHealth() });
      return result;
    };
    window.restoreNaturalCrateObserver = () => { factory.createProjectile = create; actions.ApplyDamageToEntity = damage; };
    return { id: crate.getName(), location: Array.from(crate.getv3Location()), health: crate.getEC('ECHealth').getHealth(),
      targeted: !!crate.getEC('ECTarget'), canDamage: world.players.canDamage(crate, actor),
      weapon: world.players.captureHero(actor).inventory, distance: crate.getDistanceUsingSize(actor.getv3Location()) };
  }), hero);
  console.log('Natural tutorial shooting target:', target);
  try {
    await focus();
    await guest.waitForFunction(id => {
      const world = window.guestWorld, record = world.scene.entities.get(id);
      if (!record) return false;
      const p = world.controls.app.globals.camera.worldToScreen(record.displayLocation || record.record.location), b = world.movement.canvas.getBoundingClientRect(), d = world.controls.app.globals.graphicsDevice;
      const x = p[0] * b.width / d.width, y = p[1] * b.height / d.height;
      return world.movement.available() && x > 20 && y > 20 && x < b.width - 20 && y < b.height - 20 && window.PolycraftCoopActions.pickTarget(world, { clientX: b.left + x, clientY: b.top + y }) === id;
    }, target.id, { timeout: 10000 });
    const point = await guest.evaluate(id => {
      const world = window.guestWorld, entry = world.scene.entities.get(id), p = world.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location), b = world.movement.canvas.getBoundingClientRect(), d = world.controls.app.globals.graphicsDevice;
      return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
    }, target.id);
    await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150);
    await guest.mouse.click(point.x, point.y, { delay: 100 });
    await host.waitForFunction(() => window.hostWorld.game.getPlayerData().getTaskFlags().shootCrate === true, null, { timeout: 15000 });
    const trace = await host.evaluate(() => window.naturalCrateTrace);
    assert.ok(trace.projectiles.some(projectile => projectile.archetype === 'pj_h_shotgun_blast_cone01'));
    assert.ok(trace.damage.some(damage => damage.before === target.health && damage.after <= 0));
    await guest.waitForFunction(id => !window.guestWorld.scene.entities.has(id) && window.guestWorld.quests.state?.completed?.task === 'shootCrate', target.id);
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state;
    assert.equal(state.cheats.everEnabled, false);
    assert.ok(JSON.parse(state.userData.desktopQuests).pending.some(row => row.task === 'shootCrate'));
    console.log('Natural guest click fires native projectiles, breaks the authored crate and checkpoints the shared task:', { target, trace });
  } finally { await host.evaluate(() => window.restoreNaturalCrateObserver()).catch(() => {}); }
};
