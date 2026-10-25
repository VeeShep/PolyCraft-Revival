'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const { DirectNetwork } = require('../desktop/direct-network.cjs');
const { DirectHostSession, DirectPeer, invitation } = require('../desktop/direct-transport.js');
let keys;
before(async () => { keys = await require('selfsigned').generate([{ name: 'commonName', value: 'PolyCraft test only' }], { keySize: 2048, algorithm: 'sha256' }); });
async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const result = server.address().port; await new Promise(resolve => server.close(resolve)); return result;
}
function bridge(options = {}) {
  const listeners = new Set(), events = [];
  const native = new DirectNetwork(event => { events.push(event); setImmediate(() => { for (const listener of listeners) listener(event); }); }, { certificates: async () => keys, ...options });
  return { native, events, desktop: { direct: (op, data) => native.request(op, data), onDirect: fn => { listeners.add(fn); return () => listeners.delete(fn); } }, listeners };
}
async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out waiting for direct transport'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('encrypted loopback transfers use shared framing, wait for guest activation, reject authoritative guest edits and clean up', async t => {
  const h = bridge(), g = bridge(), hostMessages = [], guestMessages = [];
  t.after(async () => { await h.native.stop(); await g.native.stop(); });
  const transport = new DirectHostSession({ desktop: h.desktop, pvp: true, onMessage: message => hostMessages.push(message), onState: (id, state) => {
    if (state === 'connected') transport.peers.get(id).send('welcome', { name: 'one' });
  } });
  const endpoint = await transport.listen({ address: '127.0.0.1', port: await freePort(), upnp: false });
  assert.equal(endpoint.mapped, false);
  const offer = await transport.createInvitation(), packet = invitation(offer.invitation);
  assert.equal(packet.pvp, true); assert.equal(packet.fingerprint.length, 64);
  const { connection, reply } = await DirectPeer.join(offer.invitation, { desktop: g.desktop, onMessage: message => guestMessages.push(message) });
  assert.equal(reply, ''); await until(() => h.native.links.get(offer.peer)?.active);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(guestMessages, [], 'Do not lose welcome before GuestWorld installs its handler');
  connection.activate(); await until(() => guestMessages.length === 1);
  assert.deepEqual(guestMessages[0], { kind: 'welcome', payload: { name: 'one' } });
  const payload = { text: 'island 🌲'.repeat(90000) };
  await transport.peers.get(offer.peer).send('snapshot', payload);
  await until(() => guestMessages.length === 2); assert.deepEqual(guestMessages[1].payload, payload);
  await connection.send('action', { type: 'move', x: 1 }); await until(() => hostMessages.length === 1);
  await assert.rejects(connection.send('snapshot', { cheated: true }), /cannot send/);
  assert.deepEqual(await connection.diagnostics(), { path: 'direct TCP/TLS', rttMs: null, bufferedBytes: 0 });
  const hostLink = transport.peers.get(offer.peer);
  assert.equal(hostLink.traffic().sentBytes, connection.traffic().receivedBytes);
  assert.equal(hostLink.traffic().receivedBytes, connection.traffic().sentBytes);
  // An authenticated but malicious guest must still pass the existing game-envelope checks.
  await g.native.send(offer.peer, JSON.stringify({ session: packet.session, peer: packet.peer, sequence: 1, kind: 'snapshot' }));
  await until(() => hostLink.closed && connection.closed);
  assert.equal(hostMessages.length, 1); assert.equal(h.listeners.size, 0); assert.equal(g.listeners.size, 0);
  transport.close(); await transport.stopped; assert.equal(h.native.server, null);
});

test('direct invitations pin the certificate before revealing a token, reject bad secrets and cannot be reused', async t => {
  const h = bridge(), g = bridge(), third = bridge(); t.after(async () => { await h.native.stop(); await g.native.stop(); await third.native.stop(); });
  const endpoint = await h.native.start({ address: '127.0.0.1', port: await freePort(), upnp: false });
  const peer = randomUUID(), reserved = h.native.reserve({ id: peer, expires: Date.now() + 10000 });
  await assert.rejects(g.native.join({ id: peer, ...reserved, fingerprint: '0'.repeat(64) }), /certificate/);
  assert.equal(h.native.links.get(peer).token, reserved.token);
  await assert.rejects(g.native.join({ id: peer, ...reserved, token: '0'.repeat(64) }), /failed/);
  assert.equal(h.native.links.get(peer).token, reserved.token);
  await g.native.join({ id: peer, ...reserved });
  await assert.rejects(third.native.join({ id: peer, ...reserved }), /failed/);
  assert.equal(h.native.links.get(peer).token, null);
  assert.equal(endpoint.port, reserved.port);
});

test('direct input bounds, three-guest limit, cancelled and expired invites and oversized unauthenticated input are enforced', async t => {
  const h = bridge(); t.after(() => h.native.stop());
  for (const options of [{ port: 80, address: '127.0.0.1', upnp: false }, { port: 37841, address: 'http://example.com', upnp: false }, { port: 37841, address: '', upnp: false }]) await assert.rejects(h.native.start(options));
  await assert.rejects(h.native.request('shell', {}), /Invalid/);
  const port = await freePort(); await h.native.start({ address: '127.0.0.1', port, upnp: false });
  const ids = Array.from({ length: 3 }, () => randomUUID());
  for (const id of ids) h.native.reserve({ id, expires: Date.now() + 10000 });
  assert.throws(() => h.native.reserve({ id: randomUUID(), expires: Date.now() + 10000 }), /three guests/);
  h.native.close(ids[0]); assert.equal(h.native.links.has(ids[0]), false);
  const expiring = randomUUID(); h.native.reserve({ id: expiring, expires: Date.now() + 15 }); await until(() => !h.native.links.has(expiring));
  const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false });
  await once(socket, 'secureConnect'); socket.write('x'.repeat(20000)); await once(socket, 'close');
  assert.equal(h.native.links.size, 2);
});

test('UPnP is opt-in, maps only TCP, removes its mapping at stop and fails clearly or falls back to manual settings', async t => {
  let made = 0, destroyed = 0, maps = [];
  const mapperFactory = async () => { made++; return { async map(opts) { maps.push(opts); return true; }, async externalIp() { return '203.0.113.5'; }, async destroy() { destroyed++; } }; };
  const h = bridge({ mapperFactory }); t.after(() => h.native.stop());
  const port = await freePort(); await h.native.start({ address: '127.0.0.1', port, upnp: false }); assert.equal(made, 0); await h.native.stop();
  const result = await h.native.start({ address: '', port, upnp: true }); assert.equal(result.host, '203.0.113.5'); assert.equal(result.mapped, true);
  assert.deepEqual(maps, [{ publicPort: port, privatePort: port, protocol: 'TCP' }]);
  await h.native.stop(); assert.equal(destroyed, 1);
  h.native.mapperFactory = async () => ({ map: async () => false, destroy: async () => { destroyed++; } });
  await assert.rejects(h.native.start({ address: '', port, upnp: true }), /UPnP failed/); assert.equal(h.native.server, null);
  const fallback = await h.native.start({ address: '203.0.113.7', port, upnp: true }); assert.match(fallback.warning, /Forward TCP/); assert.equal(fallback.mapped, false);
});

test('direct invitations reject tampered formats and expiry before opening a socket', async () => {
  const value = { protocol: 1, runtime: require('../desktop/multiplayer.js').RUNTIME, session: randomUUID(), peer: randomUUID(), nonce: randomUUID(), pvp: false, expires: Date.now() + 10000, host: '127.0.0.1', port: 37841, fingerprint: 'a'.repeat(64), token: 'b'.repeat(64) };
  const encode = value => 'polycraft-direct1.' + btoa(JSON.stringify(value));
  assert.deepEqual(invitation(encode(value)), value);
  for (const patch of [{ protocol: 2 }, { runtime: 'other' }, { expires: Date.now() - 1 }, { host: 'https://example.com' }, { token: 'secret' }, { port: 80 }, { extra: 'ignored?' }]) assert.throws(() => invitation(encode({ ...value, ...patch })));
});

test('automatic native preparation opens no mapping without consent, shares opt-in mapping and preserves occupied ports', async t => {
  let mapped = 0, destroyed = 0, available = true;
  const h = bridge({ mapperFactory: async () => ({ checkFree: async () => available, map: async opts => { assert.equal(opts.protocol, 'TCP'); assert.equal(opts.publicPort, opts.privatePort); mapped++; return true; }, externalIp: async () => '203.0.113.5', destroy: async () => { destroyed++; } }) });
  t.after(() => h.native.stop());
  const port = await freePort(); await h.native.start({ address: '', port, upnp: false, prepare: true });
  await assert.rejects(h.native.request('map'), /not enabled/); assert.equal(mapped, 0);
  assert.throws(() => h.native.reserve({ id: randomUUID(), expires: Date.now() + 10000 }), /IPv4/);
  await h.native.stop(); await h.native.start({ address: '', port, upnp: false, prepare: true, allowUpnp: true });
  const [first, second] = await Promise.all([h.native.request('map'), h.native.request('map')]);
  assert.deepEqual(first, second); assert.equal(first.mapped, true); assert.equal(mapped, 1);
  await h.native.stop(); assert.equal(destroyed, 1);
  available = false; await h.native.start({ address: '', port, upnp: false, prepare: true, allowUpnp: true });
  await assert.rejects(h.native.request('map'), /existing mapping/); assert.equal(mapped, 1); assert.equal(destroyed, 2);
});

test('stopping a slow automatic mapping cancels its result and cleans late router success', async t => {
  let release, destroyed = 0;
  const started = new Promise(resolve => { release = resolve; });
  const h = bridge({ mapperFactory: async () => ({ checkFree: async () => true, map: async () => { await started; return true; }, externalIp: async () => '203.0.113.5', destroy: async () => { destroyed++; } }) });
  t.after(() => h.native.stop());
  await h.native.start({ address: '', port: await freePort(), upnp: false, prepare: true, allowUpnp: true });
  const pending = h.native.request('map'), rejected = assert.rejects(pending, /cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  const cleanup = h.native.mapTask; await h.native.stop(); await rejected;
  release(); await assert.rejects(cleanup, /cancelled/);
  assert.equal(destroyed, 1); assert.equal(h.native.endpoint, null); assert.equal(h.native.mapper, null);
});

test('automatic host offers use separate STUN-only peers before TURN, skip failed native setup and keep the forwarded address', async t => {
  const { AutoHostSession } = require('../desktop/auto-transport.js');
  const previous = global.RTCPeerConnection, configs = [];
  global.RTCPeerConnection = class extends EventTarget {
    constructor(config) { super(); configs.push(config); }
    createDataChannel() { const channel = new EventTarget(); channel.readyState = 'connecting'; channel.close = () => {}; return channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    close() {}
  };
  t.after(() => { global.RTCPeerConnection = previous; });
  const h = bridge(), transport = new AutoHostSession({ desktop: h.desktop, iceServers: [{ urls: ['stun:custom:3478'] }, { urls: ['turn:relay:3478'], username: 'u', credential: 'p' }] });
  t.after(async () => { transport.close(); await transport.stopped; });
  await transport.listen({ address: '127.0.0.1', port: await freePort(), upnp: false });
  await assert.rejects(transport.map(), /disabled/);
  const direct = await transport.offer('forward'); assert.equal(invitation(direct.invitation).host, '127.0.0.1'); assert.equal(transport.peers.get(direct.peer).probing, true); transport.peers.get(direct.peer).close();
  const stun = await transport.offer('stun'); assert.equal(transport.peers.get(stun.peer).probing, true); assert.deepEqual(configs[0].iceServers, [{ urls: ['stun:custom:3478'] }]); transport.peers.get(stun.peer).close();
  await transport.offer('turn'); assert.equal(configs[1].iceServers[1].credential, 'p');
  const failed = new AutoHostSession({ desktop: { direct: async () => { throw new Error('port busy'); } }, iceServers: [{ urls: ['stun:custom:3478'] }] });
  await failed.listen({ address: '127.0.0.1', port: 37841, upnp: true }); assert.equal(failed.nativeReady, false);
  const offer = await failed.offer('stun'); assert.equal(failed.peers.has(offer.peer), true); failed.close(); await failed.stopped.catch(() => {});
});

test('real loopback room signaling selects native TLS and delivers game data only after guest attachment', async t => {
  const { AutoHostSession } = require('../desktop/auto-transport.js'), { AutoRoomSession } = require('../desktop/auto-rooms.js');
  const { RoomSocket } = require('../desktop/room-socket.cjs'), { createRoomServer } = require('../server/rooms.cjs');
  const { PlaytestSession } = require('../desktop/session-panel.js');
  const s = createRoomServer(); s.server.listen(0, '127.0.0.1'); await once(s.server, 'listening');
  const h = bridge(), g = bridge(), sockets = [], rooms = [], received = [];
  const desktop = base => {
    const handlers = new Set(), socket = new RoomSocket(event => { for (const fn of handlers) fn(event); }); sockets.push(socket);
    return { ...base, onlineMode: async () => {}, room: async (op, data) => socket.request(op, data), onRoom(fn) { handlers.add(fn); return () => handlers.delete(fn); } };
  };
  const hd = desktop(h.desktop), gd = desktop(g.desktop), order = [];
  const transport = new AutoHostSession({ desktop: hd, iceServers: [], onCandidate: (value, link) => rooms[0].candidate(value, link) });
  t.after(async () => { for (const room of rooms) room.close(); for (const socket of sockets) socket.close(); transport.close(); await transport.stopped; await g.native.stop(); await s.close(); });
  await transport.listen({ address: '127.0.0.1', port: await freePort(), upnp: false });
  const hostSession = { transport, changed() {}, notify(value) { this.message = value; }, world: { async admitConnectedPlayer(id, link) {
    assert.equal(id, 'saved-hero'); assert.deepEqual(order, ['attached']); order.push('admitted'); link.probing = false;
    await link.send('welcome', { playerId: id });
  } } };
  const common = { PolycraftMultiplayer: require('../desktop/multiplayer.js'), PolycraftDirect: require('../desktop/direct-transport.js'), polycraft: { checkpoint: async () => {}, runAction: fn => fn(), controls: { ready: () => true } } };
  const guestRuntime = { ...common, desktop: gd, PolycraftGuestWorld: { GuestWorld: class {
    constructor(_, link) { order.push('attached'); const guard = link.onMessage; link.onMessage = (message, connection) => { guard?.(message, connection); received.push(message); }; }
  } } };
  const guestSession = new PlaytestSession(guestRuntime);
  const host = new AutoRoomSession(hostSession, { ...common, desktop: hd }), guest = new AutoRoomSession(guestSession, guestRuntime); rooms.push(host, guest);
  host.options = guest.options = { iceServers: [] };
  const settings = { url: 'ws://127.0.0.1:' + s.server.address().port + '/signaling', room: 'native-route', password: 'loopback test', name: 'Guest' };
  await host.open('host', settings); await guest.open('guest', settings); await until(() => host.requests.size === 1);
  const entry = [...host.requests.values()][0]; await host.approve(entry.id, 'saved-hero'); await entry.running;
  assert.equal(entry.route.admitted, true, hostSession.message); assert.equal(entry.route.stage, 'forward');
  await until(() => received.length === 1); assert.deepEqual(order, ['attached', 'admitted']); assert.equal(received[0].kind, 'welcome');
  guest.close(); await until(() => entry.signalingEnded); assert.equal(guestSession.connection.closed, false);
  await host.reject(entry.id); await until(() => guestSession.connection.closed);
});
