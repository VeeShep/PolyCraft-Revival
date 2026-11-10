'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs');
const { HostConstruction } = require('../desktop/coop-construction.js');
const { HostActions } = require('../desktop/coop-actions.js');
function fixture() {
  const state = { funds: 100, heroHealth: 50, health: 10, friendly: false, enabled: true, held: false, throwing: false, locked: false, life: 0 }, charges = [], metrics = [];
  const builder = { isBuilding: () => state.held, isThrowing: () => state.throwing, getMoveFromEntity: () => null };
  const hero = { shouldBeDestroyed: () => false, getEC: name => ({ ECPlayerBuilder: builder, ECHealth: { getHealth: () => state.heroHealth }, ECPlayerLife: { states: { NORMAL: 0 }, state: state.life },
    ECPlayerData: { getSoftCurrency: () => state.funds, adjustSoftCurrency(value) { state.funds += value; charges.push(value); } } })[name] }; builder.entity = hero;
  const components = { ECBuilding: { getCanMove: () => false },  };
  const source = { getName: () => 'scaffold', getEC: name => components[name], shouldBeDestroyed: () => !!state.destroyed, isFriendlyWith: () => state.friendly };
  const scaffold = Object.assign(Object.create(ast.component('ECScaffold')), { plannedObject: 'a_b_outpost', plannedFactionName: 'hero', canSpeedUpWithSoftCurrency: true, buildTime: 1800, buildComplete: 0, startedBuilding: true, waitingForClick: false,
    archetype: { delayBuildingUntilBuilderPresent: true }, globals: { metricsManager: { sendGameMetric: (...args) => metrics.push(args) } } });
  components.ECScaffold = scaffold;
  components.ECRadialMenu = Object.assign(Object.create(ast.component('ECRadialMenu', { Sb: {} })), { getEntityEC: name => components[name], isRadialMenuEnabled: () => state.enabled });
  const manager = { getRemainingBuildingsBeforeCap: () => 10, getNumScaffoldsForCap: () => 0 };
  const game = { getBuildingManager: () => manager, getFactionManager: () => ({ getHeroFactionName: () => 'hero' }), getGameEntityByName: name => name === 'scaffold' ? source : null, isScriptLocked: () => state.locked,
    desktopPlayers: { active: new Map([['guest', { hero }]]), registry: { data: { players: [] } } } };
  const construction = new HostConstruction(game), actions = new HostActions();
  const send = (sequence, cost = 50, planned = 'a_b_outpost', queue = actions) => { queue.receive({ type: 'speedup', sequence, target: 'scaffold', planned, cost }); return queue.apply(game, hero, game.desktopPlayers); };
  return { state, hero, source, scaffold, components, game, construction, actions, charges, metrics, send };
}
test('guest scaffold speedup uses original price/payment/completion once, including two queued guest requests', () => {
  const f = fixture(), menu = f.construction.menu(f.hero, f.source), other = new HostActions();
  assert.deepEqual(menu.speedup, { planned: 'a_b_outpost', cost: 50, affordable: true }); assert.deepEqual(menu.products, []);
  const secondBuilder = { ...f.hero.getEC('ECPlayerBuilder') }, secondHero = { ...f.hero, getEC: name => name === 'ECPlayerBuilder' ? secondBuilder : f.hero.getEC(name) };
  secondBuilder.entity = secondHero; f.game.desktopPlayers.active.set('second', { hero: secondHero });
  other.receive({ type: 'speedup', sequence: 1, target: 'scaffold', planned: 'a_b_outpost', cost: 50 });
  assert.equal(f.send(1).save, true); assert.equal(f.scaffold.buildComplete, 1); assert.equal(f.state.funds, 50);
  assert.equal(other.apply(f.game, secondHero, f.game.desktopPlayers).save, undefined); assert.equal(f.send(2).save, undefined);
  assert.deepEqual(f.charges, [-50]); assert.deepEqual(f.metrics, [['buildingSpeedupBought_a_b_outpost', 50]]);
  assert.equal(f.construction.speedupInfo(f.hero, f.source), null); f.construction.close();
});
test('speedup rechecks original eligibility, current quote/funds and actor/source restrictions without spending on failure', () => {
  for (const failure of ['price', 'planned', 'funds', 'completed', 'waiting', 'destroyed', 'enemy', 'ally', 'disabled', 'sourceDead', 'heroDead', 'dying', 'held', 'throwing', 'script', 'unowned', 'claim']) {
    const f = fixture();
    if (failure === 'price') f.scaffold.buildComplete = .03;
    if (failure === 'funds') f.state.funds = 49;
    if (failure === 'completed') f.scaffold.buildComplete = 1;
    if (failure === 'waiting') f.scaffold.waitingForClick = true;
    if (failure === 'destroyed') f.state.destroyed = true;
    if (failure === 'enemy') f.scaffold.plannedFactionName = 'enemy';
    if (failure === 'ally') f.scaffold.plannedFactionName = 'npc';
    if (failure === 'disabled') f.state.enabled = false;
    if (failure === 'sourceDead') f.components.ECHealth = { getHealth: () => 0 };
    if (failure === 'heroDead') f.state.heroHealth = 0;
    if (failure === 'dying') f.state.life = 1;
    if (failure === 'held') f.state.held = true;
    if (failure === 'throwing') f.state.throwing = true;
    if (failure === 'script') f.state.locked = true;
    if (failure === 'unowned') f.game.desktopPlayers.active.clear();
    if (failure === 'claim') f.game.desktopPlayers.registry.data.players.push({ id: 'offline', construction: { moveFrom: 'scaffold' } });
    assert.equal(f.send(1, 50, failure === 'planned' ? 'other' : 'a_b_outpost').save, undefined, failure);
    assert.deepEqual(f.charges, [], failure); assert.deepEqual(f.metrics, [], failure); f.construction.close();
  }
});
test('scaffold speedup wire requests reject malformed quotes, authority fields and sequence replay', () => {
  const valid = { type: 'speedup', sequence: 1, target: 'scaffold', planned: 'a_b_outpost', cost: 50 };
  for (const change of [{ cost: 0 }, { cost: -1 }, { cost: NaN }, { cost: 1.5 }, { cost: 2147483648 }, { cost: '50' }, { planned: '../bad' }, { planned: '' }, { playerId: 'host' }, { complete: 1 }]) assert.throws(() => new HostActions().receive({ ...valid, ...change }), /Invalid/);
  const queue = new HostActions(); queue.receive(valid); assert.throws(() => queue.receive(valid), /repeated/);
});

test('speedup follows native radial eligibility rather than its unused saved currency flag', () => {
  const f = fixture(); f.scaffold.canSpeedUpWithSoftCurrency = false;
  assert.ok(f.construction.speedupInfo(f.hero, f.source));
  f.scaffold.startedBuilding = false; f.scaffold.archetype.delayBuildingUntilBuilderPresent = false;
  assert.equal(f.construction.speedupInfo(f.hero, f.source), null);
  f.scaffold.startedBuilding = true; assert.equal(f.send(1).save, true); assert.deepEqual(f.charges, [-50]); f.construction.close();
});

test('original scaffold archetype has no faction component; its planned faction governs the resulting building', () => {
  const definition = ast.assignedObject('a_b_scaffold', { EntityFactory: { EC_DEFAULT: {} } });
  assert.equal(Object.hasOwn(definition, 'ECFaction'), false);
  const f = fixture(); assert.equal(f.source.getEC('ECFaction'), undefined); assert.equal(f.source.isFriendlyWith(f.hero), false);
  assert.ok(f.construction.speedupInfo(f.hero, f.source));
  f.scaffold.plannedFactionName = undefined; assert.ok(f.construction.speedupInfo(f.hero, f.source));
  f.scaffold.plannedFactionName = 'enemy'; assert.equal(f.construction.speedupInfo(f.hero, f.source), null); f.construction.close();
});
