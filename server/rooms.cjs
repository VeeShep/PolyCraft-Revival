'use strict';
const http = require('node:http');
const { randomBytes, randomUUID, scrypt: derive, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { WebSocketServer } = require('ws');
const protocol = require('../desktop/room-protocol.js');
const scrypt = promisify(derive);
function check(value, message) { if (!value) throw new Error(message); }
function createRoomServer({ maxRooms = 200, maxClients = 1000, roomLifetime = 12 * 3600000, trustProxy = false } = {}) {
  const rooms = new Map(), rates = new Map(); let authenticating = 0;
  const server = http.createServer((request, response) => {
    response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); response.end(request.url === '/health' ? 'PolyCraft room service ready\n' : 'Not found\n');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: protocol.MAX_MESSAGE, perMessageDeflate: false });
  function send(socket, value) {
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > 512 * 1024) { socket.terminate(); return; }
    socket.send(JSON.stringify({ v: protocol.VERSION, ...value }));
  }
  function quota(ip) {
    const now = Date.now(); let rate = rates.get(ip);
    if (!rate || now - rate.at > 60000) { rate = { at: now, count: 0 }; rates.set(ip, rate); }
    return ++rate.count <= 30;
  }
  function endRoom(room) {
    if (rooms.get(room.name) !== room) return;
    rooms.delete(room.name);
    for (const guest of room.guests.values()) { send(guest, { type: 'room-ended' }); guest.close(1000, 'Room ended'); }
    room.host.close(1000, 'Room ended'); room.guests.clear();
  }
  server.on('upgrade', (request, socket, head) => {
    let ip = socket.remoteAddress;
    if (trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) ip = String(request.headers['x-forwarded-for'] || ip).split(',')[0].trim();
    if (request.url !== '/signaling' || wss.clients.size >= maxClients || rates.size >= 4096 && !rates.has(ip) || !quota(ip)) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, ip));
  });
  wss.on('connection', (socket, ip) => {
    let room, role, guestId, signingIn = false, messages = 0, candidates = 0, windowAt = Date.now();
    let alive = true;
    const timer = setTimeout(() => socket.terminate(), 10000); timer.unref();
    socket.on('pong', () => { alive = true; });
    socket.roomPing = () => { if (!alive) { socket.terminate(); return; } alive = false; socket.ping(); };
    socket.on('error', () => {});
    socket.on('message', async (bytes, binary) => {
      try {
        check(!binary, 'Text room messages required.');
        if (Date.now() - windowAt > 1000) { windowAt = Date.now(); messages = 0; }
        check(++messages <= 40, 'Too many room messages.');
        const msg = JSON.parse(bytes.toString());
        check(msg && !Array.isArray(msg) && msg.v === protocol.VERSION, 'Incompatible room protocol.');
        if (!room) {
          check(!signingIn && ['create', 'join'].includes(msg.type) && authenticating < 8 && quota(ip), 'Room authentication unavailable; retry shortly.');
          signingIn = true; authenticating++;
          try {
            const name = protocol.roomName(msg.room), password = protocol.password(msg.password);
            check(typeof msg.runtime === 'string' && msg.runtime.length <= 80, 'Invalid game version.');
            if (msg.type === 'create') {
              check(!rooms.has(name) && rooms.size < maxRooms, 'Room name unavailable. Choose another name.');
              const salt = randomBytes(16), hash = await scrypt(password, salt, 32);
              check(socket.readyState === 1 && !rooms.has(name) && rooms.size < maxRooms, 'Room name unavailable or connection closed.');
              room = { name, salt, hash, runtime: msg.runtime, host: socket, guests: new Map(), expires: Date.now() + roomLifetime };
              role = 'host'; rooms.set(name, room); send(socket, { type: 'created', room: name });
            } else {
              const existing = rooms.get(name), salt = existing?.salt || randomBytes(16), hash = await scrypt(password, salt, 32);
              check(socket.readyState === 1 && existing && rooms.get(name) === existing && existing.expires > Date.now() && timingSafeEqual(hash, existing.hash), 'Room name or password is incorrect, or the room has expired.');
              check(msg.runtime === existing.runtime, 'This room uses an incompatible game version.');
              check(existing.guests.size < 3, 'This room already has three guests or pending joins.');
              check(typeof msg.name === 'string' && msg.name.trim().length > 0 && msg.name.length <= 80, 'Enter a guest name.');
              room = existing; role = 'guest'; guestId = randomUUID(); room.guests.set(guestId, socket);
              send(socket, { type: 'joined', room: name, id: guestId });
              send(room.host, { type: 'request', id: guestId, name: msg.name.trim(), relay: msg.relay === true });
            }
            clearTimeout(timer);
          } finally { authenticating--; signingIn = false; }
        } else {
          check(msg.type === 'signal' && rooms.get(room.name) === room && room.expires > Date.now(), 'Room is no longer available.');
          protocol.signal(msg);
          if (msg.kind === 'route') {
            const guest = role === 'host' ? room.guests.get(msg.to) : socket, r = msg.data;
            check(guest, 'This guest has left.');
            check((role === 'host' ? ['offer', 'candidate', 'commit', 'cancel'] : ['answer', 'candidate', 'ready', 'ack', 'failed']).includes(r.type), 'This player cannot send that route control.');
            if (role === 'host' && r.type === 'offer') {
              if (guest.route?.attempt === r.attempt || guest.route && protocol.STAGES.indexOf(r.stage) <= protocol.STAGES.indexOf(guest.route.stage)) return;
              check(!guest.routeLocked && !guest.offered, 'This guest already has a selected connection.');
              guest.route = { attempt: r.attempt, stage: r.stage }; guest.routeAnswered = false; guest.routeReady = false; guest.routeAck = false; guest.routeCandidates = 0;
            } else if (!guest.route || r.attempt !== guest.route.attempt || r.stage !== guest.route.stage) return;
            if (r.type === 'candidate') check(++guest.routeCandidates <= 256, 'Too many route ICE candidates.');
            if (r.type === 'answer') { check(!guest.routeAnswered, 'Repeated route answer.'); guest.routeAnswered = true; }
            if (r.type === 'ready') guest.routeReady = true;
            if (r.type === 'commit') { check(guest.routeReady && !guest.routeLocked, 'The guest is not ready to commit.'); guest.routeLocked = true; }
            if (r.type === 'ack') { check(guest.routeLocked && !guest.routeAck, 'Unexpected route acknowledgement.'); guest.routeAck = true; }
            if (role === 'host') send(guest, { type: 'signal', kind: 'route', data: r });
            else send(room.host, { type: 'signal', from: guestId, kind: 'route', data: r });
            return;
          }
          if (msg.kind === 'candidate') check(++candidates <= 128, 'Too many ICE candidates.');
          if (role === 'host') {
            const guest = room.guests.get(msg.to); check(guest, 'This guest has left.');
            check(!guest.route || msg.kind === 'reject', 'Use the selected route protocol for this guest.');
            check(msg.kind !== 'answer', 'Hosts cannot send guest replies.');
            if (msg.kind === 'offer') { check(!guest.offered, 'This guest already has an offer.'); guest.offered = true; }
            if (msg.kind === 'candidate') check(guest.offered, 'Send an offer before candidates.');
            send(guest, { type: 'signal', kind: msg.kind, data: msg.data });
            if (msg.kind === 'reject') guest.close(1000, 'Join declined');
          } else {
            check(!socket.route && socket.offered && ['answer', 'candidate'].includes(msg.kind), 'Wait for the host to approve joining.');
            if (msg.kind === 'answer') { check(!socket.answered, 'This guest already replied.'); socket.answered = true; }
            send(room.host, { type: 'signal', from: guestId, kind: msg.kind, data: msg.data });
          }
        }
      } catch (error) { send(socket, { type: 'error', message: error instanceof SyntaxError ? 'Invalid room message.' : error.message }); socket.close(1008, 'Room request rejected'); }
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (!room) return;
      if (role === 'host') endRoom(room);
      else if (room.guests.get(guestId) === socket) { room.guests.delete(guestId); send(room.host, { type: 'left', id: guestId }); }
    });
  });
  const cleanup = setInterval(() => {
    for (const room of rooms.values()) if (room.expires <= Date.now()) endRoom(room);
    for (const [ip, rate] of rates) if (Date.now() - rate.at > 60000) rates.delete(ip);
    for (const client of wss.clients) client.roomPing?.();
  }, 30000); cleanup.unref();
  async function close() {
    clearInterval(cleanup);
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
    rooms.clear(); rates.clear();
  }
  return { server, close, rooms };
}
if (require.main === module) {
  const service = createRoomServer({ trustProxy: process.env.POLYCRAFT_TRUST_PROXY === '1' });
  const port = Number(process.env.PORT || 37842);
  check(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid PORT.');
  service.server.listen(port, '127.0.0.1', () => console.log('PolyCraft room service listening on 127.0.0.1:' + port));
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { service.close().then(() => process.exit(0)); });
}
module.exports = { createRoomServer };
