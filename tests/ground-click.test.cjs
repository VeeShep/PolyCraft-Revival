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
  global.window = { guestWorld: world, PolycraftCoopActions: { pickTarget(w, event) { assert.equal(w, world); assert.equal(event, world.pointerEvent); return state.target; } } };
  const guest = { async evaluate(callback, argument) { return callback(argument); },
    mouse: { async move(x, y) { events.push(['move', x, y]); }, async click(x, y, options) { events.push(['click', x, y, options]); world.movement.sequence++; world.movement.walkRequested = true; } },
    async waitForTimeout(ms) { events.push(['wait', ms]); },
    async waitForFunction(callback, argument, options) { assert.equal(options.timeout, 5000); assert.equal(argument, 12); assert.equal(callback(argument), true); events.push(['sent']); } };
  return { guest, world, state, events, projected };
}
test('ground-click helper projects the assigned display height, respects canvas scaling and uses normal mouse input', async t => {
  const f = fixture(t), location = [30, .5, 40], before = JSON.stringify(location);
  const result = await clickGround(f.guest, location);
  assert.deepEqual(f.projected, [[30, 7, 40]]); assert.equal(JSON.stringify(location), before);
  assert.deepEqual(f.events, [['move', 410, 270], ['wait', 150], ['click', 410, 270, { delay: 100 }], ['sent']]);
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
