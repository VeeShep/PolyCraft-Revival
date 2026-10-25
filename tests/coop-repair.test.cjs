'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs');
const original = ast.component('ECRepairable', { H: { LUMBER: 0, STONE: 1 }, ba: { repairableBuildings: true } });
const { HostConstruction } = require('../desktop/coop-construction.js');
const { HostActions } = require('../desktop/coop-actions.js');
function fixture(broken = false) {
  const state = { health: broken ? 0 : 50, friendly: true, faction: 'hero', enabled: true, destroyed: false, held: false, throwing: false, heroHealth: 10, locked: false }, funds = [100, 100], charges = [], flags = { repairingEnabled: true, buildingMovementEnabled: true };
  const health = { getHealthFactor: () => state.health / 100, getHealth: () => state.health, resetHealth: () => { state.health = 100; }, enableRegen() {}, enableDeath() {} };
  const building = { getCanMove: () => false, disableMovement: value => { state.movementDisabled = value; } };
  const components = { ECHealth: health, ECBuilding: building, ECFaction: { getFactionName: () => state.faction } };
  const source = { getName: () => 'Wall_1', getEC: name => components[name], shouldBeDestroyed: () => state.destroyed, isFriendlyWith: () => state.friendly };
  const radial = Object.assign(Object.create(ast.component('ECRadialMenu', { Sb: flags })), { getEntityEC: name => components[name], isRadialMenuEnabled: () => state.enabled });
  components.ECRadialMenu = radial;
  const builder = { isBuilding: () => state.held, isThrowing: () => state.throwing, getMoveFromEntity: () => null };
  const hero = { shouldBeDestroyed: () => false, getEC: name => name === 'ECPlayerBuilder' ? builder : name === 'ECHealth' ? { getHealth: () => state.heroHealth } : name === 'ECPlayerData' ? { getResource: index => funds[index], adjustResource(index, amount) { funds[index] += amount; charges.push([index, amount]); } } : null }; builder.entity = hero;
  const manager = { getRemainingBuildingsBeforeCap: () => 10, getNumScaffoldsForCap: () => 0 };
  const game = { desktopPlayers: { active: new Map([['guest', { hero }]]), registry: { data: { players: [{ id: 'guest' }] } } }, getBuildingManager: () => manager, getFactionManager: () => ({ getHeroFactionName: () => 'hero' }), getGameEntityByName: name => name === 'Wall_1' ? source : null, isScriptLocked: () => state.locked };
  const repair = Object.assign(Object.create(original), { entity: source, gameManager: game, broken, archetype: { minResourceRepairCost: [10, 20], maxResourceRepairCost: [30, 40] }, globals: { mathDevice: { saturate: value => Math.max(0, Math.min(1, value)) }, metricsManager: { sendGameMetric: () => { state.metric = true; } } }, getEntityEC: name => components[name], setToUpdate() {}, setToDraw() {} });
  components.ECRepairable = repair;
  const construction = new HostConstruction(game), actions = new HostActions();
  const send = (sequence, costs = construction.repairInfo(hero, source)?.costs || [0, 0]) => { actions.receive({ type: 'repair', sequence, target: 'Wall_1', costs }); return actions.apply(game, hero, game.desktopPlayers); };
  return { state, flags, source, hero, builder, funds, charges, game, repair, construction, actions, send, components };
}
test('guest repair uses actual original damage costs, shared resources and healing/broken-building restoration before requesting saving', () => {
  for (const broken of [false, true]) {
    const f = fixture(broken), menu = f.construction.menu(f.hero, f.source), costs = broken ? [30, 40] : [20, 30];
    assert.deepEqual(menu.repair.costs, costs); assert.equal(menu.repair.affordable, true);
    const result = f.send(1, costs); assert.equal(result.save, true); assert.equal(f.state.health, 100); assert.equal(f.repair.broken, false);
    assert.deepEqual(f.funds, [100 - costs[0], 100 - costs[1]]);
    if (broken) { assert.equal(f.state.movementDisabled, false); assert.equal(f.state.metric, true); }
    const previous = [...f.charges]; assert.equal(f.send(2, costs).save, undefined); assert.deepEqual(f.charges, previous);
    f.construction.close();
  }
});
test('host rejects changed quotes, insufficient shared funds and ineligible repairs without charging', () => {
  for (const failure of ['quote', 'funds', 'enemy', 'ally', 'disabled', 'flag', 'destroyed', 'held', 'throwing', 'dead', 'script', 'claim']) {
    const f = fixture(), costs = f.construction.repairInfo(f.hero, f.source).costs;
    if (failure === 'quote') f.state.health = 25; if (failure === 'funds') f.funds[0] = 0;
    if (failure === 'enemy') f.state.friendly = false; if (failure === 'ally') f.state.faction = 'allied-npc';
    if (failure === 'disabled') f.state.enabled = false; if (failure === 'flag') f.flags.repairingEnabled = false;
    if (failure === 'destroyed') f.state.destroyed = true; if (failure === 'held') f.state.held = true;
    if (failure === 'throwing') f.state.throwing = true; if (failure === 'dead') f.state.heroHealth = 0;
    if (failure === 'script') f.state.locked = true;
    if (failure === 'claim') f.game.desktopPlayers.registry.data.players.push({ id: 'offline', construction: { moveFrom: 'Wall_1' } });
    const before = f.state.health; assert.equal(f.send(1, costs).save, undefined, failure); assert.equal(f.charges.length, 0, failure); assert.equal(f.state.health, before, failure); f.construction.close();
  }
});
test('broken dispenser exposes repair only and an existing move claim also blocks original host repair callbacks', () => {
  const f = fixture(true); f.components.ECDispenser = { contents: [{}], archetype: {}, evaluateProductInfo() { throw new Error('Broken buildings cannot offer products'); } };
  const menu = f.construction.menu(f.hero, f.source); assert.deepEqual(menu.products, []); assert.equal(menu.move, false); assert.ok(menu.repair);
  f.game.desktopPlayers.registry.data.players.push({ id: 'offline', construction: { moveFrom: 'Wall_1' } });
  f.repair.purchaseRepair(f.hero, 30, 40); assert.equal(f.state.health, 0); assert.deepEqual(f.charges, []); f.construction.close();
});
test('repair requests bound and copy expected quotes, reject supplied authority and repeated sequences', () => {
  const value = { type: 'repair', sequence: 1, target: 'Wall_1', costs: [20, 30] };
  for (const costs of [undefined, [], [1], [0, 0, 0], [-1, 0], [NaN, 0], [Infinity, 0], [1e10, 0], ['0', 0], Array(2)]) assert.throws(() => new HostActions().receive({ ...value, costs }), /Invalid/);
  for (const extra of [{ playerId: 'host' }, { health: 100 }, { archetype: 'wall' }]) assert.throws(() => new HostActions().receive({ ...value, ...extra }), /Invalid/);
  const actions = new HostActions(); actions.receive(value); value.costs[0] = 0; assert.deepEqual(actions.queue[0].costs, [20, 30]); assert.throws(() => actions.receive(value), /repeated/);
});

test('two guest queues spending the same shared repair quote charge once and refuse the now-healthy target', () => {
  const f = fixture(); f.state.health = 43.75;
  const secondBuilder = { ...f.builder }, second = { ...f.hero, getEC: name => name === 'ECPlayerBuilder' ? secondBuilder : f.hero.getEC(name) }; secondBuilder.entity = second;
  f.game.desktopPlayers.active.set('second', { hero: second });
  const other = new HostActions(), costs = f.construction.repairInfo(f.hero, f.source).costs;
  assert.deepEqual(costs, [21.25, 31.25]);
  f.actions.receive({ type: 'repair', sequence: 1, target: 'Wall_1', costs });
  other.receive({ type: 'repair', sequence: 1, target: 'Wall_1', costs });
  assert.equal(f.actions.apply(f.game, f.hero, f.game.desktopPlayers).save, true);
  assert.equal(other.apply(f.game, second, f.game.desktopPlayers).save, undefined);
  assert.deepEqual(f.funds, [78.75, 68.75]); assert.equal(f.charges.length, 2); f.construction.close();
});
