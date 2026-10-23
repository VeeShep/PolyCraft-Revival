'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROTOCOL, RUNTIME, CHUNK_BYTES, MAX_TRANSFER, MAX_FRAME,
  encodeInvitation, decodeInvitation, validateIceServers, PeerLink, HostSession
} = require('../desktop/multiplayer.js');
const ids = { session: crypto.randomUUID(), peer: crypto.randomUUID(), nonce: crypto.randomUUID() };
function packet(values = {}) {
  return { protocol: PROTOCOL, runtime: RUNTIME, kind: 'offer', ...ids, pvp: false, expires: Date.now() + 60000, description: { type: 'offer', sdp: 'v=0\r\n' }, ...values };
}
class Channel extends EventTarget {
  constructor() {
    super(); this.readyState = 'open'; this.bufferedAmount = 0; this.sent = [];
  }
  send(text) { this.sent.push(text); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
}
class Peer extends EventTarget {
  constructor(config) { super(); this.config = config; this.iceGatheringState = 'complete'; }
  createDataChannel() { return new Channel(); }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription(description) { this.remoteDescription = description; }
  async getStats() { return this.stats || new Map(); }
  close() { this.connectionState = 'closed'; }
}
function mock(t) {
  const previous = global.RTCPeerConnection;
  global.RTCPeerConnection = Peer;
  t.after(() => { global.RTCPeerConnection = previous; });
}
function link(t, role = 'host', options = {}) {
  const connection = new PeerLink({ ...ids, role, pvp: false, expires: Date.now() + 60000, ...options });
  connection.attach(new Channel());
  t.after(() => connection.close());
  return connection;
}
test('invitations round-trip, survive wrapping and reject incompatible, expired, malformed or wrong-kind data', () => {
  const original = packet();
  const encoded = encodeInvitation(original);
  assert.deepEqual(decodeInvitation('  ' + encoded.slice(0, 30) + '\n' + encoded.slice(30), 'offer'), original);
  assert.throws(() => decodeInvitation(encoded, 'answer'), /reply/);
  for (const bad of [packet({ protocol: 99 }), packet({ runtime: 'other' }), packet({ expires: 0 }), packet({ expires: Date.now() + 1e10 }), packet({ pvp: 'true' }), packet({ peer: '../bad' }), packet({ extra: true }), packet({ description: { type: 'answer', sdp: 'v=0' } })]) {
    assert.throws(() => encodeInvitation(bad));
    assert.throws(() => decodeInvitation('polycraft1.' + Buffer.from(JSON.stringify(bad)).toString('base64')));
  }
  for (const bad of [null, 'x'.repeat(128 * 1024 + 1), 'polycraft1.@@@@', 'polycraft1.' + btoa('{')]) assert.throws(() => decodeInvitation(bad));
});
test('LAN is service-free by default, TURN credentials are validated locally and never included in invitations', async t => {
  mock(t);
  assert.deepEqual(validateIceServers(), []);
  const servers = [{ urls: ['stun:lan.example:3478', 'turns:relay.example:5349?transport=tcp'], username: 'player', credential: 'private-password' }];
  const checked = validateIceServers(servers);
  checked[0].urls.push('stun:another.example');
  assert.equal(servers[0].urls.length, 2);
  for (const bad of [[{ urls: 'https://example.com' }], [{ urls: 'turn:relay.example' }], [{ urls: 'stun:bad host' }], [{ urls: 'stun:a', secret: 'extra' }], [{ urls: [] }], [{ urls: 'turn:host', username: 'a', credential: '' }]]) assert.throws(() => validateIceServers(bad));
  const host = new HostSession({ iceServers: servers }); t.after(() => host.close());
  const { peer, invitation } = await host.createInvitation();
  assert.equal(host.peers.get(peer).pc.config.iceServers[0].credential, 'private-password');
  assert.equal(JSON.stringify(decodeInvitation(invitation)).includes('private-password'), false);
});
test('host reserves only three guest slots, fixes PvP for the session and binds replies to the exact invitation', async t => {
  mock(t);
  const host = new HostSession({ pvp: true }); t.after(() => host.close());
  assert.throws(() => { host.pvp = false; }, TypeError);
  const invitations = await Promise.all([host.createInvitation(), host.createInvitation(), host.createInvitation()]);
  await assert.rejects(host.createInvitation(), /four players/);
  const first = invitations[0];
  const guest = await PeerLink.join(first.invitation); t.after(() => guest.connection.close());
  assert.equal(guest.connection.pvp, true);
  assert.throws(() => { guest.connection.pvp = false; }, TypeError);
  const wrong = decodeInvitation(guest.reply); wrong.nonce = crypto.randomUUID();
  await assert.rejects(host.acceptReply(encodeInvitation(wrong)), /different invitation/);
  await host.acceptReply(guest.reply);
  await assert.rejects(host.acceptReply(guest.reply), /no longer waiting/);
  host.peers.get(first.peer).close();
  assert.equal(host.peers.size, 2);
  await host.createInvitation();
  host.close();
  await assert.rejects(host.createInvitation(), /four players/);
  await assert.rejects(host.acceptReply(guest.reply), /ended/);
});
test('large Unicode snapshots are bounded, reassembled once and ordered ahead of subsequent updates', async t => {
  mock(t);
  const received = [];
  const host = link(t);
  const guest = link(t, 'guest', { onMessage: message => received.push(message) });
  const snapshot = { world: '🌴木'.repeat(100000), entities: [{ id: 'hero', health: 100 }] };
  await Promise.all([host.send('snapshot', snapshot), host.send('update', { tick: 2 })]);
  assert.ok(host.channel.sent.length > 40);
  for (const text of host.channel.sent) {
    assert.ok(text.length <= MAX_FRAME);
    guest.receive(text);
  }
  assert.deepEqual(received, [{ kind: 'snapshot', payload: snapshot }, { kind: 'update', payload: { tick: 2 } }]);
  assert.equal(guest.incoming, null);
  assert.equal(guest.receivedSequence, host.sentSequence);
  await assert.rejects(host.send('snapshot', { tooBig: 'x'.repeat(MAX_TRANSFER) }), /32 MB/);
  await assert.rejects(guest.send('snapshot', {}), /cannot send/);
  await assert.rejects(host.send('action', {}), /cannot send/);
});
test('guests can request a full resync without gaining permission to send world state', async t => {
  mock(t);
  const received = [], host = link(t, 'host', { onMessage: message => received.push(message) }), guest = link(t, 'guest');
  const payload = { version: 1, tick: 42 };
  await guest.send('resync', payload);
  for (const frame of guest.channel.sent) host.receive(frame);
  assert.deepEqual(received, [{ kind: 'resync', payload }]);
  await assert.rejects(guest.send('update', { tick: 43 }), /cannot send/);
  await assert.rejects(host.send('resync', payload), /cannot send/);
});
test('malformed, repeated and guest-authoritative frames close only that peer before dispatch', async t => {
  mock(t);
  const host = link(t);
  await host.send('update', { tick: 1 });
  const valid = host.channel.sent[0];
  const frame = JSON.parse(valid);
  const cases = [
    '{', 'x'.repeat(MAX_FRAME + 1), JSON.stringify({ ...frame, peer: crypto.randomUUID() }),
    JSON.stringify({ ...frame, sequence: 2 }), JSON.stringify({ ...frame, bytes: MAX_TRANSFER + 1 }),
    JSON.stringify({ ...frame, index: 1 }), JSON.stringify({ ...frame, data: 'broken' }),
    JSON.stringify({ ...frame, extra: true }),
    JSON.stringify({ ...frame, kind: 'action' })
  ];
  for (const text of cases) {
    const received = [], errors = [];
    const guest = link(t, 'guest', { onMessage: message => received.push(message), onError: error => errors.push(error.message) });
    guest.channel.onmessage({ data: text });
    assert.equal(guest.closed, true);
    assert.equal(guest.incoming, null);
    assert.equal(received.length, 0);
    assert.equal(errors.length, 1);
  }
  const unsafe = '{"constructor":{"prototype":{}}}';
  const unsafeGuest = link(t, 'guest');
  assert.throws(() => unsafeGuest.receive(JSON.stringify({ ...frame, bytes: Buffer.byteLength(unsafe), data: btoa(unsafe) })), /Unsafe key/);
  const guest = link(t, 'guest');
  guest.receive(valid);
  assert.throws(() => guest.receive(valid), /Repeated/);
  const authorityErrors = [];
  const receivingHost = link(t, 'host', { onError: error => authorityErrors.push(error.message) });
  receivingHost.channel.onmessage({ data: valid });
  assert.equal(receivingHost.closed, true);
  assert.match(authorityErrors[0], /guest cannot send authoritative/);
  assert.equal(host.closed, false);
});
test('partial transfers never reach the engine and a close aborts waiting sends without hanging', async t => {
  mock(t);
  const host = link(t), delivered = [];
  const guest = link(t, 'guest', { onMessage: message => delivered.push(message) });
  await host.send('snapshot', { world: 'x'.repeat(CHUNK_BYTES * 2) });
  guest.receive(host.channel.sent[0]);
  assert.equal(guest.incoming.next, 1);
  guest.close();
  assert.equal(guest.incoming, null);
  assert.deepEqual(delivered, []);
  host.channel.bufferedAmount = 300 * 1024;
  const sending = host.send('update', { tick: 1 });
  await new Promise(resolve => setImmediate(resolve));
  host.close();
  await assert.rejects(sending, /closed/);
  assert.equal(host.pendingSends, 0);
});
test('connection path reports relay only for selected relay candidates and otherwise reports unknown honestly', async t => {
  mock(t);
  const host = link(t);
  assert.equal(await host.connectionPath(), 'unknown');
  host.pc.stats = new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { candidateType: 'host' }], ['remote', { candidateType: 'srflx' }]
  ]);
  assert.equal(await host.connectionPath(), 'direct');
  host.pc.stats.get('remote').candidateType = 'relay';
  assert.equal(await host.connectionPath(), 'relayed');
});

test('cancelling an invitation during its asynchronous creation does not resurrect the peer', async t => {
  mock(t);
  const host = new HostSession(); t.after(() => host.close());
  const creating = host.createInvitation();
  const connection = [...host.peers.values()][0];
  connection.close();
  await assert.rejects(creating, /cancelled/);
  assert.equal(connection.state, 'closed');
  assert.equal(host.peers.size, 0);
  assert.equal(connection.expiryTimer, undefined);
});
