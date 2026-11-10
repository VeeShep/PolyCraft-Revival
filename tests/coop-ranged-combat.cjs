'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

module.exports = async function rangedCombat({ host, guest, hero, focus, hostFile, directory }) {
  // Stage only the attacker's pistol and a nearby original enemy; all combat and rewards run normally.
  const setup = await host.evaluate(id => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, game = w.game, actor = w.players.active.get(id).hero, origin = actor.getv3Location();
    if (w.transport.pvp) throw new Error('Enemy combat must run with hero PvP disabled.');
    const health = actor.getEC('ECHealth');
    if (health.getHealth() !== health.getMaxHealth() || health.getInvulnerable()) throw new Error('Use an untouched, vulnerable guest.');
    actor.getEC('ECInventory').equipWeapon('wp_h_pistol');
    const firearm = actor.getEC('ECFirearm'), mesh = actor.getEC('ECMesh'), offset = firearm.archetype.shootOffset;
    const axes = ['getX', 'getY', 'getZ'].map(name => Array.from(mesh[name]()));
    const muzzle = [0, 1, 2].map(i => axes.reduce((sum, axis, j) => sum + axis[i] * offset[j], 0));
    const height = actor.getEC('ECPhysicsSphere').getv3CapsuleTopLocation()[1] + muzzle[1], radius = Math.hypot(muzzle[0], muzzle[2]);
    const location = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([x, z]) => game.placeOnGround([origin[0] + x, origin[1], origin[2] + z], .5))
      .find(point => point && Math.abs(point[1] - origin[1]) < 1 && Math.hypot(point[0] - game.getHero().getv3Location()[0], point[2] - game.getHero().getv3Location()[2]) > 40 &&
        Array.from({ length: 8 }, (_, i) => i * Math.PI / 4).every(angle => !game.getCollisionInfo([origin[0] + Math.cos(angle) * radius, height, origin[2] + Math.sin(angle) * radius], [point[0], point[1] + .4, point[2]], true, actor)));
    if (!location || !firearm.getCanFire() || firearm.getAmmo() <= 0) throw new Error('The fixture needs a clear native firing lane and ready pistol.');
    return { location: Array.from(location), health: health.getHealth(), xp: actor.getEC('ECPlayerData').getXP(), hostXP: game.getHero().getEC('ECPlayerData').getXP(), kills: actor.getEC('ECPlayerData').getTotalEnemiesKilled(), hostKills: game.getHero().getEC('ECPlayerData').getTotalEnemiesKilled(), actor: actor.getName() };
  }), hero);
  await focus();
  await guest.waitForFunction(() => {
    const c = window.guestWorld.viewCamera.camera;
    return ['Position', 'Focus'].every(key => { const a = c['currentV3' + key], b = c['desiredV3' + key]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < .01; });
  }, null, { timeout: 15000 });
  const enemy = await host.evaluate(({ id, location }) => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, game = w.game, actor = w.players.active.get(id).hero;
    const node = game.getEntityFactory().createActiveEntityInstance('Temporary original ranged combat', 'a_e_ranged_level_1', location);
    node.getEC('ECFaction').setFaction(game.getFactionManager().getEnemyFactionName());
    const space = node.getGameSpace(), enemies = space.getEnemyCount(); space.addEnemy(1);
    const health = actor.getEC('ECHealth'), damage = health.takeDamage, own = Object.hasOwn(health, 'takeDamage');
    const trace = window.rangedCombatTrace = { hits: [], deaths: [] };
    const sample = window.sampleRangedCombat = () => {
      const current = w.players.active.get(id).hero;
      return { target: node.shouldBeDestroyed() ? null : node.getEC('ECAgent').getTargetEntity()?.getName() || null,
        enemyHealth: node.shouldBeDestroyed() ? 0 : node.getEC('ECHealth').getHealth(), guestHealth: current.getEC('ECHealth').getHealth(), xp: current.getEC('ECPlayerData').getXP(), enemies: space.getEnemyCount() };
    };
    health.takeDamage = function (...args) { const before = this.getHealth(), result = damage.apply(this, args); if (args[2] === node) trace.hits.push({ amount: args[0], before, after: this.getHealth(), ...sample() }); return result; };
    const killed = event => { if (event.victim === node) trace.deaths.push({ owner: (event.aggressor?.getEC('ECAttach')?.getBaseEntity() || event.aggressor)?.getName(), ...sample() }); };
    game.eventManager.subscribe('EnemyKilled', killed);
    window.restoreRangedCombat = () => { if (own) health.takeDamage = damage; else delete health.takeDamage; game.eventManager.unsubscribe('EnemyKilled', killed); delete window.restoreRangedCombat; };
    return { id: node.getName(), health: node.getEC('ECHealth').getHealth(), priority: node.getEC('ECAgent').archetype.priorityTargetType, enemies };
  }), { id: hero, location: setup.location });
  try {
    assert.equal(enemy.health, 75); assert.equal(enemy.priority, 'Heroes');
    await host.waitForFunction(id => window.sampleRangedCombat().target === id, setup.actor, { timeout: 10000 });
    const acquired = await host.evaluate(() => window.sampleRangedCombat());
    assert.equal(acquired.enemyHealth, 75, 'The enemy must select the guest before any retaliatory damage.');
    await host.waitForFunction(() => window.rangedCombatTrace.hits.length > 0, null, { timeout: 10000 });
    const hit = await host.evaluate(() => window.rangedCombatTrace.hits[0]);
    assert.equal(hit.amount, 12); assert.equal(hit.before - hit.after, 12); assert.ok(hit.after > 0);
    await guest.waitForFunction(id => {
      const w = window.guestWorld, entry = w.scene.entities.get(id), p = entry && w.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location), b = w.movement.canvas.getBoundingClientRect(), d = w.controls.app.globals.graphicsDevice;
      return p && w.movement.available() && window.PolycraftCoopActions.pickTarget(w, { clientX: b.left + p[0] * b.width / d.width, clientY: b.top + p[1] * b.height / d.height }) === id;
    }, enemy.id, { timeout: 5000 });
    const point = await guest.evaluate(id => { const w = window.guestWorld, e = w.scene.entities.get(id), p = w.controls.app.globals.camera.worldToScreen(e.displayLocation || e.record.location), b = w.movement.canvas.getBoundingClientRect(), d = w.controls.app.globals.graphicsDevice; return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height }; }, enemy.id);
    await guest.mouse.move(point.x, point.y); await guest.mouse.click(point.x, point.y, { delay: 100 });
    await host.waitForFunction(() => window.rangedCombatTrace.deaths.length > 0, null, { timeout: 8000 });
    assert.equal(await host.evaluate(() => window.rangedCombatTrace.deaths[0].owner), setup.actor);
    await host.waitForFunction(count => window.sampleRangedCombat().enemies === count, enemy.enemies, { timeout: 5000 });
    const after = await host.evaluate(id => window.hostWorld.atRewardBoundary(() => {
      const w = window.hostWorld, a = w.players.active.get(id).hero;
      return { xp: a.getEC('ECPlayerData').getXP(), health: a.getEC('ECHealth').getHealth(), hostXP: w.game.getHero().getEC('ECPlayerData').getXP(), kills: a.getEC('ECPlayerData').getTotalEnemiesKilled(), hostKills: w.game.getHero().getEC('ECPlayerData').getTotalEnemiesKilled(), trace: window.rangedCombatTrace, sample: window.sampleRangedCombat() };
    }), hero);
    assert.equal(after.xp, setup.xp); assert.equal(after.kills, setup.kills + 1); assert.equal(after.hostKills, setup.hostKills); assert.equal(after.hostXP, setup.hostXP); assert.ok(after.health > 0);
    assert.equal(after.trace.deaths.length, 1); assert.equal(after.sample.enemies, enemy.enemies);
    await guest.waitForFunction(xp => window.guestWorld.hud.state?.xp === xp, after.xp, { timeout: 10000 });
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const record = JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop).players.find(p => p.id === hero);
    assert.equal(record.progress.xp, after.xp); assert.equal(record.gameStats.totalEnemiesKilled, after.kills); assert.ok(record.health.current > 0);
    await guest.screenshot({ path: path.join(directory, 'guest-original-ranged-combat.png') });
    fs.writeFileSync(path.join(directory, 'original-ranged-combat.json'), JSON.stringify({ setup, enemy, acquired, hit, after, record }, null, 2));
    console.log('PASS: original ranged enemy selects/damages nearby guest before normal retaliation and one saved native kill statistic:', JSON.stringify({ setup, enemy, acquired, hit, after }));
  } catch (error) {
    console.log('Original ranged combat failure:', JSON.stringify(await host.evaluate(() => ({ trace: window.rangedCombatTrace, sample: window.sampleRangedCombat() })).catch(e => ({ error: e.message }))));
    throw error;
  } finally { await host.evaluate(() => window.restoreRangedCombat?.()); }
};
