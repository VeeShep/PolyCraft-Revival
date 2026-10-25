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
async function fixture(t, { works = 'stun', upnp = false, turn = false, guestTurn = false, forward = true, delayOffer = false } = {}) {
  const service = createRoomServer(); service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const order = [], links = new Map(), sessions = [], hostTransport = { peers: new Map(), watchers: new Map(), forwardEndpoint: { host: forward ? '127.0.0.1' : '' }, nativeOptions: { upnp }, nativeReady: true,
    iceServers: turn ? [{ urls: ['turn:relay'], username: 'u', credential: 'p' }] : [{ urls: ['stun:custom'] }],
    async map() { order.push('map'); this.endpoint = { mapped: true }; },
    async offer(stage, onCreated) {
      order.push(stage); if (delayOffer === true) await new Promise(resolve => setTimeout(resolve, 100));
      const peer = randomUUID(), link = makeLink(peer, 'host'); link.stage = stage;
      this.peers.set(peer, link); links.set(peer, link);
      onCreated?.(link);
      if (delayOffer === 'hang') return new Promise(() => {});
      return { peer, invitation: (['forward', 'upnp'].includes(stage) ? 'polycraft-direct1.' : '') + peer };
    }, async acceptReply() {} };
  function makeLink(peer, role) {
    return { peer, role, probing: true, state: 'waiting', closed: false, async addCandidate() {}, close() {
      if (this.closed) return; this.closed = true; this.state = 'closed'; this.onState?.('closed', {});
      if (role === 'host') { hostTransport.peers.delete(peer); hostTransport.watchers.get(peer)?.('closed', {}); this.guest?.close(); }
    } };
  }
  const Peer = { async join(invitation, options) {
    const peer = invitation.replace('polycraft-direct1.', ''), host = links.get(peer), link = makeLink(peer, 'guest'); host.guest = link; link.onState = options.onState;
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
      world: role === 'host' ? { async admitConnectedPlayer(id, link) { assert.equal(id, 'saved-hero'); assert.equal(link.probing, true); assert.equal(link.guest.attached, true); link.guest.onMessage({ kind: 'welcome' }, link.guest); order.push('admit'); link.probing = false; } } : null,
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
  return { host, guest, entry, order, hostTransport, sessions, service };
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
