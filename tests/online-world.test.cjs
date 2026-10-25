'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controls } = require('../desktop/controls.js');
const { HostSession } = require('../desktop/multiplayer.js');
const { startHostingWorld } = require('../desktop/online-world.js');
const { CoopData } = require('../desktop/coop-data.js');
const { emptyState } = require('../desktop/saves.cjs');
test('host exit waits for accepted action saves and then captures a fresh final checkpoint before restoring solo heroes', async t => {
  const { controls, transport } = setup(t), previous = global.polycraft;
  t.after(() => { global.polycraft = previous; });
  const world = await startHostingWorld(controls, transport), order = [];
  let release;
  world.actionSaves.add(new Promise(resolve => { release = () => { order.push('action saved'); resolve(); }; }));
  world.players = { close: () => order.push('heroes restored') }; world.atBoundary = async run => run();
  global.polycraft = { checkpoint: async fresh => { assert.equal(fresh, true); order.push('final saved'); } };
  const closing = world.close(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(world.closing, true); assert.deepEqual(order, []);
  release(); await closing;
  assert.deepEqual(order, ['action saved', 'final saved', 'heroes restored']); assert.equal(world.closed, true);
});
test('demolition acknowledgement waits for a fresh checkpoint and save failure rejects only its connection', async t => {
  const { controls, transport } = setup(t), previous = global.polycraft;
  t.after(() => { global.polycraft = previous; });
  const world = await startHostingWorld(controls, transport); t.after(() => { delete world.players; return world.close(); });
  let finish, failed, writes = 0;
  const sent = [], connection = { state: 'connected', closed: false, send: async (kind, value) => sent.push({ kind, value }), fail: error => { failed = error; } };
  world.players = { active: new Map([['guest', { hero: {} }]]) };
  const payload = { type: 'demolish', sequence: 1, message: 'Building demolished and saved.' };
  world.peerPlayers.set('peer', { id: 'guest', ready: true, connection, input: { apply() {} }, actions: { apply: () => ({ ...payload, save: true }) } });
  global.polycraft = { checkpoint: fresh => { assert.equal(fresh, true); writes++; return new Promise(resolve => { finish = resolve; }); } };
  world.beginTick(); assert.equal(writes, 1); assert.deepEqual(sent, []);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [{ kind: 'result', value: payload }]);
  global.polycraft.checkpoint = async () => { throw new Error('Disk full'); };
  world.beginTick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1); assert.match(failed.message, /Disk full/);
  world.peerPlayers.clear();
  delete world.players; await world.close();
});
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
  const checked = await transport.createInvitation(), checkedLink = transport.peers.get(checked.peer);
  checkedLink.probing = true;
  let allowAdmission;
  global.polycraft.checkpoint = () => new Promise(resolve => { allowAdmission = resolve; });
  const admission = world.admitConnectedPlayer(second.id, checkedLink);
  assert.equal(active.has(second.id), false, 'Route probing and the admission checkpoint must not activate a hero');
  await assert.rejects(world.admitConnectedPlayer(second.id, checkedLink), /cannot claim/);
  await assert.rejects(world.admitConnectedPlayer(registry.data.host, checkedLink), /cannot claim/);
  allowAdmission(); await admission;
  assert.equal(checkedLink.probing, false); assert.equal(world.playerFor(checkedLink).id, second.id);
  assert.equal(deliveries.at(-1).payload.playerId, second.id); assert.equal(streams.at(-1), checked.peer);
  global.polycraft.checkpoint = async () => {};
  checkedLink.close(); await world.releasePlayer(world.peerPlayers.get(checked.peer));
  const cancelled = await transport.createInvitation(), cancelledLink = transport.peers.get(cancelled.peer); cancelledLink.probing = true;
  global.polycraft.checkpoint = () => new Promise(resolve => { allowAdmission = resolve; });
  const cancelledAdmission = world.admitConnectedPlayer(second.id, cancelledLink);
  cancelledLink.close(); allowAdmission(); await assert.rejects(cancelledAdmission, /ended before admission/);
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
test('a checkpoint rechecks construction at its capture boundary and waits for a throw that began after the first settle', async t => {
  const { controls, game, transport } = setup(t), world = await startHostingWorld(controls, transport);
  const bridge = { state: {} }; let pass = 0, captured = 0;
  controls.settle = async () => {}; controls.writeCheckpoint = () => { bridge.state.captured = ++captured; };
  const pending = new Set();
  world.construction = { pending, settle: async () => { pass++; if (pass === 2) pending.clear(); } };
  const original = world.atBoundary.bind(world);
  world.atBoundary = async read => { if (pass === 1) pending.add({}); const result = original(read); world.beginTick(); world.endTick(); return result; };
  assert.deepEqual(await world.checkpoint(bridge), { captured: 1 }); assert.equal(pass, 2);
  await world.close();
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
  world.snapshot = async () => worldSnapshot(++captures);
  const connection = { peer: 'guest', state: 'connected', closed: false,
    send(kind, state) { sent.push({ kind, ...state }); return sent.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); },
    fail(error) { throw error; }, close() { this.closed = true; }
  };
  transport.peers.set(connection.peer, connection);
  assert.throws(() => world.streamTo({ ...connection }), /connected guest/);
  const stop = world.streamTo(connection);
  assert.throws(() => world.streamTo(connection), /connected guest/);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(sent.length, 1); assert.equal(sent[0].kind, 'snapshot'); assert.equal(sent[0].tick, 1); assert.equal(captures, 1);
  release();
  const deadline = Date.now() + 2000;
  while (sent.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sent[1].kind, 'update'); assert.equal(sent[1].tick, 2); assert.equal(sent[1].baseTick, 1);
  assert.deepEqual(sent[1].spaces, [{ index: 0, remove: [], entities: [{ id: 'hero', location: [2, 0, 0] }] }]);
  stop(); const count = captures;
  await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(captures, count); assert.equal(world.streams.size, 0);
  const originalSnapshot = world.snapshot, failures = []; let rejectCapture;
  connection.fail = error => failures.push(error);
  world.snapshot = () => new Promise((resolve, reject) => { rejectCapture = reject; });
  const cancelPending = world.streamTo(connection); cancelPending();
  rejectCapture(new Error('The host session is ending.')); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failures, [], 'A cancelled snapshot must not turn normal shutdown into a peer failure');
  world.streamTo(connection); rejectCapture(new Error('Actual capture failure')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(failures.length, 1); assert.match(failures[0].message, /Actual capture failure/, 'An uncancelled failure still fails its peer');
  world.snapshot = originalSnapshot;
  world.streamTo(connection); stop(); assert.equal(world.streams.size, 1, 'An old cancellation cannot remove a restarted stream');
  await new Promise(resolve => setImmediate(resolve));
  await world.close(); assert.equal(world.streams.size, 0);
});

function worldSnapshot(tick) {
  return { version: 3, tick, time: tick / 30, dayTime: 12, hero: 'hero', torch: null,
    spaces: [{ extents: [-10, -10, -10, 10, 10, 10], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], blocks: [],
      entities: [{ id: 'hero', archetype: null, interactive: true, location: [tick, 0, 0], scale: [1, 1, 1], rotation: 0, mesh: null, health: null }] }] };
}
test('host full resyncs are periodic, rate-limited, connection-bound and wait for any in-flight transfer', async t => {
  const { controls, transport } = setup(t), world = await startHostingWorld(controls, transport);
  t.after(() => world.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, captures = 0, release, addSpace = false;
  t.mock.method(performance, 'now', () => now);
  const sent = [];
  world.snapshot = async () => {
    const state = worldSnapshot(++captures);
    if (addSpace) state.spaces.push({ ...structuredClone(state.spaces[0]), entities: [] });
    return state;
  };
  const connection = { peer: 'guest', state: 'connected', closed: false,
    send(kind, payload) { sent.push({ kind, payload }); return sent.length === 2 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); },
    fail(error) { throw error; }, close() { this.closed = true; } };
  transport.peers.set('guest', connection); world.streamTo(connection);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush(); assert.equal(sent[0].kind, 'snapshot');
  now = 100; t.mock.timers.tick(100); await flush(); assert.equal(sent[1].kind, 'update');
  world.requestResync(connection, { version: 1, tick: 1 });
  now = 500; t.mock.timers.tick(400); await flush(); assert.equal(captures, 2, 'A resync never overtakes an unfinished update');
  release(); await flush(); now = 600; t.mock.timers.tick(100); await flush();
  assert.equal(sent[2].kind, 'snapshot'); assert.equal(sent[2].payload.tick, 3);
  world.requestResync(connection, { version: 1, tick: 1 });
  assert.equal(world.streams.get(connection).forceFull, false, 'Repeated resync requests cannot force another transfer within one second');
  assert.throws(() => world.requestResync({ ...connection }, { version: 1, tick: 1 }), /active world stream/);
  for (const value of [null, { version: 1, tick: -1 }, { version: 1, tick: NaN }, { version: 1, tick: 1, playerId: 'other' }]) assert.throws(() => world.requestResync(connection, value), /Invalid/);
  now = 5601; t.mock.timers.tick(100); await flush(); assert.equal(sent[3].kind, 'snapshot', 'A full snapshot repairs state at least once every five seconds while transfers can proceed');
  now = 5701; addSpace = true; t.mock.timers.tick(100); await flush(); assert.equal(sent[4].kind, 'snapshot', 'A layout change replaces the complete baseline');
  now = 5801; t.mock.timers.tick(100); await flush(); assert.equal(sent[5].kind, 'update'); assert.equal(sent[5].payload.baseTick, 5);
  await world.close();
});

test('online checkpoints refuse in-flight construction before writing and succeed after it finishes without pausing the world', async t => {
  const { CoopPlayers } = require('../desktop/coop-players.js');
  const { controls, game, clock, transport } = setup(t);
  const world = await startHostingWorld(controls, transport);
  try {
    let throwing = true, writes = 0, snapshots = 0, persisted = 0;
    game.globals = { gamePurchaseManager: {} };
    const players = Object.create(CoopPlayers.prototype);
    players.game = game;
    players.active = new Map([['host', { hero: { getEC: () => ({ isBuilding: () => false, isThrowing: () => throwing }) } }]]);
    const record = { location: [1, 2, 3] };
    players.registry = { data: { economy: {} }, player: () => record, persist: () => { persisted++; } };
    players.captureHero = () => { snapshots++; return { location: [4, 5, 6] }; };
    world.players = players; world.atBoundary = async read => read();
    const bridge = { state: emptyState() };
    controls.settle = async () => {};
    controls.writeCheckpoint = () => { writes++; bridge.state.userData.progress = '{"xp":10}'; };
    const before = JSON.stringify(bridge.state);
    await assert.rejects(world.checkpoint(bridge), /before saving/);
    assert.equal(writes, 0); assert.equal(snapshots, 0); assert.equal(persisted, 0);
    assert.equal(JSON.stringify(bridge.state), before); assert.deepEqual(record.location, [1, 2, 3]);
    assert.equal(clock.isStopped, false); assert.equal(world.closed, false);
    throwing = false;
    const checkpoint = await world.checkpoint(bridge);
    assert.equal(writes, 1); assert.equal(snapshots, 1); assert.equal(persisted, 1);
    assert.equal(checkpoint.userData.progress, '{"xp":10}'); assert.deepEqual(record.location, [4, 5, 6]);
    assert.equal(clock.isStopped, false);
  } finally { delete world.players; await world.close(); }
});
