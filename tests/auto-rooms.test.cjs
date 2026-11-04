'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { AutoRoomSession } = require('../desktop/auto-rooms.js');
const { stunOnly, hasTurn } = require('../desktop/auto-transport.js');
const { RoomSocket } = require('../desktop/room-socket.cjs');
const { createRoomServer } = require('../server/rooms.cjs');
const rules = require('../desktop/room-protocol.js');
const { RUNTIME } = require('../desktop/multiplayer.js');
const budgets = { forward: 60, upnp: 60, stun: 60, turn: 90, admission: 100, total: 1500 };
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Automatic room check timed out'); await new Promise(resolve => setTimeout(resolve, 3)); }
}
async function fixture(t, { works = 'stun', upnp = false, turn = false, guestTurn = false, forward = true, delayOffer = false, relayService = false, failOffer = false } = {}) {
  const service = createRoomServer({ turn: relayService ? { urls: ['turn:relay.example:3478'], secret: 'test-only-secret-that-is-over-32-bytes', ttl: 60 } : undefined }); service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const iceUsed = [], order = [], links = new Map(), sessions = [], hostTransport = { peers: new Map(), watchers: new Map(), forwardEndpoint: { host: forward ? '127.0.0.1' : '' }, nativeOptions: { upnp }, nativeReady: true,
    iceServers: turn ? [{ urls: ['turn:relay'], username: 'u', credential: 'p' }] : [{ urls: ['stun:custom'] }],
    async map() { order.push('map'); this.endpoint = { mapped: true }; },
    async offer(stage, onCreated, relayServers) {
      iceUsed.push({ role: 'host', stage, servers: relayServers || (stage === 'stun' ? stunOnly(this.iceServers) : this.iceServers) });
      order.push(stage); if (failOffer && stage === 'stun') throw new Error('Offer preparation failed'); if (delayOffer === true) await new Promise(resolve => setTimeout(resolve, 100));
      const peer = randomUUID(), link = makeLink(peer, 'host'); link.stage = stage;
      this.peers.set(peer, link); links.set(peer, link);
      onCreated?.(link);
      if (delayOffer === 'hang') return new Promise(() => {});
      return { peer, invitation: (['forward', 'upnp'].includes(stage) ? 'polycraft-direct1.' : '') + peer };
    }, async acceptReply() {} };
  function makeLink(peer, role) {
    return { peer, role, probing: true, state: 'waiting', closed: false, async addCandidate() {},
      async diagnostics() { return { path: this.testPath || (this.stage === 'turn' ? 'relayed' : 'direct') }; },
      async restartOffer(servers, signal) { assert.equal(this.probing, false); assert.equal(signal.aborted, false); assert.ok(hasTurn(servers)); order.push('renew-offer'); return 'v=0\r\nrenewal-offer'; },
      async restartAnswer(sdp, servers, signal) { assert.equal(sdp, 'v=0\r\nrenewal-offer'); assert.equal(this.probing, false); assert.equal(signal.aborted, false); assert.ok(hasTurn(servers)); order.push('renew-answer'); return 'v=0\r\nrenewal-answer'; },
      async acceptRestartAnswer(sdp) { assert.equal(sdp, 'v=0\r\nrenewal-answer'); order.push('renew-accepted'); },
      async confirmRestart() { order.push('renew-checked-' + role); },
      finishRestart() { order.push('renew-finished-' + role); }, async cancelRestart() { order.push('renew-cancelled-' + role); },
      close() {
      if (this.closed) return; this.closed = true; this.state = 'closed'; this.onState?.('closed', {});
      if (role === 'host') { hostTransport.peers.delete(peer); hostTransport.watchers.get(peer)?.('closed', {}); this.guest?.close(); }
    } };
  }
  const Peer = { async join(invitation, options) {
    const peer = invitation.replace('polycraft-direct1.', ''), host = links.get(peer), link = makeLink(peer, 'guest');
    iceUsed.push({ role: 'guest', stage: host.stage, servers: options.iceServers }); host.guest = link; link.onState = options.onState;
    options.onCreated(link); link.onMessage = options.onMessage;
    if (host.stage === works) setImmediate(() => {
      if (link.closed || host.closed) return;
      host.state = link.state = 'connected'; hostTransport.watchers.get(peer)?.('connected', {}); options.onState('connected', {});
    });
    return { connection: link, reply: invitation.startsWith('polycraft-direct1.') ? '' : 'reply' };
  } };
  function room(role) {
    const handlers = new Set(), native = new RoomSocket(event => { for (const handler of handlers) handler(event); });
    const session = { notify(value) { this.message = value; }, changed() {}, addGuest() { return 'saved-hero'; }, transport: hostTransport,
      world: role === 'host' ? { requestResync(link, value) { assert.equal(link.probing, false); assert.deepEqual(value, { version: 1, tick: 0 }); order.push('renew-resync'); }, async admitConnectedPlayer(id, link) { assert.equal(id, 'saved-hero'); assert.equal(link.probing, true); assert.equal(link.guest.attached, true); link.guest.onMessage({ kind: 'welcome' }, link.guest); order.push('admit'); link.probing = false; } } : null,
      async attachGuest(link) { assert.equal(this.world, null); order.push('attach'); this.world = {}; this.connection = link; link.attached = true; link.probing = false; } };
    const runtime = { desktop: { onRoom(fn) { handlers.add(fn); return () => handlers.delete(fn); }, room: async (op, opts) => native.request(op, opts) },
      PolycraftMultiplayer: { RUNTIME, PeerLink: Peer }, PolycraftDirect: { DirectPeer: Peer }, polycraft: { checkpoint: async () => {}, runAction: fn => fn() } };
    const controller = new AutoRoomSession(session, runtime, budgets); controller.options = { iceServers: role === 'guest' && guestTurn ? [{ urls: ['turn:relay'], username: 'u', credential: 'p' }] : hostTransport.iceServers };
    sessions.push({ native, controller, session }); return controller;
  }
  const host = room('host'), guest = room('guest');
  t.after(async () => { for (const { native, controller } of sessions) { controller.close(); native.close(); } for (const link of [...hostTransport.peers.values()]) link.close(); await service.close(); });
  const settings = { url: 'ws://127.0.0.1:' + service.server.address().port + '/signaling', room: 'poopedpants123', password: 'giggle shits', name: 'Guest' };
  await host.open('host', settings); await guest.open('guest', settings); await until(() => host.requests.size === 1);
  const entry = [...host.requests.values()][0];
  return { host, guest, entry, order, hostTransport, sessions, service, iceUsed };
}
test('route envelopes reject malformed attempts, stages, controls, candidates and extra fields', () => {
  const valid = { attempt: randomUUID(), stage: 'stun', type: 'offer', value: 'offer' };
  assert.equal(rules.signal({ kind: 'route', data: valid }).data, valid);
  for (const data of [{ ...valid, attempt: 'bad' }, { ...valid, stage: 'mqtt' }, { ...valid, extra: true }, { ...valid, type: 'commit' }, { ...valid, type: 'candidate', value: { candidate: 'bad' } }, { ...valid, type: 'ack', value: '' }]) assert.throws(() => rules.signal({ kind: 'route', data }));
  const ice = [{ urls: ['stun:one', 'turn:two', 'stuns:three'], username: 'secret', credential: 'secret' }];
  assert.deepEqual(stunOnly(ice), [{ urls: ['stun:one', 'stuns:three'] }]); assert.equal(hasTurn(ice), true); assert.equal(hasTurn(stunOnly(ice)), false);
});
test('automatic room admission tries forwarding, opt-in UPnP and STUN in order, attaches once and ignores stale controls', async t => {
  const f = await fixture(t, { upnp: true }); await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  assert.deepEqual(f.order, ['forward', 'map', 'upnp', 'stun', 'attach', 'admit']); assert.equal(f.entry.route.admitted, true); assert.equal(f.hostTransport.peers.size, 1);
  await f.host.hostSignal({ from: f.entry.id, data: { attempt: randomUUID(), stage: 'forward', type: 'ack' } });
  assert.equal(f.order.filter(value => value === 'admit').length, 1);
  await f.host.handle({ type: 'left', id: f.entry.id }); assert.equal(f.host.requests.has(f.entry.id), true, 'Signaling loss must retain host disconnect controls for established games');
  assert.equal(f.guest.session.connection.closed, false);
  await f.host.reject(f.entry.id); assert.equal(f.guest.session.connection.closed, true);
});
test('working forwarding skips all later routes and TURN is attempted only after direct failure', async t => {
  const direct = await fixture(t, { works: 'forward', upnp: true, turn: true }); await direct.host.approve(direct.entry.id, 'saved-hero'); await direct.entry.running;
  assert.deepEqual(direct.order, ['forward', 'attach', 'admit']);
  const relay = await fixture(t, { works: 'turn', guestTurn: true, forward: false }); await relay.host.approve(relay.entry.id, 'saved-hero'); await relay.entry.running;
  assert.deepEqual(relay.order, ['stun', 'turn', 'attach', 'admit']); assert.equal(relay.entry.relay, true);
});
test('no relay gives bounded failure without attaching a hero; cancellation closes late-created probes', async t => {
  const f = await fixture(t, { works: 'none', forward: false }); await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  assert.deepEqual(f.order, ['stun']); assert.equal(f.hostTransport.peers.size, 0); assert.equal(f.guest.session.world, null); assert.match(f.host.session.message, /no TURN relay/);
  const hanging = await fixture(t, { works: 'none', forward: false, delayOffer: 'hang' }); await hanging.host.approve(hanging.entry.id, 'saved-hero'); await hanging.entry.running;
  assert.equal(hanging.hostTransport.peers.size, 0, 'Cancel the child even while creating its offer is stalled');
  const cancelled = await fixture(t, { delayOffer: true }); await cancelled.host.approve(cancelled.entry.id, 'saved-hero'); await cancelled.host.reject(cancelled.entry.id); await cancelled.entry.running;
  await new Promise(resolve => setTimeout(resolve, 130)); assert.equal(cancelled.hostTransport.peers.size, 0); assert.equal(cancelled.guest.session.world, null);
});
test('admission failure after commit never switches routes and closes the selected guest', async t => {
  const f = await fixture(t, { works: 'forward', turn: true }); f.host.session.world.admitConnectedPlayer = async () => { throw new Error('save failed'); };
  await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running; await until(() => f.guest.session.connection?.closed);
  assert.deepEqual(f.order, ['forward', 'attach']); assert.equal(f.hostTransport.peers.size, 0); assert.match(f.host.session.message, /save failed/);
});

test('setup history records bounded redacted outcomes, copies defensively and preserves selected-route timings', async t => {
  const f = await fixture(t, { upnp: true }); await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  const report = f.host.diagnostics();
  assert.deepEqual(report.attempts.map(value => value.stage), ['forward', 'mapping', 'upnp', 'stun']);
  assert.deepEqual(report.attempts.map(value => value.outcome), ['timed out', 'ready', 'timed out', 'connected']);
  assert.ok(report.attempts.every(value => Number.isInteger(value.durationMs) && value.durationMs >= 0));
  assert.equal(f.entry.route.link.setup.stage, 'stun'); assert.equal(f.guest.diagnostics().attempts.at(-1).outcome, 'selected');
  assert.equal(JSON.stringify(report).includes('giggle shits'), false); assert.equal(JSON.stringify(report).includes('127.0.0.1'), false);
  report.attempts[0].outcome = 'modified'; assert.equal(f.host.diagnostics().attempts[0].outcome, 'timed out');
  for (let i = 0; i < 70; i++) { const attempt = { stage: 'stun', started: performance.now() }; f.host.record(attempt, 'failed'); f.host.record(attempt, 'duplicate'); }
  assert.equal(f.host.diagnostics().attempts.length, 64); assert.ok(f.host.diagnostics().attempts.every(value => value.outcome === 'failed'));
});

test('configured room service issues distinct temporary credentials only after direct failure and supplies them only to the TURN stage', async t => {
  const f = await fixture(t, { works: 'turn', forward: false, relayService: true });
  await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  assert.deepEqual(f.order, ['stun', 'turn', 'attach', 'admit']);
  for (const role of ['host', 'guest']) {
    assert.equal(hasTurn(f.iceUsed.find(value => value.role === role && value.stage === 'stun').servers), false);
    const servers = f.iceUsed.find(value => value.role === role && value.stage === 'turn').servers;
    assert.equal(hasTurn(servers), true); assert.equal(servers[0].urls[0], 'turn:relay.example:3478');
  }
  const credentials = f.iceUsed.filter(value => value.stage === 'turn').map(value => value.servers[0]);
  assert.notEqual(credentials[0].username, credentials[1].username); assert.notEqual(credentials[0].credential, credentials[1].credential);
  assert.equal(f.entry.relayServers, undefined); assert.equal(f.guest.relayServers, undefined);
  assert.equal(JSON.stringify(f.host.diagnostics()).includes(credentials[0].credential), false);
  const direct = await fixture(t, { works: 'stun', forward: false, relayService: true }); await direct.host.approve(direct.entry.id, 'saved-hero'); await direct.entry.running;
  assert.deepEqual(direct.order, ['stun', 'attach', 'admit']); assert.equal([...direct.service.rooms.values()][0].guests.values().next().value.relayIssued, undefined);
});

test('temporary credential waiting is bounded even if sending stalls and cancellation releases the waiter', async () => {
  const room = Object.create(AutoRoomSession.prototype); room.send = () => new Promise(() => {});
  const expired = { id: randomUUID(), deadline: Date.now() + 20 };
  await assert.rejects(room.requestRelay(expired), /timed out/); assert.equal(expired.relayWait, null);
  const cancelled = { id: randomUUID(), deadline: Date.now() + 1000 }, waiting = room.requestRelay(cancelled);
  cancelled.relayWait.finish(null); assert.equal(await waiting, null); assert.equal(cancelled.relayWait, null);
});

test('failed or stalled direct-offer preparation rejects only that join without requesting credentials or closing its room', async t => {
  for (const options of [{ failOffer: true }, { delayOffer: 'hang' }]) {
    const f = await fixture(t, { ...options, relayService: true, forward: false });
    await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
    assert.deepEqual(f.order, ['stun']); assert.equal(f.host.connected, true); assert.equal(f.service.rooms.size, 1);
    assert.match(f.host.session.message, /setup failed before a relay/); assert.equal(f.guest.session.world, null);
  }
});
function renewalWindow(f) {
  const guest = [...f.service.rooms.values()][0].guests.get(f.entry.id), state = f.host.renewals.states.get(f.entry.id);
  assert.ok(state); clearTimeout(state.timer); guest.lastRelayIssue = Date.now() - 16000;
  guest.relayExpires = state.expires = Date.now() + 30000; return { guest, state };
}
test('automatic service renewal completes both selected generations over a real local room socket without readmitting heroes', async t => {
  const f = await fixture(t, { works: 'turn', relayService: true, forward: false });
  await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  const link = f.entry.route.link, guestLink = f.guest.session.connection, { guest, state } = renewalWindow(f), previous = state.expires;
  await f.host.renewals.start(state);
  await until(() => f.order.includes('renew-finished-guest') && f.order.includes('renew-resync'));
  assert.ok(state.expires > previous); assert.equal(guest.relayExpires, state.expires); assert.equal(guest.renewal, null);
  assert.equal(f.hostTransport.peers.get(link.peer), link); assert.equal(f.guest.session.connection, guestLink);
  assert.equal(link.closed, false); assert.equal(guestLink.closed, false); assert.equal(f.order.filter(value => value === 'admit').length, 1); assert.equal(f.order.filter(value => value === 'attach').length, 1);
  assert.ok(f.order.indexOf('renew-checked-host') < f.order.indexOf('renew-finished-host')); assert.ok(f.order.indexOf('renew-checked-guest') < f.order.indexOf('renew-finished-host'));
});
test('an existing direct ICE path never requests fresh relay credentials', async t => {
  const f = await fixture(t, { works: 'turn', relayService: true, forward: false }); await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  const { guest, state } = renewalWindow(f), issued = guest.lastRelayIssue; f.entry.route.link.testPath = 'direct';
  await f.host.renewals.start(state); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(guest.lastRelayIssue, issued); assert.equal(guest.renewal, undefined); assert.equal(state.tx, undefined); assert.equal(f.order.includes('renew-offer'), false);
});
test('failed renewal preserves live peers and prior expiry, clears both transactions and never exposes native SDP errors', async t => {
  const f = await fixture(t, { works: 'turn', relayService: true, forward: false }); await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  const { guest, state } = renewalWindow(f), expires = guest.relayExpires;
  f.entry.route.link.restartOffer = async () => { throw new Error('private-SDP-and-credential'); };
  await f.host.renewals.start(state); await until(() => state.failures === 1 && !f.guest.renewals.guest && guest.renewal === null);
  assert.equal(guest.relayExpires, expires); assert.equal(state.expires, expires); assert.equal(f.host.connected, true); assert.equal(f.guest.connected, true);
  assert.equal(f.entry.route.link.closed, false); assert.equal(f.guest.session.connection.closed, false); assert.doesNotMatch(f.host.session.message, /private|SDP|credential/);
});
test('room shutdown cancels an in-flight renewal and suppresses a late offer without closing its admitted data channel', async t => {
  const f = await fixture(t, { works: 'turn', relayService: true, forward: false }); await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  const { state } = renewalWindow(f); let release;
  f.entry.route.link.restartOffer = () => new Promise(resolve => { release = () => resolve('v=0\r\nlate-offer'); });
  await f.host.renewals.start(state); await until(() => !!release); const tx = state.tx;
  f.host.close(); release(); await tx.running; assert.equal(tx.controller.signal.aborted, true); assert.equal(f.entry.route.link.closed, false); assert.equal(f.order.includes('renew-accepted'), false);
});
test('native peer closure clears renewal work immediately and suppresses its late offer while signaling remains available', async t => {
  const f = await fixture(t, { works: 'turn', relayService: true, forward: false }); await f.host.approve(f.entry.id, 'saved-hero'); await f.entry.running;
  const { state } = renewalWindow(f); let release;
  f.entry.route.link.restartOffer = () => new Promise(resolve => { release = () => resolve('v=0\r\nlate-offer'); });
  await f.host.renewals.start(state); await until(() => !!release); const tx = state.tx;
  f.entry.route.link.close(); release(); await tx.running;
  assert.equal(f.host.renewals.states.size, 0); assert.equal(f.guest.renewals.guest, null); assert.equal(tx.controller.signal.aborted, true);
  assert.equal(f.host.connected, true); assert.equal(f.guest.connected, true); assert.equal(f.order.includes('renew-accepted'), false);
});
