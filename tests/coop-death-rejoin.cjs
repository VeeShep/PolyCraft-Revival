'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

module.exports = async function deathRejoin({ host, guest, hero, reconnect, hostFile, huts, directory, before, waiting, damage, attack }) {
  const phase = attack ? 'dying' : 'waiting';
  let initial = await host.evaluate(({ hero, huts, phase }) => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, players = w.players, restore = players.restoreHero, own = Object.hasOwn(players, 'restoreHero'), cleanup = [];
    const trace = window.deathRejoinTrace = { restored: [], respawns: [], payments: [], schedules: [] };
    const read = actor => {
      const inventory = actor.getEC('ECInventory'), gun = actor.getEC('ECFirearm'), carrier = actor.getEC('ECResourceCarrier');
      return { time: w.game.globals.gameCurrentTime, entity: actor.getName(), health: actor.getEC('ECHealth').getHealth(), maximum: actor.getEC('ECHealth').getMaxHealth(), invulnerable: actor.getEC('ECHealth').getInvulnerable(),
        life: players.captureLife(actor), xp: actor.getEC('ECPlayerData').getXP(), location: Array.from(actor.getv3Location()),
        inventory: { weapon: inventory.getHeldWeapon(), mainWeapon: gun.mainWeaponName || null, ammo: gun.getAmmo(), temporaryAmmo: gun.temporaryWeaponAmmo || 0, carried: [carrier.getResource(0), carrier.getResource(1)] } };
    };
    window.sampleDeathRejoin = () => ({ tick: w.game.gameClock.getFrameIndex(), actor: players.active.has(hero) ? read(players.active.get(hero).hero) : null,
      amber: w.game.getPlayerData().getSoftCurrency(), workers: huts.map(id => w.game.getGameEntityByName(id).getEC('ECWildlingHouse').getWildling().getEC('ECWildlingAgent').lastUpdateTime),
      others: [...players.active].filter(([id]) => id !== hero).map(([id, entry]) => ({ id, health: entry.hero.getEC('ECHealth').getHealth(), xp: entry.hero.getEC('ECPlayerData').getXP() })) });
    players.restoreHero = function (actor, record) {
      const result = restore.call(this, actor, record);
      if (record.id === hero) {
        trace.restored.push({ saved: JSON.parse(JSON.stringify(record)), actual: read(actor) });
        const life = actor.getEC('ECPlayerLife'), respawn = life.respawn, pay = life.payToRevive, ownRespawn = Object.hasOwn(life, 'respawn'), ownPay = Object.hasOwn(life, 'payToRevive');
        life.respawn = function (...args) { const result = respawn.apply(this, args); trace.respawns.push(read(actor)); return result; };
        life.payToRevive = function (...args) { const result = pay.apply(this, args); trace.payments.push({ args, result }); return result; };
        if (phase === 'dying') {
          const schedule = life.scheduleRespawn, ownSchedule = Object.hasOwn(life, 'scheduleRespawn');
          life.scheduleRespawn = function (...args) { const result = schedule.apply(this, args); trace.schedules.push(read(actor)); return result; };
          cleanup.push(() => { if (ownSchedule) life.scheduleRespawn = schedule; else delete life.scheduleRespawn; });
        }
        cleanup.push(() => { if (ownRespawn) life.respawn = respawn; else delete life.respawn; if (ownPay) life.payToRevive = pay; else delete life.payToRevive; });
      }
      return result;
    };
    window.restoreDeathRejoinObservation = () => { if (own) players.restoreHero = restore; else delete players.restoreHero; cleanup.forEach(fn => fn()); delete window.sampleDeathRejoin; delete window.deathRejoinTrace; delete window.restoreDeathRejoinObservation; };
    return window.sampleDeathRejoin();
  }), { hero, huts, phase });
  try {
    if (attack) {
      await attack();
      await host.waitForFunction(() => window.sampleDeathRejoin().actor.life.phase === 'dying', null, { timeout: 10000 });
      initial = await host.evaluate(() => window.sampleDeathRejoin()); waiting = initial.actor;
      damage = await host.evaluate(() => window.pvpLifeTrace);
      assert.ok(damage.projectiles.some(row => row.archetype === 'pj_h_pistol_weak')); assert.ok(damage.hits.some(row => row.amount >= before.health && row.after === 0));
      assert.equal(damage.deaths.length, 1); assert.equal(damage.deaths[0].state, damage.deaths[0].expected);
    }
    assert.equal(initial.actor.health, 0); assert.equal(initial.actor.life.phase, phase);
    await guest.evaluate(() => window.connection.close('Disposable native knockout rejoin test'));
    await host.waitForFunction(id => !window.hostWorld.players.active.has(id), hero, { timeout: 10000 });
    await guest.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld, null, { timeout: 10000 });
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const disk = JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop), saved = disk.players.find(row => row.id === hero);
    assert.equal(saved.health.current, 0); assert.equal(saved.life.phase, phase); assert.equal(saved.progress.xp, before.xp);
    assert.ok(saved.life.remaining > 0 && saved.life.remaining <= initial.actor.life.remaining);
    assert.deepEqual(saved.life.location, waiting.life.location); assert.equal(saved.life.lives, before.life.lives); assert.equal(saved.life.infiniteLives, before.life.infiniteLives);
    assert.deepEqual(saved.inventory, initial.actor.inventory);
    const absent = await host.evaluate(() => window.sampleDeathRejoin());
    await host.waitForTimeout(1200);
    const continued = await host.evaluate(() => window.sampleDeathRejoin());
    assert.equal(continued.actor, null); assert.ok(continued.tick > absent.tick && continued.workers.every((time, i) => time > absent.workers[i]));
    await reconnect({ phase });
    const restored = await host.evaluate(() => ({ sample: window.sampleDeathRejoin(), trace: window.deathRejoinTrace }));
    assert.equal(restored.trace.restored.length, 1);
    const native = restored.trace.restored[0];
    assert.equal(native.actual.health, 0); assert.equal(native.actual.life.phase, phase); assert.equal(native.actual.xp, before.xp);
    assert.deepEqual(native.actual.inventory, saved.inventory); assert.notEqual(native.actual.entity, initial.actor.entity);
    assert.ok(Math.abs(native.actual.life.remaining - saved.life.remaining) < 1e-7);
    assert.deepEqual(native.actual.life.location, saved.life.location); assert.equal(native.actual.life.lives, saved.life.lives); assert.equal(native.actual.life.infiniteLives, saved.life.infiniteLives);
    assert.equal(await guest.evaluate(() => window.guestWorld.movement.available()), false);
    assert.equal(await guest.evaluate(() => window.guestWorld.identity.playerId), hero);
    await guest.screenshot({ path: path.join(directory, 'guest-native-death-rejoin.png') });
    await host.waitForFunction(() => { const s = window.sampleDeathRejoin(); return s.actor?.life.phase === 'normal' && s.actor.health === s.actor.maximum; }, null, { timeout: 25000 });
    await guest.waitForFunction(() => window.guestWorld.lifeState?.phase === 'normal' && window.guestWorld.movement.available(), null, { timeout: 10000 });
    const after = await host.evaluate(() => ({ sample: window.sampleDeathRejoin(), trace: window.deathRejoinTrace }));
    assert.equal(after.trace.respawns.length, 1); assert.equal(after.trace.respawns[0].invulnerable, true); assert.equal(after.trace.respawns[0].health, before.maximum); assert.deepEqual(after.trace.payments, []);
    if (phase === 'dying') {
      assert.equal(after.trace.schedules.length, 1); const countdown = after.trace.schedules[0];
      assert.equal(countdown.life.phase, 'waiting'); assert.ok(Math.abs(countdown.life.remaining - before.respawnDelay) < 1e-7);
      assert.ok(countdown.time >= native.actual.time + saved.life.remaining - 1e-7 && countdown.time <= native.actual.time + saved.life.remaining + .2);
    }
    assert.equal(after.sample.actor.xp, before.xp); assert.equal(after.sample.actor.life.lives, before.life.lives); assert.equal(after.sample.actor.life.infiniteLives, before.life.infiniteLives);
    assert.equal(after.sample.amber, before.amber); assert.deepEqual(after.sample.others, before.others);
    assert.ok(after.sample.tick > restored.sample.tick && after.sample.workers.every((time, i) => time > restored.sample.workers[i]));
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const final = JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop).players.find(row => row.id === hero);
    assert.equal(final.life.phase, 'normal'); assert.equal(final.health.current, final.health.maximum); assert.equal(final.progress.xp, before.xp);
    console.log('PASS: native lethal knockout survives actual departure/disk/rejoin and original automatic respawn without a charge:', JSON.stringify({ phase, before, waiting, damage, initial, saved, absent, continued, restored, after }));
  } catch (error) {
    console.log('Native death rejoin diagnostics:', JSON.stringify(await host.evaluate(() => ({ sample: window.sampleDeathRejoin(), trace: window.deathRejoinTrace })).catch(failure => ({ unavailable: failure.message }))));
    throw error;
  } finally { await host.evaluate(() => window.restoreDeathRejoinObservation?.()); }
};
