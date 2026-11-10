'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const incomingDisconnect = require('./coop-incoming-disconnect.cjs');

function fixture(t, mode, own) {
  const prior = global.window; t.after(() => { if (prior === undefined) delete global.window; else global.window = prior; });
  t.mock.method(console, 'log', () => {});
  const actor = makeActor([95, 0], [10, 0]), node = { getName: () => 'pickup', getEC: () => ({ getCollectorName: () => 'hero', flyingTween: {}, archetype: { carriedResource: [10, 0] } }) };
  function makeActor(carried, inbound) {
    const carrier = { carried, inbound, getResource: type => carried[type], getInboundResource: type => inbound[type], getResourceCap: () => 100 };
    const health = { current: 25, getHealth() { return this.current; }, getMaxHealth: () => 50 };
    const ecs = { ECResourceCarrier: carrier, ECHealth: health, ECInventory: { getHeldWeapon: () => 'starter' }, ECFirearm: { mainWeaponName: 'starter', getAmmo: () => 2, temporaryWeaponAmmo: 0 } };
    return { getName: () => 'hero', getEC: name => ecs[name] };
  }
  const slot = { connection: { closed: false }, releasing: false };
  const manager = { actionList: [], otherActionList: [], actionFunctionMap: { GivePickup(args) {
    const c = args.collector.getEC('ECResourceCarrier'); c.carried[0] = mode === 'lost' ? 95 : 100;
    if (mode !== 'stuck') c.inbound[0] = 0;
  } } };
  let saved;
  const capture = function (entity) {
    assert.equal(this, players); manager.actionFunctionMap.GivePickup({ collector: entity, pickup: node });
    if (mode === 'duplicate') manager.actionFunctionMap.GivePickup({ collector: entity, pickup: node });
    return { inventory: { weapon: 'starter', mainWeapon: 'starter', ammo: 2, temporaryAmmo: 0, carried: [...entity.getEC('ECResourceCarrier').carried] }, health: { current: 25, maximum: 50 } };
  };
  const restore = function (entity, record) {
    assert.equal(this, players); entity.getEC('ECResourceCarrier').carried.splice(0, 2, ...record.inventory.carried);
    if (mode === 'bad-restore') entity.getEC('ECResourceCarrier').carried[0]--;
    if (mode === 'bad-health') entity.getEC('ECHealth').current = 26;
  };
  const players = Object.assign(Object.create({ captureHero: capture, restoreHero: restore }), { active: new Map([['assigned', { hero: actor }]]), registry: { player: () => saved } });
  if (own) { players.captureHero = capture; players.restoreHero = restore; }
  const hostWindow = { hostWorld: { players, guestSlots: new Map([['assigned', slot]]), game: { actionManager: manager, gameClock: { getFrameIndex: () => 10 }, getGameSpaceList: () => [{ getEntitiesWithEC: () => [node] }] } } };
  const guestWindow = { polycraft: { controls: { guestWorld: {} } }, connection: { closed: false, close() {
    this.closed = slot.connection.closed = true; slot.releasing = mode !== 'not-releasing';
    if (mode === 'missed') actor.getEC('ECResourceCarrier').inbound[0] = 0;
    saved = { id: 'assigned', ...players.captureHero(actor) }; players.active.delete('assigned'); hostWindow.hostWorld.guestSlots.delete('assigned'); guestWindow.polycraft.controls.guestWorld = null;
  } } };
  const run = async (state, callback, arg) => { const before = global.window; global.window = state; try { return structuredClone(await callback(arg)); } finally { global.window = before; } };
  const host = { evaluate: (callback, arg) => run(hostWindow, callback, arg), async waitForFunction(callback, arg) { assert.ok(await run(hostWindow, callback, arg)); } };
  const guest = { evaluate: (callback, arg) => run(guestWindow, callback, arg), async waitForFunction(callback, arg) { assert.ok(await run(guestWindow, callback, arg)); } };
  const reconnect = async () => {
    const rejoined = makeActor([0, 0], [0, 0]); await run(hostWindow, () => players.restoreHero(rejoined, saved)); players.active.set('assigned', { hero: rejoined });
    if (mode === 'late-restore') await run(hostWindow, () => players.restoreHero(rejoined, { ...saved, inventory: { ...saved.inventory, carried: [90, 0] } }));
  };
  if (mode === 'expired') actor.getEC('ECResourceCarrier').inbound[0] = 0;
  return { host, guest, hero: 'assigned', reconnect, players, capture, restore, manager, grant: manager.actionFunctionMap.GivePickup, hostWindow };
}

for (const own of [false, true]) for (const mode of ['normal', 'late-restore', 'expired', 'missed', 'not-releasing', 'stuck', 'lost', 'duplicate', 'bad-restore', 'bad-health']) {
  test('incoming observer ' + mode + ' preserves method ownership=' + own, async t => {
    const f = fixture(t, mode, own), observer = await incomingDisconnect(f);
    try {
      if (mode === 'normal' || mode === 'late-restore') {
        await observer.attempt(); observer.finish(); await observer.attempt();
        assert.deepEqual(f.hostWindow.nativeIncomingDisconnect.capture.after.carried, [100, 0]);
        assert.equal(f.hostWindow.nativeIncomingDisconnect.grants.length, 1);
      } else if (mode === 'expired') {
        await observer.attempt(); assert.throws(() => observer.finish(), /must actually interrupt/);
        assert.equal(f.hostWindow.nativeIncomingDisconnect.requested, null);
      } else await assert.rejects(observer.attempt(), error => error.code === 'ERR_ASSERTION');
    } finally { await observer.close(); }
    assert.equal(f.players.captureHero, f.capture); assert.equal(f.players.restoreHero, f.restore);
    for (const method of ['captureHero', 'restoreHero']) assert.equal(Object.hasOwn(f.players, method), own);
    assert.equal(f.manager.actionFunctionMap.GivePickup, f.grant);
    assert.equal(f.hostWindow.sampleIncomingDisconnect, undefined); assert.equal(f.hostWindow.restoreIncomingDisconnect, undefined);
  });
}
