'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

module.exports = async function pvpLife({ host, attackerPage, victimPage, focusAttacker, focusVictim, attackerId, victimId, paid, hostFile, directory, huts }) {
  const before = await host.evaluate(({ attackerId, victimId, huts }) => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, game = w.game, attacker = w.players.active.get(attackerId).hero, victim = w.players.active.get(victimId).hero;
    if (!w.transport.pvp || Object.getOwnPropertyDescriptor(w.transport, 'pvp').writable) throw new Error('This disposable session needs fixed PvP enabled.');
    const health = victim.getEC('ECHealth'), life = victim.getEC('ECPlayerLife');
    if (health.getHealth() !== health.getMaxHealth() || health.getInvulnerable() || life.state !== life.states.NORMAL) throw new Error('The native victim must begin alive, fully healthy and vulnerable.');
    const origin = victim.getv3Location(), others = [...w.players.active].filter(([id]) => ![attackerId, victimId].includes(id)).map(([, entry]) => entry.hero);
    attacker.getEC('ECInventory').equipWeapon('wp_h_pistol');
    const firearm = attacker.getEC('ECFirearm'), offset = firearm.hasShootOffset ? firearm.archetype.shootOffset : [0, 0, 0];
    const mesh = attacker.getEC('ECMesh'), axes = ['getX', 'getY', 'getZ'].map(name => Array.from(mesh[name]()));
    const muzzleOffset = [0, 1, 2].map(i => axes.reduce((sum, axis, j) => sum + axis[i] * offset[j], 0));
    const height = attacker.getEC('ECPhysicsSphere').getv3CapsuleTopLocation()[1] - attacker.getv3Location()[1] + muzzleOffset[1], radius = Math.hypot(muzzleOffset[0], muzzleOffset[2]);
    const destination = victim.getEC('ECPhysicsSphere').getv3CapsuleTopLocation();
    const location = [3, 5].flatMap(distance => [[distance, 0], [-distance, 0], [0, distance], [0, -distance]])
      .map(([x, z]) => game.placeOnGround([origin[0] + x, origin[1], origin[2] + z], 0.5))
      .find(point => point && Math.abs(point[1] - origin[1]) < 1 && !game.getCollisionInfo(origin, point, false, victim) &&
        others.every(hero => Math.hypot(hero.getv3Location()[0] - point[0], hero.getv3Location()[2] - point[2]) > 2) &&
        // Check the elevated muzzle envelope as native facing rotates, including character interception.
        Array.from({ length: 8 }, (_, i) => i * Math.PI / 4).every(angle => game.getCollisionInfo([point[0] + Math.cos(angle) * radius, point[1] + height, point[2] + Math.sin(angle) * radius], destination, true, attacker)?.collidedEntity === victim));
    if (!location) throw new Error('The disposable duel needs an unobstructed native muzzle-to-victim firing lane.');
    const binding = [...w.peerPlayers.values()].find(row => row.id === attackerId); binding.input.discard(); binding.actions.stop(attacker);
    attacker.getEC('ECNav')?.endPath(); attacker.getEC('ECLocomotion').clearDestination(); attacker.teleport(location);
    if (!firearm.getCanFire() || firearm.getAmmo() <= 0) throw new Error('The staged native pistol must be ready.');
    const factory = game.getProjectileFactory(), create = factory.createProjectile, damage = health.takeDamage, lose = life.loseLife, respawn = life.respawn;
    const ownCreate = Object.hasOwn(factory, 'createProjectile'), ownDamage = Object.hasOwn(health, 'takeDamage'), ownLose = Object.hasOwn(life, 'loseLife'), ownRespawn = Object.hasOwn(life, 'respawn');
    const trace = window.pvpLifeTrace = { projectiles: [], impacts: [], hits: [], deaths: [], respawns: [] }, projectileObservers = [];
    const sample = () => {
      const actor = w.players.active.get(victimId).hero, component = actor.getEC('ECHealth');
      return { tick: game.gameClock.getFrameIndex(), life: w.players.captureLife(actor), health: component.getHealth(), maximum: component.getMaxHealth(), active: actor.getEC('ECLocomotion').active,
        amber: game.getPlayerData().getSoftCurrency(), xp: actor.getEC('ECPlayerData').getXP(), workers: huts.map(id => game.getGameEntityByName(id).getEC('ECWildlingHouse').getWildling().getEC('ECWildlingAgent').lastUpdateTime),
        others: [...w.players.active].filter(([id]) => id !== victimId).map(([id, entry]) => ({ id, health: entry.hero.getEC('ECHealth').getHealth(), xp: entry.hero.getEC('ECPlayerData').getXP() })) };
    };
    factory.createProjectile = function (...args) {
      const node = create.apply(this, args);
      if (args[0] === attacker) {
        trace.projectiles.push({ id: node.getName(), archetype: node.getArchetypeName(), origin: Array.from(args[1]), destination: Array.from(args[2]), victim: Array.from(victim.getv3Location()) });
        const projectile = node.getEC('ECProjectile'), impact = projectile.onImpact, own = Object.hasOwn(projectile, 'onImpact');
        projectile.onImpact = function (...values) { trace.impacts.push({ projectile: node.getName(), target: values[0]?.getName() || null, location: values[1] && Array.from(values[1]) }); return impact.apply(this, values); };
        projectileObservers.push(() => { if (own) projectile.onImpact = impact; else delete projectile.onImpact; });
      }
      return node;
    };
    health.takeDamage = function (...args) {
      const previous = this.getHealth(), result = damage.apply(this, args);
      if (args[2] === attacker) trace.hits.push({ amount: args[0], before: previous, after: this.getHealth() });
      return result;
    };
    life.loseLife = function (...args) { const result = lose.apply(this, args); trace.deaths.push({ state: this.state, expected: this.states.DYING }); return result; };
    life.respawn = function (...args) { const result = respawn.apply(this, args); trace.respawns.push({ state: this.state, expected: this.states.NORMAL, health: health.getHealth(), invulnerable: health.getInvulnerable() }); return result; };
    window.samplePvpLife = sample;
    window.restorePvpLifeObserver = () => {
      if (ownCreate) factory.createProjectile = create; else delete factory.createProjectile;
      for (const restore of projectileObservers) restore();
      if (ownDamage) health.takeDamage = damage; else delete health.takeDamage;
      if (ownLose) life.loseLife = lose; else delete life.loseLife;
      if (ownRespawn) life.respawn = respawn; else delete life.respawn;
      w.players.active.get(attackerId)?.hero.getEC('ECAutoFire')?.disable();
      delete window.samplePvpLife; delete window.restorePvpLifeObserver;
    };
    return { ...sample(), target: victim.getName(), respawnDelay: life.getRespawnDelay(), hasChargeComponent: !!attacker.getEC('ECChargeableShot') };
  }), { attackerId, victimId, huts });
  try {
    assert.ok(!paid || before.amber >= 10, 'Use the existing island funds for the original revive price.');
    assert.equal(await attackerPage.evaluate(() => window.guestWorld.identity.pvp), true);
    await focusAttacker();
    await attackerPage.waitForFunction(() => {
      const c = window.guestWorld.viewCamera.camera;
      return ['Position', 'Focus'].every(key => { const a = c['currentV3' + key], b = c['desiredV3' + key]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < .01; }) && Math.abs(c.currentFOV - c.desiredFOV) < .001;
    }, null, { timeout: 15000 });
    await attackerPage.waitForFunction(id => {
      const w = window.guestWorld, entry = w.scene.entities.get(id), point = entry && w.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location), bounds = w.movement.canvas.getBoundingClientRect(), d = w.controls.app.globals.graphicsDevice;
      return point && w.movement.available() && point[0] > 30 && point[0] < d.width - 30 && point[1] > 30 && point[1] < d.height - 30 &&
        window.PolycraftCoopActions.pickTarget(w, { clientX: bounds.left + point[0] * bounds.width / d.width, clientY: bounds.top + point[1] * bounds.height / d.height }) === id;
    }, before.target, { timeout: 15000 });
    const point = await attackerPage.evaluate(id => {
      const w = window.guestWorld, entry = w.scene.entities.get(id), p = w.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location), b = w.movement.canvas.getBoundingClientRect(), d = w.controls.app.globals.graphicsDevice;
      return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
    }, before.target);
    await attackerPage.mouse.move(point.x, point.y); await attackerPage.mouse.click(point.x, point.y, { delay: 100 });
    await focusVictim();
    await host.waitForFunction(() => window.pvpLifeTrace.deaths.length > 0, null, { timeout: 10000 });
    const damage = await host.evaluate(() => window.pvpLifeTrace);
    assert.ok(damage.projectiles.some(row => row.archetype === 'pj_h_pistol_weak')); assert.ok(damage.hits.some(row => row.amount >= before.health && row.after === 0));
    assert.equal(damage.deaths.length, 1); assert.equal(damage.deaths[0].state, damage.deaths[0].expected);
    await host.waitForFunction(() => window.samplePvpLife().life.phase === 'waiting', null, { timeout: 10000 });
    const waiting = await host.evaluate(() => window.samplePvpLife());
    assert.equal(waiting.health, 0); assert.ok(waiting.life.remaining > 0 && waiting.life.remaining <= before.respawnDelay);
    if (paid) {
      await victimPage.waitForFunction(() => {
        const w = window.guestWorld, row = w.game.getGuiManager().prevDrawGuiMap['guest-revive'];
        return w.lifeState?.phase === 'waiting' && w.lifeState.option === 'amber' && w.lifeState.affordable && row?.scale > .95 && row.archetypeName === 'respawnButtonAmber';
      }, null, { timeout: 4000 });
      assert.equal(await victimPage.evaluate(() => window.guestWorld.movement.available()), false);
      const episode = await victimPage.evaluate(() => window.guestWorld.lifeState.episode);
      const button = await victimPage.evaluate(() => {
        const w = window.guestWorld, row = w.game.getGuiManager().prevDrawGuiMap['guest-revive'], p = row.argumentObject.v2ScreenLocation, b = w.movement.canvas.getBoundingClientRect(), d = w.controls.app.globals.graphicsDevice;
        return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
      });
      await victimPage.mouse.move(button.x, button.y); await victimPage.waitForFunction(() => window.guestWorld.game.getIMGui().isHot('guest-revive'), null, { timeout: 1500 });
      await victimPage.mouse.click(button.x, button.y, { delay: 100 });
      await victimPage.waitForFunction(() => window.guestWorld.lastTargetResult?.type === 'revive', null, { timeout: 10000 });
      assert.equal(await victimPage.evaluate(() => window.guestWorld.lastTargetResult.message), 'Revive purchased and saved.');
      assert.equal(JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop).economy.softCurrency, before.amber - 10);
      await victimPage.waitForFunction(() => window.guestWorld.lifeState?.phase === 'normal' && window.guestWorld.movement.available(), null, { timeout: 10000 });
      await victimPage.evaluate(episode => { const w = window.guestWorld; w.lastTargetResult = null; w.connection.send('action', { type: 'revive', sequence: ++w.targetSequence, target: w.identity.entity, amber: true, episode }); }, episode);
      await victimPage.waitForFunction(() => window.guestWorld.lastTargetResult?.type === 'revive');
      assert.match(await victimPage.evaluate(() => window.guestWorld.lastTargetResult.message), /changed|unavailable/);
    } else {
      await victimPage.waitForFunction(id => window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap['ecPlayerLife' + id + 'revive']?.archetypeName === 'gameMessage', before.target, { timeout: 5000 });
      await victimPage.screenshot({ path: path.join(directory, 'pvp-host-native-countdown.png') });
      await victimPage.waitForTimeout(1200);
      const during = await host.evaluate(() => window.samplePvpLife());
      assert.ok(during.tick > waiting.tick && during.life.remaining < waiting.life.remaining && during.workers.every((time, i) => time > waiting.workers[i]));
    }
    await host.waitForFunction(() => { const s = window.samplePvpLife(); return s.life.phase === 'normal' && s.health === s.maximum && s.active !== false; }, null, { timeout: 25000 });
    const after = await host.evaluate(() => ({ sample: window.samplePvpLife(), trace: window.pvpLifeTrace }));
    assert.equal(after.trace.respawns.length, 1); assert.equal(after.trace.respawns[0].state, after.trace.respawns[0].expected); assert.equal(after.trace.respawns[0].health, before.maximum); assert.equal(after.trace.respawns[0].invulnerable, true);
    assert.equal(after.sample.xp, before.xp); assert.equal(after.sample.life.lives, before.life.lives); assert.equal(after.sample.life.infiniteLives, before.life.infiniteLives);
    assert.deepEqual(after.sample.others, before.others); assert.equal(after.sample.amber, before.amber - (paid ? 10 : 0));
    assert.ok(after.sample.tick > before.tick && after.sample.workers.every((time, i) => time > before.workers[i]));
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const disk = JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop), record = disk.players.find(row => row.id === victimId);
    assert.equal(record.life.phase, 'normal'); assert.equal(record.health.current, record.health.maximum); assert.equal(record.progress.xp, before.xp); assert.equal(disk.economy.softCurrency, before.amber - (paid ? 10 : 0));
    console.log('PASS: original lethal PvP projectile and native ' + (paid ? 'guest paid revive/stale-episode refusal' : 'host automatic respawn/unpaused worker AI') + ':', JSON.stringify({ before, waiting, after }));
  } catch (error) {
    console.log('PvP failure diagnostics:', JSON.stringify(await host.evaluate(({ attackerId, victimId }) => {
      const w = window.hostWorld, actor = w.players.active.get(attackerId).hero, victim = w.players.active.get(victimId).hero, binding = [...w.peerPlayers.values()].find(row => row.id === attackerId);
      return { trace: window.pvpLifeTrace, sample: window.samplePvpLife(), attacker: { location: Array.from(actor.getv3Location()), ammo: actor.getEC('ECFirearm').getAmmo(), ready: actor.getEC('ECFirearm').getCanFire(), target: actor.getEC('ECAutoFire')?.getTargetEntity()?.getName() || null }, victim: { location: Array.from(victim.getv3Location()), vulnerable: !victim.getEC('ECHealth').getInvulnerable() }, actionSequence: binding.actions.sequence, errors: window.workerConnectionErrors };
    }, { attackerId, victimId }).catch(diagnostic => ({ unavailable: diagnostic.message }))));
    console.log('PvP attacker input:', JSON.stringify(await attackerPage.evaluate(() => { const w = window.guestWorld, gui = w.game.getIMGui(); return { available: w.movement.available(), result: w.lastTargetResult, sequence: w.targetSequence, captured: gui.hasCapturedInput(), hot: gui.hotID, active: gui.activeID, gobbled: gui.prevGobbled }; }).catch(diagnostic => ({ unavailable: diagnostic.message }))));
    throw error;
  } finally { await host.evaluate(() => window.restorePvpLifeObserver?.()); }
};
