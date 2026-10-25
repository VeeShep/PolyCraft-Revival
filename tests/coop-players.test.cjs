'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CoopPlayers } = require('../desktop/coop-players.js');
const { CoopData } = require('../desktop/coop-data.js');
const { emptyState } = require('../desktop/saves.cjs');
test('hero replacement removes only its owned in-flight projectiles before destroying owner components', () => {
  const calls = [], hero = { setToBeDestroyed: () => calls.push('hero') }, other = {};
  const projectile = owner => ({ getEC: () => ({ getOwner: () => owner }), setToBeDestroyed: () => calls.push('projectile') });
  const damage = (aggressor, victim) => ({ actionName: 'ApplyDamageToEntity', actionArguments: { aggressor, victim } });
  const retained = damage(other, other), effect = { actionName: 'SpecialEffect', actionArguments: {} };
  const actionManager = { actionList: [damage(hero, other), retained, effect], otherActionList: [damage(other, hero)] };
  CoopPlayers.prototype.destroy.call({ game: { actionManager, getGameSpaceList: () => [{ getEntitiesWithEC: () => [projectile(hero), projectile(other)], destroyDeadEntities: () => calls.push('destroy') }] } }, hero);
  assert.deepEqual(calls, ['projectile', 'hero', 'destroy']);
  assert.deepEqual(actionManager.actionList, [retained, effect]); assert.deepEqual(actionManager.otherActionList, []);
});
test('fixed session PvP allows registered hero-versus-hero damage only, preserving enemies, self-damage and environment behavior', () => {
  const entity = faction => ({ faction, shouldBeDestroyed: () => false, isFriendlyWith(other) { return faction === other.faction; } });
  const host = entity('players'), guest = entity('players'), worker = entity('players'), building = entity('players');
  const enemy = entity('enemies'), otherEnemy = entity('enemies');
  for (const pvp of [false, true]) {
    const players = Object.create(CoopPlayers.prototype);
    players.game = { globals: { desktopWorld: { transport: { pvp } } } };
    players.registry = { data: { host: 'host' } }; players.active = new Map([['host', { hero: host }], ['guest', { hero: guest }]]);
    assert.equal(players.canDamage(host, guest), pvp); assert.equal(players.canDamage(guest, host), pvp);
    for (const target of [worker, building]) { assert.equal(players.canDamage(target, host), false); assert.equal(players.canDamage(host, target), false); }
    assert.equal(players.canDamage(enemy, host), true); assert.equal(players.canDamage(host, enemy), true);
    assert.equal(players.canDamage(otherEnemy, enemy), true, 'Enemy-versus-enemy rules remain original');
    assert.equal(players.canDamage(host, host), true); assert.equal(players.canDamage(host, null), true);
    assert.equal(players.canDamage(host, { shouldBeDestroyed: () => true }), false);
  }
});
test('unknown imported weapons and held construction are rejected before touching the solo hero, inventory or save', () => {
  for (const busy of [false, true]) {
    const state = emptyState(), registry = new CoopData(state);
    registry.data.players[0].inventory.weapon = 'wp_h_unknown'; registry.persist();
    const before = JSON.stringify(state);
    let destroyed = false;
    const builder = { isBuilding: () => busy, isThrowing: () => false };
    const hero = { getEC: name => name === 'ECPlayerBuilder' ? builder : { getWeaponDefinition: () => undefined }, setToBeDestroyed: () => { destroyed = true; } };
    const game = { getHero: () => hero, globals: { gamePurchaseManager: {} } }, bridge = { state };
    assert.throws(() => new CoopPlayers(game, bridge), busy ? /Finish placing/ : /Unknown saved hero weapon/);
    assert.equal(destroyed, false); assert.equal(game.desktopPlayers, undefined); assert.equal(bridge.coopEconomy, undefined);
    assert.equal(JSON.stringify(state), before);
  }
});
test('ending co-op refuses to destroy an in-flight construction or change ownership while unsettled', () => {
  let captured = false;
  const players = { active: new Map([['guest', { hero: {} }]]), capture: () => { captured = true; },
    requireSettled: () => { throw new Error('Finish placing'); } };
  assert.throws(() => CoopPlayers.prototype.close.call(players), /Finish placing/);
  assert.equal(captured, false); assert.equal(players.active.size, 1); assert.equal(players.closed, undefined);
});

test('co-op capture preflights every hero before snapshots or persistence, protecting held purchases and in-flight construction', () => {
  for (const blocked of ['throwing', 'purchase', null]) {
    let snapshots = 0, writes = 0;
    const players = Object.create(CoopPlayers.prototype);
    players.game = { globals: { gamePurchaseManager: { consumeBuildingInProgress: blocked === 'purchase' } } };
    const hero = busy => ({ getEC: () => ({ isBuilding: () => busy && blocked === 'held', isThrowing: () => busy && blocked === 'throwing' }) });
    players.active = new Map([['host', { hero: hero(false) }], ['guest', { hero: hero(true) }]]);
    const records = new Map([['host', { location: [1, 2, 3] }], ['guest', { location: [4, 5, 6] }]]);
    players.registry = { data: { economy: {} }, player: id => records.get(id), persist: () => { writes++; } };
    players.captureHero = () => { snapshots++; return { location: [9, 9, 9] }; };
    const before = JSON.stringify([...records]);
    if (blocked) {
      assert.throws(() => players.capture(), /Finish placing/);
      assert.equal(snapshots, 0, 'Even an earlier idle hero must not be captured before every builder is safe');
      assert.equal(writes, 0); assert.equal(JSON.stringify([...records]), before);
    } else {
      players.capture(); assert.equal(snapshots, 2); assert.equal(writes, 1);
      assert.deepEqual(records.get('guest').location, [9, 9, 9]);
    }
  }
});

function heldFixture() {
  const runtime = require('./runtime-ast.cjs');
  const original = runtime.component('ECPlayerBuilder');
  const events = [], sounds = [], payments = [], visuals = [];
  const entity = name => ({ getName: () => name, getSmartPointer() { return { get: () => this }; }, shouldBeDestroyed() { return !!this.destroyed; },
    getEC: key => key === 'ECBuilding' ? {} : key === 'ECFaction' ? { getFactionName: () => 'hero' } : null });
  const references = new Map(['HQ_1', 'Wall_1'].map(name => [name, entity(name)]));
  const definition = { buildingType: 'Wall', stackable: false, canPlaceAnywhere: false, mustPlaceNearCreator: false };
  const factory = { getECArchetype: (name, key) => name === 'a_b_wall' && key === 'ECBuilding' ? definition : null,
    getObjectBuildBuffer: () => 0, getv3ObjectFootprintExtents: () => [1, 1, 1], getBuildingMaxLinePlacementLength: () => 10 };
  const game = { globals: { gamePurchaseManager: {} }, eventManager: { notify: (...args) => events.push(args) }, getEntityFactory: () => factory,
    getGameEntityByName: name => references.get(name), getFactionManager: () => ({ getHeroFactionName: () => 'hero' }),
    getGameSpaceList: () => [], actionManager: { actionList: [], otherActionList: [] } };
  const players = Object.create(CoopPlayers.prototype); players.game = game;
  function actor() {
    const data = { adjustResource: (...args) => payments.push(args), adjustSoftCurrency: (...args) => payments.push(args) };
    const hero = { getEC: key => key === 'ECPlayerBuilder' ? builder : key === 'ECPlayerData' ? data : null, setToBeDestroyed() { this.destroyed = true; } };
    const builder = { ...original, entity: hero, gameManager: game, globals: { gameManager: game, gameCurrentTime: 0 }, heldItemQuantity: 0, throwing: 0,
      playSound: name => sounds.push(name), getEntityEC: key => hero.getEC(key),
      createAndStoreHeldEntity() { this.heldEntity = { setToBeDestroyed() { visuals.push('removed'); } }; visuals.push('created'); } };
    return { hero, builder };
  }
  return { players, game, actor, references, events, sounds, payments, visuals };
}
function heldRecord(change = {}) {
  return { archetype: 'a_b_wall', quantity: 3, instant: false, infinite: false, isNew: true, cannotCancel: true, payWhenPlacing: false, parent: 'HQ_1', moveFrom: null, lastPlaced: null, ...change };
}
test('real original builder methods round-trip prepaid quantities, repeat blueprints and moved buildings without payments or EmptyHanded', () => {
  for (const held of [heldRecord(), heldRecord({ quantity: 1, infinite: true, cannotCancel: false, payWhenPlacing: true, lastPlaced: [5, 0, 6] }), heldRecord({ quantity: 1, instant: true, isNew: false, cannotCancel: false, moveFrom: 'Wall_1' })]) {
    const f = heldFixture(), first = f.actor();
    f.players.restoreConstruction(first.hero, held);
    assert.deepEqual(f.players.captureConstruction(first.hero), held);
    assert.equal(first.builder.heldItemQuantity, held.quantity);
    f.players.destroy(first.hero);
    assert.equal(first.hero.destroyed, true); assert.equal(first.builder.heldEntity, undefined);
    const returned = f.actor(); f.players.restoreConstruction(returned.hero, structuredClone(held));
    assert.deepEqual(f.players.captureConstruction(returned.hero), held);
    assert.deepEqual(f.events, []); assert.deepEqual(f.payments, []);
    assert.deepEqual(f.visuals, ['created', 'removed', 'created']);
  }
});
test('held restore rejects unknown assets and missing, dead or foreign references before touching the live builder', () => {
  for (const kind of ['unknown', 'missing', 'dead', 'foreign']) {
    const f = heldFixture(), { hero, builder } = f.actor();
    const held = heldRecord(kind === 'unknown' ? { archetype: 'unknown_building' } : {});
    if (kind === 'missing') f.references.delete('HQ_1');
    if (kind === 'dead') f.references.get('HQ_1').destroyed = true;
    if (kind === 'foreign') f.references.get('HQ_1').getEC = key => key === 'ECBuilding' ? {} : { getFactionName: () => 'enemy' };
    assert.throws(() => f.players.restoreConstruction(hero, held), /Unknown saved|reference is unavailable/);
    assert.equal(builder.isBuilding(), false); assert.equal(builder.heldItemQuantity, 0);
    assert.deepEqual(f.visuals, []); assert.deepEqual(f.events, []); assert.deepEqual(f.payments, []);
  }
});
test('held capture still refuses in-flight throws and pending shop consumption', () => {
  const f = heldFixture(), { hero, builder } = f.actor();
  f.players.restoreConstruction(hero, heldRecord());
  builder.throwing = 1; assert.throws(() => f.players.captureConstruction(hero), /thrown building/);
  builder.throwing = 0; f.game.globals.gamePurchaseManager.consumeBuildingInProgress = true;
  assert.throws(() => f.players.captureConstruction(hero), /shop requests/);
  f.game.globals.gamePurchaseManager.consumeBuildingInProgress = false;
  assert.deepEqual(f.players.captureConstruction(hero), heldRecord());
});

test('restoring a saved host building queue subscribes once and consumes nothing until the host is actually empty-handed', () => {
  const runtime = require('./runtime-ast.cjs');
  let hero, callback, subscriptions = 0, requests = 0;
  const game = { globals: {}, setHero: value => { hero = value; }, getHero: () => hero, desktopPlayers: {},
    eventManager: { subscribe: (event, value) => { assert.equal(event, 'EmptyHanded'); callback = value; subscriptions++; }, unsubscribe() {} } };
  const purchase = { globals: { gameManager: game }, requestConsumeOnBuildingPlacement: runtime.method('requestConsumeOnBuildingPlacement'),
    removeConsumeOnBuildingPlacement() { this.onEmptyHandedCallback = undefined; }, createPlaceableBuildings: () => { requests++; } };
  game.globals.gamePurchaseManager = purchase;
  const players = Object.create(CoopPlayers.prototype); players.game = game; players.active = new Map(); players.solo = { model: {}, name: 'Host' };
  const record = { inventory: { weapon: null, mainWeapon: null } };
  players.registry = { data: { host: 'host', economy: { pendingPlacements: true } }, player: () => record, createPlayerData: () => ({}) };
  players.spawn = () => ({});
  players.add('host'); assert.equal(subscriptions, 1); assert.equal(requests, 0);
  callback({ entity: {} }); assert.equal(requests, 0); assert.equal(subscriptions, 1);
  callback({ entity: hero }); assert.equal(requests, 1); assert.equal(purchase.onEmptyHandedCallback, undefined);
});

test('capture, guest removal and reattachment preserve held inventory without clearing it or replaying payment', () => {
  const f = heldFixture(), state = emptyState(), registry = new CoopData(state), guest = registry.addPlayer('Returning builder');
  class Model { init(globals) { this.globals = globals; } }
  const solo = new Model(); solo.init(f.game.globals);
  f.players.solo = { model: solo, name: 'Host' }; f.players.registry = registry;
  const first = f.actor(); f.players.restoreConstruction(first.hero, heldRecord());
  f.players.active = new Map([[guest.id, { hero: first.hero }]]);
  f.players.captureHero = hero => ({ location: [1, 2, 3], construction: f.players.captureConstruction(hero) });
  f.players.spawn = record => { const next = f.actor(); f.players.restoreConstruction(next.hero, record.construction); return next.hero; };
  f.players.capture(); assert.deepEqual(new CoopData(state).player(guest.id).construction, heldRecord());
  f.players.pendingRefresh = new Set([guest.id]);
  f.players.remove(guest.id); assert.equal(f.players.pendingRefresh.has(guest.id), false);
  const returning = f.players.add(guest.id); assert.notEqual(returning, first.hero);
  f.players.capture(); assert.deepEqual(new CoopData(state).player(guest.id).construction, heldRecord());
  assert.deepEqual(f.events, []); assert.deepEqual(f.payments, []);
});

test('ending co-op captures held inventory, removes only its visual and restores the separate solo hero', () => {
  const f = heldFixture(), state = emptyState(), registry = new CoopData(state), first = f.actor();
  const soloItems = {}, soloModel = {};
  f.players.registry = registry; f.players.bridge = { state, coopEconomy: registry.data.economy, basket: {} };
  f.players.solo = { model: soloModel, name: 'Solo', archetype: 'solo', record: { construction: null }, crown: false, owned: {}, items: soloItems, basket: {} };
  f.game.globals.storeManager = { userItems: registry.data.economy.userItems };
  f.game.desktopPlayers = f.players; f.game.setHero = hero => { f.game.hero = hero; };
  f.players.restoreConstruction(first.hero, heldRecord());
  f.players.active = new Map([[registry.data.host, { hero: first.hero }]]);
  f.players.captureHero = hero => ({ location: [1, 2, 3], construction: f.players.captureConstruction(hero) });
  f.players.spawn = record => { const actor = f.actor(); f.players.restoreConstruction(actor.hero, record.construction); return actor.hero; };
  f.players.close();
  assert.equal(f.players.closed, true); assert.equal(f.players.active.size, 0);
  assert.deepEqual(new CoopData(state).data.players[0].construction, heldRecord());
  assert.equal(first.hero.destroyed, true); assert.equal(f.game.hero.getEC('ECPlayerBuilder').isBuilding(), false);
  assert.equal(f.game.playerData, soloModel); assert.equal(f.game.globals.storeManager.userItems, soloItems);
  assert.equal(f.game.desktopPlayers, undefined); assert.equal(f.players.bridge.coopEconomy, undefined);
  assert.deepEqual(f.events, []); assert.deepEqual(f.payments, []);
});
