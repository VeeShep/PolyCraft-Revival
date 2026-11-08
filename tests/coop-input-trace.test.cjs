'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const trace = require('./coop-input-trace.cjs');

function fixture() {
  const calls = [], token = {}, failure = new Error('native input failed');
  const prototype = { pointer(event, value) { calls.push([this, event, value]); this.targetSequence++; return token; },
    clickTarget(event) { calls.push([this, event]); throw failure; } };
  const world = Object.assign(Object.create(prototype), {
    game: { getIMGui: () => ({ hasCapturedInput: () => true, isHot: id => id === 'guest-pause' }) },
    movement: { available: () => false, nativeFocused: false }, controls: { paused: true }, connection: { closed: false },
    guiInput: { down: false, pendingDown: true }, targetSequence: 0, quests: { description: { taskId: 'taskIdcrit_10' } }, construction: {}
  });
  return { world, calls, token, failure, prototype, event: { clientX: 10, clientY: 20, button: 0 } };
}
test('resource input trace delegates once with the same receiver/arguments/result and records before/after gates', () => {
  const f = fixture(); trace(f.world);
  assert.equal(f.world.pointer('pointerdown', f.event), f.token);
  assert.deepEqual(f.calls, [[f.world, 'pointerdown', f.event]]);
  const [row] = f.world.resourceInputTrace.events;
  assert.equal(row.before.sequence, 0); assert.equal(row.after.sequence, 1);
  assert.equal(row.before.available, false); assert.equal(row.before.captured, true);
  assert.deepEqual(row.before.hot, ['guest-pause']); assert.equal(row.before.description, 'taskIdcrit_10');
  assert.equal(row.x, 10); assert.equal(row.y, 20);
  f.world.resourceInputTrace.restore();
  assert.equal(Object.hasOwn(f.world, 'pointer'), false); assert.equal(f.world.pointer, f.prototype.pointer);
  assert.equal(f.world.resourceInputTrace, undefined);
});
test('resource input trace preserves native exceptions even when state capture fails', () => {
  const f = fixture(); f.world.game.getIMGui = () => { throw new Error('GUI unavailable'); }; trace(f.world);
  assert.throws(() => f.world.clickTarget(f.event), error => error === f.failure);
  assert.equal(f.calls.length, 1); assert.equal(f.world.resourceInputTrace.events[0].after.traceError, 'GUI unavailable');
  f.world.resourceInputTrace.restore();
});
test('resource input trace bounds history, ignores motion and leaves later hooks intact on restoration', () => {
  const f = fixture(); trace(f.world);
  assert.throws(() => trace(f.world), /already active/);
  for (let index = 0; index < 30; index++) f.world.pointer('pointerdown', f.event);
  for (let index = 0; index < 30; index++) f.world.pointer('pointermove', f.event);
  assert.equal(f.calls.length, 60); assert.equal(f.world.resourceInputTrace.events.length, 24);
  assert.equal(f.world.resourceInputTrace.events[0].before.sequence, 6);
  const replacement = () => {}; f.world.pointer = replacement; f.world.resourceInputTrace.restore();
  assert.equal(f.world.pointer, replacement); assert.equal(f.world.clickTarget, f.prototype.clickTarget);
});
test('resource input trace can be serialized into a renderer realm without Node or module closures', () => {
  const f = fixture();
  require('node:vm').runInNewContext('(' + trace.toString() + ')()', { guestWorld: f.world, performance });
  assert.equal(f.world.pointer('pointerdown', f.event), f.token);
  assert.equal(f.world.resourceInputTrace.events[0].after.sequence, 1);
  assert.equal(f.world.resourceInputTrace.events[0].before.focused, null);
  assert.doesNotThrow(() => JSON.stringify(f.world.resourceInputTrace.events));
  f.world.resourceInputTrace.restore(); assert.equal(f.world.resourceInputTrace, undefined);
});
test('resource input trace passively captures canvas cursor setting and bounded highlight flags without retaining live views', () => {
  const f = fixture();
  f.world.scene = { tick: 100 };
  f.world.movement.canvas = { style: { cursor: 'url(original-interact.png), auto' } };
  f.world.resourceHighlights = new Map(Array.from({ length: 12 }, (_, index) => ['tree-' + index, { smartValid: true, hot: index === 0 }]));
  trace(f.world); assert.equal(f.world.pointer('pointerdown', f.event), f.token);
  const first = f.world.resourceInputTrace.events[0];
  assert.equal(first.before.tick, 100); assert.equal(first.before.cursor, 'url(original-interact.png), auto');
  assert.equal(first.before.highlightCount, 12); assert.equal(first.before.highlights.length, 8);
  assert.deepEqual(first.before.highlights[0], { id: 'tree-0', near: true, hot: true });
  assert.equal(first.before.highlights.at(-1).id, 'tree-7');
  f.world.scene.tick++; f.world.movement.canvas.style.cursor = 'url(original-move.png), auto';
  f.world.resourceHighlights.get('tree-0').hot = false;
  f.world.pointer('pointerup', f.event);
  assert.equal(f.calls.length, 2); assert.equal(first.after.tick, 100);
  assert.equal(first.after.cursor, 'url(original-interact.png), auto'); assert.equal(first.after.highlights[0].hot, true);
  const second = f.world.resourceInputTrace.events[1];
  assert.equal(second.before.tick, 101); assert.equal(second.before.highlights[0].hot, false);
  assert.equal(second.before.cursor, 'url(original-move.png), auto');
  assert.doesNotThrow(() => JSON.stringify(f.world.resourceInputTrace.events));
  f.world.resourceInputTrace.restore();
});
