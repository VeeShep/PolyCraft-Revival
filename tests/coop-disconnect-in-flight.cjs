'use strict';
const assert = require('node:assert/strict');

module.exports = async function disconnectInFlight({ host, guest, hero, reconnect }) {
  await host.evaluate(id => {
    const world = window.hostWorld, actor = world.players.active.get(id).hero, carrier = actor.getEC('ECResourceCarrier');
    const mark = window.nativeFlightDisconnect = { requested: null, capture: null, walkingStopped: false, cancelled: false };
    const sample = () => ({ tick: world.game.gameClock.getFrameIndex(), flying: carrier.hasAnyFlyingResource(), count: carrier.numFlyingResourceBlocks, entries: carrier.flyingTweens.length });
    const own = Object.hasOwn(world.players, 'captureHero'), original = world.players.captureHero;
    world.players.captureHero = function (entity) {
      const slot = world.guestSlots.get(id);
      const before = entity === actor && mark.requested && !mark.capture && slot?.releasing && slot.connection.closed ? sample() : null;
      const result = original.call(this, entity);
      if (before) mark.capture = { before, after: sample() };
      return result;
    };
    window.cancelNativeFlightDisconnect = () => {
      mark.cancelled = true;
      if (own) world.players.captureHero = original; else delete world.players.captureHero;
      delete window.cancelNativeFlightDisconnect;
    };
  }, hero);
  try {
    await host.waitForFunction(() => window.nativeFlightDisconnect.walkingStopped || window.nativeFlightDisconnect.cancelled, null, { timeout: 180000 });
    const requested = await host.evaluate(id => {
      const mark = window.nativeFlightDisconnect, world = window.hostWorld, carrier = world.players.active.get(id).hero.getEC('ECResourceCarrier');
      if (mark.cancelled) return null;
      return mark.requested = { tick: world.game.gameClock.getFrameIndex(), flying: carrier.hasAnyFlyingResource(), count: carrier.numFlyingResourceBlocks, entries: carrier.flyingTweens.length };
    }, hero);
    assert.equal(requested?.flying, true, 'The real guest connection must close while its transfer is active.');
    await guest.evaluate(() => window.connection.close('Temporary mid-flight disconnect test.'));
    await guest.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld, null, { timeout: 15000 });
    await host.waitForFunction(id => !window.hostWorld.players.active.has(id) && !window.hostWorld.guestSlots.has(id), hero, { timeout: 15000 });
    const result = await host.evaluate(id => ({ observation: window.nativeFlightDisconnect, player: window.hostWorld.players.registry.player(id) }), hero);
    assert.equal(result.observation.capture?.before.flying, true, 'Host peer removal must capture the still-active transfer.');
    assert.ok(result.observation.capture.before.count > 0 && result.observation.capture.before.entries > 0);
    assert.equal(result.observation.capture.after.flying, false);
    assert.equal(result.observation.capture.after.count, 0); assert.equal(result.observation.capture.after.entries, 0);
    assert.deepEqual(result.player.inventory.carried, [0, 0]);
    await reconnect();
    const restored = await host.evaluate(id => window.hostWorld.players.captureHero(window.hostWorld.players.active.get(id).hero), hero);
    assert.deepEqual(restored.inventory, result.player.inventory);
    assert.deepEqual(restored.health, result.player.health);
    console.log('PASS: actual guest disconnect captures the live transfer once and reconnect restores its saved hero:', JSON.stringify(result.observation));
    return result.observation;
  } finally { await host.evaluate(() => window.cancelNativeFlightDisconnect?.()).catch(() => {}); }
};
