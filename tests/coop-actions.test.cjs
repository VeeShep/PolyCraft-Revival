'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostActions, pickTarget } = require('../desktop/coop-actions.js');
test('build and preview intents accept only an owned copy of a bounded position and product index, never supplied costs or hero identity', () => {
  for (const type of ['build', 'preview']) {
    const valid = { type, sequence: 1, target: 'HQ', index: 0, location: [1, 2, 3] };
    for (const value of [{ ...valid, index: -1 }, { ...valid, index: 32 }, { ...valid, location: [1, NaN, 2] }, { ...valid, location: Array(3) }, { ...valid, location: [1, 2, 1e7] }, { ...valid, location: [1, 2] }, { ...valid, cost: 0 }, { ...valid, playerId: 'another' }]) {
      const actions = new HostActions(); assert.throws(() => actions.receive(value), /Invalid/); assert.equal(actions.sequence, 0);
    }
    const actions = new HostActions(); actions.receive(valid); valid.location[0] = 999;
    assert.deepEqual(actions.queue[0].location, [1, 2, 3]); assert.throws(() => actions.receive(valid), /repeated/);
  }
});
function setup() {
  const state = { remaining: 4, range: 0, active: true, blocked: false, building: false, throwing: false, health: 50, permitted: true, armed: true, inRange: true, ready: true, ammo: 4, collected: 0, fired: 0 };
  const hero = { shouldBeDestroyed: () => false, getRadius: () => 1, getv3Location: () => [0, 0, 0], getEC: name => ({
    ECHealth: { getHealth: () => state.health }, ECPlayerBuilder: { isBuilding: () => state.building, isThrowing: () => state.throwing },
    ECFirearm: { hasWeapon: () => state.armed, isWithinRange: () => state.inRange, getCanFire: () => state.ready, getAmmo: () => state.ammo, attemptFire: target => { assert.equal(target, enemy); state.fired++; } }
  })[name] };
  const resource = { shouldBeDestroyed: () => false, getv3Location: () => [1, 0, 0], getDistanceUsingSize: () => state.range, getEC: name => ({
    ECResourceDispenser: { getResource: () => state.remaining }, ECInteractable: { getActive: () => state.active, executeCallbacks: actor => { assert.equal(actor, hero); state.remaining--; state.collected++; } }
  })[name] };
  const enemy = { shouldBeDestroyed: () => false, getv3Location: () => [2, 0, 0], getEC: name => ({ ECTarget: { isValidTarget: () => true }, ECHealth: { getHealth: () => 10 } })[name] };
  const game = { getGameEntityByName: id => ({ tree: resource, enemy, self: hero })[id], isScriptLocked: () => false,
    getCollisionInfo: () => state.blocked ? { collidedEntity: {} } : null,
    eventManager: { notify: (name, target) => { assert.equal(name, 'PlayerAttackedTarget'); assert.equal(target, enemy); } } };
  const players = { canDamage: (target, actor) => { assert.equal(target, enemy); assert.equal(actor, hero); return state.permitted; } };
  return { state, hero, resource, game, players };
}
test('target menus and previews use the assigned hero and current host construction metadata without requesting a save', () => {
  const { game, hero, resource, players, state } = setup(), actions = new HostActions();
  const construction = { source: 'tree', move: false, repair: null, upgrade: null, demolition: null, products: [{}] }, preview = { valid: false };
  game.desktopConstruction = {
    menu(actor, source) { assert.equal(actor, hero); assert.equal(source, resource); return construction; },
    preview(actor, source, index, location) {
      assert.equal(actor, hero); assert.equal(source, resource); assert.equal(index, 2); assert.deepEqual(location, [1, 0, 2]);
      return { message: 'Cannot build here.', preview };
    }
  };
  actions.receive({ type: 'target', sequence: 1, target: 'tree' });
  assert.equal(actions.apply(game, hero, players).construction, construction);
  actions.receive({ type: 'preview', sequence: 2, target: 'tree', index: 2, location: [1, 0, 2] });
  assert.deepEqual(actions.apply(game, hero, players), { type: 'preview', sequence: 2, message: 'Cannot build here.', preview });
  assert.equal(state.collected + state.fired, 0);
  state.throwing = true;
  assert.match(actions.execute(game, hero, players, 'tree', null, 'preview', { index: 2, location: [1, 0, 2] }), /Finish/);
});
test('target actions reject replay, authority fields, malformed IDs, queue overflow and excess rate without advancing accepted sequence', () => {
  for (const value of [null, {}, { type: 'target', sequence: 2, target: 'tree' }, { type: 'target', sequence: 1, target: '' }, { type: 'target', sequence: 1, target: 'x'.repeat(257) }, { type: 'target', sequence: 1, target: 'tree', playerId: 'other' }]) {
    const actions = new HostActions(() => 0); assert.throws(() => actions.receive(value), /Invalid/); assert.equal(actions.sequence, 0);
  }
  let now = 0; const actions = new HostActions(() => now), { game, hero, players } = setup();
  const send = sequence => actions.receive({ type: 'target', sequence, target: 'missing' });
  send(1); assert.throws(() => send(1), /repeated/);
  for (let i = 2; i <= 4; i++) send(i);
  assert.throws(() => send(5), /Too many/); assert.equal(actions.sequence, 4);
  for (let i = 1; i <= 4; i++) assert.equal(actions.apply(game, hero, players).sequence, i);
  for (let i = 5; i <= 10; i++) { send(i); actions.apply(game, hero, players); }
  assert.throws(() => send(11), /Too many/); now = 1000; send(11);
});
test('gathering uses only a live reachable unobstructed resource and the assigned actor callback, rechecking depletion for every queued action', () => {
  const { state, game, hero, players } = setup(), actions = new HostActions();
  state.range = 20; assert.match(actions.execute(game, hero, players, 'tree'), /closer/);
  state.range = 0; state.blocked = true; assert.match(actions.execute(game, hero, players, 'tree'), /blocked/);
  state.blocked = false; state.active = false; assert.match(actions.execute(game, hero, players, 'tree'), /No resources/);
  state.active = true; state.throwing = true; assert.match(actions.execute(game, hero, players, 'tree'), /Finish/);
  state.throwing = false; state.remaining = 1;
  actions.receive({ type: 'target', sequence: 1, target: 'tree' }); actions.receive({ type: 'target', sequence: 2, target: 'tree' });
  assert.match(actions.apply(game, hero, players).message, /gathered/); assert.match(actions.apply(game, hero, players).message, /No resources/);
  assert.equal(state.collected, 1); assert.equal(actions.apply(game, hero, players), null);
});
test('combat rejects protected, out-of-range, unarmed, dead and reloading actors and fires through the original weapon only when eligible', () => {
  const { state, game, hero, players } = setup(), actions = new HostActions();
  for (const [key, value, message] of [['permitted', false, /protected/], ['inRange', false, /range/], ['armed', false, /range/], ['ready', false, /reloading/], ['ammo', 0, /reloading/], ['health', 0, /Finish/]]) {
    const previous = state[key]; state[key] = value; assert.match(actions.execute(game, hero, players, 'enemy'), message); assert.equal(state.fired, 0); state[key] = previous;
  }
  assert.match(actions.execute(game, hero, players, 'missing'), /unavailable/);
  assert.match(actions.execute(game, hero, players, 'self'), /cannot be attacked/);
  assert.equal(actions.execute(game, hero, players, 'enemy'), 'Attack issued.'); assert.equal(state.fired, 1);
});
test('demolition selects host metadata, rechecks protection at execution and requests a fresh save only after removal', () => {
  const { state, game, hero, players } = setup(), actions = new HostActions();
  let removed = 0, reason = '', available = true;
  const controls = { demolitionInfo: () => available ? { id: 'enemy', name: 'Storage', reason } : null,
    demolishBuilding: id => { assert.equal(id, 'enemy'); removed++; } };
  const send = (type, sequence) => actions.receive({ type, sequence, target: 'enemy' });
  send('target', 1); assert.deepEqual(actions.apply(game, hero, players, controls), { type: 'target', sequence: 1, message: 'Building selected.', building: { id: 'enemy', name: 'Storage', reason: '', movable: false } });
  send('demolish', 2); reason = 'Remove the buildings above this one first';
  assert.equal(actions.apply(game, hero, players, controls).message, reason); assert.equal(removed, 0);
  reason = ''; send('demolish', 3);
  assert.deepEqual(actions.apply(game, hero, players, controls), { type: 'demolish', sequence: 3, message: 'Building demolished and saved.', save: true });
  assert.equal(removed, 1); assert.equal(state.collected + state.fired, 0);
  available = false; send('demolish', 4); assert.match(actions.apply(game, hero, players, controls).message, /cannot be demolished/); assert.equal(removed, 1);
});
test('guest picking maps CSS pixels to the rendered scene and ignores own hero, hidden meshes and noninteractive art', () => {
  const record = (id, location, visible = true) => ({ record: { id, location, archetype: null, interactive: id !== 'art', mesh: { visible } } });
  const world = { identity: { entity: 'self' }, controls: { app: { globals: { graphicsDevice: { width: 200, height: 100, canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }) } }, camera: { worldToScreen: location => location } } } },
    game: { getEntityFactory: () => ({ getECArchetype: (id, component) => id !== 'art' && component === 'ECTarget' }) },
    scene: { entities: new Map([['self', record('self', [40, 20])], ['art', record('art', [40, 20])], ['hidden', record('hidden', [40, 20], false)], ['enemy', record('enemy', [45, 20])]]) } };
  assert.equal(pickTarget(world, { clientX: 30, clientY: 30 }), 'enemy');
  world.scene.entities.get('enemy').displayLocation = [45, 20]; world.scene.entities.get('enemy').record.location = [200, 200];
  assert.equal(pickTarget(world, { clientX: 30, clientY: 30 }), 'enemy', 'Picking follows the visible interpolated target, not its newer authoritative position');
  assert.equal(pickTarget(world, { clientX: 100, clientY: 65 }), null);
});
