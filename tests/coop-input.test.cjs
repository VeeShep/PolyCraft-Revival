'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostMovement, GuestMovement } = require('../desktop/coop-input.js');
function hero() {
  let destination = null, health = 50;
  return { getv3Location: () => [10, 2, 20], getEC: name => name === 'ECHealth' ? { getHealth: () => health } : { setDestination: value => { destination = value; }, clearDestination: () => { destination = null; } },
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
  input.close(); assert.equal(listeners.size, 0); assert.equal(removed, true);
});
