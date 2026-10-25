'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs');
const { HostConstruction } = require('../desktop/coop-construction.js');
const { HostActions } = require('../desktop/coop-actions.js');
const original = ast.component('ECUpgradable', { H: { LUMBER: 0, STONE: 1 } }), upgradeRuntime = ast.component('ECUpgrader', { H: { LUMBER: 0, STONE: 1 } });
function fixture() {
  const state = { friendly: true, faction: 'hero', health: 10, enabled: true, broken: false, prereq: true, count: 0, held: false, throwing: false, locked: false }, funds = [100, 100], charges = [], events = [];
  const components = { ECHealth: { getHealth: () => 10 }, ECBuilding: { getCanMove: () => false }, ECFaction: { getFactionName: () => state.faction } };
  const source = { getName: () => 'HQ_1', getArchetypeName: () => 'hq', getEC: name => components[name], shouldBeDestroyed: () => !!state.destroyed, isFriendlyWith: () => state.friendly };
  const flags = { buildingUpgradesEnabled: true, repairingEnabled: true };
  components.ECRadialMenu = Object.assign(Object.create(ast.component('ECRadialMenu', { Sb: flags })), { isRadialMenuEnabled: () => state.enabled, getEntityEC: name => components[name], isRepairButtonExclusive: () => state.broken });
  const builder = { isBuilding: () => state.held, isThrowing: () => state.throwing, getMoveFromEntity: () => null };
  const hero = { shouldBeDestroyed: () => false, getEC: name => name === 'ECPlayerBuilder' ? builder : name === 'ECHealth' ? { getHealth: () => state.health } : name === 'ECPlayerData' ? { getResource: index => funds[index], adjustResource(index, value) { funds[index] += value; charges.push([index, value]); } } : name === 'ECWildlingLeader' ? { onUpgradeStarted: entity => { assert.equal(entity, source); state.assigned = true; } } : null }; builder.entity = hero;
  const manager = { getRemainingBuildingsBeforeCap: () => 10, getNumScaffoldsForCap: () => state.count, canCreateBuilding: () => state.prereq && state.count < 1, hasReachedScaffoldCap: () => state.count >= 1, upgraderAdded: () => { state.count++; }, upgraderRemoved: () => { state.count--; } };
  const game = { desktopPlayers: { active: new Map([['guest', { hero }]]), registry: { data: { players: [] } } }, getGameEntityByName: name => name === 'HQ_1' ? source : null, isScriptLocked: () => state.locked, getBuildingManager: () => manager, getFactionManager: () => ({ getHeroFactionName: () => 'hero' }), eventManager: { notify: (...value) => events.push(value) } };
  const upgrade = Object.assign(Object.create(original), { entity: source, gameManager: game, getEntityEC: name => components[name], archetype: { radialMenu: true, upgradeArchetypeName: 'hq2', upgradeName: 'Level 2', maxNearbyEntitiesToUpgrade: 1 }, resourceCost: 20, secondaryResourceCost: 30, softCurrencyCost: 0, buildTime: 10, upgradeTime: 10, scaffoldType: 'normal', obeysScaffoldCap: true, prerequisites: [] });
  const upgrader = Object.assign(Object.create(upgradeRuntime), { entity: source, gameManager: game, getEntityEC: name => components[name], globals: { gameManager: game, mathDevice: { saturate: value => Math.max(0, Math.min(1, value)) } }, archetype: { upgradeSpeed: 1 }, startedUpgrading: false, upgradeComplete: 0, extraUpgradeTimeThisFrame: 0, setToUpdate() {}, setToDraw() {}, createScaffoldMesh() { state.mesh = true; }, destroyScaffoldMesh() { state.mesh = false; } });
  components.ECUpgradable = upgrade; components.ECUpgrader = upgrader;
  const construction = new HostConstruction(game), actions = new HostActions();
  const send = (sequence, type = 'upgradeBuilding', next = 'hq2', costs = [20, 30]) => { actions.receive({ type, sequence, target: 'HQ_1', next, ...(type === 'upgradeBuilding' ? { costs } : { episode: construction.upgradeInfo(hero, source)?.episode || 1 }) }); return actions.apply(game, hero, game.desktopPlayers); };
  return { state, flags, funds, charges, events, source, hero, components, game, upgrade, upgrader, construction, actions, send };
}
test('guest upgrade uses actual original payment/start, assigned workers, cap registration, serializable progress and half-refund cancellation', () => {
  const f = fixture(), info = f.construction.upgradeInfo(f.hero, f.source);
  assert.equal(info.valid, true); assert.deepEqual(info.resources, [100, 100]);
  assert.equal(f.send(1).save, true); assert.deepEqual(f.funds, [80, 70]); assert.equal(f.state.count, 1); assert.equal(f.state.assigned, true); assert.equal(f.state.mesh, true);
  assert.equal(f.send(2).save, undefined); assert.deepEqual(f.funds, [80, 70]);
  f.upgrader.updateUpgradingProgress(2); const saved = f.upgrader.saveSerialize();
  assert.equal(saved.startedUpgrading, true); assert.equal(saved.upgradeComplete, 0.2); assert.equal(saved.upgradedArchetypeName, 'hq2'); assert.equal(f.upgrader.getUpgradeTimeRemaining(), 8);
  assert.equal(f.send(3, 'cancelUpgrade').save, true); assert.deepEqual(f.funds, [90, 85]); assert.equal(f.state.count, 0); assert.equal(f.state.mesh, false);
  assert.equal(f.send(4, 'cancelUpgrade').save, undefined); assert.deepEqual(f.funds, [90, 85]); f.construction.close();
});
test('upgrade rechecks quote, definition, funds, prerequisites, cap and actor/source restrictions before payment', () => {
  for (const failure of ['price', 'next', 'funds', 'prereq', 'cap', 'flag', 'disabled', 'broken', 'destroyed', 'enemy', 'ally', 'held', 'throwing', 'dead', 'script', 'claim', 'research']) {
    const f = fixture();
    if (failure === 'price') f.upgrade.resourceCost++; if (failure === 'funds') f.funds[0] = 0; if (failure === 'prereq') f.state.prereq = false; if (failure === 'cap') f.state.count = 1;
    if (failure === 'flag') f.flags.buildingUpgradesEnabled = false; if (failure === 'disabled') f.state.enabled = false; if (failure === 'broken') f.state.broken = true; if (failure === 'destroyed') f.state.destroyed = true;
    if (failure === 'enemy') f.state.friendly = false; if (failure === 'ally') f.state.faction = 'allied-npc'; if (failure === 'held') f.state.held = true; if (failure === 'throwing') f.state.throwing = true;
    if (failure === 'dead') f.state.health = 0; if (failure === 'script') f.state.locked = true;
    if (failure === 'claim') f.game.desktopPlayers.registry.data.players.push({ id: 'offline', construction: { moveFrom: 'HQ_1' } });
    if (failure === 'research') f.components.ECCapDispenser = { isResearching: () => true };
    assert.equal(f.send(1, 'upgradeBuilding', failure === 'next' ? 'hq3' : 'hq2').save, undefined, failure); assert.deepEqual(f.charges, [], failure); assert.equal(f.upgrader.isUpgrading(), false, failure); f.construction.close();
  }
});
test('two guest queues cannot purchase the same upgrade twice or cancel a later/different upgrade', () => {
  const f = fixture(), second = new HostActions(); second.receive({ type: 'upgradeBuilding', sequence: 1, target: 'HQ_1', next: 'hq2', costs: [20, 30] });
  assert.equal(f.send(1).save, true); assert.equal(second.apply(f.game, f.hero, f.game.desktopPlayers).save, undefined); assert.equal(f.charges.length, 2);
  assert.equal(f.send(2, 'cancelUpgrade', 'hq3').save, undefined); f.upgrader.waitingForClick = true; assert.equal(f.send(3, 'cancelUpgrade').save, undefined); assert.deepEqual(f.funds, [80, 70]); f.construction.close();
});
test('native single/batch/free upgrade entry points refuse source claims before charging or altering the original', () => {
  const f = fixture(); f.game.desktopPlayers.registry.data.players.push({ id: 'offline', construction: { moveFrom: 'HQ_1' } });
  f.upgrade.purchaseUpgrade(f.hero); f.upgrade.beginUpgrade(f.hero);
  f.upgrade.getListOfEntitiesThatICanUpgradeAroundMe = () => [f.source]; f.upgrade.refineUpgradeList = values => values;
  f.upgrade.attemptToPurchaseMultipleUpgrade(f.hero, 1); f.upgrade.beginUpgradeMultipleBuildings(f.hero, 1);
  assert.deepEqual(f.charges, []); assert.equal(f.upgrader.isUpgrading(), false); assert.equal(f.state.mesh, undefined);
  f.upgrader.startedUpgrading = true; f.upgrader.cancelUpgrade(f.hero); assert.equal(f.upgrader.isUpgrading(), true); assert.deepEqual(f.charges, []); f.construction.close();
});
test('building upgrade messages bound expected archetypes and copy prices without accepting caller authority', () => {
  const value = { type: 'upgradeBuilding', sequence: 1, target: 'HQ_1', next: 'hq2', costs: [20, 30] };
  for (const next of [undefined, '', 'a'.repeat(101), '../bad', 5]) assert.throws(() => new HostActions().receive({ ...value, next }), /Invalid/);
  for (const extra of [{ playerId: 'host' }, { costs: [NaN, 0] }, { costs: Array(2) }, { level: 99 }]) assert.throws(() => new HostActions().receive({ ...value, ...extra }), /Invalid/);
  const actions = new HostActions(); actions.receive(value); value.costs[0] = 0; assert.deepEqual(actions.queue[0].costs, [20, 30]);
  assert.throws(() => new HostActions().receive({ type: 'cancelUpgrade', sequence: 1, target: 'HQ_1', next: 'hq2', refund: 999 }), /Invalid/);
  for (const episode of [undefined, null, 0, -1, 1.5, Infinity]) assert.throws(() => new HostActions().receive({ type: 'cancelUpgrade', sequence: 1, target: 'HQ_1', next: 'hq2', episode }), /Invalid/);
});

test('a delayed cancellation cannot refund a new native restart of the same upgrade target', () => {
  const f = fixture(); f.send(1);
  const episode = f.construction.upgradeInfo(f.hero, f.source).episode, delayed = new HostActions();
  delayed.receive({ type: 'cancelUpgrade', sequence: 1, target: 'HQ_1', next: 'hq2', episode });
  f.upgrader.cancelUpgrade(f.hero); f.upgrade.purchaseUpgrade(f.hero);
  assert.notEqual(f.construction.upgradeInfo(f.hero, f.source).episode, episode);
  const before = [...f.funds]; assert.equal(delayed.apply(f.game, f.hero, f.game.desktopPlayers).save, undefined);
  assert.equal(f.upgrader.isUpgrading(), true); assert.deepEqual(f.funds, before);
  assert.equal(Object.hasOwn(f.upgrader.saveSerialize(), 'episode'), false); f.construction.close();
});
