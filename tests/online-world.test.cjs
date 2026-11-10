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
for (const type of ['demolish', 'speedup']) test(type + ' acknowledgement waits for a fresh checkpoint and save failure rejects only its connection', async t => {
  const { controls, transport } = setup(t), previous = global.polycraft;
  t.after(() => { global.polycraft = previous; });
  const world = await startHostingWorld(controls, transport); t.after(() => { delete world.players; return world.close(); });
  let finish, failed, writes = 0;
  const sent = [], connection = { state: 'connected', closed: false, send: async (kind, value) => sent.push({ kind, value }), fail: error => { failed = error; } };
  world.players = { active: new Map([['guest', { hero: {} }]]) };
  const payload = { type, sequence: 1, message: 'Building action saved.' };
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
  const modes = [], cleanups = [];
  global.desktop = { onlineMode: async enabled => modes.push(enabled) };
  global.document = { querySelector: () => null, getElementById: () => ({ hidden: true }), exitPointerLock() {} };
  t.after(async () => { try { for (const cleanup of cleanups) await cleanup(); } finally { global.desktop = previousDesktop; global.document = previousDocument; } });
  const events = [];
  const clock = { isStopped: false, pause() { this.isStopped = true; }, resume() { this.isStopped = false; } };
  const controller = { update: () => events.push('input'), clearInputs: () => events.push('clear'), unlockMouse() {} };
  const game = {
    hasLoadedLevel: true, gameClock: clock, paused: false, globals: { gameCurrentTime: 0 },
    gameSoundManager: { activeSoundSourceList: [], playInternal() {}, stopInternal() {} },
    getActiveGameState: () => ({ name: 'GamestatePlaying' }),
    getGameController: () => controller, getPlayState: () => ({ update: () => events.push('play-state') }),
    beginWorldUpdate: () => events.push('begin'), updateSimulation: () => events.push('simulation'),
    isPaused() { return this.paused; }
  };
  const controls = new Controls(); controls.ready = () => true;
  controls.attach({ globals: { gameManager: game }, updateGame: () => events.push('app') }, [], {});
  const transport = new HostSession();
  t.after(() => transport.close());
  return { controls, game, controller, clock, transport, modes, events, cleanup: callback => cleanups.push(callback) };
}
test('reward boundaries wait for natural completion, re-resolve a replaced solo hero and read exactly once', async t => {
  const { controls, game, transport, cleanup } = setup(t), world = await startHostingWorld(controls, transport);
  cleanup(() => world.close());
  let collector = 'old', hero = { getName: () => 'old' }, reads = 0, attempts = 0;
  game.getHero = () => hero;
  game.getGameSpaceList = () => [{ getEntitiesWithEC: () => [{ getEC: () => ({ xp: 20, getCollectorName: () => collector }) }] }];
  world.atBoundary = async read => { if (++attempts === 2) { collector = undefined; hero = { getName: () => 'replacement' }; } return read(); };
  assert.equal(await world.atRewardBoundary(() => { reads++; return game.getHero().getName(); }), 'replacement');
  assert.equal(attempts, 2); assert.equal(reads, 1);
  await assert.rejects(world.atRewardBoundary(async () => 1), /synchronously/);
});
test('initial hosting defers solo replacement through its batch and later pickup, then restores the original refresh hook', async t => {
  const { controls, game, transport, cleanup } = setup(t);
  let hero = { getName: () => 'solo' }, collector = 'solo', replacements = 0;
  game.getHero = () => hero;
  game.getGameSpaceList = () => [{ getEntitiesWithEC: () => [{ getEC: () => ({ xp: 20, getCollectorName: () => collector }) }] }];
  const original = game.refreshHeroEntity = function () { assert.equal(this, game); replacements++; hero = { getName: () => 'replacement' }; };
  game.updateSimulation = () => { game.refreshHeroEntity(hero); game.refreshHeroEntity(hero); };
  const world = await startHostingWorld(controls, transport); cleanup(() => world.close());
  game.updateSimulation(); world.endTick(); assert.equal(replacements, 0); assert.equal(hero.getName(), 'solo');
  collector = undefined;
  const ready = world.atRewardBoundary(() => game.getHero().getName());
  await new Promise(resolve => setImmediate(resolve)); world.endTick();
  assert.equal(await ready, 'replacement'); assert.equal(replacements, 1);
  await world.close(); assert.equal(game.refreshHeroEntity, original);
});
test('reward boundary timeout preserves actors, models and callback and rejects a pending frozen read without spinning', async t => {
  const { controls, game, transport, cleanup } = setup(t), world = await startHostingWorld(controls, transport);
  cleanup(() => world.close());
  let now = 0, reads = 0; t.mock.method(Date, 'now', () => now);
  world.pendingRewards = () => true; world.atBoundary = async read => { now += 10001; return read(); };
  await assert.rejects(world.atRewardBoundary(() => reads++), /heroes and previous save are safe/);
  assert.equal(reads, 0); assert.equal(world.closed, false);
  world.freezeFinalSave();
  await assert.rejects(world.atRewardBoundary(() => reads++), /heroes and previous save are safe/);
  assert.equal(reads, 0); world.resumeFinalSave();
});
test('final-save freeze stops native clock/tween progress and resumes without absence catch-up', async t => {
  const { controls, game, transport, cleanup } = setup(t), ast = require('./runtime-ast.cjs');
  const globals = Object.assign(controls.app.globals, { appCurrentTime: 1, gameCurrentTime: 0, appTimeStep: 1 / 60, appMaxTimeSteps: 4 });
  const clock = game.gameClock = Object.assign(Object.create(ast.prototypeWith('getTimeDilation')), { globals, timeDilation: 1 }); clock.start();
  const tweens = ast.visualEffectMethods([]).tweens; Object.assign(tweens, { globals, add() {}, remove() {} });
  const state = { value: 0 }, tween = tweens.Create(state).to({ value: 1 }, 1).start();
  const update = controls.app.updateGame = () => {
    if (clock.tick(false, true)) { globals.gameCurrentTime = clock.getCurrentTime(); game.updateSimulation(); tween.update(globals.gameCurrentTime * 1000, globals.appCurrentTime * 1000); }
  };
  const world = await startHostingWorld(controls, transport); cleanup(() => world.close());
  globals.appCurrentTime += 1 / 60; update(); const before = { time: clock.getCurrentTime(), value: state.value };
  world.freezeFinalSave(); globals.appCurrentTime += 120; controls.app.updateGame();
  assert.equal(clock.getCurrentTime(), before.time); assert.equal(state.value, before.value); assert.equal(clock.isStopped, true);
  await assert.rejects(world.atBoundary(async () => 1), /synchronously/);
  world.resumeFinalSave(); assert.equal(controls.app.updateGame, update); assert.equal(clock.isStopped, false);
  assert.equal(game.prevAppCurrentTime, globals.appCurrentTime);
  globals.appCurrentTime += 1 / 60; controls.app.updateGame();
  assert.ok(clock.getCurrentTime() > before.time && clock.getCurrentTime() < 0.1); assert.ok(state.value > before.value && state.value < 0.1);
});
test('pending guest removal reserves its actor until completion, and timeout retains it detached', async t => {
  const { controls, game, transport, cleanup } = setup(t), world = await startHostingWorld(controls, transport), previous = global.polycraft;
  cleanup(() => { delete world.players; world.peerPlayers.clear(); global.polycraft = previous; return world.close(); });
  global.polycraft = { checkpoint: async () => {} };
  for (const fail of [false, true]) {
    const actor = { getName: () => 'guest' }, connection = { peer: 'peer', closed: true };
    const binding = { id: 'guest', peer: 'peer', joined: true, connection, input: { stop() {} }, actions: { stop() {} } };
    world.players = { active: new Map([['guest', { hero: actor }]]), remove(id) { this.active.delete(id); } };
    world.guestSlots.set('guest', binding); world.peerPlayers.set('peer', binding);
    let now = 0, attempts = 0; t.mock.method(Date, 'now', () => now);
    world.pendingRewards = id => { assert.equal(id, 'guest'); return fail || attempts === 1; };
    world.atBoundary = async read => {
      attempts++; assert.equal(binding.releasing, true); assert.equal(world.guestSlots.get('guest'), binding); assert.equal(world.players.active.get('guest').hero, actor);
      if (fail) now = 10001;
      return read();
    };
    if (fail) {
      await assert.rejects(world.releasePlayer(binding), /Incoming rewards/);
      assert.equal(world.players.active.get('guest').hero, actor); assert.equal(world.detachedPlayers.has('guest'), true);
    } else { await world.releasePlayer(binding); assert.equal(attempts, 2); assert.equal(world.players.active.has('guest'), false); }
    assert.equal(world.guestSlots.has('guest'), false); assert.equal(world.peerPlayers.has('peer'), false);
  }
});
test('closing retains validated guest requests for rollback without executing them or accepting forged streams', async t => {
  const { controls, transport, cleanup } = setup(t), world = await startHostingWorld(controls, transport);
  const { HostActions } = require('../desktop/coop-actions.js'), { HostMovement } = require('../desktop/coop-input.js'), actions = new HostActions(), input = new HostMovement();
  const connection = { peer: 'guest', closed: false, state: 'connected' };
  world.players = { active: new Map([['assigned', { hero: {} }]]) };
  const binding = { id: 'assigned', connection, ready: true, actions, input };
  world.peerPlayers.set('guest', binding);
  transport.peers.set('guest', connection);
  cleanup(() => { world.closing = false; world.peerPlayers.clear(); transport.peers.clear(); delete world.players; return world.close(); });
  const send = payload => world.receiveMessage({ kind: 'action', payload }, connection);
  world.closing = true;
  send({ type: 'life', sequence: 1, target: 'hero' }); assert.equal(actions.sequence, 1); assert.equal(actions.queue.length, 1);
  assert.throws(() => send({ type: 'life', sequence: 2, target: 'hero', forged: true }), /Invalid/);
  for (const [object, key, value] of [[binding, 'ready', false], [binding, 'releasing', true], [connection, 'closed', true]]) {
    const before = object[key]; object[key] = value; send({ type: 'life', sequence: 2, target: 'hero' }); assert.equal(actions.sequence, 1); object[key] = before;
  }
  send({ type: 'move', sequence: 1, move: [1, 0] }); assert.equal(actions.sequence, 1); assert.equal(input.sequence, 1); assert.deepEqual(input.move, [0, 0]);
  send({ type: 'walk', sequence: 2, mode: 'click', location: [1, 2, 3] }); assert.equal(input.sequence, 2); assert.equal(input.pendingWalk, null);
  assert.throws(() => send({ type: 'move', sequence: 4, move: [0, 0] }), /Invalid/);
  assert.throws(() => world.receiveMessage({ kind: 'action', payload: { type: 'life', sequence: 2, target: 'hero' } }, { ...connection }), /no assigned/);
  world.closing = false; send({ type: 'life', sequence: 2, target: 'hero' });
  send({ type: 'move', sequence: 3, move: [0, 1] }); assert.equal(input.sequence, 3); assert.deepEqual(input.move, [0, 1]);
  assert.deepEqual(actions.queue.map(row => row.sequence), [1, 2]);
});
for (const fail of [false, true]) test('host final save drains a late reward, freezes through acknowledgement and restores hooks/streams on failure=' + fail, async t => {
  const { controls, game, transport, clock, controller, events, cleanup } = setup(t), previous = global.polycraft;
  const world = await startHostingWorld(controls, transport), originalUpdate = controls.app.updateGame;
  cleanup(() => { global.polycraft = previous; delete world.players; world.peerPlayers.clear(); transport.peers.clear(); return world.close(); });
  let pending = false, late = false, xp = 0, destroyed = false, savedXP, release, reject;
  const gate = new Promise((resolve, refuse) => { release = resolve; reject = refuse; });
  world.players = { active: new Map(), close: () => { destroyed = true; } };
  world.pendingRewards = () => pending;
  world.atBoundary = async read => {
    if (!world.finalUpdate && pending) { xp += 20; pending = false; }
    const result = read();
    if (world.finalUpdate && !late) { pending = true; late = true; }
    return result;
  };
  let streamsRestored = 0;
  const connection = { peer: 'guest', closed: false, state: 'connected', close() { this.closed = true; } };
  world.peerPlayers.set('guest', { ready: true, connection }); transport.peers.set('guest', connection);
  world.streamTo = received => { assert.equal(received, connection); streamsRestored++; };
  global.polycraft = { checkpoint: async fresh => { assert.equal(fresh, true); assert.ok(world.finalUpdate); assert.equal(pending, false); savedXP = xp; await gate; assert.equal(destroyed, false); } };
  const closing = world.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(xp, 20); assert.equal(savedXP, 20); assert.equal(destroyed, false); assert.equal(clock.isStopped, true);
  events.length = 0; controls.app.updateGame(); game.updateSimulation(); controller.update(); world.endTick();
  assert.deepEqual(events, []); assert.equal(destroyed, false);
  if (fail) {
    const reason = new Error('Disk full'); reject(reason); await assert.rejects(closing, error => error === reason);
    assert.equal(world.closed, false); assert.equal(destroyed, false); assert.equal(streamsRestored, 1);
  } else { release(); await closing; assert.equal(world.closed, true); assert.equal(destroyed, true); assert.equal(streamsRestored, 0); }
  assert.equal(controls.app.updateGame, originalUpdate); assert.equal(world.finalUpdate, undefined); assert.equal(world.closing, false); assert.equal(clock.isStopped, false);
});
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
  const hero = name => ({ getGameSpace: () => ({ getv3Location: () => [0, 0, 0] }), name, getName: () => name, getEC: component => component === 'ECLocomotion' ? { clearDestination() {}, clearDestinationEntity() {}, getDestination: () => null, getTimeHeld: () => 0 } : null, shouldBeDestroyed: () => false, getv3Location: () => [0, 0, 0], getV3Scale: () => [1, 1, 1], getRotationY: () => 0 });
  const host = hero('Host'); game.getHero = () => host; game.getPlayFlags = () => ({}); game.applyToHeroEntities = apply => apply(host); game.getFactionManager = () => ({ applyToEnemies() {} });
  game.gameClock.getFrameIndex = () => 1; game.globals = { gameCurrentTime: 0 }; game.getGameDayTime = () => 12;
  game.getGameSpaceList = () => [{ calculateExtents: () => [-10, -10, -10, 10, 10, 10], getM43FullTransform: () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], getEntitiesWithEC: () => [], getBlockList: () => [], getEntityList: () => [host, ...[...active.values()].map(entry => entry.hero)] }];
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
  world.results.sequence = 5;
  await world.connectPlayer(invitation.peer);
  assert.equal(world.playerFor(connection).id, first.id);
  assert.equal(world.peerPlayers.get(invitation.peer).actions.resultFloor, 5);
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
test('native simulation marks the whole update and always clears its replacement guard, preserving return, errors and solo restoration', async t => {
  const { controls, game, transport } = setup(t), reason = new Error('native simulation failed'), seen = [];
  let fail = false;
  const original = game.updateSimulation = function (...args) {
    assert.equal(this, game); seen.push({ active: controls.app.globals.desktopWorld.simulating, args });
    if (fail) throw reason;
    return 'native result';
  };
  const world = await startHostingWorld(controls, transport);
  t.after(() => world.close());
  assert.equal(game.updateSimulation(1, 2), 'native result'); assert.equal(world.simulating, false);
  fail = true; assert.throws(() => game.updateSimulation(3), error => error === reason); assert.equal(world.simulating, false);
  assert.deepEqual(seen, [{ active: true, args: [1, 2] }, { active: true, args: [3] }]);
  await world.close(); assert.equal(game.updateSimulation, original);
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
test('brief peer disconnection suspends world captures, preserves its stream and resumes with a full snapshot', async t => {
  const { controls, transport, events } = setup(t), world = await startHostingWorld(controls, transport);
  t.after(() => { delete world.players; return world.close(); });
  const sent = [], failures = []; let captures = 0, stoppedInput = 0;
  const connection = { peer: 'recovering', state: 'connected', closed: false, send: async (kind, state) => sent.push({ kind, state }), fail: error => failures.push(error) };
  const binding = { id: 'guest', ready: true, joined: true, connection, input: { apply() {}, stop() { stoppedInput++; } }, actions: { apply() {}, stop() {} } };
  world.players = { active: new Map([['guest', { hero: {} }]]), flushRefreshes() {}, syncTutorialWeapons() {} };
  world.peerPlayers.set(connection.peer, binding); transport.peers.set(connection.peer, connection);
  world.snapshot = async link => { world.playerFor(link); return worldSnapshot(++captures); };
  world.streamTo(connection); await new Promise(resolve => setImmediate(resolve)); const stream = world.streams.get(connection);
  assert.equal(sent.length, 1); connection.state = 'disconnected';
  world.beginTick(); world.endTick(); assert.equal(stoppedInput, 1); assert.ok(events.includes('simulation'));
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(captures, 1, 'disconnected guests cannot accumulate snapshots'); assert.equal(sent.length, 1); assert.deepEqual(failures, []);
  assert.equal(world.streams.get(connection), stream); connection.state = 'connected';
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(sent[1].kind, 'snapshot'); assert.equal(world.peerPlayers.get(connection.peer), binding); assert.equal(binding.joined, true);
  assert.equal(world.streams.get(connection), stream); assert.deepEqual(failures, []);
  const count = captures; transport.peers.delete(connection.peer); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(captures, count); assert.equal(world.streams.size, 0, 'replaced connections cannot keep a stale stream');
  delete world.players; await world.close();
});
test('a disconnect between capture request and simulation boundary yields no snapshot rather than failing a valid peer', async t => {
  const { controls, transport } = setup(t), world = await startHostingWorld(controls, transport);
  t.after(() => { delete world.players; return world.close(); });
  const connection = { peer: 'boundary', state: 'connected', closed: false, close() { this.closed = true; } };
  transport.peers.set(connection.peer, connection); world.players = { active: new Map([['guest', { hero: {} }]]) };
  world.peerPlayers.set(connection.peer, { id: 'guest', ready: true, connection });
  let release; const gate = new Promise(resolve => { release = resolve; });
  world.atBoundary = async read => { await gate; return read(); };
  const pending = world.snapshot(connection); connection.state = 'disconnected'; release(); assert.equal(await pending, null);
  delete world.players; await world.close();
});
test('a peer replaced while its snapshot is pending cannot receive the captured state', async t => {
  const { controls, transport } = setup(t), world = await startHostingWorld(controls, transport); t.after(() => world.close());
  const sent = [], connection = { peer: 'replaced', state: 'connected', closed: false, send: async () => sent.push('obsolete'), fail: error => { throw error; }, close() { this.closed = true; } };
  let release; world.snapshot = () => new Promise(resolve => { release = () => resolve(worldSnapshot(1)); });
  transport.peers.set(connection.peer, connection); world.streamTo(connection);
  transport.peers.set(connection.peer, { ...connection }); release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, []); assert.equal(world.streams.size, 0); await world.close();
});
test('authenticated in-flight actions survive a disconnected peer without applying until recovery or bypassing identity validation', async t => {
  const { controls, transport } = setup(t), world = await startHostingWorld(controls, transport);
  t.after(() => { delete world.players; return world.close(); });
  const { HostActions } = require('../desktop/coop-actions.js'), actions = new HostActions(); let applied = 0;
  actions.apply = () => { if (actions.queue.shift()) applied++; return null; };
  const connection = { peer: 'in-flight', state: 'disconnected', closed: false, close() { this.closed = true; } }, hero = { getEC: () => null };
  const binding = { id: 'guest', ready: true, joined: true, connection, input: { apply() {}, stop() {} }, actions };
  world.players = { active: new Map([['guest', { hero }]]) }; world.peerPlayers.set(connection.peer, binding); transport.peers.set(connection.peer, connection);
  const message = { kind: 'action', payload: { type: 'life', sequence: 1, target: 'own-hero' } };
  world.receiveMessage(message, connection); assert.equal(actions.queue.length, 1); world.beginTick(); assert.equal(applied, 0);
  assert.throws(() => world.receiveMessage(message, { ...connection }), /no assigned/);
  assert.throws(() => world.receiveMessage({ kind: 'action', payload: { ...message.payload, sequence: 2, xp: 999 } }, connection), /Invalid/);
  const stream = { resyncRequestedAt: -Infinity, forceFull: false, stop: () => world.streams.delete(connection) }; world.streams.set(connection, stream);
  world.receiveMessage({ kind: 'resync', payload: { version: 1, tick: 1 } }, connection); assert.equal(stream.forceFull, true);
  connection.state = 'connected'; world.beginTick(); world.beginTick(); assert.equal(applied, 1); assert.equal(actions.sequence, 1);
  world.receiveMessage({ kind: 'action', payload: { type: 'craftMenu', target: 'own-hero', sequence: 2 } }, connection);
  world.receiveMessage({ kind: 'action', payload: { type: 'craftResource', target: 'own-hero', sequence: 3, quote: 2, index: 0 } }, connection);
  assert.deepEqual(actions.queue.map(action => action.type), ['craftMenu', 'craftResource']);
  assert.throws(() => world.receiveMessage({ kind: 'action', payload: { type: 'craftResource', target: 'own-hero', sequence: 4, quote: 2, index: 0, cost: 0 } }, connection), /Invalid/);
  world.beginTick(); world.beginTick(); assert.equal(applied, 3);
  delete world.players; await world.close();
});

function worldSnapshot(tick) {
  return { version: 18, notices: [], effects: { sequence: 0, events: [], active: [] }, audio: { sequence: 0, events: [], loops: [] }, music: null, combat: null, tick, time: tick / 30, dayTime: 12, hero: 'hero', torch: null, camera: { mode: 'explore', dead: false, buildingAge: 1000, destination: null, pathDestination: null, lookAhead: null, timeHeld: 0, heroes: ['hero'], enemies: [], center: [0, 0, 0] },
    spaces: [{ extents: [-10, -10, -10, 10, 10, 10], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], blocks: [],
      entities: [{ id: 'hero', archetype: null, interactive: true, resourceReady: false, attackCursor: false, workerCue: null, location: [tick, 0, 0], scale: [1, 1, 1], rotation: 0, mesh: null, health: null }] }] };
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

test('host menu quests update before coherent snapshot capture', async t => {
  const { controls, transport, game } = setup(t), world = await startHostingWorld(controls, transport);
  let completed = false, ticks = 0;
  game.desktopQuestRewards = {};
  game.getActiveGameState = () => ({ name: 'GamestateShop' });
  game.updateOnlineTasks = () => { completed = true; ticks++; };
  world.worldUpdated = true;
  const captured = world.atBoundary(() => completed);
  world.endTick(); assert.equal(await captured, true); assert.equal(ticks, 1);
  game.getActiveGameState = () => ({ name: 'GamestatePlaying' });
  world.endTick(); assert.equal(ticks, 1); await world.close();
});
test('disconnect and host shutdown stop guest automatic fire even if construction defers hero removal', async t => {
  const { controls, transport } = setup(t), previous = global.polycraft;
  t.after(() => { global.polycraft = previous; });
  global.polycraft = { checkpoint: async () => {} };
  const world = await startHostingWorld(controls, transport);
  let target = {}, stops = 0;
  const hero = { getEC: name => name === 'ECAutoFire' ? { disable() { target = null; } } : null };
  const binding = { id: 'guest', peer: 'peer', ready: true, joined: true, connection: { closed: true }, input: { stop() { stops++; } }, actions: new (require('../desktop/coop-actions.js').HostActions)() };
  world.players = { active: new Map([['guest', { hero }]]), remove() { throw new Error('Finish thrown building'); } };
  world.peerPlayers.set('peer', binding); world.guestSlots.set('guest', binding);
  world.beginTick(); assert.equal(target, null); assert.equal(stops, 1);
  target = {}; world.atBoundary = async read => read();
  await assert.rejects(world.releasePlayer(binding), /thrown building/);
  assert.equal(target, null); assert.equal(stops, 2); assert.equal(world.players.active.has('guest'), true); assert.equal(world.detachedPlayers.has('guest'), true);
  target = {}; binding.releasing = false; binding.connection = { closed: false, state: 'connected' }; world.peerPlayers.set('peer', binding); world.closing = true;
  world.beginTick(); assert.equal(target, null); assert.equal(stops, 3);
  world.closing = false; world.peerPlayers.clear(); delete world.players; await world.close();
});
test('the host dispatcher keeps walking, directional cancellation and construction moves on their separate validated streams', async t => {
  const { controls, transport } = setup(t), world = await startHostingWorld(controls, transport);
  const { HostMovement } = require('../desktop/coop-input.js'), { HostActions } = require('../desktop/coop-actions.js');
  const connection = { peer: 'guest-peer', state: 'connected', closed: false }, input = new HostMovement(), actions = new HostActions(), hero = {};
  world.players = { active: new Map([['guest', { hero }]]) }; transport.peers.set(connection.peer, connection);
  world.peerPlayers.set(connection.peer, { id: 'guest', connection, ready: true, input, actions });
  transport.onMessage = world.receiveMessage.bind(world);
  try {
    const send = payload => transport.onMessage({ kind: 'action', payload }, connection);
    send({ type: 'walk', mode: 'click', sequence: 1, location: [30, 2, 20] }); assert.deepEqual(input.pendingWalk, { location: [30, 2, 20], mode: 'click' });
    send({ type: 'move', sequence: 2, move: [0, 0] }); assert.equal(input.pendingWalk, null); assert.equal(input.sequence, 2); assert.equal(actions.sequence, 0);
    send({ type: 'move', sequence: 3, move: [1, 0] }); assert.deepEqual(input.move, [1, 0]);
    send({ type: 'move', sequence: 1, target: 'workshop' }); assert.equal(actions.queue[0].target, 'workshop'); assert.equal(actions.sequence, 1); assert.equal(input.sequence, 3);
    assert.throws(() => send({ type: 'move', sequence: 4, move: [0, 0], target: 'forged hero' }), /Invalid/);
    assert.equal(input.sequence, 3); assert.equal(actions.sequence, 1);
    assert.throws(() => transport.onMessage({ kind: 'action', payload: { type: 'move', sequence: 4, move: [0, 0] } }, { ...connection }), /no assigned/);
    send({ type: 'campaignStart', sequence: 2, target: 'banner', campaign: 'campaign_tutorial_01' });
    send({ type: 'campaignClose', sequence: 3, target: 'banner', campaign: 'campaign_tutorial_01' });
    assert.deepEqual(actions.queue.slice(1).map(action => action.type), ['campaignStart', 'campaignClose']); assert.equal(input.sequence, 3);
    send({ type: 'skipPrepare', sequence: 4, target: 'guest', episode: 7 }); assert.equal(actions.queue.at(-1).type, 'skipPrepare'); assert.equal(input.sequence, 3);
    actions.queue.length = 0;
    const speedup = { type: 'speedup', sequence: 5, target: 'scaffold', planned: 'a_b_outpost', cost: 50 };
    send(speedup); assert.deepEqual(actions.queue, [speedup]); assert.equal(input.sequence, 3);
    assert.throws(() => send({ ...speedup, sequence: 6, playerId: 'host' }), /Invalid/);
    world.closing = true; send({ ...speedup, sequence: 6 });
    assert.deepEqual(actions.queue.map(action => action.type), ['speedup', 'speedup']); assert.equal(input.sequence, 3);


  } finally { world.closing = false; world.peerPlayers.clear(); transport.peers.clear(); delete world.players; await world.close(); }
});

test('hosting installs one world-audio recorder and closing restores original native audio hooks', async t => {
  const { controls, transport, game } = setup(t), original = { play: game.gameSoundManager.playInternal, stop: game.gameSoundManager.stopInternal };
  const world = await startHostingWorld(controls, transport);
  assert.equal(game.desktopAudio, world.audio); assert.notEqual(game.gameSoundManager.playInternal, original.play);
  game.gameSoundManager.playInternal('aud_shotgunshot', [1, 2, 3]); assert.equal(game.desktopAudio.capture().events.length, 1);
  await world.close(); assert.equal(game.desktopAudio, undefined);
  assert.equal(game.gameSoundManager.playInternal, original.play); assert.equal(game.gameSoundManager.stopInternal, original.stop);
});

test('failed host audio initialization restores an already-installed original visual factory without publishing world hooks', async t => {
  const { controls, transport, game } = setup(t), create = () => {}, factory = { create }, failure = new Error('invalid audio source');
  controls.effectMethods = { factory, archetypes: {} };
  game.gameSoundManager.activeSoundSourceList = [{ get soundName() { throw failure; } }];
  await assert.rejects(startHostingWorld(controls, transport), error => error === failure);
  assert.equal(factory.create, create); assert.equal(game.desktopEffects, undefined); assert.equal(controls.onlineWorld, undefined);
});

test('hosting borrows pre-host effect history across failed admission, host exit and another session without duplicating native calls', async t => {
  const { controls, transport, game } = setup(t), { HostEffects } = require('../desktop/world-effects.js'); let calls = 0;
  const factory = { create() { calls++; } }, original = factory.create, api = { factory, archetypes: { vfx_exp_decal: {} } };
  const history = controls.effectHistory = new HostEffects(() => game, api); t.after(() => history.close());
  factory.create(game.globals, api.archetypes.vfx_exp_decal, [1, 2, 3]); const first = history.capture(); assert.equal(first.active.length, 1);
  const failure = new Error('audio initialization failed'); game.gameSoundManager.activeSoundSourceList = [{ get soundName() { throw failure; } }];
  await assert.rejects(startHostingWorld(controls, transport), error => error === failure); assert.notEqual(factory.create, original); assert.deepEqual(history.capture(), first);
  game.gameSoundManager.activeSoundSourceList = []; const world = await startHostingWorld(controls, transport);
  assert.equal(world.effects, history); assert.equal(game.desktopEffects, history); await world.close();
  assert.equal(history.closed, undefined); assert.equal(game.desktopEffects, undefined); assert.deepEqual(history.capture(), first);
  factory.create(game.globals, api.archetypes.vfx_exp_decal, [4, 5, 6]); assert.equal(calls, 2); assert.equal(history.capture().active.length, 2);
  const secondTransport = new HostSession(); t.after(() => secondTransport.close());
  const second = await startHostingWorld(controls, secondTransport); assert.equal(second.effects, history); await second.close(); assert.equal(history.sequence, 2);
});
test('completed campaign results are retained after native task scoring before coherent admission/save boundaries', async t => {
  const { controls, game, transport } = setup(t), ast = require('./runtime-ast.cjs');
  const runtime = ast.campaignRuntime({}, {}, {}), score = ast.campaignScore({ gameManager: { eventManager: { subscribe() {}, unsubscribe() {} } } });
  score.getHQHealthFactor = () => 1;
  game.getScoreInfo = () => score; controls.campaignMethods = runtime; controls.infoPanels = { starGuiArchetypeMap: ast.assignedObject('starGuiArchetypeMap') };
  const world = await startHostingWorld(controls, transport); t.after(() => world.close());
  game.desktopQuestRewards = {}; game.getActiveGameState = () => ({ name: 'GamestateCampaignScore' });
  game.updateOnlineTasks = () => {
    const definition = runtime.archetypes.campaign_tutorial_01;
    score.onCampaignStarted({ maxResourceBonusList: definition.maxResourceBonusList, maxXpBonus: definition.maxXpBonus, starCriteriaList: definition.starCriteriaList });
    score.onCampaignEnded();
  };
  const captured = world.atBoundary(() => { assert.equal(world.results.latest?.id, 1); return world.results.latest; });
  world.beginTick(); world.endTick(); assert.equal((await captured).campaign, 'campaign_tutorial_01');
  assert.equal(game.desktopCampaignResults, world.results); await world.close(); assert.equal(game.desktopCampaignResults, undefined); assert.equal(world.results.latest, null);
});

test('failed result-recorder initialization restores installed audio hooks and leaves the island outside online mode', async t => {
  const { controls, game, transport } = setup(t), failure = new Error('Score unavailable');
  const play = game.gameSoundManager.playInternal, stop = game.gameSoundManager.stopInternal;
  game.getScoreInfo = () => { throw failure; };
  await assert.rejects(startHostingWorld(controls, transport), error => error === failure);
  assert.equal(game.gameSoundManager.playInternal, play); assert.equal(game.gameSoundManager.stopInternal, stop);
  assert.equal(controls.onlineWorld, undefined); assert.equal(game.desktopCampaignResults, undefined);
});
