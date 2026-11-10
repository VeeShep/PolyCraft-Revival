'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');

module.exports = async function healthItemTransitions({ host, guest, hero, reconnect, hostFile }) {
  for (const kind of ['health', 'item']) {
    await host.evaluate(id => {
      const w = window.hostWorld, game = w.game, players = w.players;
      const grant = game.actionManager.actionFunctionMap.GivePickup, boundary = w.atRewardBoundary, restore = players.restoreHero;
      const ownBoundary = Object.hasOwn(w, 'atRewardBoundary'), ownRestore = Object.hasOwn(players, 'restoreHero');
      const read = actor => ({ health: actor.getEC('ECHealth').getHealth(), maximum: actor.getEC('ECHealth').getMaxHealth(),
        weapon: actor.getEC('ECInventory').getHeldWeapon(), mainWeapon: actor.getEC('ECFirearm').mainWeaponName,
        temporaryAmmo: actor.getEC('ECFirearm').temporaryWeaponAmmo || 0, xp: actor.getEC('ECPlayerData').getXP() });
      const trace = window.healthItemTransition = { grants: [], restored: [], pendingAtRelease: null, other: read(game.getHero()) };
      game.actionManager.actionFunctionMap.GivePickup = function (args) {
        const result = grant.call(this, args);
        if (args.pickup === trace.pickup) trace.grants.push({ ...read(args.collector), alive: !args.collector.shouldBeDestroyed() });
        return result;
      };
      w.atRewardBoundary = function (read, selected) {
        if (selected === id) trace.pendingAtRelease = this.pendingRewards(id);
        return boundary.call(this, read, selected);
      };
      players.restoreHero = function (actor, record) {
        const result = restore.call(this, actor, record);
        if (record.id === id) {
          const held = actor.getEC('ECInventory').heldWeaponEntity;
          trace.restored.push({ ...read(actor), held: held ? { id: held.getName(), mesh: held.getEC('ECMesh').getMeshPath() } : null });
        }
        return result;
      };
      window.restoreHealthItemObserver = () => {
        game.actionManager.actionFunctionMap.GivePickup = grant;
        if (ownBoundary) w.atRewardBoundary = boundary; else delete w.atRewardBoundary;
        if (ownRestore) players.restoreHero = restore; else delete players.restoreHero;
        delete window.restoreHealthItemObserver;
      };
    }, hero);
    try {
      const before = await host.evaluate(({ id, kind }) => window.hostWorld.atBoundary(() => {
        const w = window.hostWorld, actor = w.players.active.get(id).hero, health = actor.getEC('ECHealth'), inventory = actor.getEC('ECInventory');
        if (kind === 'health') {
          if (health.getHealth() <= 20) throw new Error('This disposable hero needs enough health for a nonlethal fixture.');
          health.addHealth(-20); health.onHealthChange();
        } else if (!inventory.canEquipTemporaryWeapon('wp_h_bombs')) throw new Error('The disposable hero must not already hold the staged temporary item.');
        const node = w.game.getEntityFactory().createActiveEntityInstance('Temporary health/item transition', kind === 'health' ? 'a_p_heal' : 'a_p_bombs', actor.getv3Location());
        const pickup = node.getEC('ECPickup'), trace = window.healthItemTransition;
        trace.pickup = node;
        const expected = { kind, health: kind === 'health' ? Math.min(health.getMaxHealth(), health.getHealth() + pickup.archetype.health) : health.getHealth(),
          maximum: health.getMaxHealth(), weapon: kind === 'item' ? pickup.item : inventory.getHeldWeapon(), mainWeapon: actor.getEC('ECFirearm').mainWeaponName,
          temporaryAmmo: kind === 'item' ? pickup.itemAmmo : actor.getEC('ECFirearm').temporaryWeaponAmmo || 0, xp: actor.getEC('ECPlayerData').getXP() + (pickup.xp || 0), pickupXP: pickup.xp || 0,
          heldMesh: kind === 'item' ? inventory.getWeaponDefinition(pickup.item).meshPath : null };
        pickup.storeCollector(actor); if (kind === 'health') pickup.beginFly();
        if (!window.PolycraftCoopPlayers.CoopPlayers.hasPendingRewards(w.game, actor)) throw new Error('The reward must still be owned or queued before disconnect.');
        const binding = [...w.peerPlayers.values()].find(row => row.id === id);
        if (!binding?.ready || binding.connection.closed) throw new Error('The disposable assigned guest must be connected.');
        binding.connection.close('Temporary host-side close with pending ' + kind + ' reward.');
        return expected;
      }), { id: hero, kind });
      console.log('Original health/item transition staged with observed native reward:', JSON.stringify(before));
      await guest.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld, null, { timeout: 15000 });
      await host.waitForFunction(id => !window.hostWorld.players.active.has(id) && !window.hostWorld.guestSlots.has(id), hero, { timeout: 15000 });
      const saved = await host.evaluate(id => ({ pending: window.healthItemTransition.pendingAtRelease, grants: window.healthItemTransition.grants,
        record: window.hostWorld.players.registry.player(id) }), hero);
      assert.equal(saved.pending, true); assert.equal(saved.grants.length, 1); assert.equal(saved.grants[0].alive, true);
      for (const key of ['maximum', 'weapon', 'mainWeapon', 'temporaryAmmo', 'xp']) assert.equal(saved.grants[0][key], before[key], kind + ' native grant: ' + key);
      if (kind === 'health') { assert.equal(saved.grants[0].health, before.health); assert.equal(saved.record.health.current, before.health); }
      else assert.ok(saved.grants[0].health >= before.health && saved.record.health.current >= saved.grants[0].health && saved.record.health.current <= before.maximum, 'The item phase may retain ordinary native regeneration.');
      assert.equal(saved.record.health.maximum, before.maximum);
      assert.equal(saved.record.inventory.weapon, before.weapon); assert.equal(saved.record.inventory.mainWeapon, before.mainWeapon);
      assert.equal(saved.record.inventory.temporaryAmmo, before.temporaryAmmo); assert.equal(saved.record.progress.xp, before.xp);
      await reconnect();
      const restored = await host.evaluate(() => ({ trace: window.healthItemTransition.restored, grants: window.healthItemTransition.grants.length,
        other: { health: window.hostWorld.game.getHero().getEC('ECHealth').getHealth(), maximum: window.hostWorld.game.getHero().getEC('ECHealth').getMaxHealth(),
          weapon: window.hostWorld.game.getHero().getEC('ECInventory').getHeldWeapon(), mainWeapon: window.hostWorld.game.getHero().getEC('ECFirearm').mainWeaponName,
          temporaryAmmo: window.hostWorld.game.getHero().getEC('ECFirearm').temporaryWeaponAmmo || 0, xp: window.hostWorld.game.getHero().getEC('ECPlayerData').getXP() }, baseline: window.healthItemTransition.other }));
      assert.equal(restored.trace.length, 1); assert.equal(restored.grants, 1); assert.deepEqual(restored.other, restored.baseline);
      for (const key of ['maximum', 'weapon', 'mainWeapon', 'temporaryAmmo', 'xp']) assert.equal(restored.trace[0][key], before[key], kind + ' immediate native restore: ' + key);
      assert.ok(Math.abs(restored.trace[0].health - saved.record.health.current) < 1e-7, 'Native restore must retain the captured health, including legitimate regeneration.');
      if (kind === 'item') { assert.ok(restored.trace[0].held, 'The restored temporary weapon needs its native held entity.'); assert.equal(restored.trace[0].held.mesh, before.heldMesh); }
      await guest.waitForFunction(expected => {
        const w = window.guestWorld, actor = w.scene.entities.get(w.identity.entity), held = expected.held && w.scene.entities.get(expected.held.id);
        return actor?.record.health.current >= expected.health && actor.record.health.current <= expected.maximum &&
          (!expected.held || held?.record.mesh?.path === expected.held.mesh);
      }, restored.trace[0], { timeout: 10000 });
      await host.evaluate(() => window.polycraft.checkpoint(true));
      const disk = JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop).players.find(row => row.id === hero);
      assert.ok(disk.health.current + 1e-7 >= saved.record.health.current && disk.health.current <= before.maximum, 'Later native regeneration may heal but must not lose the delivered health.');
      assert.equal(disk.inventory.weapon, before.weapon); assert.equal(disk.inventory.mainWeapon, before.mainWeapon); assert.equal(disk.inventory.temporaryAmmo, before.temporaryAmmo);
      console.log('PASS: original pending ' + kind + ' grant completes once before actual host-side link close removes its living collector; exact native restore, guest scene and disk retain it:', JSON.stringify({ before, saved, restored: restored.trace[0], diskHealth: disk.health }));
    } finally { await host.evaluate(() => window.restoreHealthItemObserver?.()); }
  }
};
