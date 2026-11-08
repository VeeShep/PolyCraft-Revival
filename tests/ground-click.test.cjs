'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const clickGround = require('./coop-ground-click.cjs');

function fixture(t) {
  const prior = global.window, events = [], projected = [], state = { available: true, captured: false, hot: false, target: null, cursor: [30, 7, 40], screen: [800, 500] };
  t.after(() => { if (prior === undefined) delete global.window; else global.window = prior; });
  const world = { identity: { entity: 'assigned' }, scene: { entities: new Map([
    ['assigned', { record: { location: [1, 2, 3] }, displayLocation: [4, 7, 6] }], ['solo', { record: { location: [999, 999, 999] } }]
  ]) }, controls: { app: { globals: { camera: { worldToScreen: location => { projected.push(location); return typeof state.screen === 'function' ? state.screen(location) : state.screen; } }, graphicsDevice: { width: 2000, height: 1000 } } } },
    movement: { sequence: 12, walkRequested: false, available: () => state.available,
      canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 1000, height: 500 }) },
      requestWalk: () => assert.fail('The helper must use a real mouse click, not inject an intent.') },
    construction: { cursor: () => state.cursor }, game: { getIMGui: () => ({ hasCapturedInput: () => state.captured, isHot: () => state.hot }) }, pointerEvent: { clientX: 410, clientY: 270 } };
  world.viewCamera = { camera: { baseAngle: 0, desiredBaseAngle: 0 } };
  global.window = { guestWorld: world, PolycraftCoopActions: { pickTarget(w, event) { assert.equal(w, world); assert.ok(Number.isFinite(event.clientX) && Number.isFinite(event.clientY)); return state.pick ? state.pick(event) : state.target; } } };
  const guest = { async evaluate(callback, argument) { return callback(argument); },
    keyboard: { async down(key) { events.push(['down', key]); }, async up(key) { events.push(['up', key]); } },
    mouse: { async move(x, y) { events.push(['move', x, y]); world.pointerEvent = { clientX: x, clientY: y }; }, async click(x, y, options) { events.push(['click', x, y, options]); world.movement.sequence++; world.movement.walkRequested = true; } },
    async waitForTimeout(ms) { events.push(['wait', ms]); },
    async waitForFunction(callback, argument, options) { assert.equal(options.timeout, 5000); if (argument === .001) { assert.equal(callback(argument), true); events.push(['camera-settled']); return; } assert.equal(argument, 12); assert.equal(callback(argument), true); events.push(['sent']); } };
  return { guest, world, state, events, projected };
}
test('ground-click helper projects the assigned display height, respects canvas scaling and uses normal mouse input', async t => {
  const f = fixture(t), location = [30, .5, 40], before = JSON.stringify(location);
  const result = await clickGround(f.guest, location);
  assert.deepEqual(f.projected, [[30, 7, 40]]); assert.equal(JSON.stringify(location), before);
  assert.deepEqual(f.events, [['wait', 150], ['move', 410, 270], ['click', 410, 270, { delay: 100 }], ['sent']]);
  assert.equal(result.sequenceBefore, 12); assert.equal(f.world.movement.sequence, 13);
});
test('ground-click helper rejects HUD, invalid projection, blocked input, entities and a mismatched ray before clicking', async t => {
  const f = fixture(t);
  for (const reason of ['hud', 'projection', 'input', 'gui', 'hot', 'target', 'cursor', 'ray']) {
    Object.assign(f.state, { available: true, captured: false, hot: false, target: null, cursor: [30, 7, 40], screen: [800, 500] }); f.events.length = 0;
    if (reason === 'hud') f.state.screen = [100, 500];
    if (reason === 'projection') f.state.screen = null;
    if (reason === 'input') f.state.available = false;
    if (reason === 'gui') f.state.captured = true;
    if (reason === 'hot') f.state.hot = true;
    if (reason === 'target') f.state.target = 'tree';
    if (reason === 'cursor') f.state.cursor = null;
    if (reason === 'ray') f.state.cursor = [31, 7, 40];
    await assert.rejects(clickGround(f.guest, [30, .5, 40]), { code: 'ERR_ASSERTION' }, reason);
    assert.ok(!f.events.some(event => event[0] === 'click'), reason); assert.equal(f.world.movement.sequence, 12);
    if (['input', 'gui', 'hot', 'cursor'].includes(reason)) assert.equal(f.events.filter(event => event[0] === 'move').length, 1, reason);
    const held = f.events.filter(event => event[0] === 'down').length;
    assert.ok(held <= 4); assert.equal(f.events.filter(event => event[0] === 'up').length, held);
  }
});
test('ground-click helper uses a visible shorter leg when the full waypoint is behind the HUD', async t => {
  const f = fixture(t);
  f.state.screen = location => location[0] > 20 ? [1800, 500] : [800, 500];
  f.state.cursor = [17, 7, 23];
  const result = await clickGround(f.guest, [30, .5, 40]);
  assert.deepEqual(f.projected, [[30, 7, 40], [17, 7, 23]]);
  assert.deepEqual(result.location, [17, 7, 23]); assert.equal(result.point.fraction, .5);
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1);
});
test('ground-click helper preserves a failed input delivery instead of retrying or accepting it as a walk', async t => {
  const f = fixture(t), failure = new Error('walking intent not observed');
  f.guest.waitForFunction = async () => { throw failure; };
  await assert.rejects(clickGround(f.guest, [30, .5, 40]), error => error === failure);
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1);
});

function nativeProjection(f, { width = 1200, height = 720, scale = 1, hero = [-100, .9, -90], eye = [16, 22, 18] } = {}) {
  const native = require('./runtime-ast.cjs'), { GuestConstruction } = require('../desktop/guest-construction.js'), math = {};
  for (const name of ['v3Sub', 'v3Normalize', 'v3Cross', 'm43Build', 'm44Build', 'm43InverseOrthonormal', 'm43MulM44', 'v4Build', 'm44Transform', 'v2Build', 'm44Inverse', 'm43Pos', 'v3Build', 'v3BuildYAxis', 'v3Copy', 'v3Dot', 'v3ScalarMul', 'getRayPlaneIntersection']) math[name] = native.method(name, { F: Float32Array, A: math });
  math.vec2Build = math.v2Build;
  const globals = f.world.controls.app.globals, type = { prototype: { scratchpad: {} } };
  const camera = { md: math, globals, nearPlane: 1, farPlane: 1000, parallel: false, infinite: false,
    viewOffsetX: 0, viewOffsetY: 0, recipViewWindowX: 1, recipViewWindowY: 1, aspectRatio: width / height };
  Object.assign(camera, native.projectionCameraMethods(type));
  globals.mathDevice = math; globals.camera = camera; globals.graphicsDevice = { width: width * scale, height: height * scale };
  camera.lookAt([...hero], [0, 1, 0], hero.map((value, i) => value + eye[i])); camera.updateProjectionMatrix(); camera.updateViewMatrix(); camera.updateViewProjectionMatrix();
  f.world.scene.entities.get('assigned').displayLocation = [...hero];
  f.world.movement.canvas.getBoundingClientRect = () => ({ left: 23, top: 74, width, height });
  f.world.guiInput = { position: [0, 0] }; f.world.construction = new GuestConstruction(f.world);
  const move = f.guest.mouse.move;
  f.guest.mouse.move = async (x, y) => {
    await move(x, y); f.world.pointerEvent = { clientX: x, clientY: y };
    f.world.guiInput.position = [(x - 23) * scale, (y - 74) * scale];
  };
  return { camera, hero };
}
for (const row of [
  { width: 1200, height: 720, scale: 1, eye: [16, 22, 18] },
  { width: 1024, height: 640, scale: 2, eye: [-18, 20, 16] },
  { width: 1440, height: 900, scale: 3, hero: [-96.9, .8955, -96.8732], eye: [14, 18, -20] }
]) test(`ground clicks round-trip through native perspective camera/math and guest unprojection at ${row.width}x${row.height}, scale ${row.scale}`, async t => {
  const f = fixture(t), { hero } = nativeProjection(f, row), target = [hero[0] + 2, -50, hero[2] - 3];
  const before = JSON.stringify(f.world.scene.entities.get('assigned'));
  const result = await clickGround(f.guest, target), cursor = f.world.construction.cursor();
  assert.equal(result.point.fraction, 1);
  assert.ok(Math.hypot(cursor[0] - target[0], cursor[2] - target[2]) < .001);
  assert.ok(Math.abs(cursor[1] - hero[1]) < .0001);
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1);
  assert.equal(JSON.stringify(f.world.scene.entities.get('assigned')), before);
});
test('actual native perspective projection rejects all behind-camera legs without sending a click', async t => {
  const f = fixture(t), { camera } = nativeProjection(f);
  camera.lookAt([0, 0, 0], [0, 1, 0], [0, 10, 10]); camera.updateViewMatrix(); camera.updateViewProjectionMatrix();
  f.world.scene.entities.get('assigned').displayLocation = [-100, 1, 100];
  await assert.rejects(clickGround(f.guest, [-95, 1, 105]), /walking waypoint must be visible/);
  assert.ok(!f.events.some(event => event[0] === 'click'));
  assert.equal(f.world.movement.sequence, 12);
});
test('ground click projects after camera settling so a moving view cannot invalidate the intended ray before input', async t => {
  const f = fixture(t), { camera, hero } = nativeProjection(f), wait = f.guest.waitForTimeout;
  f.guest.waitForTimeout = async ms => {
    await wait(ms); camera.matrix[9] += .4; camera.updateViewMatrix(); camera.updateViewProjectionMatrix();
  };
  const target = [hero[0] + 2, hero[1], hero[2] - 3];
  await clickGround(f.guest, target);
  const cursor = f.world.construction.cursor();
  assert.ok(Math.hypot(cursor[0] - target[0], cursor[2] - target[2]) < .001);
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1);
});
test('ground click reframes an off-screen waypoint with normal camera keys before issuing one walking click', async t => {
  const f = fixture(t); f.state.screen = [1900, 500];
  f.guest.keyboard = { async down(key) { f.events.push(['down', key]); }, async up(key) { f.events.push(['up', key]); f.state.screen = [800, 500]; } };
  const result = await clickGround(f.guest, [30, .5, 40]);
  assert.deepEqual(result.location, [30, 7, 40]); assert.equal(result.cameraTurns, 1);
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1);
  assert.deepEqual(f.events.filter(event => ['down', 'up'].includes(event[0])), [['down', 'ArrowLeft'], ['up', 'ArrowLeft']]);
});
test('camera reframing always releases its key and preserves a failed hold without clicking or retrying', async t => {
  const f = fixture(t), failure = new Error('camera wait failed'), wait = f.guest.waitForTimeout; f.state.screen = [1900, 500];
  f.guest.keyboard = { async down(key) { f.events.push(['down', key]); }, async up(key) { f.events.push(['up', key]); } };
  f.guest.waitForTimeout = async ms => { await wait(ms); if (ms === 500) throw failure; };
  await assert.rejects(clickGround(f.guest, [30, .5, 40]), error => error === failure);
  assert.deepEqual(f.events.filter(event => ['down', 'up'].includes(event[0])), [['down', 'ArrowLeft'], ['up', 'ArrowLeft']]);
  assert.ok(!f.events.some(event => event[0] === 'click'));
});
test('camera reframing waits for the native angular blend, including wraparound, before projecting the walking click', async t => {
  const f = fixture(t); f.state.screen = [1900, 500];
  f.world.viewCamera = { camera: { baseAngle: 0, desiredBaseAngle: .5 } };
  f.guest.keyboard = { async down(key) { f.events.push(['down', key]); }, async up(key) { f.events.push(['up', key]); } };
  const wait = f.guest.waitForFunction;
  f.guest.waitForFunction = async (callback, argument, options) => {
    if (argument !== .001) return wait(callback, argument, options);
    assert.equal(options.timeout, 5000); assert.equal(callback(argument), false);
    f.world.viewCamera.camera.baseAngle = .5005; assert.equal(callback(argument), true);
    f.world.viewCamera.camera.baseAngle += 2 * Math.PI; assert.equal(callback(argument), true);
    f.state.screen = [800, 500]; f.events.push(['camera-settled']);
  };
  await clickGround(f.guest, [30, .5, 40]);
  assert.ok(f.events.findIndex(event => event[0] === 'camera-settled') < f.events.findIndex(event => event[0] === 'click'));
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1);
});
test('ground click re-aims the same world point if the native view shifts between projection and pointer input', async t => {
  const f = fixture(t), { camera, hero } = nativeProjection(f), move = f.guest.mouse.move; let moves = 0;
  f.guest.mouse.move = async (x, y) => { await move(x, y); if (++moves === 1) { camera.matrix[9] += .4; camera.updateViewMatrix(); camera.updateViewProjectionMatrix(); } };
  const target = [hero[0] + 2, hero[1], hero[2] - 3], result = await clickGround(f.guest, target);
  assert.equal(result.aims, 2); assert.equal(moves, 2);
  assert.ok(Math.hypot(result.location[0] - target[0], result.location[2] - target[2]) < .0001);
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1); assert.equal(f.world.movement.sequence, 13);
});
test('ground click stops after three unstable native-view aims without sending any walking action', async t => {
  const f = fixture(t), { camera, hero } = nativeProjection(f), move = f.guest.mouse.move; let moves = 0;
  f.guest.mouse.move = async (x, y) => { await move(x, y); moves++; camera.matrix[9] += .4; camera.updateViewMatrix(); camera.updateViewProjectionMatrix(); };
  await assert.rejects(clickGround(f.guest, [hero[0] + 2, hero[1], hero[2] - 3]), /walking click must hit empty ground/);
  assert.equal(moves, 3); assert.ok(!f.events.some(event => event[0] === 'click')); assert.equal(f.world.movement.sequence, 12);
});

test('ground click skips entity-covered projected ground and chooses an unobstructed native route leg', async t => {
  const f = fixture(t);
  f.state.screen = location => location[0] > 20 ? [800, 500] : [600, 500];
  f.state.pick = event => event.clientX > 400 ? 'hut' : null;
  f.state.cursor = [17, 7, 23];
  const result = await clickGround(f.guest, [30, .5, 40]);
  assert.deepEqual(result.location, [17, 7, 23]);
  assert.equal(f.events.filter(event => event[0] === 'click').length, 1);
  assert.equal(f.events.filter(event => event[0] === 'down').length, 0);
});
