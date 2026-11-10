'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs'), { CoopPlayers } = require('../desktop/coop-players.js');

function fixture(archetype) {
  const active = [], tweens = ast.visualEffectMethods([]).tweens;
  tweens.add = tween => active.push(tween); tweens.remove = tween => { const i = active.indexOf(tween); if (i >= 0) active.splice(i, 1); }; tweens.getAll = () => active;
  const math = { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)), v3Copy: v => [...v], v3Lerp(a, b, n, out) { a.forEach((v, i) => { out[i] = v + (b[i] - v) * n; }); return out; } };
  const globals = { mathDevice: math, gameCurrentTime: 0, appCurrentTime: 0, gameTimeStep: 1 / 60, gamePurchaseManager: { consumeBuildingInProgress: false } };
  tweens.globals = globals;
  const native = ast.pickupMethods(tweens), entities = new Map(), nodes = [], bank = [0, 0], events = [], progress = { xp: 0 }, record = {};
  const data = { adjustResource: (type, amount) => { bank[type] += amount; }, adjustXP: amount => { progress.xp += amount; } };
  const carrier = Object.assign(Object.create(ast.resourceCarrierMethods(tweens)), { globals, resource: [0, 0], inboundResource: [0, 0], maxResource: [100, 100], addedMaxBlocks: 0, resourcesPerBlock: [10, 10], playSound() {}, setToUpdate() {}, adjustResourceEntities() {}, flyingTweens: [], numFlyingResourceBlocks: 0 });
  const actor = { name: 'assigned-hero', location: [0, 0, 0], destroyed: false, getName() { return this.name; }, getv3Location() { return this.location; }, getRotationY: () => 0, isManagedByThisMachine() { return !this.destroyed; },
    getEC(name) { return this.destroyed ? null : this.components[name]; }, components: { ECResourceCarrier: carrier, ECHealth: { getHealth: () => 50, getMaxHealth: () => 50 }, ECPlayerData: data,
      ECFirearm: { mainWeaponName: null, getAmmo: () => 0 }, ECInventory: { getHeldWeapon: () => null }, ECPlayerBuilder: { isBuilding: () => false, isThrowing: () => false } } };
  const space = { getEntitiesWithEC: name => name === 'ECPickup' ? nodes : [] };
  const game = { globals, getGameSpaceList: () => [space], getGameEntityByName: name => entities.get(name), getGuiManager: () => ({ addXpBubble() {} }), eventManager: { notify: (...args) => events.push(args) } };
  game.actionManager = native.createActionManager(globals, game);
  const makePickup = (type = archetype) => {
    let pickup;
    const mesh = { getScale: () => 1, setScale() {}, addRotationY() {} };
    const node = { name: 'original-pickup-' + nodes.length, archetypeName: type, location: [2, 0, 0], dead: false, getName() { return this.name; }, getv3Location() { return this.location; }, getEC: name => name === 'ECPickup' ? pickup : null, setToBeDestroyed() { this.dead = true; }, shouldBeDestroyed() { return this.dead; } };
    const definition = ast.archetypeComponent(type, 'ECPickup');
    pickup = Object.assign(Object.create(native.pickup), { entity: node, gameManager: game, globals, archetype: { health: 0, resource: [0, 0], softCurrency: 0, ...definition }, xp: 0, attractDuration: 0.2, beginCollectScale: 1.25,
      getv3Location: () => node.location, getEntityEC: name => name === 'ECMesh' ? mesh : null, isManagedByThisMachine: () => true });
    nodes.push(node); entities.set(node.name, node); return { pickup, node };
  };
  const { pickup, node } = makePickup(); entities.set(actor.name, actor);
  const players = Object.assign(Object.create(CoopPlayers.prototype), { game, active: new Map([['guest', { hero: actor, model: progress }]]), pendingRefresh: new Set(), registry: { data: { host: 'host' }, player: () => record, persist: () => events.push('persist') }, captureConstruction: () => null, captureLife: () => null });
  const capture = () => players.captureHero(actor);
  const finish = () => { for (const tween of [...active]) { tween.update(10000, 10000); tweens.remove(tween); } game.actionManager.update(); };
  return { pickup, carrier, actor, node, game, active, bank, events, progress, record, data, players, entities, makePickup, capture, finish, remove() { actor.destroyed = true; entities.delete(actor.name); } };
}

for (const phase of ['claimed', 'flying', 'queued']) test('co-op capture retains original incoming resource exactly once in ' + phase + ' phase', () => {
  for (const name of ['a_r_lumber', 'a_r_lumber_large', 'a_r_stone', 'a_r_stone_large']) {
    const f = fixture(name), expected = Array.from(f.pickup.archetype.carriedResource);
    f.pickup.storeCollector(f.actor);
    if (phase === 'flying') f.pickup.beginFly();
    if (phase === 'queued') { f.pickup.givePickupIfCollector(); f.node.setToBeDestroyed(); }
    assert.equal(f.carrier.hasAnyInboundResource(), true);
    const record = f.capture();
    assert.deepEqual(record.inventory.carried, expected, name);
    assert.deepEqual(f.carrier.inboundResource, [0, 0]); assert.equal(f.node.dead, true); assert.equal(f.active.length, 0);
    f.capture(); f.remove(); f.finish();
    assert.deepEqual(record.inventory.carried, expected); assert.deepEqual(f.carrier.resource, expected); assert.deepEqual(f.bank, [0, 0]);
  }
});

test('incoming resource capture preserves other owners, unclaimed pickups and unrelated queue ordering', () => {
  const f = fixture('a_r_lumber'), manager = f.game.actionManager, order = [];
  manager.registerAction('Other', value => order.push(value)); manager.addAction('Other', 'first');
  f.pickup.storeCollector(f.actor); f.pickup.givePickupIfCollector(); f.node.setToBeDestroyed(); manager.addAction('Other', 'second');
  const next = f.makePickup(); next.pickup.storeCollector(f.actor); next.pickup.givePickupIfCollector(); next.node.setToBeDestroyed();
  manager.otherActionList.push(manager.actionList.pop()); manager.otherActionList.push({ actionName: 'Other', actionArguments: 'third' });
  const otherCarrier = Object.assign(Object.create(Object.getPrototypeOf(f.carrier)), { ...f.carrier, resource: [0, 0], inboundResource: [0, 0] });
  const other = { ...f.actor, name: 'other-hero', components: { ...f.actor.components, ECResourceCarrier: otherCarrier } }; f.entities.set(other.name, other);
  const foreign = f.makePickup(); foreign.pickup.storeCollector(other); foreign.pickup.beginFly(); const untouched = f.makePickup();
  assert.deepEqual(f.capture().inventory.carried, [10, 0]); assert.deepEqual(f.carrier.inboundResource, [0, 0]);
  assert.deepEqual(Array.from(manager.actionList, action => action.actionArguments), ['first', 'second']);
  assert.deepEqual(Array.from(manager.otherActionList, action => action.actionArguments), ['third']);
  assert.equal(foreign.pickup.getCollectorName(), other.name); assert.equal(foreign.node.dead, false); assert.equal(f.active.length, 1);
  assert.equal(untouched.pickup.getCollectorName(), undefined); assert.equal(untouched.node.dead, false);
  f.finish(); manager.update(); assert.deepEqual(order, ['first', 'second', 'third']);
  assert.deepEqual(otherCarrier.resource, [5, 0]); assert.deepEqual(f.carrier.resource, [10, 0]); assert.deepEqual(f.bank, [0, 0]);
});
test('a partial native grant failure blocks capture/removal and cannot replay the dequeued payment', () => {
  const f = fixture('a_r_lumber'), error = new Error('Native held-resource visual failed'), adjust = f.carrier.adjustResource;
  f.pickup.storeCollector(f.actor); f.pickup.givePickupIfCollector(); f.node.setToBeDestroyed();
  f.carrier.adjustResource = function (...args) { adjust.apply(this, args); throw error; };
  let destroyed = 0; f.players.destroy = () => { destroyed++; };
  assert.throws(f.capture, reason => reason === error); assert.deepEqual(f.carrier.resource, [5, 0]);
  assert.throws(f.capture, reason => reason === error); assert.throws(() => f.players.remove('guest'), reason => reason === error);
  f.finish(); assert.deepEqual(f.carrier.resource, [5, 0]); assert.deepEqual(f.carrier.inboundResource, [5, 0]);
  assert.equal(destroyed, 0); assert.equal(f.players.active.has('guest'), true); assert.deepEqual(f.record, {}); assert.deepEqual(f.events, []);
});
test('native XP level-up waits for the rest of its action batch to deliver incoming resources before hero replacement', () => {
  const f = fixture('a_r_lumber'), manager = f.game.actionManager;
  const xp = f.makePickup(); xp.pickup.archetype.carriedResource = [0, 0]; xp.pickup.xp = 100;
  Object.assign(f.data, { adjustXP: ast.component('ECPlayerData').adjustXP, entity: f.actor, gameManager: f.game, globals: f.game.globals,
    getVisibleXP: () => f.progress.xp, getLevel: () => 1 + Math.floor(f.progress.xp / 100), getv3Location: f.actor.getv3Location.bind(f.actor), playerData: { addXP: amount => { f.progress.xp += amount; } }, onLevelUp() {}, saveProgress() {}, autoSaveProgress() {} });
  f.game.desktopPlayers = f.players; f.game.refreshHeroEntity = ast.method('refreshHeroEntity');
  xp.pickup.storeCollector(f.actor); xp.pickup.givePickupIfCollector(); xp.node.setToBeDestroyed();
  f.pickup.storeCollector(f.actor); f.pickup.givePickupIfCollector(); f.node.setToBeDestroyed();
  manager.update();
  assert.equal(f.progress.xp, 100); assert.deepEqual(f.carrier.resource, [5, 0]); assert.deepEqual(f.carrier.inboundResource, [0, 0]);
  assert.equal(f.players.pendingRefresh.has('guest'), true); assert.deepEqual(f.events, []);
  f.players.destroy = () => { assert.equal(manager.actionList.length, 0); f.events.push('destroy'); };
  f.players.spawn = record => { assert.deepEqual(record.inventory.carried, [5, 0]); f.events.push('spawn'); return f.actor; };
  f.players.flushRefreshes(); assert.deepEqual(f.events, ['destroy', 'spawn', 'persist']); assert.equal(f.players.pendingRefresh.size, 0);
});
test('incoming settlement preserves the original carrying cap', () => {
  const f = fixture('a_r_lumber_large'); f.carrier.resource[0] = 95; f.pickup.storeCollector(f.actor); f.pickup.beginFly();
  assert.deepEqual(f.capture().inventory.carried, [100, 0]); assert.deepEqual(f.carrier.inboundResource, [0, 0]); f.finish();
  assert.deepEqual(f.carrier.resource, [100, 0]); assert.deepEqual(f.bank, [0, 0]);
});
test('mixed resource/XP pickups wait for normal completion rather than forcing a refresh during capture', () => {
  const f = fixture('a_r_lumber'); f.pickup.xp = 1; f.pickup.storeCollector(f.actor); f.pickup.beginFly();
  assert.throws(f.capture, /Finish collecting incoming rewards/); assert.equal(f.players.incomingResourceFailures?.has(f.actor) || false, false);
  assert.deepEqual(f.carrier.resource, [0, 0]); assert.deepEqual(f.carrier.inboundResource, [5, 0]); assert.equal(f.node.dead, false);
  f.finish(); assert.deepEqual(f.capture().inventory.carried, [5, 0]); assert.equal(f.progress.xp, 1);
});
test('all four original carried-resource pickups have no XP/item/health/currency grant side effects', () => {
  for (const name of ['a_r_lumber', 'a_r_lumber_large', 'a_r_stone', 'a_r_stone_large']) {
    const definition = ast.archetypeComponent(name, 'ECPickup'); assert.equal(Array.from(definition.carriedResource).some(amount => amount > 0), true);
    for (const field of ['xp', 'item', 'health', 'cost', 'softCurrency']) assert.equal(Boolean(definition[field]), false, name + '.' + field);
    assert.equal(definition.resource?.some(Boolean) || false, false);
  }
});

test('a failed native completion stops its animation and cannot restart or replay the queued grant', () => {
  const f = fixture('a_r_lumber'), error = new Error('Native pickup action could not be queued');
  f.pickup.storeCollector(f.actor); f.pickup.beginFly(); let attempts = 0;
  f.game.actionManager.addAction = () => { attempts++; throw error; };
  assert.throws(f.capture, reason => reason === error);
  assert.equal(f.active.length, 0); assert.equal(Boolean(f.pickup.flyingTween), true);
  f.pickup.beginFlyIfNeeded(); f.finish(); assert.throws(f.capture, reason => reason === error);
  assert.equal(attempts, 1); assert.deepEqual(f.carrier.resource, [0, 0]); assert.deepEqual(f.carrier.inboundResource, [5, 0]);
  assert.equal(f.node.dead, false); assert.deepEqual(f.bank, [0, 0]);
});
