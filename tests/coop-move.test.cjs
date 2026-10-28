'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostConstruction } = require('../desktop/coop-construction.js');
const { CoopPlayers } = require('../desktop/coop-players.js');
const { HostActions } = require('../desktop/coop-actions.js');
const { Controls } = require('../desktop/controls.js');
const original = require('./runtime-ast.cjs').component('ECBuilding');
function fixture() {
  const events = [], state = { friendly: true, permitted: true, health: 10, faction: 'hero' }, definition = { canBeMoved: true, buildingType: 'Wall', buildingName: 'Wall', level: 1 };
  const manager = { getRemainingBuildingsBeforeCap: () => 0, getNumScaffoldsForCap: () => 0, canCreateBuilding: () => false };
  const game = { globals: { gamePurchaseManager: {} }, desktopPlayers: { active: new Map(), registry: { data: { players: [] } } },
    getBuildingManager: () => manager, getEntityFactory: () => ({ getECArchetype: (_name, key) => key === 'ECBuilding' ? definition : null }),
    getFactionManager: () => ({ getHeroFactionName: () => 'hero' }), eventManager: { notify: (...values) => events.push(values) }, isScriptLocked: () => false };
  const radial = { isMoveButtonValid: () => state.permitted, isRadialMenuEnabled: () => !state.disabled, isRepairButtonExclusive: () => !!state.broken, closeMenu() {} };
  const source = { getName: () => 'Wall_1', getArchetypeName: () => 'wall', getv3Location: () => [0, 0, 0], getSmartPointer() { return { get: () => source }; }, shouldPlayerSave: true,
    shouldBeDestroyed: () => !!state.destroyed, isFriendlyWith: () => state.friendly,
    getEC: name => ({ ECBuilding: building, ECRadialMenu: radial, ECHealth: { getHealth: () => state.health }, ECFaction: { getFactionName: () => state.faction } })[name] };
  const building = Object.assign(Object.create(original), { entity: source, gameManager: game, globals: { gameManager: game }, archetype: definition,
    getEntityEC: name => source.getEC(name), getArchetypeName: () => 'wall', getBuildingParentEntity: () => null, generateTemporaryBuildingData: value => { events.push(['capture', value]); return {}; }, getBuildingsAbove: () => [] });
  function actor(id) {
    const builder = { held: false, entity: null, getHeldObjectName: () => 'wall', getHeldItemQuantity: () => 1, canCancelHeldBuilding: () => true, isBuilding() { return this.held; }, isThrowing: () => false,
      clearInHand() { events.push(['clear']); this.held = false; this.spMoveFromEntity = undefined; },
      getMoveFromEntity() { return this.spMoveFromEntity?.get(); }, placeMoveScaffoldInHand(archetype, entity, parent) { assert.equal(archetype, 'wall'); assert.equal(parent, null); this.spMoveFromEntity = entity.getSmartPointer(); this.held = true; this.instantBuildFlavour = true; } };
    const hero = { getName: () => id, shouldBeDestroyed: () => false, getEC: name => name === 'ECAutoFire' ? null : name === 'ECPlayerBuilder' ? builder : name === 'ECHealth' ? { getHealth: () => 10 } : { clearDestination() {}, clearDestinationEntity() {} } }; builder.entity = hero;
    game.desktopPlayers.active.set(id, { hero }); game.desktopPlayers.registry.data.players.push({ id, construction: null }); return { hero, builder };
  }
  const first = actor('one'), second = actor('two'); game.getGameEntityByName = id => id === 'Wall_1' ? source : null;
  const construction = new HostConstruction(game);
  return { construction, game, source, building, first, second, events, state };
}
test('original pickup uses the assigned actor and preserves a serializable move reference without reserving a new building', () => {
  const f = fixture(); assert.equal(f.construction.canMove(f.first.hero, f.source), true);
  const result = f.construction.move(f.first.hero, f.source); assert.equal(result.save, true); assert.equal(result.held.archetype, 'wall');
  assert.equal(f.first.builder.getMoveFromEntity(), f.source); assert.equal(f.second.builder.held, false); assert.equal(f.construction.pending.size, 0);
  assert.equal(f.events[0][0], 'capture'); assert.equal(f.events[1][0], 'BuildingEvent'); assert.equal(f.events[1][1].scaffold, f.first.hero);
  const players = Object.assign(Object.create(CoopPlayers.prototype), { game: f.game });
  assert.deepEqual(players.captureConstruction(f.first.hero), { archetype: 'wall', quantity: 1, instant: true, infinite: false, isNew: false, cannotCancel: false, payWhenPlacing: false, parent: null, moveFrom: 'Wall_1', lastPlaced: null });
  f.construction.close();
});
test('active, saved-offline and in-flight claims prevent another pickup and demolition, including original host UI calls', () => {
  const f = fixture(); f.construction.move(f.first.hero, f.source);
  assert.equal(f.construction.canMove(f.second.hero, f.source), false); f.building.move(f.second.hero); assert.equal(f.second.builder.held, false);
  assert.match(Controls.prototype.demolitionInfo.call({ manager: () => f.game }, f.source).reason, /saved hero/);
  const record = f.game.desktopPlayers.registry.data.players[0]; record.construction = { moveFrom: 'Wall_1' }; f.game.desktopPlayers.active.delete('one');
  assert.equal(f.construction.claimed(f.source), true); assert.equal(f.construction.canMove(f.second.hero, f.source), false);
  record.construction = { parent: 'Wall_1', moveFrom: null }; assert.equal(f.construction.claimed(f.source), true);
  record.construction = null; f.game.desktopPlayers.active.set('one', { hero: f.first.hero });
  const pending = f.construction.reserve(f.first.builder, 'wall'); f.first.builder.spMoveFromEntity = null; f.first.builder.held = false;
  assert.equal(f.construction.claimed(f.source), true); assert.equal(pending.move, true);
  f.construction.complete(pending, () => {}); assert.equal(f.construction.canMove(f.second.hero, f.source), true); f.construction.close();
});
test('move eligibility reuses original movement/territory flags and refuses enemies, dead targets, busy actors and scripts before mutation', () => {
  for (const failure of ['flag', 'enemy', 'dead', 'busy', 'script', 'disabled', 'broken', 'ally']) {
    const f = fixture(); if (failure === 'flag') f.state.permitted = false; if (failure === 'enemy') f.state.friendly = false; if (failure === 'dead') f.state.health = 0; if (failure === 'busy') f.first.builder.held = true; if (failure === 'script') f.game.isScriptLocked = () => true; if (failure === 'disabled') f.state.disabled = true; if (failure === 'broken') f.state.broken = true; if (failure === 'ally') f.state.faction = 'allied-npc';
    const actions = new HostActions(); actions.receive({ type: 'move', sequence: 1, target: 'Wall_1' }); assert.equal(typeof actions.apply(f.game, f.first.hero, {}).message, 'string');
    assert.equal(f.events.length, 0); assert.equal(f.first.builder.getMoveFromEntity(), undefined); f.construction.close();
  }
});

test('the actual original radial movement gate retains global, top/movement and territory-tracker restrictions', () => {
  const flags = { buildingMovementEnabled: true }, radial = require('./runtime-ast.cjs').component('ECRadialMenu', { Sb: flags });
  let building = true, territory = true;
  const actor = { getEntityEC: name => name === 'ECBuilding' ? { getCanMove: () => building } : { getCanMove: () => territory } };
  assert.equal(radial.isMoveButtonValid.call(actor), true);
  territory = false; assert.equal(radial.isMoveButtonValid.call(actor), false);
  territory = true; building = false; assert.equal(radial.isMoveButtonValid.call(actor), false);
  building = true; flags.buildingMovementEnabled = false; assert.equal(radial.isMoveButtonValid.call(actor), false);
});

test('capture clears destroyed active and offline move sources without cancellation, refunds or resurrection', () => {
  for (const missing of [false, true]) {
    const f = fixture(); f.construction.move(f.first.hero, f.source);
    const offline = { id: 'offline', construction: { moveFrom: 'Wall_1' } };
    f.game.desktopPlayers.registry.data.players.push(offline);
    f.construction.reconcileMoves(); assert.equal(f.first.builder.held, true); assert.ok(offline.construction);
    if (missing) { f.first.builder.spMoveFromEntity = { get: () => undefined }; f.game.getGameEntityByName = () => undefined; }
    else f.state.destroyed = true;
    assert.equal(f.construction.canPlace(f.first.builder), false);
    const players = Object.assign(Object.create(CoopPlayers.prototype), f.game.desktopPlayers, { game: f.game });
    players.requireSettled = () => {}; players.captureHero = hero => ({ construction: players.captureConstruction(hero) });
    players.registry.player = id => players.registry.data.players.find(record => record.id === id);
    let writes = 0; players.registry.persist = () => { writes++; };
    players.registry.data.economy = {};
    players.capture();
    assert.equal(f.first.builder.held, false); assert.equal(offline.construction, null);
    assert.equal(players.registry.player('one').construction, null); assert.equal(writes, 1);
    assert.deepEqual(f.events.slice(2), [['clear']]); f.construction.close();
  }
});

test('move cleanup leaves an in-flight original callback and unrelated purchases alone', () => {
  const f = fixture(); f.construction.move(f.first.hero, f.source);
  f.state.destroyed = true; f.construction.reconcileMoves(f.second.hero);
  assert.equal(f.first.builder.held, true, 'A guest departure must not mutate another active hero before its capture');
  f.first.builder.isThrowing = () => true; f.state.destroyed = true;
  f.second.builder.held = true;
  f.construction.reconcileMoves();
  assert.equal(f.first.builder.held, true); assert.equal(f.second.builder.held, true);
  assert.equal(f.events.length, 2); f.construction.close();
});
