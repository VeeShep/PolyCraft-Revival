'use strict';
const assert = require('node:assert/strict');

module.exports = async function incomingDisconnect({ host, guest, hero, reconnect }) {
  await host.evaluate(id => {
    const world = window.hostWorld, players = world.players, manager = world.game.actionManager;
    const actor = players.active.get(id).hero;
    const mark = window.nativeIncomingDisconnect = { requested: null, capture: null, restored: null, grants: [] };
    const sample = entity => {
      const c = entity.getEC('ECResourceCarrier'), h = entity.getEC('ECHealth');
      return { tick: world.game.gameClock.getFrameIndex(), carried: [c.getResource(0), c.getResource(1)], inbound: [c.getInboundResource(0), c.getInboundResource(1)],
        maximum: [c.getResourceCap(0), c.getResourceCap(1)], health: { current: h.getHealth(), maximum: h.getMaxHealth() } };
    };
    const pickups = () => {
      const owned = world.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).filter(entity => entity.getEC('ECPickup').getCollectorName() === actor.getName());
      const queued = [manager.actionList, manager.otherActionList].flat().filter(action => action.actionName === 'GivePickup' && action.actionArguments.collector === actor).map(action => action.actionArguments.pickup);
      return [...new Set([...owned, ...queued])].filter(entity => entity.getEC('ECPickup').archetype.carriedResource?.some(amount => amount > 0));
    };
    const originals = ['captureHero', 'restoreHero'].map(name => ({ name, own: Object.hasOwn(players, name), fn: players[name] }));
    const grant = manager.actionFunctionMap.GivePickup;
    players.captureHero = function (entity) {
      const slot = world.guestSlots.get(id), recording = entity === actor && mark.requested && !mark.capture && slot?.releasing && slot.connection.closed;
      const before = recording ? { ...sample(entity), ids: pickups().map(node => node.getName()) } : null;
      const result = originals[0].fn.call(this, entity);
      if (before) mark.capture = { before, after: sample(entity), inventory: structuredClone(result.inventory) };
      return result;
    };
    players.restoreHero = function (entity, record) {
      const result = originals[1].fn.call(this, entity, record);
      if (mark.capture && !mark.restored && record.id === id) mark.restored = { saved: structuredClone(record), actual: sample(entity), inventory: {
        weapon: entity.getEC('ECInventory').getHeldWeapon(), mainWeapon: entity.getEC('ECFirearm').mainWeaponName || null,
        ammo: entity.getEC('ECFirearm').getAmmo(), temporaryAmmo: entity.getEC('ECFirearm').temporaryWeaponAmmo || 0,
        carried: sample(entity).carried } };
      return result;
    };
    manager.actionFunctionMap.GivePickup = function (args) {
      if (args.collector !== actor || !args.pickup.getEC('ECPickup').archetype.carriedResource?.some(amount => amount > 0)) return grant.call(this, args);
      const before = sample(actor), result = grant.call(this, args);
      mark.grants.push({ id: args.pickup.getName(), before, after: sample(actor) });
      return result;
    };
    window.sampleIncomingDisconnect = () => {
      const state = sample(actor), nodes = pickups();
      if (!state.inbound.some(amount => amount > 0) || !nodes.some(node => node.getEC('ECPickup').flyingTween)) return null;
      return mark.requested = { ...state, ids: nodes.map(node => node.getName()) };
    };
    window.restoreIncomingDisconnect = () => {
      for (const entry of originals) { if (entry.own) players[entry.name] = entry.fn; else delete players[entry.name]; }
      manager.actionFunctionMap.GivePickup = grant;
      delete window.sampleIncomingDisconnect; delete window.restoreIncomingDisconnect;
    };
  }, hero);
  let completed = false;
  return {
    async attempt() {
      if (completed) return;
      if (!await host.evaluate(() => window.sampleIncomingDisconnect())) return;
      await guest.evaluate(() => window.connection.close('Temporary incoming-pickup disconnect test.'));
      await guest.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld, null, { timeout: 15000 });
      await host.waitForFunction(id => !window.hostWorld.players.active.has(id) && !window.hostWorld.guestSlots.has(id), hero, { timeout: 15000 });
      const result = await host.evaluate(id => ({ mark: window.nativeIncomingDisconnect, saved: window.hostWorld.players.registry.player(id) }), hero);
      const capture = result.mark.capture;
      assert.ok(capture?.before.inbound.some(amount => amount > 0), 'Host removal must capture actual incoming resources, not a missed flight.');
      assert.ok(capture.before.ids.length > 0);
      assert.deepEqual(capture.after.inbound, [0, 0]);
      assert.deepEqual(capture.after.carried, capture.before.carried.map((amount, type) => Math.min(capture.before.maximum[type], amount + capture.before.inbound[type])));
      assert.deepEqual(result.saved.inventory, capture.inventory);
      for (const id of capture.before.ids) assert.equal(result.mark.grants.filter(grant => grant.id === id).length, 1, 'Each captured incoming pickup must grant exactly once: ' + id);
      await reconnect();
      const restored = await host.evaluate(() => window.nativeIncomingDisconnect.restored);
      assert.ok(restored, 'Observe native restore before a subsequent simulation tick can collect more pickups.');
      assert.deepEqual(restored.saved.inventory, result.saved.inventory);
      assert.deepEqual(restored.inventory, result.saved.inventory);
      assert.deepEqual(restored.actual.inbound, [0, 0]);
      assert.equal(restored.actual.health.current, restored.actual.health.maximum * result.saved.health.current / result.saved.health.maximum);
      completed = true;
      console.log('PASS: actual incoming pickup interruption/removal and immediate native rejoin restore:', JSON.stringify({ ...result, restored }));
    },
    finish() { assert.equal(completed, true, 'The visible case must actually interrupt an incoming pickup.'); },
    async close() { await host.evaluate(() => window.restoreIncomingDisconnect?.()); }
  };
};
