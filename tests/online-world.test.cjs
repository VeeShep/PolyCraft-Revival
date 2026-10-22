'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controls } = require('../desktop/controls.js');
const { HostSession } = require('../desktop/multiplayer.js');
const { startHostingWorld } = require('../desktop/online-world.js');
function setup(t) {
  const previousDesktop = global.desktop, previousDocument = global.document;
  const modes = [];
  global.desktop = { onlineMode: async enabled => modes.push(enabled) };
  global.document = { querySelector: () => null, getElementById: () => ({ hidden: true }), exitPointerLock() {} };
  t.after(() => { global.desktop = previousDesktop; global.document = previousDocument; });
  const events = [];
  const clock = { isStopped: false, pause() { this.isStopped = true; }, resume() { this.isStopped = false; } };
  const controller = { update: () => events.push('input'), clearInputs: () => events.push('clear'), unlockMouse() {} };
  const game = {
    hasLoadedLevel: true, gameClock: clock, paused: false,
    getActiveGameState: () => ({ name: 'GamestatePlaying' }),
    getGameController: () => controller, getPlayState: () => ({ update: () => events.push('play-state') }),
    beginWorldUpdate: () => events.push('begin'), updateSimulation: () => events.push('simulation'),
    isPaused() { return this.paused; }
  };
  const controls = new Controls(); controls.ready = () => true;
  controls.attach({ globals: { gameManager: game }, updateGame: () => events.push('app') }, [], {});
  const transport = new HostSession();
  t.after(() => transport.close());
  return { controls, game, controller, clock, transport, modes, events };
}
test('online host menus update the world once per tick and block only local modal input', async t => {
  const { controls, game, controller, clock, transport, modes, events } = setup(t);
  const world = await startHostingWorld(controls, transport);
  t.after(() => world.close());
  assert.deepEqual(modes, [true]);
  clock.pause(); assert.equal(clock.isStopped, false);
  events.length = 0;
  world.beginTick();
  controller.update();
  game.updateSimulation();
  world.endTick();
  assert.deepEqual(events, ['input', 'simulation']);
  events.length = 0;
  controls.pause(true);
  controls.app.updateGame();
  world.beginTick();
  controller.update();
  world.endTick();
  assert.deepEqual(events, ['clear', 'app', 'play-state', 'begin', 'simulation']);
  controls.pause(false);
  global.document.querySelector = () => ({});
  events.length = 0; controller.update(); assert.deepEqual(events, []);
  game.paused = true;
  await world.close();
  assert.equal(clock.isStopped, true);
  assert.equal(controls.onlineWorld, undefined);
  assert.equal(transport.closed, true);
  assert.deepEqual(modes, [true, false]);
  events.length = 0;
  controls.pause(true); controls.app.updateGame();
  assert.deepEqual(events, [], 'Solo desktop pause is restored');
});
test('online captures occur only after simulation and checkpoint preserves the captured tick during acknowledgements', async t => {
  const { controls, game, transport, events } = setup(t);
  const world = await startHostingWorld(controls, transport); t.after(() => world.close());
  let tick = 0;
  const bridge = { state: { tick: 0 } };
  controls.writeCheckpoint = () => { bridge.state.tick = tick; };
  let settled = 0;
  controls.settle = async () => { if (++settled === 2) bridge.state.tick = 999; };
  const checkpoint = controls.checkpoint(bridge);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(world.captures.length, 1);
  tick = 12; events.length = 0;
  world.beginTick(); world.endTick();
  assert.deepEqual(await checkpoint, { tick: 12 });
  assert.equal(bridge.state.tick, 999, 'Later bridge activity does not change captured data');
  assert.deepEqual(events, ['play-state', 'begin', 'simulation']);
  assert.equal(controls.paused, undefined, 'Saving does not pause local input or the world');
  const rejected = world.atBoundary(() => 'never');
  await world.close();
  await assert.rejects(rejected, /host ended/);
  await assert.rejects(world.atBoundary(() => {}), /not ready/);
});
test('hosting cannot stack or start on a menu and failed native setup restores solo hooks', async t => {
  const { controls, game, clock, transport } = setup(t);
  const original = game.updateSimulation;
  game.getActiveGameState = () => ({ name: 'GamestateStartScreen' });
  await assert.rejects(startHostingWorld(controls, transport), /Play before hosting/);
  assert.equal(game.updateSimulation, original);
  game.getActiveGameState = () => ({ name: 'GamestatePlaying' });
  global.desktop.onlineMode = async enabled => { if (enabled) throw new Error('native mode unavailable'); };
  await assert.rejects(startHostingWorld(controls, transport), /native mode unavailable/);
  assert.equal(controls.onlineWorld, undefined);
  assert.equal(game.updateSimulation, original);
  clock.pause(); assert.equal(clock.isStopped, true);
});
