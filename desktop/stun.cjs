'use strict';
const dgram = require('node:dgram');
const { randomBytes } = require('node:crypto');
const { crc32 } = require('node:zlib');
const DEFAULT_SERVER = 'stun:stun.l.google.com:19302';
const COOKIE = 0x2112a442;
function check(value, message) { if (!value) throw new Error(message); }
function serverAddress(value = DEFAULT_SERVER) {
  check(typeof value === 'string' && value.length <= 300, 'Choose an IPv4-capable UDP STUN server.');
  const match = /^stun:([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)(?::([0-9]{1,5}))?$/.exec(value);
  check(match && match[1].length <= 253, 'IP discovery needs a stun:hostname:port UDP server; stuns:/TURN and IPv6 literals are not supported here.');
  const port = Number(match[2] || 3478);
  check(port > 0 && port <= 65535, 'Invalid STUN server port.');
  return { host: match[1], port };
}
function bindingRequest(transaction = randomBytes(12)) {
  check(Buffer.isBuffer(transaction) && transaction.length === 12, 'Invalid STUN transaction.');
  const packet = Buffer.alloc(20);
  packet.writeUInt16BE(0x0001, 0); packet.writeUInt32BE(COOKIE, 4); transaction.copy(packet, 8);
  return packet;
}
function responseAddress(packet, transaction) {
  if (packet.length < 20 || packet.length > 2048 || packet.readUInt32BE(4) !== COOKIE || !packet.subarray(8, 20).equals(transaction)) return null;
  check(packet.readUInt16BE(0) === 0x0101, 'The STUN server did not accept address discovery.');
  check(packet.readUInt16BE(2) % 4 === 0 && packet.readUInt16BE(2) + 20 === packet.length, 'Malformed STUN response length.');
  let mapped, xored;
  for (let offset = 20; offset < packet.length;) {
    check(offset + 4 <= packet.length, 'Truncated STUN attribute.');
    const type = packet.readUInt16BE(offset), length = packet.readUInt16BE(offset + 2), value = offset + 4, next = value + Math.ceil(length / 4) * 4;
    check(next <= packet.length, 'Truncated STUN attribute.');
    if (type === 0x8028) {
      check(length === 4 && next === packet.length && packet.readUInt32BE(value) === ((crc32(packet.subarray(0, offset)) ^ 0x5354554e) >>> 0), 'Invalid STUN response fingerprint.');
    } else if (type === 0x0020 || type === 0x0001) {
      check(length >= 4, 'Invalid mapped STUN address.');
      if (packet[value + 1] === 1) {
        check(length === 8, 'Invalid mapped IPv4 address.');
        const mask = type === 0x0020 ? COOKIE : 0;
        const address = (packet.readUInt32BE(value + 4) ^ mask) >>> 0;
        check(address >>> 24 > 0 && address >>> 24 < 224, 'STUN returned an unusable IPv4 address.');
        const text = [24, 16, 8, 0].map(shift => (address >>> shift) & 255).join('.');
        if (type === 0x0020) xored ||= text; else mapped ||= text;
      }
    }
    offset = next;
  }
  check(xored || mapped, 'STUN did not return an IPv4 address. Enter the address manually.');
  // Only the IP is returned: the STUN UDP mapping is not the game's forwarded TCP port.
  return xored || mapped;
}
// shortcut: bounded unauthenticated IPv4/UDP Binding discovery; use WebRTC ICE for other transports.
function discover({ server = DEFAULT_SERVER, signal, timeout = 3000 } = {}) {
  const endpoint = serverAddress(server);
  check(Number.isInteger(timeout) && timeout > 0 && timeout <= 5000, 'Invalid address-discovery deadline.');
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4'), request = bindingRequest(), retries = [];
    let finished = false;
    const finish = (error, address) => {
      if (finished) return; finished = true;
      clearTimeout(deadline); retries.forEach(clearTimeout); signal?.removeEventListener('abort', aborted);
      try { socket.close(); } catch { /* Cancellation can precede binding. */ }
      error ? reject(error) : resolve({ address });
    };
    const aborted = () => finish(new Error('Address discovery cancelled.'));
    const deadline = setTimeout(() => finish(new Error('STUN address discovery timed out. Enter your public IPv4 manually or choose another STUN server.')), timeout);
    socket.on('error', () => finish(new Error('STUN address discovery failed. Check the server/network or enter your public IPv4 manually.')));
    socket.on('message', packet => {
      try { const address = responseAddress(packet, request.subarray(8, 20)); if (address) finish(null, address); }
      catch (error) { finish(error); }
    });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    socket.connect(endpoint.port, endpoint.host, () => {
      const send = () => { if (!finished) socket.send(request, error => { if (error) finish(new Error('Cannot send the STUN request.')); }); };
      if (finished) return;
      send(); for (const delay of [500, 1500]) if (delay < timeout) retries.push(setTimeout(send, delay));
    });
  });
}
module.exports = { DEFAULT_SERVER, serverAddress, bindingRequest, responseAddress, discover };
