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
