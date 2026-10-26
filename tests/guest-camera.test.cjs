'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuestCamera } = require('../desktop/guest-world.js');
const ast = require('./runtime-ast.cjs');
const methods = ast.cameraMethods(() => ({ setv3Position(value) { this.value = [...value]; }, setv3Destination(value) { this.value = [...value]; }, getv3Location() { return this.value; }, update() {} }));
function fixture(t) {
  let now = 1000; t.mock.method(performance, 'now', () => now);
  const put = (a, out = []) => { a.forEach((value, index) => { out[index] = value; }); return out; };
  const math = { v3BuildZero: out => put([0, 0, 0], out), v3Build: (x, y, z, out) => put([x, y, z], out), v3Copy: put,
    v3Add: (a, b, out) => put(a.map((v, i) => v + b[i]), out), v3Sub: (a, b, out) => put(a.map((v, i) => v - b[i]), out), v3ScalarMul: (a, scale, out) => put(a.map(v => v * scale), out),
    v3Lerp: (a, b, scale, out) => put(a.map((v, i) => v + (b[i] - v) * scale), out), v3Normalize: (a, out) => put(a.map(v => v / (Math.hypot(...a) || 1)), out), v3Length: a => Math.hypot(...a), v3Distance: (a, b) => Math.hypot(...a.map((v, i) => v - b[i])), v3DistanceSq: (a, b) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0), v3Dot: (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0),
    boundAngle: a => Math.atan2(Math.sin(a), Math.cos(a)), m33BuildRotationY: a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)], m33Transform: (m, v, out) => put([m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]], out),
    lerp: (a, b, scale) => a + (b - a) * scale, lerpAngle: (a, b, scale) => a + (b - a) * scale, diffAngles: (a, b) => b - a, remap: (a, b, c, d, v) => c + (d - c) * ((v - a) / (b - a)), saturate: v => Math.max(0, Math.min(1, v)), getFactor: (a, b, v) => (v - a) / (b - a), clamp: (v, a, b) => Math.max(a, Math.min(b, v)), angleToV3: a => [Math.sin(a), 0, Math.cos(a)],
    aabbClampSphere: (extents, point, radius, out) => put(point.map((v, i) => Math.max(extents[i] + radius, Math.min(extents[i + 3] - radius, v))), out)
  };
  const rendered = [], display = { extractSmallestFOV: () => Math.PI / 3, setFOV() {}, lookAt: (...args) => rendered.push(args), updateViewMatrix() {}, updateViewProjectionMatrix() {}, updateFrustumPlanes() {} };
  const globals = { mathDevice: math, camera: display, gameAppTimeStep: 1 / 30, guiRenderer: { getScaleFactor: () => 1 }, debugDrawFlags: {}, dynamicUI: { addGroup() { throw new Error('Guest init must not create debug UI'); } } };
  const solo = Object.assign(Object.create(methods), { globals: { ...globals, dynamicUI: null }, camera: display }); solo.init(); solo.heroEntity = { id: 'solo' }; solo.zoomerBlend = true; solo.zoomerPosition = { keep: true };
  const context = { mode: 'explore', dead: false, buildingAge: 100, destination: [20, 0, 0], lookAhead: [12, 0, 0], timeHeld: 0, heroes: ['guest', 'friend'], enemies: ['enemy'], center: [0, 0, 0] };
  const entities = new Map(['guest', 'friend', 'enemy'].map((id, i) => [id, { record: { id, location: [i * 3, 0, 0] }, displayLocation: [i * 3 + 1, 0, 0] }]));
  const state = { hero: 'guest', camera: context, spaces: [{ extents: [-100, -100, -100, 100, 100, 100], entities: [...entities.values()].map(entry => entry.record) }] };
  const world = { controls: { app: { globals } }, scene: { snapshot: state, entities }, game: { getGameCamera: () => solo, getHero: () => { throw new Error('Solo hero must not be read'); } } };
  return { world, globals, solo, context, entities, rendered, advance: ms => { now += ms; } };
}
test('guest runs the original camera framing and phase selection with private state, local aspect and received actors', t => {
  const f = fixture(t), before = [...f.solo.desiredV3Focus], camera = new GuestCamera(f.world), source = JSON.stringify(f.world.scene.snapshot);
  f.advance(33); camera.update();
  assert.equal(f.rendered.length, 1); assert.ok(f.rendered[0].every(vector => vector.every(Number.isFinite))); assert.equal(camera.camera.getCameraValues(), camera.camera.cameraValueLibrary.explore);
  assert.deepEqual(camera.actor('guest').getEC('ECLocomotion').getLookAhead(), [13, 0, 0]);
  assert.equal(camera.camera.heroEntity, camera.actor('guest')); assert.notEqual(camera.camera.scratchPad, f.solo.scratchPad); assert.notEqual(camera.camera.zoomerPosition, f.solo.zoomerPosition); assert.deepEqual(f.solo.desiredV3Focus, before); assert.deepEqual(f.solo.heroEntity, { id: 'solo' });
  assert.equal(JSON.stringify(f.world.scene.snapshot), source); assert.deepEqual(f.entities.get('guest').displayLocation, [1, 0, 0]);
  f.context.mode = 'war'; f.advance(33); camera.update(); assert.equal(camera.camera.getCameraValues(), camera.camera.cameraValueLibrary.war);
  f.context.buildingAge = 0; f.advance(33); camera.update(); assert.equal(camera.camera.getCameraValues(), camera.camera.cameraValueLibrary.building);
  f.context.dead = true; f.advance(33); camera.update(); assert.equal(camera.camera.getCameraValues(), camera.camera.cameraValueLibrary.dead);
});
test('guest camera freezes during resync, snaps on recovery and teleport, and discards removed actor proxies', t => {
  const f = fixture(t), camera = new GuestCamera(f.world); camera.update();
  f.world.resyncing = true; f.advance(5000); camera.update(); assert.equal(f.rendered.length, 1);
  f.world.resyncing = false; camera.update(); assert.equal(f.rendered.length, 2); assert.equal(camera.resyncing, false);
  f.entities.get('guest').displayLocation = [70, 0, 0]; f.advance(33); camera.update(); assert.equal(camera.camera.shouldSnap, false); assert.ok(camera.camera.desiredV3Focus[0] > 50); f.advance(33); camera.update(); assert.ok(camera.camera.currentV3Focus[0] > 50);
  f.context.enemies = []; f.entities.delete('enemy'); f.advance(33); camera.update(); assert.equal(camera.actors.has('enemy'), false);
});
test('original camera rotation is local, time-based and gated; host quest notices are throttled and wait for acknowledgement', t => {
  const f = fixture(t), sent = []; let available = true;
  f.world.movement = { keys: new Set(['ArrowLeft']), available: () => available }; f.world.sendTarget = (type, id) => { sent.push({ type, id }); return sent.length; };
  const camera = new GuestCamera(f.world), soloAngle = f.solo.desiredBaseAngle, initial = camera.camera.desiredBaseAngle;
  f.advance(100); camera.update(); assert.ok(Math.abs(camera.camera.desiredBaseAngle - initial - Math.PI * 0.05) < 1e-10); assert.deepEqual(sent, [{ type: 'rotateCamera', id: 'guest' }]); assert.equal(f.solo.desiredBaseAngle, soloAngle);
  f.advance(1000); camera.update(); assert.equal(sent.length, 1, 'Pending receipt must prevent another notice');
  f.world.cameraRequest = null; f.advance(100); camera.update(); assert.equal(sent.length, 2);
  f.world.cameraRequest = null; f.advance(100); camera.update(); assert.equal(sent.length, 2, 'No more than two notices per second');
  f.world.movement.keys.add('ArrowRight'); const stopped = camera.camera.desiredBaseAngle; f.advance(100); camera.update(); assert.equal(camera.camera.desiredBaseAngle, stopped);
  f.world.movement.keys.delete('ArrowLeft'); f.advance(100); camera.update(); assert.ok(camera.camera.desiredBaseAngle < stopped);
  available = false; const paused = camera.camera.desiredBaseAngle; f.advance(1000); camera.update(); assert.equal(camera.camera.desiredBaseAngle, paused);
  f.world.resyncing = true; available = true; f.advance(1000); camera.update(); assert.equal(camera.camera.desiredBaseAngle, paused);
});
