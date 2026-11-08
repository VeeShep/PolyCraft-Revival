'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const disconnectInFlight = require('./coop-disconnect-in-flight.cjs');

function fixture(t, mode, own) {
  const prior = global.window; t.after(() => { if (prior === undefined) delete global.window; else global.window = prior; });
  t.mock.method(console, 'log', () => {});
  const carrier = { flying: true, numFlyingResourceBlocks: 1, flyingTweens: [{}], hasAnyFlyingResource() { return this.flying; } };
  const actor = { getEC: () => carrier }, slot = { connection: { closed: false }, releasing: false };
  const record = { inventory: { weapon: 'starter', ammo: 2, carried: [0, 0] }, health: { current: 50, maximum: 50 } };
  let saved = structuredClone(record), rejoined;
  const capture = function (entity) {
    assert.equal(this, players);
    if (entity === actor && mode !== 'stuck') { carrier.flying = false; carrier.numFlyingResourceBlocks = 0; carrier.flyingTweens.length = 0; }
    return structuredClone(entity === rejoined && mode === 'bad-rejoin' ? { ...record, inventory: { ...record.inventory, carried: [1, 0] } } : record);
  };
  const players = Object.assign(Object.create({ captureHero: capture }), { active: new Map([['assigned', { hero: actor }]]), registry: { player: () => saved } });
  if (own) players.captureHero = capture;
  const world = { players, guestSlots: new Map([['assigned', slot]]), game: { gameClock: { getFrameIndex: () => 10 } } };
  const hostWindow = { hostWorld: world }, guestWindow = { polycraft: { controls: { guestWorld: {} } } };
  guestWindow.connection = { closed: false, close() {
    this.closed = slot.connection.closed = true; slot.releasing = mode !== 'not-releasing';
    saved = players.captureHero(actor); players.active.delete('assigned'); world.guestSlots.delete('assigned'); guestWindow.polycraft.controls.guestWorld = null;
  } };
  const run = async (state, callback, argument) => {
    const before = global.window; global.window = state;
    try { return structuredClone(await callback(argument)); } finally { global.window = before; }
  };
  const host = { evaluate: (callback, argument) => run(hostWindow, callback, argument), async waitForFunction(callback, argument, options) {
    assert.ok([180000, 15000].includes(options.timeout));
    if (options.timeout === 180000) {
      hostWindow.nativeFlightDisconnect.walkingStopped = true;
      if (mode === 'expired') { carrier.flying = false; carrier.numFlyingResourceBlocks = 0; carrier.flyingTweens.length = 0; }
    }
    assert.ok(await run(hostWindow, callback, argument));
  } };
  const guest = { evaluate: (callback, argument) => run(guestWindow, callback, argument), async waitForFunction(callback, argument, options) {
    assert.equal(options.timeout, 15000); assert.ok(await run(guestWindow, callback, argument));
  } };
  const reconnect = async () => { rejoined = {}; players.active.set('assigned', { hero: rejoined }); };
  return { host, guest, reconnect, players, capture, hostWindow };
}
for (const own of [false, true]) {
  test('mid-flight disconnect observes host removal and restores the same saved inventory (own=' + own + ')', async t => {
    const f = fixture(t, 'normal', own), result = await disconnectInFlight({ host: f.host, guest: f.guest, hero: 'assigned', reconnect: f.reconnect });
    assert.equal(result.capture.before.flying, true); assert.equal(result.capture.after.entries, 0);
    assert.equal(f.players.captureHero, f.capture); assert.equal(Object.hasOwn(f.players, 'captureHero'), own); assert.equal(f.hostWindow.cancelNativeFlightDisconnect, undefined);
  });
  for (const [mode, message] of [['expired', /connection must close while its transfer is active/], ['not-releasing', /Host peer removal/], ['stuck', /strictly equal/], ['bad-rejoin', /deep-equal/]]) {
    test('mid-flight disconnect rejects ' + mode + ' and restores capture ownership (own=' + own + ')', async t => {
      const f = fixture(t, mode, own);
      await assert.rejects(disconnectInFlight({ host: f.host, guest: f.guest, hero: 'assigned', reconnect: f.reconnect }), message);
      assert.equal(f.players.captureHero, f.capture); assert.equal(Object.hasOwn(f.players, 'captureHero'), own); assert.equal(f.hostWindow.cancelNativeFlightDisconnect, undefined);
    });
  }
}
