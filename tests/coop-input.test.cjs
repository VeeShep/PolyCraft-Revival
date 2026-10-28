'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostMovement, GuestMovement } = require('../desktop/coop-input.js');
function hero() {
  let destination = null, health = 50;
  return { getv3Location: () => [10, 2, 20], getEC: name => ({ ECHealth: { getHealth: () => health }, ECLocomotion: { setDestination: value => { destination = value; }, clearDestination: () => { destination = null; }, clearDestinationEntity() {} } })[name],
    destination: () => destination, die: () => { health = 0; } };
}
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
  world.localMenu = () => false; world.construction = null; input.keys.clear();
  if (input.pending) await input.pending;
  const point = [30, 999, 20]; input.requestWalk(point); point[0] = 999;
  const walk = sent.at(-1).value; assert.equal(walk.type, 'walk'); assert.deepEqual(walk.location, [30, 999, 20]);
  const before = sent.length; await input.flush(); assert.equal(sent.length, before, 'neutral idle ticks retain a click path');
  world.localMenu = () => true; await input.flush(); assert.equal(sent.at(-1).value.type, 'move'); assert.deepEqual(sent.at(-1).value.move, [0, 0]); assert.equal(sent.at(-1).value.sequence, walk.sequence + 1);
  world.localMenu = () => false; input.requestWalk([30, 2, 20]); world.resyncing = true; await input.flush(); assert.deepEqual(sent.at(-1).value.move, [0, 0]);
  world.resyncing = false; input.requestWalk([30, 2, 20]); nativeFocus(false); await input.flush(); assert.deepEqual(sent.at(-1).value.move, [0, 0]);
  nativeFocus(true); input.keys.add('KeyW'); const count = sent.length; input.requestWalk([30, 2, 20]); assert.equal(sent.length, count, 'held movement keys take priority over ground clicks');
  input.close(); assert.equal(listeners.size, 0); assert.equal(removed, true);
});
function walkingFixture() {
  const ast = require('./runtime-ast.cjs'), position = [10, 2, 20], state = { admit: true, blocked: true, space: true, dead: false, script: false, building: false, throwing: false, queries: 0, chargeCancelled: 0 };
  const math = { v3Copy: a => [...a], v3Sub: (a, b) => a.map((v, i) => v - b[i]), v3ScalarMul: (a, b) => a.map(v => v * b), v3Normalize: a => a.map(v => v / Math.hypot(...a)), v3Dot: (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0), v3Distance2DSq: (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2 };
  const locomotion = { destination: null, entity: {}, setDestination(value) { this.destination = [...value]; }, clearDestination() { this.destination = null; }, clearDestinationEntity() { this.entity = null; } };
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
    const input = new HostMovement(() => 0); assert.throws(() => input.receive({ type: 'walk', sequence: 1, location: [1, 2, 3], ...extra }), /Invalid/); assert.equal(input.sequence, 0);
  }
  let now = 0; const input = new HostMovement(() => now), location = [1, 2, 3];
  input.receive({ type: 'walk', sequence: 1, location }); location[0] = 99; assert.deepEqual(input.pendingWalk, [1, 2, 3]);
  assert.throws(() => input.receive({ type: 'walk', sequence: 1, location }), /repeated/);
  for (let sequence = 2; sequence <= 4; sequence++) input.receive({ type: 'walk', sequence, location });
  assert.throws(() => input.receive({ type: 'walk', sequence: 5, location }), /Too many walking/); assert.equal(input.sequence, 4);
  now = 1000; input.receive({ type: 'walk', sequence: 5, location }); assert.equal(input.sequence, 5);
});
test('ground clicks use actual native navigation, authoritative height and original collision fallback without teleporting', () => {
  const f = walkingFixture(); f.input.receive({ type: 'walk', sequence: 1, location: [30, 999, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.deepEqual(f.state.requested, [30, 2, 20]); assert.deepEqual(f.position, [10, 2, 20]); assert.deepEqual(f.locomotion.destination, [10, 2, 25]); assert.equal(f.state.chargeCancelled, 1); assert.equal(f.locomotion.entity, null);
  f.time(10000); f.input.apply(f.hero, f.game, f.controls); assert.ok(f.nav.path, 'click paths survive idle keyboard timeout');
  f.position[2] = 25; f.nav.update(); assert.deepEqual(f.locomotion.destination, [30, 2, 20]);
  f.input.receive({ type: 'walk', sequence: 2, location: [...f.position] }); f.input.apply(f.hero, f.game, f.controls);
  assert.equal(f.nav.path, null); assert.equal(f.locomotion.destination, null, 'same-position clicks cannot revive an old waypoint');
  f.state.admit = false; f.input.receive({ type: 'walk', sequence: 3, location: [30, 0, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.equal(f.nav.path, null); assert.ok(Math.abs(f.locomotion.destination[0] - 14.65) < 1e-9, 'original normal-clearance collision fallback');
  f.state.blocked = false; f.state.space = false; f.input.receive({ type: 'walk', sequence: 4, location: [30, 500, 20] }); f.input.apply(f.hero, f.game, f.controls);
  assert.deepEqual(f.locomotion.destination, [30, 2, 20]);
});
test('neutral cancellation, keyboard takeover, life/script/construction guards and forced disconnect clear both native path and destination', () => {
  for (const reason of ['neutral', 'keyboard', 'dead', 'script', 'building', 'throwing', 'disconnect']) {
    const f = walkingFixture(); f.input.receive({ type: 'walk', sequence: 1, location: [30, 2, 20] }); f.input.apply(f.hero, f.game, f.controls);
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
  assert.deepEqual(sent.map(value => [value.type, value.sequence]), [['move', 1], ['walk', 2]]);
  release(); await sending; assert.equal(sent.length, 2, 'a late dirty keyboard flush must not cancel the new path');
  available = false; await input.flush(); assert.equal(sent[2].type, 'move'); assert.equal(sent[2].sequence, 3); assert.deepEqual(sent[2].move, [0, 0]);
});
