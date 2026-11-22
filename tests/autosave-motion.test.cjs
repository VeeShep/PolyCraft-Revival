'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), path = require('node:path');
const { verifyMotion, installMotionFrames } = require('./coop-autosave-motion.cjs');
test('moving autosave acceptance requires four participants, actual travel, completed normal save and overlapping held input', () => {
  const valid = { participants: 4, distance: 7, inputs: [{ startedAt: 90, endedAt: 150 }], guestFrames: [{ milliseconds: 17 }], timing: { records: [{ phase: 'checkpoint', startedAt: 100, endedAt: 120 }], frames: [17], status: [{ text: 'Saving…' }, { text: 'Saved locally at 12:00' }] } };
  verifyMotion(valid);
  for (const mutate of [f => { f.participants = 1; }, f => { f.distance = 0; }, f => { f.inputs[0].endedAt = 100; }, f => { f.inputs[0].startedAt = 120; }, f => { f.timing.records = []; }, f => { f.timing.status.pop(); }, f => { f.guestFrames = []; }]) {
    const value = structuredClone(valid); mutate(value); assert.throws(() => verifyMotion(value), assert.AssertionError);
  }
});
test('passive moving frame observation stops without changing game updates and bounds its samples', () => {
  let next; const window = {};
  vm.runInNewContext('(' + installMotionFrames.toString() + ')()', { window, requestAnimationFrame(callback) { next = callback; } });
  next(0); next(17); assert.equal(window.autosaveMotionFrames.frames[0].milliseconds, 17);
  for (let i = 0; i < 8100; i++) next(34 + i * 17);
  assert.equal(window.autosaveMotionFrames.frames.length, 8000);
  window.autosaveMotionFrames.running = false; const pending = next; next = null; pending(200000); assert.equal(next, null);
});
test('moving autosave CLI refuses missing co-op or earned campaign mode before fixture reads and game launch', () => {
  const { spawnSync } = require('node:child_process');
  for (const flags of [['--autosave-motion'], ['--coop', '--autosave-motion'], ['--coop', '--natural-outpost', '--autosave-motion'], ['--natural-campaign', '--autosave-motion']]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'worker-reload-smoke.cjs'), ...flags], { encoding: 'utf8', env: { ...process.env, POLYCRAFT_WORKER_FIXTURE: '/missing-motion-fixture' } });
    assert.equal(result.status, 1); assert.match(result.stderr, /Autosave motion requires/); assert.doesNotMatch(result.stderr, /ENOENT|electron.launch/);
  }
});

test('host frame and Saving UI samples retain wall-clock windows for save-hitch attribution', () => {
  const { installSaveTiming } = require('./save-timing.cjs'); let next, mutation, now = 100;
  const element = { textContent: 'Saving…' }, window = { polycraft: { controls: { manager: () => ({ saveLevel() {} }), checkpoint() {}, writeCheckpoint() {} } } };
  vm.runInNewContext('(' + installSaveTiming.toString() + ')()', { window, performance: { now: () => now }, Date: { now: () => now }, document: { getElementById: () => element }, requestAnimationFrame(callback) { next = callback; }, MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() {} } });
  next(0); now = 120; mutation(); now = 400; next(300);
  assert.deepEqual(JSON.parse(JSON.stringify(window.saveTiming.frameIntervals)), [{ startedAt: 100, endedAt: 400, milliseconds: 300 }]);
  assert.equal(window.saveTiming.status[0].wallTime, 120); assert.equal(window.saveTiming.status[0].text, 'Saving…'); window.saveTiming.restore();
});
