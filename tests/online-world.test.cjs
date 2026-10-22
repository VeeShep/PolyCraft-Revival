'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controls } = require('../desktop/controls.js');
const { HostSession } = require('../desktop/multiplayer.js');
const { startHostingWorld } = require('../desktop/online-world.js');
const { CoopData } = require('../desktop/coop-data.js');
const { emptyState } = require('../desktop/saves.cjs');
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
test('host-selected invitation slots reserve identities, reject duplicate claims and keep saved heroes across peer replacement', async t => {
  const { controls, transport, game } = setup(t), previous = global.polycraft;
  let saves = 0, unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  global.polycraft = { checkpoint: async () => { await gate; saves++; } };
  t.after(() => { global.polycraft = previous; });
  const world = await startHostingWorld(controls, transport);
  world.atBoundary = async read => read();
  const registry = new CoopData(emptyState()), first = registry.addPlayer('One'), second = registry.addPlayer('Two');
  const active = new Map();
  const hero = name => ({ name, getName: () => name, getEC: () => null, shouldBeDestroyed: () => false, getv3Location: () => [0, 0, 0], getV3Scale: () => [1, 1, 1], getRotationY: () => 0 });
  const host = hero('Host'); game.getHero = () => host;
  game.gameClock.getFrameIndex = () => 1; game.globals = { gameCurrentTime: 0 }; game.getGameDayTime = () => 12;
  game.getGameSpaceList = () => [{ calculateExtents: () => [-10, -10, -10, 10, 10, 10], getM43FullTransform: () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], getBlockList: () => [], getEntityList: () => [host, ...[...active.values()].map(entry => entry.hero)] }];
  world.players = { registry, active, add(id) { active.set(id, { hero: hero('Hero_' + id), model: { id } }); },
    remove(id) { active.delete(id); } };
  const deliveries = [], streams = [];
  transport.createInvitation = async () => {
    const peer = crypto.randomUUID();
    transport.peers.set(peer, { peer, closed: false, state: 'connected', send: async (kind, payload) => deliveries.push({ peer, kind, payload }), close() { this.closed = true; } });
    return { peer, invitation: peer };
  };
  world.streamTo = connection => streams.push(connection.peer);
  const pending = world.createPlayerInvitation(first.id);
  await assert.rejects(world.createPlayerInvitation(first.id), /available saved/);
  await assert.rejects(world.createPlayerInvitation(registry.data.host), /available saved/);
  await assert.rejects(world.createPlayerInvitation('missing'), /does not belong/);
  unblock();
  const invitation = await pending, connection = transport.peers.get(invitation.peer);
  assert.equal(invitation.playerId, first.id);
  assert.throws(() => world.playerFor(connection), /no assigned/);
  await world.connectPlayer(invitation.peer);
  assert.equal(world.playerFor(connection).id, first.id);
  assert.deepEqual(deliveries[0], { peer: invitation.peer, kind: 'welcome', payload: { version: 1, playerId: first.id, name: 'One', entity: 'Hero_' + first.id, pvp: false } });
  assert.deepEqual(streams, [invitation.peer]);
  await world.connectPlayer(invitation.peer); assert.equal(deliveries.length, 1);
  assert.throws(() => world.playerFor({ ...connection }), /no assigned/, 'A copied peer identifier does not confer its connection authority');
  const binding = world.peerPlayers.get(invitation.peer); connection.close(); await world.releasePlayer(binding);
  assert.equal(active.has(first.id), false); assert.equal(registry.player(first.id).name, 'One');
  const returning = await world.createPlayerInvitation(first.id);
  assert.notEqual(returning.peer, invitation.peer); await world.connectPlayer(returning.peer);
  assert.equal(world.playerFor(transport.peers.get(returning.peer)).id, first.id);
  const unused = await world.createPlayerInvitation(second.id), unusedBinding = world.peerPlayers.get(unused.peer);
  transport.peers.get(unused.peer).close(); await world.releasePlayer(unusedBinding);
  assert.equal(world.guestSlots.has(second.id), false); assert.equal(active.has(second.id), false);
  const before = registry.data.players.length;
  global.polycraft.checkpoint = async () => { throw new Error('Save refused'); };
  await assert.rejects(world.createPlayerInvitation(second.id), /Save refused/);
  assert.equal(world.guestSlots.has(second.id), false); assert.equal(registry.data.players.length, before);
  assert.ok(saves >= 4);
  delete world.players; await world.close();
});
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
test('host streams an initial snapshot then bounded updates, waits for each transfer and stops on cancellation or host exit', async t => {
  const { controls, transport } = setup(t);
  const world = await startHostingWorld(controls, transport); t.after(() => world.close());
  const sent = []; let captures = 0, release;
  world.snapshot = async () => ({ tick: ++captures });
  const connection = { peer: 'guest', state: 'connected', closed: false,
    send(kind, state) { sent.push({ kind, ...state }); return sent.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); },
    fail(error) { throw error; }, close() { this.closed = true; }
  };
  transport.peers.set(connection.peer, connection);
  assert.throws(() => world.streamTo({ ...connection }), /connected guest/);
  const stop = world.streamTo(connection);
  assert.throws(() => world.streamTo(connection), /connected guest/);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(sent, [{ kind: 'snapshot', tick: 1 }]); assert.equal(captures, 1);
  release();
  const deadline = Date.now() + 2000;
  while (sent.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(sent[1], { kind: 'update', tick: 2 });
  stop(); const count = captures;
  await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(captures, count); assert.equal(world.streams.size, 0);
  world.streamTo(connection); stop(); assert.equal(world.streams.size, 1, 'An old cancellation cannot remove a restarted stream');
  await new Promise(resolve => setImmediate(resolve));
  await world.close(); assert.equal(world.streams.size, 0);
});
