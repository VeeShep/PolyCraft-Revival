'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRoomServer } = require('../server/rooms.cjs');
const { RoomSocket } = require('../desktop/room-socket.cjs');
const rules = require('../desktop/room-protocol.js');
const { RoomSession } = require('../desktop/rooms.js');
const runtime = require('../desktop/multiplayer.js').RUNTIME;
const candidate = { candidate: 'candidate:1 1 udp 1234 203.0.113.1 54321 typ srflx', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abc' };
async function service(t, options) {
  const service = createRoomServer(options); service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening'); t.after(() => service.close());
  return { ...service, url: 'ws://127.0.0.1:' + service.server.address().port + '/signaling' };
}
function client(t) {
  const events = [], listeners = new Set(), native = new RoomSocket(event => { events.push(event); for (const fn of listeners) fn(event); });
  t.after(() => native.close());
  const desktop = { room: (operation, options) => Promise.resolve().then(() => native.request(operation, options)), onRoom(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  return { native, events, desktop, listeners };
}
async function until(check) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error('Room check timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
const settings = url => ({ url, room: 'poopedpants123', password: 'giggle shits', runtime });

test('room names normalize, password spaces/case are preserved and insecure remote endpoints are rejected', () => {
  assert.equal(rules.roomName(' PoopedPants123 '), 'poopedpants123'); assert.equal(rules.password('giggle shits'), 'giggle shits'); assert.equal(rules.password('  giggle shits  '), '  giggle shits  ');
  for (const value of ['', 'has spaces', '../rooms']) assert.throws(() => rules.roomName(value));
  for (const value of ['', 'short', ' '.repeat(10)]) assert.throws(() => rules.password(value));
  assert.equal(rules.serverUrl('ws://127.0.0.1:37842/signaling'), 'ws://127.0.0.1:37842/signaling');
  assert.equal(rules.serverUrl('wss://rooms.example/signaling'), 'wss://rooms.example/signaling');
  for (const value of ['ws://rooms.example/signaling', 'wss://user:password@rooms.example', 'wss://rooms.example/?secret=abc', 'http://rooms.example']) assert.throws(() => rules.serverUrl(value));
  for (const value of [{ kind: 'snapshot', data: {} }, { kind: 'candidate', data: { ...candidate, bad: true } }, { kind: 'candidate', data: { ...candidate, sdpMLineIndex: -1 } }]) assert.throws(() => rules.signal(value));
});

test('real local room service authenticates a spaced password, isolates rooms and forwards only approved signaling', async t => {
  const s = await service(t), h = client(t), g = client(t), wrong = client(t), other = client(t);
  const host = await h.native.open({ ...settings(s.url), type: 'create' });
  assert.equal(host.room, 'poopedpants123');
  const stored = s.rooms.get(host.room); assert.equal(stored.password, undefined); assert.equal(stored.hash.length, 32);
  await assert.rejects(wrong.native.open({ ...settings(s.url), password: 'Giggle shits', type: 'join', name: 'Wrong' }), /incorrect/);
  await other.native.open({ ...settings(s.url), room: 'other-room', type: 'create' });
  const guest = await g.native.open({ ...settings(s.url), type: 'join', name: 'Guest' });
  await until(() => h.events.some(event => event.type === 'request'));
  const request = h.events.find(event => event.type === 'request'); assert.equal(request.name, 'Guest');
  await h.native.send({ id: host.id, to: request.id, kind: 'offer', data: 'encoded-offer' });
  await until(() => g.events.some(event => event.type === 'signal'));
  assert.equal(g.events.find(event => event.type === 'signal').data, 'encoded-offer');
  await g.native.send({ id: guest.id, kind: 'answer', data: 'encoded-answer' });
  await g.native.send({ id: guest.id, kind: 'candidate', data: candidate });
  await until(() => h.events.filter(event => event.type === 'signal').length === 2);
  assert.equal(h.events.find(event => event.kind === 'answer').from, request.id);
  assert.equal(other.events.some(event => event.type === 'signal' || event.type === 'request'), false);
  g.native.close(); await until(() => h.events.some(event => event.type === 'left'));
});

test('wrong password, missing/duplicate/full/incompatible rooms and guest messages before approval fail without assigning heroes', async t => {
  const s = await service(t), h = client(t); await h.native.open({ ...settings(s.url), type: 'create' });
  await assert.rejects(client(t).native.open({ ...settings(s.url), type: 'create' }), /unavailable/);
  await assert.rejects(client(t).native.open({ ...settings(s.url), room: 'missing', type: 'join', name: 'Guest' }), /incorrect/);
  await assert.rejects(client(t).native.open({ ...settings(s.url), runtime: 'other-version', type: 'join', name: 'Guest' }), /incompatible/);
  const early = client(t), first = await early.native.open({ ...settings(s.url), type: 'join', name: 'Guest' });
  await early.native.send({ id: first.id, kind: 'answer', data: 'forged-before-approval' });
  await until(() => early.events.some(event => event.type === 'error'));
  assert.equal(h.events.some(event => event.kind === 'answer'), false);
  await until(() => s.rooms.get('poopedpants123').guests.size === 0);
  for (let i = 0; i < 3; i++) await client(t).native.open({ ...settings(s.url), type: 'join', name: 'Guest ' + i });
  await assert.rejects(client(t).native.open({ ...settings(s.url), type: 'join', name: 'Fourth' }), /three guests/);
});

test('room controllers exchange invitation/reply and queued trickle candidates automatically after host hero approval', async t => {
  const s = await service(t), h = client(t), g = client(t), calls = [], peer = 'e0943157-af6c-4dce-9b99-1227db49a04d';
  let hostRoom;
  const hostSession = { changed() {}, notify(message) { this.message = message; }, addGuest(name) { calls.push(['new-hero', name]); return 'saved-guest'; }, transport: { peers: new Map(), async acceptReply(text) { calls.push(['answer', text]); } }, world: { async createPlayerInvitation(id) {
    calls.push(['assigned', id]); const link = { peer, async addCandidate(value) { calls.push(['host-candidate', value]); } }; hostSession.transport.peers.set(peer, link);
    hostRoom.candidate(candidate, link); return { peer, invitation: 'auto-offer' };
  } } };
  const guestSession = { notify(message) { this.message = message; }, async connect(role, options, text) {
    calls.push(['guest-connect', role, text]); options.onCandidate(candidate, { peer }); this.world = { original: {} }; this.connection = { state: 'connected', async addCandidate(value) { calls.push(['guest-candidate', value]); } }; this.outgoing = 'auto-answer';
  } };
  const runtimeFor = desktop => ({ desktop, PolycraftMultiplayer: { RUNTIME: runtime }, polycraft: { runAction: fn => fn() } });
  hostRoom = new RoomSession(hostSession, runtimeFor(h.desktop)); const guestRoom = new RoomSession(guestSession, runtimeFor(g.desktop)); t.after(() => { hostRoom.close(); guestRoom.close(); });
  await hostRoom.open('host', settings(s.url)); await guestRoom.open('guest', { ...settings(s.url), name: 'Vee' });
  await until(() => hostRoom.requests.size === 1); assert.equal(calls.length, 0, 'Password alone must not assign an island hero');
  const request = [...hostRoom.requests.keys()][0]; await hostRoom.approve(request, 'existing-saved-hero');
  await until(() => calls.some(call => call[0] === 'host-candidate') && calls.some(call => call[0] === 'guest-candidate'));
  assert.deepEqual(calls.find(call => call[0] === 'assigned'), ['assigned', 'existing-saved-hero']);
  assert.equal(calls.some(call => call[0] === 'new-hero'), false);
  assert.deepEqual(calls.find(call => call[0] === 'guest-connect'), ['guest-connect', 'guest', 'auto-offer']);
  assert.deepEqual(calls.find(call => call[0] === 'answer'), ['answer', 'auto-answer']);
  assert.equal(guestSession.outgoing, '');
  // Signaling loss must not close an established game connection or call end().
  let ended = false; guestSession.end = () => { ended = true; };
  h.native.close(); await until(() => !guestRoom.connected); assert.equal(ended, false); assert.ok(guestSession.world);
});

test('host decline and room expiration remove membership without persisting room passwords', async t => {
  const s = await service(t, { roomLifetime: 20 }), h = client(t), g = client(t);
  const host = await h.native.open({ ...settings(s.url), type: 'create' });
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(g.native.open({ ...settings(s.url), type: 'join', name: 'Late' }), /expired/);
  h.native.close(); await until(() => !s.rooms.size);
});

test('declining a pending room guest closes only that membership and preserves the useful reason', async t => {
  const s = await service(t), h = client(t), g = client(t);
  const stub = () => ({ notify(message) { this.message = message; }, changed() {} });
  const hs = stub(), gs = stub(), r = desktop => ({ desktop, PolycraftMultiplayer: { RUNTIME: runtime } });
  const host = new RoomSession(hs, r(h.desktop)), guest = new RoomSession(gs, r(g.desktop));
  t.after(() => { host.close(); guest.close(); });
  await host.open('host', settings(s.url)); await guest.open('guest', { ...settings(s.url), name: 'Guest' });
  await until(() => host.requests.size === 1); await host.reject([...host.requests.keys()][0]);
  await until(() => !guest.connected); assert.match(gs.message, /host declined/);
  assert.equal(s.rooms.get('poopedpants123').guests.size, 0); assert.equal(host.connected, true);
});

test('signaling loss closes unfinished attempts but preserves established links and lets the host disconnect them', async () => {
  const closed = [], active = { state: 'connected', close(reason) { closed.push(['active', reason]); } }, pending = { state: 'waiting', close(reason) { closed.push(['pending', reason]); } };
  const session = { notify() {}, changed() {}, transport: { peers: new Map([['active', active], ['pending', pending]]) } };
  const room = new RoomSession(session, { desktop: { onRoom: () => () => {}, room: async () => {} } }); room.role = 'host'; room.connected = true;
  room.requests.set('waiting', { name: 'Waiting' }); room.requests.set('pending', { peer: 'pending', name: 'Connecting' }); room.requests.set('active', { peer: 'active', name: 'Playing' });
  await room.handle({ type: 'closed' }); assert.equal(closed.length, 1); assert.equal(closed[0][0], 'pending'); assert.deepEqual([...room.requests.keys()], ['active']);
  await room.reject('active'); assert.equal(closed[1][0], 'active'); room.close();
});

test('native room sockets reject untrusted public-style TLS certificates before sending the room password', async t => {
  const https = require('node:https');
  const keys = await require('selfsigned').generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, algorithm: 'sha256' });
  const server = https.createServer({ key: keys.private, cert: keys.cert }), sockets = new Set(); let upgrades = 0;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', () => { upgrades++; }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const c = client(t);
  await assert.rejects(c.native.open({ ...settings('wss://127.0.0.1:' + server.address().port + '/signaling'), type: 'create' }), /TLS certificate/);
  assert.equal(upgrades, 0);
});

test('route service fences attempts, ignores stale controls, locks selection and denies guest host controls', async t => {
  const s = await service(t), h = client(t), g = client(t);
  const host = await h.native.open({ ...settings(s.url), type: 'create' }), guest = await g.native.open({ ...settings(s.url), type: 'join', name: 'Guest' });
  await until(() => h.events.some(event => event.type === 'request'));
  const to = h.events.find(event => event.type === 'request').id, first = crypto.randomUUID(), next = crypto.randomUUID();
  const hostRoute = data => h.native.send({ id: host.id, to, kind: 'route', data });
  const guestRoute = data => g.native.send({ id: guest.id, kind: 'route', data });
  await hostRoute({ attempt: first, stage: 'forward', type: 'offer', value: 'native-offer' });
  await hostRoute({ attempt: first, stage: 'forward', type: 'cancel' });
  await hostRoute({ attempt: next, stage: 'stun', type: 'offer', value: 'rtc-offer' });
  await until(() => g.events.filter(event => event.kind === 'route').length === 3);
  await guestRoute({ attempt: first, stage: 'forward', type: 'ack' });
  await guestRoute({ attempt: next, stage: 'stun', type: 'answer', value: 'rtc-answer' });
  await guestRoute({ attempt: next, stage: 'stun', type: 'ready' });
  await until(() => h.events.filter(event => event.kind === 'route').length === 2);
  assert.equal(h.events.some(event => event.data?.attempt === first), false);
  await hostRoute({ attempt: next, stage: 'stun', type: 'commit' });
  await until(() => g.events.some(event => event.data?.type === 'commit'));
  await guestRoute({ attempt: next, stage: 'stun', type: 'ack' });
  await until(() => h.events.some(event => event.data?.type === 'ack'));
  await hostRoute({ attempt: crypto.randomUUID(), stage: 'turn', type: 'offer', value: 'second-selected-link' });
  await until(() => h.events.some(event => event.type === 'error'));
  assert.equal(g.events.some(event => event.data?.value === 'second-selected-link'), false);
  const separate = await service(t), h2 = client(t), g2 = client(t);
  await h2.native.open({ ...settings(separate.url), type: 'create' });
  const guest2 = await g2.native.open({ ...settings(separate.url), type: 'join', name: 'Guest' });
  await g2.native.send({ id: guest2.id, kind: 'route', data: { attempt: crypto.randomUUID(), stage: 'stun', type: 'commit' } });
  await until(() => g2.events.some(event => event.type === 'error'));
  assert.equal(h2.events.some(event => event.kind === 'route'), false);
});
