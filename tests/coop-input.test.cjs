'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostMovement, GuestMovement } = require('../desktop/coop-input.js');
function hero() {
  let destination = null, health = 50;
  return { getv3Location: () => [10, 2, 20], getEC: name => ({ ECHealth: { getHealth: () => health }, ECLocomotion: { setDestination: value => { destination = value; }, clearDestination: () => { destination = null; }, clearDestinationEntity() {} } })[name],
    destination: () => destination, die: () => { health = 0; } };
}
test('discarded movement still validates/advances sequence and cannot replay walking or a previous direction on rollback', () => {
  const input = new HostMovement(), actor = hero();
  input.receive({ type: 'move', sequence: 1, move: [1, 0] }); input.apply(actor); assert.ok(actor.destination());
  input.discard(); input.apply(actor); assert.equal(actor.destination(), null); assert.equal(input.sequence, 1);
  input.receive({ type: 'walk', sequence: 2, mode: 'click', location: [15, 2, 20] }, true);
  assert.equal(input.pendingWalk, null); input.apply(actor); assert.equal(actor.destination(), null);
  input.receive({ type: 'move', sequence: 3, move: [1, 0] }, true); input.apply(actor); assert.equal(actor.destination(), null);
  assert.throws(() => input.receive({ type: 'move', sequence: 5, move: [0, 0] }, true), /Invalid/);
  input.receive({ type: 'move', sequence: 4, move: [0, 1] }); input.apply(actor); assert.deepEqual(actor.destination(), [10, 2, 25]);
});
test('host applies normalized intent through the assigned hero locomotion and stops on neutral, timeout or death', () => {
  let now = 0; const input = new HostMovement(() => now), actor = hero(), other = hero();
  input.receive({ type: 'move', sequence: 1, move: [1, 0] }); input.apply(actor);
  assert.deepEqual(actor.destination(), [15, 2, 20]); assert.equal(other.destination(), null);
  now = 601; input.apply(actor); assert.equal(actor.destination(), null);
  input.receive({ type: 'move', sequence: 2, move: [0, -1] }); input.apply(actor);
  assert.deepEqual(actor.destination(), [10, 2, 15]);
  input.receive({ type: 'move', sequence: 3, move: [0, 0] }); input.apply(actor); assert.equal(actor.destination(), null);
  input.receive({ type: 'move', sequence: 4, move: [1, 0] }); input.apply(actor);
  actor.die(); input.apply(actor); assert.equal(actor.destination(), null);
});
test('movement trust boundary rejects replays, skipped sequences, forged identities, authoritative edits and invalid directions without advancing accepted state', () => {
  for (const value of [
    { type: 'move', sequence: 2, move: [0, 1] }, { type: 'move', sequence: 1, move: [1, 1] },
    { type: 'move', sequence: 1, move: [NaN, 0] }, { type: 'move', sequence: 1, move: [Infinity, 0] },
    { type: 'move', sequence: 1, move: Array(2) }, { type: 'move', sequence: 1, move: [0, '1'] },
    { type: 'move', sequence: 1, move: [0, 1], playerId: 'another-hero' },
    { type: 'progress', sequence: 1, xp: 1000 }, { type: 'move', sequence: 1, move: [2, 0] }
  ]) {
    const input = new HostMovement(() => 0);
    assert.throws(() => input.receive(value), /Invalid/); assert.equal(input.sequence, 0); assert.deepEqual(input.move, [0, 0]);
  }
  const input = new HostMovement(() => 0), valid = { type: 'move', sequence: 1, move: [0, 1] };
  input.receive(valid); assert.throws(() => input.receive(valid), /repeated/); assert.equal(input.sequence, 1);
});
test('per-peer movement rate is bounded and refills with monotonic elapsed time', () => {
  let now = 0; const input = new HostMovement(() => now);
  for (let sequence = 1; sequence <= 30; sequence++) input.receive({ type: 'move', sequence, move: [0, 1] });
  assert.throws(() => input.receive({ type: 'move', sequence: 31, move: [0, 1] }), /Too many/);
  assert.equal(input.sequence, 30); now = 1000;
  input.receive({ type: 'move', sequence: 31, move: [0, 0] }); assert.equal(input.sequence, 31);
});
test('guest camera-relative keys normalize diagonals, cancel opposing aliases and send neutral on menus/focus loss', async t => {
  const names = ['document', 'addEventListener', 'removeEventListener', 'desktop', 'PointerEvent'];
  const previous = Object.fromEntries(names.map(name => [name, global[name]]));
  t.after(() => { for (const name of names) if (previous[name] === undefined) delete global[name]; else global[name] = previous[name]; });
  const listeners = new Map(), sent = [], canvas = { focus() { global.document.activeElement = canvas; } };
  let focused = true, modal = false;
  global.document = { activeElement: canvas, hasFocus: () => focused, querySelector: () => modal ? {} : null, getElementById: name => name === 'launcher' ? { hidden: true } : canvas };
  global.addEventListener = (name, handler, options) => { assert.deepEqual(options, { capture: true, passive: false }); listeners.set(name, handler); };
  global.removeEventListener = name => listeners.delete(name);
  const controls = { paused: false, app: { globals: { camera: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] } } } };
  let clicks = 0;
  global.PointerEvent = function () {};
  const world = { controls, identity: {}, scene: { snapshot: {} }, clickTarget: () => { clicks++; }, connection: { state: 'connected', send: async (kind, value) => { sent.push({ kind, value }); }, fail: error => { throw error; } } };
  let nativeFocus, removed = false;
  global.desktop = { windowFocused: async () => true, onWindowFocusChanged: callback => { nativeFocus = callback; return () => { removed = true; }; } };
  const input = new GuestMovement(world); t.after(() => input.close());
  await Promise.resolve();
  const arrow = code => ({ code, preventDefault() {}, stopImmediatePropagation() {} });
  listeners.get('keydown')(arrow('ArrowLeft')); assert.equal(input.keys.has('ArrowLeft'), true); assert.deepEqual(input.direction(), [0, 0]);
  listeners.get('keyup')(arrow('ArrowLeft')); assert.equal(input.keys.has('ArrowLeft'), false);
  listeners.get('keydown')(arrow('ArrowRight')); listeners.get('blur')(); assert.equal(input.keys.size, 0);
  const click = { target: canvas, button: 0, preventDefault() {}, stopImmediatePropagation() {} };
  listeners.get('pointerdown')(click); listeners.get('mousedown')(click);
  assert.equal(clicks, 1, 'Use pointer-down without duplicating its compatibility mouse event');
  input.keys.add('KeyW'); assert.deepEqual(input.direction(), [0, -1]);
  world.lifeState = { phase: 'waiting' }; assert.equal(input.available(), false); world.lifeState = { phase: 'normal' };
  input.keys.add('ArrowUp'); input.keys.add('KeyS'); assert.deepEqual(input.direction(), [0, 0]);
  input.keys.delete('KeyS'); input.keys.add('KeyD'); assert.ok(Math.abs(Math.hypot(...input.direction()) - 1) < 1e-12);
  await input.flush(); assert.equal(sent[0].kind, 'action'); assert.equal(sent[0].value.sequence, 1);
  modal = true; await input.flush(); assert.deepEqual(sent[1].value.move, [0, 0]); assert.equal(input.keys.size, 0);
  modal = false; input.keys.add('KeyW'); input.lastSent = -Infinity; await input.flush();
  focused = false; listeners.get('blur')(); await input.flush();
  assert.deepEqual(sent.at(-1).value.move, [0, 0]);
  focused = true; input.keys.add('KeyW'); input.lastSent = -Infinity; await input.flush();
  nativeFocus(false); await input.flush(); assert.deepEqual(sent.at(-1).value.move, [0, 0]);
  let pauses = 0; world.togglePauseMenu = () => { pauses++; };
  let fullscreens = 0; world.toggleFullscreen = () => { fullscreens++; };
  listeners.get('keydown')({ ...arrow('KeyF'), repeat: false }); listeners.get('keydown')({ ...arrow('KeyF'), repeat: true }); assert.equal(fullscreens, 1);
  listeners.get('keydown')({ ...arrow('Enter'), altKey: true }); assert.equal(fullscreens, 2);
  listeners.get('keydown')({ ...arrow('KeyF'), ctrlKey: true }); assert.equal(fullscreens, 2);
  controls.fullscreen = true; listeners.get('keydown')(arrow('Escape')); assert.equal(fullscreens, 3); controls.fullscreen = false;
  const key = repeat => ({ code: 'KeyP', repeat, preventDefault() {}, stopImmediatePropagation() {} });
  listeners.get('keydown')(key(false)); listeners.get('keydown')(key(true)); assert.equal(pauses, 1);
  let cancelled = 0;
  world.localMenu = () => true; world.cancelLocalMenu = () => { cancelled++; };
  nativeFocus(true); input.keys.add('KeyW'); assert.equal(input.available(), false);
  listeners.get('keydown')({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(cancelled, 1); assert.equal(input.keys.size, 0);
  let heldCancellations = 0; world.construction = { placement: { held: true }, cancelHeld() { heldCancellations++; } };
  listeners.get('keydown')({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(heldCancellations, 1); assert.equal(cancelled, 1, 'Escape must request authoritative held cancellation rather than silently hide it');
  world.construction = null; let dismissed = 0; world.lifeState = { phase: 'normal' }; world.campaign = { result: {}, dismissResult() { dismissed++; this.result = null; } };
  listeners.get('keydown')({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }); assert.equal(dismissed, 1); assert.equal(cancelled, 1);
  world.campaign.result = {}; world.pauseMenu = true;
  listeners.get('keydown')({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }); assert.equal(dismissed, 1); assert.equal(cancelled, 2);
  world.pauseMenu = false; world.lifeState.phase = 'waiting';
  listeners.get('keydown')({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }); assert.equal(dismissed, 1); assert.equal(cancelled, 3);
  world.lifeState = world.campaign = null;

  world.localMenu = () => false; world.construction = null; input.keys.clear();
  if (input.pending) await input.pending;
  const point = [30, 999, 20]; input.requestWalk(point); point[0] = 999;
  const walk = sent.at(-1).value; assert.equal(walk.type, 'walk'); assert.deepEqual(walk.location, [30, 999, 20]);
  const before = sent.length; await input.flush(); assert.equal(sent.length, before, 'neutral idle ticks retain a click path');
  world.localMenu = () => true; await input.flush(); assert.equal(sent.at(-1).value.type, 'move'); assert.deepEqual(sent.at(-1).value.move, [0, 0]); assert.equal(sent.at(-1).value.sequence, walk.sequence + 1);
  world.localMenu = () => false; input.requestWalk([30, 2, 20]); world.resyncing = true; await input.flush(); assert.deepEqual(sent.at(-1).value.move, [0, 0]);
  world.resyncing = false; input.requestWalk([30, 2, 20]); nativeFocus(false); await input.flush(); assert.deepEqual(sent.at(-1).value.move, [0, 0]);
  nativeFocus(true); input.keys.add('KeyW'); const count = sent.length; input.requestWalk([30, 2, 20]); assert.equal(sent.length, count, 'held movement keys take priority over ground clicks');
  const pointerCancellations = []; world.cancelGroundDrag = stop => pointerCancellations.push(stop);
  listeners.get('lostpointercapture')({ target: {} }); assert.equal(pointerCancellations.length, 0);
  listeners.get('pointercancel')({ target: canvas }); listeners.get('lostpointercapture')({ target: canvas });
  listeners.get('pointerup')({ target: {} }); assert.deepEqual(pointerCancellations, [true, true, true]);
  input.close(); assert.equal(listeners.size, 0); assert.equal(removed, true);
});
function walkingFixture() {
  const ast = require('./runtime-ast.cjs'), position = [10, 2, 20], state = { admit: true, blocked: true, space: true, dead: false, script: false, building: false, throwing: false, queries: 0, chargeCancelled: 0 };
  const math = { v3Copy: a => [...a], v3Sub: (a, b) => a.map((v, i) => v - b[i]), v3ScalarMul: (a, b) => a.map(v => v * b), v3Normalize: a => a.map(v => v / Math.hypot(...a)), v3Dot: (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0), v3Distance2DSq: (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2 };
  const locomotion = { destination: null, entity: {}, setDestination(value, run) { this.destination = [...value]; this.run = run; }, clearDestination() { this.destination = null; }, clearDestinationEntity() { this.entity = null; } };
  const hero = { getv3Location: () => position, getCentreLocation: () => [position[0], position[1] + 0.25, position[2]], getEC: name => ({ ECHealth: { getHealth: () => 50 }, ECPlayerLife: { isDead: () => state.dead }, ECLocomotion: locomotion, ECNav: nav, ECPlayerBuilder: { isBuilding: () => state.building, isThrowing: () => state.throwing }, ECChargeAttack: { cancel: () => { state.chargeCancelled++; } } })[name] };
  const path = { getEndWaypointIndex: () => 2, getV3WaypointLocationByIndex: index => index === 1 ? [10, 2, 25] : [30, 2, 20] };
  const game = { globals: { mathDevice: math, gameCurrentTime: 1 }, isScriptLocked: () => state.script, getGameSpace: () => state.space ? {} : null,
    getCollisionInfo: (start, end) => { assert.equal(start[1], 2.25); assert.equal(end[1], 2.25); return state.blocked ? { v3Location: [15, 2.25, 20], v3Normal: [-1, 0, 0] } : null; },
    getNavManager: () => ({ getPathQueryPeriod: () => 1, getV3ToV3Path(start, end, faction, heights, force) { state.queries++; state.requested = [...end]; assert.equal(start, position); assert.equal(force, true); assert.deepEqual(Array.from(heights), [0.5, -2]); return state.admit ? path : null; } }) };
  const nav = Object.assign(Object.create(ast.component('ECNav')), { _super() {}, globals: game.globals, gameManager: game, entity: hero, path: null, lastQueryTime: 0, archetype: { canClimb: true, canDrop: true }, getv3Location: () => position, getEntityEC: name => hero.getEC(name) });
  const controls = { movementMethods: { destination: ast.method('setControllableDestination'), collision: ast.prototypeWith('getv3WorldGroundLocationFromCoord').buildCollisionInfo } };
  let now = 0; const input = new HostMovement(() => now);
  return { hero, game, controls, input, nav, locomotion, position, state, time: value => { now = value; } };
}
test('walking trust boundary owns finite destinations and rate limits path queries without accepting actor or speed authority', () => {
  for (const extra of [{ location: Array(3) }, { location: [0, NaN, 1] }, { location: [0, Infinity, 1] }, { location: [0, 1e7, 1] }, { location: [1, 2] }, { target: 'another hero' }, { speed: 100 }, { run: true }]) {
    const input = new HostMovement(() => 0); assert.throws(() => input.receive({ type: 'walk', mode: 'click', sequence: 1, location: [1, 2, 3], ...extra }), /Invalid/); assert.equal(input.sequence, 0);
  }
  let now = 0; const input = new HostMovement(() => now), location = [1, 2, 3];
  input.receive({ type: 'walk', mode: 'click', sequence: 1, location }); location[0] = 99; assert.deepEqual(input.pendingWalk, { location: [1, 2, 3], mode: 'click' });
  assert.throws(() => input.receive({ type: 'walk', mode: 'click', sequence: 1, location }), /repeated/);
  for (let sequence = 2; sequence <= 4; sequence++) input.receive({ type: 'walk', mode: 'click', sequence, location });
  assert.throws(() => input.receive({ type: 'walk', mode: 'click', sequence: 5, location }), /Too many walking/); assert.equal(input.sequence, 4);
  now = 1000; input.receive({ type: 'walk', mode: 'click', sequence: 5, location }); assert.equal(input.sequence, 5);
});
test('ground clicks use actual native navigation, authoritative height and original collision fallback without teleporting', () => {
  const f = walkingFixture(); f.input.receive({ type: 'walk', mode: 'click', sequence: 1, location: [30, 999, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.deepEqual(f.state.requested, [30, 2, 20]); assert.deepEqual(f.position, [10, 2, 20]); assert.deepEqual(f.locomotion.destination, [10, 2, 25]); assert.equal(f.state.chargeCancelled, 1); assert.equal(f.locomotion.entity, null);
  f.time(10000); f.input.apply(f.hero, f.game, f.controls); assert.ok(f.nav.path, 'click paths survive idle keyboard timeout');
  f.position[2] = 25; f.nav.update(); assert.deepEqual(f.locomotion.destination, [30, 2, 20]);
  f.input.receive({ type: 'walk', mode: 'click', sequence: 2, location: [...f.position] }); f.input.apply(f.hero, f.game, f.controls);
  assert.equal(f.nav.path, null); assert.equal(f.locomotion.destination, null, 'same-position clicks cannot revive an old waypoint');
  f.state.admit = false; f.input.receive({ type: 'walk', mode: 'click', sequence: 3, location: [30, 0, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.equal(f.nav.path, null); assert.ok(Math.abs(f.locomotion.destination[0] - 14.65) < 1e-9, 'original normal-clearance collision fallback');
  f.state.blocked = false; f.state.space = false; f.input.receive({ type: 'walk', mode: 'click', sequence: 4, location: [30, 500, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.deepEqual(f.locomotion.destination, [30, 2, 20]);
});
test('neutral cancellation, keyboard takeover, life/script/construction guards and forced disconnect clear both native path and destination', () => {
  for (const reason of ['neutral', 'keyboard', 'dead', 'script', 'building', 'throwing', 'disconnect']) {
    const f = walkingFixture(); f.input.receive({ type: 'walk', mode: 'click', sequence: 1, location: [30, 2, 20] }); f.input.apply(f.hero, f.game, f.controls);
    if (reason === 'disconnect') f.input.stop(f.hero, true);
    else { if (['neutral', 'keyboard'].includes(reason)) f.input.receive({ type: 'move', sequence: 2, move: reason === 'keyboard' ? [1, 0] : [0, 0] }); else f.state[reason] = true; f.input.apply(f.hero, f.game, f.controls); }
    assert.equal(f.nav.path, null, reason); assert.equal(f.locomotion.entity, null, reason); assert.deepEqual(f.locomotion.destination, reason === 'keyboard' ? [15, 2, 20] : null, reason);
  }
});
test('a click following keyboard release stays ordered through send backpressure and only explicit cancellation sends neutral', async () => {
  const input = Object.create(GuestMovement.prototype), sent = []; let release, direction = [1, 0], available = true;
  Object.assign(input, { sequence: 0, lastMove: [0, 0], lastSent: -Infinity, keys: new Set(), available: () => available, direction: () => direction,
    world: { identity: {}, scene: { snapshot: {} }, connection: { state: 'connected', send(_kind, value) { sent.push(value); return value.sequence === 1 ? new Promise(done => { release = done; }) : Promise.resolve(); }, fail: error => { throw error; } } } });
  const sending = input.flush(); direction = [0, 0]; input.flush(); input.requestWalk([30, 2, 20]);
  input.requestWalk([40, 2, 20], 'drag'); input.requestWalk([50, 2, 20], 'release');
  assert.deepEqual(sent.map(value => [value.type, value.sequence]), [['move', 1]], 'walking waits behind the pending send');
  release(); await sending; assert.equal(sent.length, 2, 'a late dirty keyboard flush must not cancel the new path');
  assert.equal(sent[1].mode, 'release'); assert.deepEqual(sent[1].location, [50, 2, 20]); assert.equal(sent[1].sequence, 2, 'only the latest queued pointer intent receives a sequence');
  available = false; await input.flush(); assert.equal(sent[2].type, 'move'); assert.equal(sent[2].sequence, 3); assert.deepEqual(sent[2].move, [0, 0]);
});
test('native drag steering uses fixed native run/collision modes, cannot spend path-query budget and expires when stale', () => {
  const f = walkingFixture();
  f.input.receive({ type: 'walk', mode: 'drag', sequence: 1, location: [30, 999, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.equal(f.state.queries, 0); assert.equal(f.input.walkTokens, 4); assert.deepEqual(f.locomotion.destination, [30, 2, 20]); assert.equal(f.locomotion.run, true); assert.equal(f.nav.path, null);
  f.time(601); f.input.apply(f.hero, f.game, f.controls); assert.equal(f.locomotion.destination, null);
  f.input.receive({ type: 'walk', mode: 'drag', sequence: 2, location: [30, 2, 20] }); f.time(1300); f.input.apply(f.hero, f.game, f.controls); assert.equal(f.locomotion.destination, null, 'expired queued steering cannot restart movement');
  f.state.admit = false; f.input.receive({ type: 'walk', mode: 'release', sequence: 3, location: [30, 2, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.equal(f.state.queries, 1); assert.equal(f.locomotion.run, true); assert.ok(Math.abs(f.locomotion.destination[0] - 14.65) < 1e-9);
  f.time(5000); f.input.apply(f.hero, f.game, f.controls); assert.ok(f.locomotion.destination, 'released navigation retains the native destination');
  for (const mode of [undefined, 'teleport', true]) assert.throws(() => new HostMovement().receive({ type: 'walk', sequence: 1, location: [1, 2, 3], mode }), /Invalid/);
});
test('drag steering advances native held movement and bump charge per host tick rather than per received packet', () => {
  const ast = require('./runtime-ast.cjs'), movement = ast.component('ECLocomotion'), bumpMethods = ast.component('ECBumpAttack');
  for (const fps of [30, 60, 120]) {
    const f = walkingFixture(), globals = f.game.globals; f.state.blocked = false;
    globals.gameTimeStep = 1 / fps;
    Object.assign(globals.mathDevice, { v3BuildZero: () => [0, 0, 0], v3LengthSq: v => v.reduce((sum, x) => sum + x * x, 0), v3Normalize(v, out = v) { const length = Math.hypot(...v); for (let i = 0; i < 3; i++) out[i] = v[i] / length; return out; } });
    Object.assign(f.locomotion, { globals, timeHeld: 0, _super() {}, updateLocomotion() {},
      ...Object.fromEntries(['setDestination', 'clearDestination', 'getDestination', 'hasDestination', 'getTimeHeld', 'update'].map(name => [name, movement[name]])) });
    const enemy = { shouldBeDestroyed: () => false, getEC: name => name === 'ECAgent' ? {} : null, getv3Location: () => [12, 2, 20] };
    f.hero.isFriendlyWith = () => false;
    f.game.applyToEntitiesInGridCellsWithinRadius = (_point, radius, visit) => { assert.equal(radius, 3); visit(enemy); };
    const bump = Object.assign(Object.create(bumpMethods), { globals, gameManager: f.game, entity: f.hero, scratchpad: {}, _super() {}, getv3Location: () => f.hero.getv3Location(), getEntityEC: name => f.hero.getEC(name) });
    let sequence = 0, nextPacket = 0;
    for (let frame = 0; frame < fps; frame++) {
      const now = frame * 1000 / fps; f.time(now);
      if (now + 1e-6 >= nextPacket) { f.input.receive({ type: 'walk', mode: 'drag', sequence: ++sequence, location: [30, 999, 20] }); nextPacket += 50; }
      f.input.apply(f.hero, f.game, f.controls); f.locomotion.update();
    }
    assert.ok(f.locomotion.getTimeHeld() > 0.9, fps + ' Hz native held time must advance between 20 Hz packets');
    bump.update(); assert.equal(bump.targetEntity, enemy); assert.equal(bump.getSpeedMod(), 1.5);
    assert.equal(f.input.sequence, sequence); assert.equal(f.input.walkTokens, 4); assert.equal(f.state.queries, 0, 'retained drag must not issue path searches');
    f.time(1601); f.input.apply(f.hero, f.game, f.controls); bump.update(); assert.equal(bump.targetEntity, undefined); assert.equal(bump.getSpeedMod(), 1);
  }
});
test('a cancelled pointer intent stays cancelled if focus returns before a slow send completes', async () => {
  const input = Object.create(GuestMovement.prototype), sent = []; let finish, available = true;
  Object.assign(input, { sequence: 0, lastMove: [0, 0], lastSent: -Infinity, available: () => available, direction: () => [0, 0],
    world: { identity: {}, scene: { snapshot: {} }, connection: { state: 'connected', send(_kind, value) { sent.push(value); return value.sequence === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(); }, fail: error => { throw error; } } } });
  input.requestWalk([30, 2, 20]); const pending = input.pending;
  input.requestWalk([40, 2, 20], 'drag'); available = false; input.flush(); available = true;
  finish(); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.map(value => value.type), ['walk', 'move']); assert.deepEqual(sent[1].move, [0, 0]); assert.equal(input.queuedWalk, null); assert.equal(input.walkRequested, false);
});

function targetedGesture(type) {
  const types = { NONE: 0, INTERACTABLE: 1, ENEMY_RANGED: 2 }, calls = [];
  const methods = require('./runtime-ast.cjs').prototypeWith('updateTargeted', { GameInputController: { interactTypes: types } });
  let target = { getEC: name => name === 'ECInteractable' ? { shouldApproachOnUp: () => false, executeCallbacks: actor => { assert.equal(actor, hero); calls.push('gather'); } } : null };
  const hero = { getEC: () => null }, view = Object.assign(Object.create(methods), {
    globals: { appCurrentTime: 0, mathDevice: { v2DistanceSq: (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 } },
    prevDown: true, downTime: 0, downv2ScreenCoord: [0, 0], crashMobController: { getv2ScreenCoord: () => [100, 0], controlNavigate: true },
    getHeroEntity: () => hero, getTargetEntity: () => target, calculateNearestTarget() {}, getSelectionRadius: () => 1, getAddedSelectionRadius: () => 0,
    getSelectedType: () => types[type], clearTargetEntity() { target = null; calls.push('clear'); },
    setControllableDestination(...flags) { calls.push(['destination', ...flags]); }, attackRangedTargetedEntity() { calls.push('attack'); },
    activateTargetEntityIfValid() { calls.push('activate'); }, endTargeted() { calls.push('end'); }
  });
  view.beginTargeted();
  return { view, calls };
}
test('original targeted resources wait for release; a swipe alone retains targeting but a hold switches to native movement', () => {
  const short = targetedGesture('INTERACTABLE'); short.view.updateFunction(); short.view.downFunction();
  assert.deepEqual(short.calls, [], 'a resource press and large swipe do not gather or abandon a retained target');
  short.view.liftFunction(); assert.deepEqual(short.calls, ['gather', 'activate', 'end']);
  const held = targetedGesture('INTERACTABLE'); held.view.globals.appCurrentTime = 0.5; held.view.updateFunction(); assert.deepEqual(held.calls, []);
  held.view.globals.appCurrentTime = 0.501; held.view.updateFunction(); held.view.downFunction();
  assert.deepEqual(held.calls, ['clear', ['destination', true, false, true], ['destination', false, true, false]]);
  held.view.liftFunction(); assert.deepEqual(held.calls.at(-1), ['destination', true, true, true]);
  assert.equal(held.calls.includes('gather'), false, 'holding must not execute the original resource callback');
});
test('original ranged targeting attacks when selected and does not repeat the press attack during targeted updates or release', () => {
  const ranged = targetedGesture('ENEMY_RANGED'); ranged.view.updateFunction(); ranged.view.downFunction();
  assert.deepEqual(ranged.calls, ['attack']);
  ranged.view.getTargetEntity = () => ({ getEC: () => null });
  ranged.view.updateFunction(); assert.deepEqual(ranged.calls, ['attack'], 'another ranged enemy does not re-enter the same interaction mode');
  ranged.view.liftFunction(); assert.deepEqual(ranged.calls, ['attack', 'activate', 'end']);
});
