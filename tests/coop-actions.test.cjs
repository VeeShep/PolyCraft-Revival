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
  const state = { remaining: 4, range: 0, active: true, approach: true, blocked: false, building: false, throwing: false, health: 50, permitted: true, armed: true, inRange: true, ready: true, ammo: 4, collected: 0, fired: 0 };
  const hero = { shouldBeDestroyed: () => false, getRadius: () => 1, getv3Location: () => [0, 0, 0], getEC: name => ({
    ECHealth: { getHealth: () => state.health }, ECPlayerBuilder: { isBuilding: () => state.building, isThrowing: () => state.throwing },
    ECFirearm: { hasWeapon: () => state.armed, isWithinRange: () => state.inRange, getCanFire: () => state.ready, getAmmo: () => state.ammo, clearOverloadProjectile() {}, attemptFire: target => { assert.equal(target, enemy); state.fired++; } }
  })[name] };
  const resource = { shouldBeDestroyed: () => false, getv3Location: () => [1, 0, 0], getDistanceUsingSize: () => state.range, getEC: name => ({
    ECResourceDispenser: { getResource: () => state.remaining }, ECInteractable: { getActive: () => state.active, shouldApproachOnUp: () => state.approach, executeCallbacks: actor => { assert.equal(actor, hero); state.remaining--; state.collected++; } }
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
  actions.receive({ type: 'target', phase: 'release', sequence: 1, target: 'tree' });
  assert.equal(actions.apply(game, hero, players).construction, construction);
  actions.receive({ type: 'preview', sequence: 2, target: 'tree', index: 2, location: [1, 0, 2] });
  assert.deepEqual(actions.apply(game, hero, players), { type: 'preview', sequence: 2, message: 'Cannot build here.', preview });
  assert.equal(state.collected + state.fired, 0);
  state.throwing = true;
  assert.match(actions.execute(game, hero, players, 'tree', null, 'preview', { index: 2, location: [1, 0, 2] }), /Finish/);
});
test('target actions reject replay, authority fields, malformed IDs, queue overflow and excess rate without advancing accepted sequence', () => {
  for (const value of [null, {}, { type: 'target', phase: 'release', sequence: 2, target: 'tree' }, { type: 'target', phase: 'release', sequence: 1, target: '' }, { type: 'target', phase: 'release', sequence: 1, target: 'x'.repeat(257) }, { type: 'target', phase: 'release', sequence: 1, target: 'tree', playerId: 'other' }]) {
    const actions = new HostActions(() => 0); assert.throws(() => actions.receive(value), /Invalid/); assert.equal(actions.sequence, 0);
  }
  let now = 0; const actions = new HostActions(() => now), { game, hero, players } = setup();
  const send = sequence => actions.receive({ type: 'target', phase: 'release', sequence, target: 'missing' });
  send(1); assert.throws(() => send(1), /repeated/);
  for (let i = 2; i <= 4; i++) send(i);
  assert.throws(() => send(5), /Too many/); assert.equal(actions.sequence, 4);
  for (let i = 1; i <= 4; i++) assert.equal(actions.apply(game, hero, players).sequence, i);
  for (let i = 5; i <= 10; i++) { send(i); actions.apply(game, hero, players); }
  assert.throws(() => send(11), /Too many/); now = 1000; send(11);
});
test('movement-required gathering uses only a live reachable unobstructed resource and the assigned actor callback, rechecking depletion for every queued action', () => {
  const { state, game, hero, players } = setup(), actions = new HostActions();
  state.range = 20; assert.match(actions.execute(game, hero, players, 'tree'), /closer/);
  state.range = 0; state.blocked = true; assert.match(actions.execute(game, hero, players, 'tree'), /blocked/);
  state.blocked = false; state.active = false; assert.match(actions.execute(game, hero, players, 'tree'), /No resources/);
  state.active = true; state.throwing = true; assert.match(actions.execute(game, hero, players, 'tree'), /Finish/);
  state.throwing = false; state.remaining = 1;
  actions.receive({ type: 'target', phase: 'release', sequence: 1, target: 'tree' }); actions.receive({ type: 'target', phase: 'release', sequence: 2, target: 'tree' });
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
  const send = (type, sequence) => actions.receive({ type, sequence, target: 'enemy', ...(type === 'target' ? { phase: 'release' } : {}) });
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
test('guest interface events validate ownership and exact intent without pausing or changing the host window', () => {
  const { game, hero, players, state } = setup(), events = [];
  game.eventManager.notify = (name, data) => events.push([name, data]);
  game.isScriptLocked = () => true; state.health = 0;
  game.togglePause = game.startPaused = () => assert.fail('host must keep simulating');
  for (const [type, event] of [['pauseGame', 'PauseGame'], ['enterFullscreen', 'GoFullScreen']]) {
    for (const extra of [{ event: 'Reward' }, { amount: 99 }, { angle: 1 }]) {
      const actions = new HostActions();
      assert.throws(() => actions.receive({ type, sequence: 1, target: 'self', ...extra }), /Invalid/);
    }
    const actions = new HostActions();
    actions.receive({ type, sequence: 1, target: 'tree' });
    assert.match(actions.apply(game, hero, players).message, /own interface/);
    actions.receive({ type, sequence: 2, target: 'self' });
    assert.match(actions.apply(game, hero, players).message, /recorded/);
    assert.deepEqual(events.at(-1), [event, {}]);
    assert.throws(() => actions.receive({ type, sequence: 2, target: 'self' }), /repeated/);
  }
  assert.equal(events.length, 2);
});
function automaticCombat() {
  const f = setup(), { state, hero, game, players } = f, original = hero.getEC;
  state.ready = true; state.ammo = 2; state.targetHealth = 10; state.valid = true; state.distance = 20; state.script = false; state.dead = false;
  const target = { shouldBeDestroyed: () => !!target.toBeDestroyed, getv3Location: () => [state.distance, 0, 0], getEC: name => ({ ECTarget: { isValidTarget: () => state.valid }, ECHealth: { getHealth: () => state.targetHealth } })[name] };
  const firearm = { hasWeapon: () => state.armed, isWithinRange: () => state.distance <= 10, getCanFire: () => state.ready, getCanFireDuration: () => 0.1,
    getAmmo: () => state.ammo, clearOverloadProjectile() { state.cleared = (state.cleared || 0) + 1; },
    attemptFire(value) { assert.equal(value, target); assert.ok(state.ammo > 0 && state.ready); state.fired++; state.ammo--; state.ready = false; } };
  const locomotion = { clearLookAt() {}, setLookAt() {} };
  const automatic = Object.assign(Object.create(require('./runtime-ast.cjs').component('ECAutoFire')), {
    _super() {}, globals: { mathDevice: { v3Distance2DSq: (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2 } },
    archetype: { targetRange: 25, triggerRange: 25, additionalPauseBetweenShots: 0 }, getv3Location: () => hero.getv3Location(), getEntityEC: name => hero.getEC(name), drawTargetCross() {} });
  hero.getEC = name => name === 'ECAutoFire' ? automatic : name === 'ECFirearm' ? firearm : name === 'ECLocomotion' ? locomotion : name === 'ECPlayerLife' ? { isDead: () => state.dead } : original(name);
  game.getGameEntityByName = id => id === 'enemy' ? target : id === 'self' ? hero : undefined;
  game.isScriptLocked = () => state.script; game.eventManager.notify = (name, value) => { assert.equal(name, 'PlayerAttackedTarget'); assert.equal(value, target); };
  players.canDamage = () => state.permitted;
  return { ...f, automatic, target, firearm, actions: new HostActions() };
}
test('guest attack selects original automatic fire at its native trigger range, including while reloading', () => {
  const f = automaticCombat(), { actions, game, hero, players, automatic, state, target } = f;
  actions.receive({ type: 'target', phase: 'release', sequence: 1, target: 'enemy' });
  assert.equal(actions.apply(game, hero, players).message, 'Attack issued.');
  assert.equal(state.fired, 1); assert.equal(state.cleared, 1); assert.equal(automatic.getTargetEntity(), target);
  actions.apply(game, hero, players); automatic.update(); assert.equal(state.fired, 1, 'cooldown remains native');
  state.ready = true; actions.apply(game, hero, players); automatic.update(); assert.equal(state.fired, 2); assert.equal(state.ammo, 0);
  actions.stop(hero); assert.equal(automatic.getTargetEntity(), undefined);
  actions.receive({ type: 'target', phase: 'release', sequence: 2, target: 'enemy' });
  assert.match(actions.apply(game, hero, players).message, /selected.*reloading/); assert.equal(automatic.getTargetEntity(), target);
  automatic.update(); assert.equal(state.fired, 2);
  state.ammo = 2; state.ready = true; actions.apply(game, hero, players); automatic.update(); assert.equal(state.fired, 3);
  state.distance = 26; automatic.update(); assert.equal(automatic.getTargetEntity(), undefined);
  assert.match(actions.execute(game, hero, players, 'enemy'), /range/); assert.equal(state.fired, 3);
  const failed = automaticCombat(); failed.firearm.attemptFire = () => { throw new Error('projectile failed'); };
  assert.throws(() => failed.actions.execute(failed.game, failed.hero, failed.players, 'enemy'), /projectile failed/);
  assert.equal(failed.state.cleared, 1); assert.equal(failed.automatic.getTargetEntity(), undefined);
});
test('retained guest combat rechecks eligibility each host tick and native automatic fire clears unavailable targets', () => {
  for (const failure of ['health', 'targetHealth', 'valid', 'permitted', 'dead', 'script', 'building', 'throwing', 'destroyed']) {
    const { actions, game, hero, players, automatic, state, target } = automaticCombat();
    actions.execute(game, hero, players, 'enemy');
    if (failure === 'destroyed') target.toBeDestroyed = true;
    else state[failure] = ['health', 'targetHealth'].includes(failure) ? 0 : ['valid', 'permitted'].includes(failure) ? false : true;
    state.ready = true; actions.apply(game, hero, players); automatic.update();
    assert.equal(automatic.getTargetEntity(), undefined, failure); assert.equal(state.fired, 1, failure);
  }
  const { actions, game, hero, players, automatic, state } = automaticCombat();
  state.permitted = false; assert.match(actions.execute(game, hero, players, 'enemy'), /protected/); assert.equal(automatic.getTargetEntity(), undefined);
  state.permitted = true; state.valid = false; assert.match(actions.execute(game, hero, players, 'enemy'), /cannot be attacked/); assert.equal(state.fired, 0);
  state.valid = true; state.distance = 2; actions.execute(game, hero, players, 'enemy'); automatic.disable();
  assert.equal(automatic.getTargetEntity(), undefined); assert.equal(state.fired, 1);
});
test('automatic guest combat retains original hero-only PvP protection at selection and later ticks', () => {
  const { CoopPlayers } = require('../desktop/coop-players.js'), { actions, game, hero, target, automatic, state } = automaticCombat();
  hero.isFriendlyWith = target.isFriendlyWith = () => true;
  game.globals = { desktopWorld: { transport: { pvp: false } } };
  const players = Object.assign(Object.create(CoopPlayers.prototype), { game, registry: { data: { host: 'host' } }, active: new Map([['host', { hero }], ['guest', { hero: target }]]) });
  assert.match(actions.execute(game, hero, players, 'enemy'), /protected/); assert.equal(state.fired, 0);
  game.globals.desktopWorld.transport.pvp = true;
  assert.equal(actions.execute(game, hero, players, 'enemy'), 'Attack issued.'); assert.equal(automatic.getTargetEntity(), target);
  players.active.delete('guest'); actions.apply(game, hero, players); assert.equal(automatic.getTargetEntity(), undefined, 'friendly non-hero remains protected');
  assert.match(actions.execute(game, hero, players, 'enemy'), /protected/);
  players.active.set('guest', { hero: target }); actions.execute(game, hero, players, 'enemy');
  game.globals.desktopWorld.transport.pvp = false; actions.apply(game, hero, players); assert.equal(automatic.getTargetEntity(), undefined);
});
test('guest resource clicks preserve actual original no-movement interaction rules for trees and rocks', () => {
  const ast = require('./runtime-ast.cjs'), native = ast.component('ECInteractable'), lift = ast.method('liftTargetedInteractable');
  const names = ['a_v_seed_tree', 'a_v_seed_rock', 'a_r_tree01', 'a_r_tree02', 'a_r_tree04', 'a_r_rock01', 'a_r_rock02', 'a_r_rock03', 'a_r_rock04'];
  for (const name of names) {
    const archetype = ast.archetypeComponent(name, 'ECInteractable');
    const { state, game, hero, resource, players } = setup(), original = resource.getEC;
    const interaction = Object.assign(Object.create(native), { archetype, active: true, onInteractCallbacks: [actor => { assert.equal(actor, hero); state.remaining--; state.collected++; }] });
    assert.equal(interaction.shouldApproachOnUp(hero), false, name);
    resource.getEC = component => component === 'ECInteractable' ? interaction : original(component);
    resource.getDistanceUsingSize = () => assert.fail('direct native interactions have no reach restriction');
    game.getCollisionInfo = () => assert.fail('direct native interactions have no ray obstruction restriction');
    lift.call({ getTargetEntity: () => resource, getHeroEntity: () => hero, setControllableDestination: () => assert.fail('original click must not move this hero') });
    assert.equal(state.collected, 1, name); state.collected = 0; state.remaining = 1;
    const actions = new HostActions(); actions.receive({ type: 'target', phase: 'release', sequence: 1, target: 'tree' });
    assert.match(actions.apply(game, hero, players).message, /gathered/); assert.equal(state.collected, 1, name); assert.equal(state.remaining, 0);
    assert.match(actions.execute(game, hero, players, 'tree'), /No resources/); assert.equal(state.collected, 1);
    state.remaining = 1; interaction.active = false; assert.match(actions.execute(game, hero, players, 'tree'), /No resources/);
    interaction.active = true; state.health = 0; assert.match(actions.execute(game, hero, players, 'tree'), /Finish/);
    state.health = 50; game.isScriptLocked = () => true; assert.match(actions.execute(game, hero, players, 'tree'), /Finish/); assert.equal(state.collected, 1);
  }
});

test('target phases use native host classification: resources and menus wait for release while ranged attacks start once on press', () => {
  const f = setup(), actions = new HostActions(), ast = require('./runtime-ast.cjs'), types = ast.assignedObject('interactTypes');
  const enemy = f.game.getGameEntityByName('enemy'); enemy.hasEC = name => !!enemy.getEC(name);
  const controls = { movementMethods: { targetType: ast.prototypeWith('getv3WorldGroundLocationFromCoord', { GameInputController: { interactTypes: types } }).getSelectedType, rangedType: types.ENEMY_RANGED }, demolitionInfo: () => null };
  let menus = 0; f.game.desktopConstruction = { menu: () => { menus++; return null; } };
  f.state.approach = false;
  const send = (sequence, target, phase) => { actions.receive({ type: 'target', sequence, target, phase }); return actions.apply(f.game, f.hero, f.players, controls); };
  send(1, 'tree', 'press'); assert.equal(f.state.collected, 0); assert.equal(menus, 0);
  send(2, 'tree', 'release'); assert.equal(f.state.collected, 1); assert.equal(menus, 1);
  send(3, 'enemy', 'press'); assert.equal(f.state.fired, 1); assert.equal(menus, 1);
  const other = { ...enemy }; f.game.getGameEntityByName = id => id === 'other' ? other : ({ tree: f.resource, enemy })[id];
  f.players.canDamage = (target, actor) => { assert.ok(target === enemy || target === other); assert.equal(actor, f.hero); return f.state.permitted; };
  send(4, 'other', 'update'); assert.equal(f.state.fired, 1, 'changing between ranged enemies does not re-enter ranged mode');
  send(5, 'other', 'release'); assert.equal(f.state.fired, 1, 'release must not issue a second original press shot');
  send(6, 'tree', 'press'); assert.equal(f.state.collected, 1, 'cancelled/held presses have no deferred resource effect');
  actions.stop(f.hero); assert.equal(actions.targetMode, null);
});
test('target phases reject malformed fields and preserve release capacity with a separately bounded press budget', () => {
  for (const phase of [undefined, null, 'drag', true]) {
    const actions = new HostActions(() => 0); assert.throws(() => actions.receive({ type: 'target', sequence: 1, target: 'tree', phase }), /Invalid/); assert.equal(actions.sequence, 0);
  }
  const actions = new HostActions(() => 0);
  for (let sequence = 1; sequence <= 20; sequence++) {
    actions.receive({ type: 'target', sequence, target: 'tree', phase: sequence % 2 ? 'press' : 'release' }); actions.queue.shift();
  }
  assert.equal(actions.tokens, 0); assert.equal(actions.pressTokens, 0);
  assert.throws(() => actions.receive({ type: 'target', sequence: 21, target: 'tree', phase: 'press' }), /Too many/);
  assert.equal(actions.sequence, 20);
});

function rangedFacingFixture() {
  const f = setup(), ast = require('./runtime-ast.cjs'), types = ast.assignedObject('interactTypes');
  const enemy = f.game.getGameEntityByName('enemy'), position = [2, 0, 0], otherPosition = [9, 0, 4];
  enemy.hasEC = name => !!enemy.getEC(name); enemy.getv3Location = () => position;
  const other = { ...enemy, getv3Location: () => otherPosition }, originalGet = f.hero.getEC;
  const aim = { look: null, facing: null, disabled: 0, now: 0, script: false, removed: false, automatic: null };
  enemy.shouldBeDestroyed = () => aim.removed;
  f.hero.getEC = name => name === 'ECLocomotion' ? { setLookAt: value => { aim.look = [...value]; }, setFacing: value => { aim.facing = [...value]; }, clearLookAt: () => { aim.look = null; }, clearFacing: () => { aim.facing = null; } } : name === 'ECAutoFire' ? {
    getTargetEntity: () => aim.automatic, isWithinFiringRange: () => true, setTargetEntity: target => { aim.automatic = target; }, disable: () => { aim.automatic = null; aim.disabled++; }
  } : originalGet(name);
  f.game.getGameEntityByName = id => ({ enemy, other, tree: f.resource })[id]; f.game.isScriptLocked = () => aim.script;
  f.players.canDamage = (_target, actor) => { assert.equal(actor, f.hero); return f.state.permitted; };
  const controls = { movementMethods: { targetType: ast.prototypeWith('getv3WorldGroundLocationFromCoord', { GameInputController: { interactTypes: types } }).getSelectedType,
    rangedType: types.ENEMY_RANGED, gesture: ast.prototypeWith('updateTargeted') }, demolitionInfo: () => null }, actions = new HostActions(() => aim.now);
  let sequence = 0;
  const send = (target, phase) => { actions.receive({ type: 'target', sequence: ++sequence, target, phase }); return actions.apply(f.game, f.hero, f.players, controls); };
  return { ...f, enemy, aim, actions, controls, send, position, otherPosition };
}
test('original held ranged facing follows live assigned targets without changing automatic-fire identity and clears on release or clear', () => {
  const f = rangedFacingFixture(); f.send('enemy', 'press'); assert.deepEqual(f.aim.look, f.position); assert.deepEqual(f.aim.facing, f.position); assert.equal(f.aim.automatic, f.enemy);
  f.position[0] = 5; f.actions.apply(f.game, f.hero, f.players, f.controls); assert.equal(f.aim.look[0], 5, 'host facing follows a moving entity without trusting another client position');
  f.send('other', 'update'); assert.deepEqual(f.aim.look, f.otherPosition); assert.equal(f.aim.automatic, f.enemy); assert.equal(f.state.fired, 1);
  f.send('other', 'release'); assert.equal(f.aim.look, null); assert.equal(f.aim.facing, null); assert.equal(f.aim.automatic, f.enemy); assert.equal(f.aim.disabled, 0);
  f.send('enemy', 'press'); f.send('enemy', 'clear'); assert.equal(f.aim.look, null); assert.equal(f.aim.facing, null); assert.equal(f.aim.disabled, 0);
  f.actions.stop(f.hero); assert.equal(f.aim.automatic, null); assert.equal(f.aim.disabled, 1);
});
test('held facing expires or clears on host life, script, construction, target and permission changes', () => {
  for (const reason of ['timeout', 'script', 'building', 'throwing', 'health', 'removed', 'permission']) {
    const f = rangedFacingFixture(); f.send('enemy', 'press'); assert.notEqual(f.aim.look, null);
    if (reason === 'timeout') f.aim.now = 601;
    if (reason === 'script') f.aim.script = true;
    if (reason === 'building') f.state.building = true;
    if (reason === 'throwing') f.state.throwing = true;
    if (reason === 'health') f.state.health = 0;
    if (reason === 'removed') f.aim.removed = true;
    if (reason === 'permission') f.state.permitted = false;
    f.actions.apply(f.game, f.hero, f.players, f.controls); assert.equal(f.aim.look, null, reason); assert.equal(f.aim.facing, null, reason);
  }
});

test('standalone, expired and cancelled target updates cannot resume held facing or attack without another press', () => {
  for (const reason of ['standalone', 'timeout', 'release', 'clear', 'stop']) {
    const f = rangedFacingFixture();
    if (reason !== 'standalone') f.send('enemy', 'press');
    if (reason === 'timeout') f.aim.now = 601;
    if (reason === 'release' || reason === 'clear') f.send('enemy', reason);
    if (reason === 'stop') f.actions.stop(f.hero);
    const shots = f.state.fired;
    assert.match(f.send('other', 'update').message, /expired/); f.aim.now = 2000; f.actions.apply(f.game, f.hero, f.players, f.controls);
    assert.equal(f.aim.look, null, reason); assert.equal(f.aim.facing, null, reason); assert.equal(f.state.fired, shots, reason);
  }
  const f = rangedFacingFixture(); f.send('enemy', 'press');
  const failure = new Error('native classification failure'); f.controls.movementMethods.targetType = () => { throw failure; };
  assert.throws(() => f.send('enemy', 'release'), error => error === failure); assert.equal(f.aim.look, null); assert.equal(f.aim.facing, null); assert.equal(f.actions.targetStarted, undefined);
});

test('guest worker acknowledgements use assigned-hero smart range and native callbacks, never host-local selection or duplicate offline credit', () => {
  const f = setup(), ast = require('./runtime-ast.cjs'), native = ast.component('ECWildlingAgent', { Sb: { wildlingHeroFollowingEnabled: false } });
  const s = { position: [6.5, 0, 0], friendly: true, valid: true, active: true, credit: 0, calls: 0, sleeping: false };
  const selectable = { permanentValid: true, triggererList: [], archetype: { smart: true, smartRadiusFactor: 1.2, selectType: 'selectTypeNormal' }, smartValid: false, getValid: () => false };
  const worker = Object.assign(Object.create(native), { waitingForClick: true, isSleeping: () => s.sleeping,
    canBeClicked: () => true, getEntityEC: () => null, doOfflineClickAction() { s.credit++; }, getv3Location: () => s.position,
    wakeUp() { s.sleeping = false; }, gameManager: { getGameSoundManager: () => null, getEventManager: () => ({ notify() {} }), guiManager: { addSpeechBubble() {} } } });
  const interaction = { getActive: () => s.active, executeCallbacks: ast.component('ECInteractable').executeCallbacks, onInteractCallbacks: [actor => { s.calls++; assert.equal(actor, f.hero); native.onInteract.call(worker, actor); }] };
  const target = { shouldBeDestroyed: () => false, isDead: () => false, getv3Location: () => s.position,
    getEC: key => ({ ECWildlingAgent: worker, ECSelectable: selectable, ECInteractable: interaction })[key] };
  const heroGet = f.hero.getEC; f.hero.getEC = key => key === 'ECSmartSelectableTrigger' ? { archetype: { worldRadius: 5.5 } } : heroGet(key);
  f.hero.isFriendlyWith = other => { assert.equal(other, target); return s.friendly; };
  f.game.getGameEntityByName = () => target; f.game.getPlayFlags = () => ({ validSelectTypes: { selectTypeNormal: s.valid } });
  const actions = new HostActions(), run = () => actions.execute(f.game, f.hero, f.players, 'worker');
  assert.match(run().message, /Worker/); assert.equal(s.credit, 1);
  run(); assert.equal(s.credit, 1, 'Native waiting state prevents a second award.');
  worker.waitingForClick = true; s.position = [6.6, 0, 0]; assert.match(run(), /closer/); assert.equal(s.credit, 1);
  selectable.triggererList = [{}]; s.position = [7, 0, 0]; assert.match(run(), /closer/, 'Another hero does not grant hysteresis.');
  selectable.triggererList = [f.hero]; assert.match(run().message || '', /Worker/); assert.equal(s.credit, 2);
  s.position = [7.6, 0, 0]; assert.match(run(), /closer/);
  s.position = [1, 0, 0];
  for (const [key, value] of [['position', [1, -0.51, 0]], ['friendly', false], ['valid', false], ['active', false]]) {
    const before = s[key]; s[key] = value; assert.equal(typeof run(), 'string'); assert.equal(s.credit, 2); assert.equal(s.calls, 3); s[key] = before;
  }
  s.position = [1, 0, 0]; selectable.permanentValid = false; assert.equal(typeof run(), 'string'); assert.equal(s.credit, 2);
  selectable.permanentValid = true; f.state.building = true; assert.match(run(), /Finish/); assert.equal(s.calls, 3);
  f.state.building = false; s.sleeping = true; run(); assert.equal(s.sleeping, false); assert.equal(s.credit, 2); assert.equal(s.calls, 4);
});
