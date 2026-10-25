'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const dgram = require('node:dgram');
const { randomBytes } = require('node:crypto');
const { DEFAULT_SERVER, serverAddress, bindingRequest, responseAddress, discover } = require('../desktop/stun.cjs');
const { DirectNetwork } = require('../desktop/direct-network.cjs');
function response(request, { xored = true, address = '203.0.113.9', port = 45678 } = {}) {
  const reply = Buffer.alloc(32); reply.writeUInt16BE(0x0101, 0); reply.writeUInt16BE(12, 2); request.copy(reply, 4, 4, 20);
  reply.writeUInt16BE(xored ? 0x0020 : 0x0001, 20); reply.writeUInt16BE(8, 22); reply[25] = 1;
  reply.writeUInt16BE(port ^ (xored ? 0x2112 : 0), 26);
  const bytes = Buffer.from(address.split('.').map(Number)), cookie = request.subarray(4, 8);
  for (let i = 0; i < 4; i++) reply[28 + i] = bytes[i] ^ (xored ? cookie[i] : 0);
  return reply;
}
async function responder(t, handler) {
  const socket = dgram.createSocket('udp4'); socket.on('message', (request, remote) => handler(socket, request, remote)); socket.bind(0, '127.0.0.1'); await once(socket, 'listening'); t.after(() => socket.close());
  return 'stun:127.0.0.1:' + socket.address().port;
}
test('native discovery defaults to Google and accepts only bounded UDP IPv4-capable STUN endpoints', () => {
  assert.equal(DEFAULT_SERVER, 'stun:stun.l.google.com:19302'); assert.deepEqual(serverAddress(), { host: 'stun.l.google.com', port: 19302 });
  assert.deepEqual(serverAddress('stun:example.com'), { host: 'example.com', port: 3478 });
  for (const value of ['stuns:example.com:5349', 'turn:example.com:3478', 'stun:user@host:3478', 'stun:host:0', 'stun:host:65536', 'stun:[::1]:3478', 'stun:host/anything', 'stun:host?transport=tcp']) assert.throws(() => serverAddress(value));
  const first = bindingRequest(), second = bindingRequest(); assert.equal(first.length, 20); assert.equal(first.readUInt16BE(0), 1); assert.equal(first.readUInt32BE(4), 0x2112a442); assert.notDeepEqual(first.subarray(8), second.subarray(8));
});
test('RFC 5769 IPv4 vector independently checks XOR address and CRC fingerprint; mapped UDP ports are never returned', () => {
  // RFC 5769 section 2.2 test bytes, https://www.rfc-editor.org/rfc/rfc5769#section-2.2
  const packet = Buffer.from('0101003c2112a442b7e7a701bc34d686fa87dfae8022000b7465737420766563746f7220002000080001a147e112a643000800142b91f599fd9e90c38c7489f92af9ba53f06be7d780280004c07d4c96', 'hex');
  const transaction = packet.subarray(8, 20);
  assert.equal(responseAddress(packet, transaction), '192.0.2.1');
  const corrupt = Buffer.from(packet); corrupt[corrupt.length - 1] ^= 1; assert.throws(() => responseAddress(corrupt, transaction), /fingerprint/);
  assert.equal(responseAddress(packet, randomBytes(12)), null);
});
test('parser supports legacy mapped IPv4 and rejects truncated, bad-length, failed and non-IPv4 replies', () => {
  const request = bindingRequest(), tid = request.subarray(8, 20), reply = response(request, { xored: false });
  assert.equal(responseAddress(reply, tid), '203.0.113.9');
  assert.equal(responseAddress(reply.subarray(0, 10), tid), null);
  for (const change of [buffer => buffer.writeUInt16BE(8, 2), buffer => buffer.writeUInt16BE(0x0111, 0), buffer => buffer.writeUInt16BE(500, 22), buffer => { buffer[25] = 2; }]) {
    const damaged = Buffer.from(reply); change(damaged); assert.throws(() => responseAddress(damaged, tid));
  }
});
test('real local UDP discovery correlates transactions, accepts only its chosen endpoint and returns an IP without a UDP port', async t => {
  let requests = 0;
  const spoof = dgram.createSocket('udp4'); spoof.bind(0, '127.0.0.1'); await once(spoof, 'listening'); t.after(() => spoof.close());
  const server = await responder(t, (socket, request, remote) => {
    requests++;
    spoof.send(response(request, { address: '198.51.100.42' }), remote.port, remote.address);
    const stale = response(bindingRequest()); socket.send(stale, remote.port, remote.address);
    setTimeout(() => socket.send(response(request), remote.port, remote.address), 10);
  });
  assert.deepEqual(await discover({ server }), { address: '203.0.113.9' }); assert.equal(requests, 1);
});
test('timeout and abort are bounded, stop cancels discovery, and overlapping native discoveries are refused', async t => {
  let count = 0;
  const server = await responder(t, () => count++);
  await assert.rejects(discover({ server, timeout: 600 }), /timed out/); assert.equal(count, 2, 'One bounded retransmission after packet loss');
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(discover({ server, signal: aborted.signal }), /cancelled/);
  const native = new DirectNetwork(() => {}), pending = native.request('discover', { server });
  await assert.rejects(native.request('discover', { server }), /already running/);
  await native.stop(); await assert.rejects(pending, /cancelled/); assert.equal(native.discovery, null);
  assert.equal(native.server, null, 'Discovery must not open a game listener or router mapping');
});
