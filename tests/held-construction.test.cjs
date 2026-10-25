'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { component } = require('./runtime-ast.cjs');
const { HostConstruction } = require('../desktop/coop-construction.js');
const { HostActions } = require('../desktop/coop-actions.js');
const original = component('ECPlayerBuilder', { Z: { BUTTON_WIDE: 1 } });
function setup() {
  const events = [], payments = [], state = { move: null, critical: false, clicks: 0, valid: true, throwing: false, refunds: 0, placements: 0 };
  const definition = { buildingType: 'Wall', buildingName: 'Wall', prerequisites: [], scaffoldType: 'normal' };
  const factory = { getECArchetype: (_name, key) => key === 'ECBuilding' ? definition : key === 'ECGameCritical' && state.critical ? {} : null };
  const game = { eventManager: { notify: type => events.push(type) }, globals: { gameCurrentTime: 1 }, isScriptLocked: () => false,
    getEntityFactory: () => factory, getBuildingManager: () => ({ getRemainingBuildingsBeforeCap: () => 1, getNumScaffoldsForCap: () => 0, canCreateBuilding(type, parent) { return this.getRemainingBuildingsBeforeCap(type, parent) > 0; } }),
    getIMGui: () => ({ getv2ScreenBarLocation: () => [0, 0], doButton: () => { state.clicks++; return true; } }), placeOnGround: location => [...location] };
  const hero = { getName: () => 'owned', shouldBeDestroyed: () => false, getEC: key => key === 'ECPlayerBuilder' ? builder : key === 'ECHealth' ? { getHealth: () => 10 } : null };
  const builder = Object.assign(Object.create(original), { entity: hero, gameManager: game, globals: { ...game.globals, gameManager: game, currentLanguage: {} }, _super() {},
    heldObjectName: 'wall', heldItemQuantity: 2, heldObjectFootplateBuffer: 0.1, shouldPayWhenPlacingBuildings: false,
    getMoveFromEntity: () => state.move, getEntityEC: () => null, refundCost: () => { state.refunds++; }, playSound: name => events.push(name), removeHeldEntity: () => events.push('visual removed'),
    getv3BuildLocation: location => [...location], getv3HeldObjectExtents: () => [2, 2, 2], canBuildAtPosition: () => state.valid,
    canAffordToPlaceBuilding: () => true, areBuildingPrerequisitesMet: () => true, isThrowing: () => state.throwing,
    attemptToPlaceBuilding: location => { assert.deepEqual(location, [1, 0, 2]); state.placements++; if (!state.valid) return false; if (builder.shouldPayWhenPlacingBuildings) payments.push('original payment'); builder.clearInHand(); return true; } });
  game.desktopPlayers = { active: new Map([['owned', { hero }]]) }; game.getHero = () => hero;
  game.getGameEntityByName = id => id === 'owned' ? hero : { shouldBeDestroyed: () => false };
  const construction = new HostConstruction(game);
  return { builder, hero, game, construction, state, events, payments };
}
test('shared original cancellation preserves prepaid refunds, infinite-payment and move rules, protected objects and once-only EmptyHanded', () => {
  for (const mode of ['prepaid', 'infinite', 'move']) {
    const f = setup(); f.builder.shouldPayWhenPlacingBuildings = mode === 'infinite'; f.state.move = mode === 'move' ? {} : null;
    assert.equal(f.builder.cancelHeldBuilding(), true); assert.equal(f.state.refunds, mode === 'prepaid' ? 1 : 0);
    assert.equal(f.events.filter(value => value === 'EmptyHanded').length, 1); assert.equal(f.builder.cancelHeldBuilding(), false); assert.equal(f.state.refunds, mode === 'prepaid' ? 1 : 0);
    f.construction.close();
  }
  for (const protection of ['critical', 'amberwell', 'amberchest', 'cannotCancel']) {
    const f = setup(); if (protection === 'critical') f.state.critical = true;
    if (protection.startsWith('amber')) f.builder.heldObjectName = 'a_b_' + protection;
    if (protection === 'cannotCancel') f.builder.cannotCancel = true;
    assert.equal(f.builder.cancelHeldBuilding(), false); assert.equal(f.events.length, 0); assert.equal(f.builder.isBuilding(), true);
    if (protection !== 'cannotCancel') { f.state.move = {}; assert.equal(f.builder.cancelHeldBuilding(), true); }
    f.construction.close();
  }
});
test('guest builders ignore the host cancel button but retain original prerequisite-triggered cancellation', () => {
  const f = setup(); f.game.getHero = () => ({});
  f.builder.update(); assert.equal(f.state.clicks, 0); assert.equal(f.builder.isBuilding(), true);
  f.builder.shouldPayWhenPlacingBuildings = true; f.builder.areBuildingPrerequisitesMet = () => false;
  f.builder.update(); assert.equal(f.state.clicks, 0); assert.equal(f.builder.isBuilding(), false); assert.equal(f.state.refunds, 0);
  const local = setup(); local.builder.update(); assert.equal(local.state.clicks, 1); assert.equal(local.builder.isBuilding(), false);
  f.construction.close(); local.construction.close();
});
test('held previews do not buy or recreate objects; placement uses the restored builder and cancellation keeps original payment behavior', () => {
  const f = setup(), before = f.builder.heldItemQuantity;
  const preview = f.construction.heldPreview(f.hero, [1, 0, 2]); assert.equal(preview.preview.valid, true); assert.equal(preview.preview.source, 'owned');
  assert.equal(f.builder.heldItemQuantity, before); assert.equal(f.state.refunds, 0); assert.equal(f.state.placements, 0);
  f.state.valid = false; assert.equal(f.construction.heldPreview(f.hero, [1, 0, 2]).preview.valid, false);
  assert.equal(typeof f.construction.placeHeld(f.hero, [1, 0, 2]), 'string'); assert.equal(f.builder.isBuilding(), true);
  f.state.valid = true; f.builder.shouldPayWhenPlacingBuildings = true;
  assert.deepEqual(f.construction.placeHeld(f.hero, [1, 0, 2]), { message: 'Held building placed and saved.', save: true, held: null });
  assert.deepEqual(f.payments, ['original payment']); assert.equal(f.state.refunds, 0);
  const cancel = setup(); cancel.state.throwing = true; assert.equal(typeof cancel.construction.cancelHeld(cancel.hero), 'string'); assert.equal(cancel.state.refunds, 0);
  cancel.state.throwing = false; assert.equal(cancel.construction.cancelHeld(cancel.hero).save, true); assert.equal(cancel.state.refunds, 1);
  f.construction.close(); cancel.construction.close();
});
test('held actions use only the host-assigned hero, validate sequence/shape and refuse actions during throws or script locks', () => {
  const f = setup(), actions = new HostActions();
  actions.receive({ type: 'held', sequence: 1, target: 'owned' });
  assert.equal(actions.apply(f.game, f.hero, {}).held.archetype, 'wall');
  actions.receive({ type: 'cancelBuild', sequence: 2, target: 'other', archetype: 'wall' }); assert.match(actions.apply(f.game, f.hero, {}).message, /own held/); assert.equal(f.state.refunds, 0);
  for (const value of [{ type: 'held', sequence: 3, target: 'owned', cost: 0 }, { type: 'cancelBuild', sequence: 2, target: 'owned' }]) assert.throws(() => actions.receive(value), /Invalid|repeated/);
  f.state.throwing = true; assert.match(actions.execute(f.game, f.hero, {}, 'owned', null, 'cancelBuild'), /Finish/); assert.equal(f.state.refunds, 0);
  f.state.throwing = false; f.game.isScriptLocked = () => true; assert.match(actions.execute(f.game, f.hero, {}, 'owned', null, 'build', { index: 0, location: [1, 0, 2] }), /Finish/);
  f.game.isScriptLocked = () => false; assert.match(actions.execute(f.game, f.hero, {}, 'owned', null, 'build', { index: 1, location: [1, 0, 2], archetype: 'wall' }), /Invalid held/);
  assert.match(actions.execute(f.game, f.hero, {}, 'owned', null, 'cancelBuild', { archetype: 'changed' }), /changed/); assert.equal(f.state.refunds, 0);
  assert.equal(actions.execute(f.game, f.hero, {}, 'owned', null, 'cancelBuild', { archetype: 'wall' }).save, true); assert.equal(f.state.refunds, 1);
  f.construction.close();
});

test('each original line-placement segment rechecks shared capacity before throwing or charging', () => {
  const f = setup(), reservations = [];
  f.builder.shouldPayWhenPlacingBuildings = true;
  f.builder.throwHeldObjectToDestinationAndBuild = () => reservations.push(f.construction.reserve(f.builder, 'wall'));
  f.builder.payCost = () => f.payments.push('payment');
  assert.equal(original.placeBuilding.call(f.builder, [1, 0, 2], true, 0, false), true);
  assert.equal(original.placeBuilding.call(f.builder, [2, 0, 2], true, 0, false), false);
  assert.equal(original.placeBuilding.call(f.builder, [3, 0, 2], true, 0, true), false);
  assert.equal(reservations.length, 1); assert.deepEqual(f.payments, ['payment']);
  f.construction.complete(reservations[0], () => {}); f.construction.close();
});
