'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostConstruction } = require('../desktop/coop-construction.js');
function setup() {
  const definition = { buildingType: 'Wall', scaffoldType: 'normal', obeysScaffoldCap: true, prerequisites: [] };
  let count = 0;
  const manager = { getRemainingBuildingsBeforeCap: () => Math.max(0, 1 - count), getNumScaffoldsForCap: () => 0,
    canCreateBuilding(type, parent, prerequisites, scaffolds, scaffoldType) { return this.getRemainingBuildingsBeforeCap(type, parent) > 0 && (!scaffolds || this.getNumScaffoldsForCap(scaffoldType) < 1); } };
  const game = { desktopPlayers: { active: new Map() }, getBuildingManager: () => manager, placeOnGround: location => [location[0], 0.1, location[2]], getEntityFactory: () => ({ getECArchetype: () => definition, getv3ObjectFootprintExtents: () => [2, 3, 4], getObjectBuildBuffer: () => 0.2, getBuildingMaxLinePlacementLength: () => 0 }) };
  const construction = new HostConstruction(game);
  const actor = () => {
    const state = { resource: [100, 100], amber: 100, held: false, throwing: false, valid: true };
    const data = { adjustResource: (index, amount) => { state.resource[index] += amount; }, playerData: { adjustSoftCurrency: amount => { state.amber += amount; } } };
    const hero = { getEC: name => name === 'ECPlayerBuilder' ? builder : name === 'ECHealth' ? { getHealth: () => 10 } : name === 'ECPlayerData' ? data : undefined };
    const builder = { entity: hero, getHeldObjectName: () => 'wall', getMoveFromEntity: () => null, getv3BuildLocation: location => location,
      canBuildAtPosition: () => state.valid, placeInHand: () => { state.held = true; builder.heldEntity = {}; }, isBuilding: () => state.held, isThrowing: () => state.throwing, clearInHand: () => { state.held = false; builder.heldEntity = null; },
      attemptToPlaceBuilding: () => { state.throwing = true; state.held = false; state.reservation = construction.reserve(builder, 'wall'); return true; } };
    game.desktopPlayers.active.set(hero, { hero }); return { hero, builder, state };
  };
  const first = actor(), second = actor();
  let valid = true, friendly = true, evaluated = 0;
  const dispenser = { archetype: {}, contents: [{ dispensedArchetypeName: 'wall' }], getDispenseName: () => 'Wall', getBuildTime: () => 10, getUsesInfiniteBuildMode: () => true,
    getQuantityPerPurchase: () => 1, getProductInfo: index => index === 0 ? { dispensedArchetypeName: 'wall' } : null,
    evaluateProductInfo: () => { evaluated++; }, getValid: () => valid && construction.canPlace(first.builder),
    canAfford: hero => hero === first.hero && first.state.resource[0] >= 10 && first.state.resource[1] >= 5 && first.state.amber >= 3,
    getResourceCost: () => 10, getSecondaryResourceCost: () => 5, getSoftCurrencyCost: () => 3,
    payForDispensedEntity: hero => { const data = hero.getEC('ECPlayerData'); data.adjustResource(0, -10); data.adjustResource(1, -5); data.playerData.adjustSoftCurrency(-3); } };
  const source = { getName: () => 'Workshop', getEC: name => name === 'ECDispenser' ? dispenser : undefined, isFriendlyWith: () => friendly };
  return { construction, game, manager, definition, first, second, source, dispenser, evaluated: () => evaluated, disable: () => { valid = false; }, enemy: () => { friendly = false; }, placed: () => { count++; } };
}
test('original menu and dry-run previews report current validity without spawning, spending, changing the real builder or reserving capacity', () => {
  const { construction, first, source, evaluated } = setup();
  const before = JSON.stringify(first.state), fields = Object.keys(first.builder);
  const menu = construction.menu(first.hero, source);
  assert.equal(menu.source, 'Workshop'); assert.deepEqual(menu.products[0].costs, [10, 5, 3]); assert.equal(menu.products[0].repeat, true);
  const preview = construction.preview(first.hero, source, 0, [1, 2, 3]);
  assert.deepEqual(preview.preview, { source: 'Workshop', index: 0, location: [1, 2, 3], position: [1, 0.1, 3], extents: [2, 4], buffer: 0.2, valid: true });
  assert.equal(JSON.stringify(first.state), before); assert.deepEqual(Object.keys(first.builder), fields); assert.equal(construction.pending.size, 0); assert.equal(evaluated(), 2);
  first.state.valid = false; assert.equal(construction.preview(first.hero, source, 0, [1, 2, 3]).preview.valid, false);
  construction.close();
});
test('stalled construction refuses the save after its deadline and permits a retry after the throw completes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { construction, first } = setup(), pending = construction.reserve(first.builder, 'wall');
  const saving = construction.settle(); t.mock.timers.tick(5001);
  await assert.rejects(saving, /Construction has not finished/);
  construction.complete(pending, () => {}); await construction.settle(); construction.close();
});
test('in-flight co-op throws reserve global/local building and scaffold capacity until original scaffold creation takes over, then restore hooks', async () => {
  const { construction, manager, first, second, placed, game } = setup();
  assert.equal(construction.canPlace(first.builder), true);
  const pending = construction.reserve(first.builder, 'wall');
  assert.equal(manager.getRemainingBuildingsBeforeCap('Wall'), 0); assert.equal(manager.getNumScaffoldsForCap('normal'), 1);
  assert.equal(construction.canPlace(second.builder), false); assert.throws(() => construction.close(), /Finish/);
  let settled = false; const saving = construction.settle().then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  construction.complete(pending, () => { assert.equal(manager.getRemainingBuildingsBeforeCap('Wall'), 1); placed(); });
  await saving; assert.equal(settled, true); assert.equal(manager.getRemainingBuildingsBeforeCap('Wall'), 0);
  const parent = () => ({ getEC: () => ({ getLocalBuildingCap: () => 1 }) }), a = parent(), b = parent();
  first.builder.spBuildingParentEntity = { get: () => a };
  const item = construction.reserve(first.builder, 'wall');
  assert.equal([...construction.pending].filter(entry => entry.parent === a).length, 1);
  const original = construction.original.remaining; construction.original.remaining = () => 1;
  assert.equal(manager.getRemainingBuildingsBeforeCap('Wall', a), 0); assert.equal(manager.getRemainingBuildingsBeforeCap('Wall', b), 1);
  construction.original.remaining = original; construction.complete(item, () => {});
  construction.close(); assert.equal(game.desktopConstruction, undefined); assert.equal(manager.getRemainingBuildingsBeforeCap, original);
});
test('host recomputes dispenser permission and placement before charging the assigned model, preserves exact costs and refuses invalid or unaffordable requests', () => {
  for (const failure of ['enemy', 'prerequisite', 'position', 'funds', 'index', 'toolbox']) {
    const env = setup(), { construction, first, source } = env;
    if (failure === 'enemy') env.enemy(); if (failure === 'prerequisite') env.disable();
    if (failure === 'position') first.state.valid = false; if (failure === 'funds') first.state.amber = 0;
    if (failure === 'toolbox') first.builder.placeInHand = () => { first.state.held = true; };
    const before = JSON.stringify(first.state);
    assert.equal(typeof construction.build(first.hero, source, failure === 'index' ? 31 : 0, [1, 0, 2]), 'string');
    assert.equal(JSON.stringify(first.state), before); assert.equal(construction.pending.size, 0); construction.close();
  }
  const { construction, first, source, evaluated } = setup();
  assert.deepEqual(construction.build(first.hero, source, 0, [1, 0, 2]), { message: 'Building placed and saved.', save: true });
  assert.equal(evaluated(), 1); assert.deepEqual(first.state.resource, [90, 95]); assert.equal(first.state.amber, 97);
  assert.equal(first.state.held, false); assert.equal(construction.pending.size, 1);
  construction.complete(first.state.reservation, () => {}); construction.close();
});
test('existing-building moves wait for completion without reserving a second building, while unbound original builders remain untouched', () => {
  const { construction, first, second, manager } = setup();
  const pending = construction.reserve(first.builder, 'wall');
  second.builder.getMoveFromEntity = () => ({});
  assert.equal(construction.canPlace(second.builder), true);
  const move = construction.reserve(second.builder, 'wall');
  assert.equal(move.move, true); assert.equal(manager.getRemainingBuildingsBeforeCap('Wall'), 0);
  construction.complete(pending, () => {}); assert.equal(manager.getRemainingBuildingsBeforeCap('Wall'), 1);
  assert.equal(construction.canPlace({ entity: {} }), true); assert.equal(construction.reserve({ entity: {} }, 'wall'), null);
  construction.complete(move, () => {}); construction.close();
});
test('attached workshop icons use their live root building for ownership, never a guest-supplied or unrelated cap parent', () => {
  const { construction, first, source } = setup(), getEC = source.getEC;
  let alive = true, friendly = true;
  const owner = { shouldBeDestroyed: () => !alive, getEC: () => null, isFriendlyWith: () => friendly };
  source.isFriendlyWith = () => false;
  source.getEC = name => name === 'ECAttach' ? { getBaseEntity: () => owner } : getEC(name);
  friendly = false; assert.match(construction.build(first.hero, source, 0, [1, 0, 2]), /not an available/);
  friendly = true; alive = false; assert.match(construction.build(first.hero, source, 0, [1, 0, 2]), /not an available/);
  alive = true; assert.equal(construction.build(first.hero, source, 0, [1, 0, 2]).save, true);
  construction.complete(first.state.reservation, () => {}); construction.close();
});
test('placement rejection refunds through raw currency data so Crown bonuses cannot duplicate refunds, and failed scaffold callbacks block later saving', async () => {
  const { construction, first, source } = setup();
  first.builder.attemptToPlaceBuilding = () => false;
  assert.equal(typeof construction.build(first.hero, source, 0, [1, 0, 2]), 'string');
  assert.deepEqual(first.state.resource, [100, 100]); assert.equal(first.state.amber, 100); assert.equal(first.state.held, false);
  const pending = construction.reserve(first.builder, 'wall');
  assert.throws(() => construction.complete(pending, () => { throw new Error('Scaffold failed'); }), /Scaffold failed/);
  assert.equal(construction.canPlace(first.builder), false);
  assert.equal(typeof construction.build(first.hero, source, 0, [1, 0, 2]), 'string');
  assert.deepEqual(first.state.resource, [100, 100]); assert.equal(first.state.amber, 100);
  await assert.rejects(construction.settle(), /Scaffold failed/); assert.throws(() => construction.close(), /Finish/);
});
