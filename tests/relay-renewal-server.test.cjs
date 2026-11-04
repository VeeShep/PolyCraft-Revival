'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createRoomServer } = require('../server/rooms.cjs');
const { RoomSocket } = require('../desktop/room-socket.cjs');
const rules = require('../desktop/room-protocol.js');
const runtime = require('../desktop/multiplayer.js').RUNTIME;
async function until(check) {
  const deadline = performance.now() + 3000;
  while (!check()) { if (performance.now() > deadline) throw new Error('Renewal test timed out.'); await new Promise(resolve => setTimeout(resolve, 3)); }
}
async function fixture(t, { stage = 'turn', admitted = true, issued = true, roomLifetime } = {}) {
  const service = createRoomServer({ roomLifetime, turn: { urls: ['turn:relay.example'], secret: 'test-only-secret-that-is-over-32-bytes', ttl: 120 } });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  t.after(() => service.close());
  function client() { const events = [], socket = new RoomSocket(event => events.push(event)); t.after(() => socket.close()); return { socket, events }; }
  const host = client(), guest = client(), settings = { url: 'ws://127.0.0.1:' + service.server.address().port + '/signaling', room: 'renew-test', password: 'test password', runtime };
  host.open = await host.socket.open({ ...settings, type: 'create' }); guest.open = await guest.socket.open({ ...settings, type: 'join', name: 'Guest' });
  await until(() => host.events.some(event => event.type === 'request'));
  const guestId = host.events.find(event => event.type === 'request').id, room = service.rooms.get(settings.room), stored = room.guests.get(guestId);
  const send = (client, kind, data) => client.socket.send({ id: client.open.id, kind, data, ...(client === host ? { to: guestId } : {}) });
  const route = (client, attempt, stage, type) => send(client, 'route', { attempt, stage, type, ...(['offer', 'answer'].includes(type) ? { value: 'opaque-initial-signal' } : {}) });
  if (issued) {
    const attempt = randomUUID(); await route(host, attempt, 'stun', 'offer'); await send(host, 'relay', 'request');
    await until(() => host.events.some(event => event.type === 'relay'));
  }
  const attempt = randomUUID(); await route(host, attempt, stage, 'offer');
  if (admitted) { await route(guest, attempt, stage, 'ready'); await until(() => stored.routeReady); await route(host, attempt, stage, 'commit'); await route(guest, attempt, stage, 'ack'); await until(() => stored.routeAck); }
  else await until(() => stored.route?.attempt === attempt);
  const renew = (client, type, id, value) => send(client, 'renew', { id, type, ...(value === undefined ? {} : { value }) });
  const messages = (client, id, type) => client.events.filter(event => event.kind === 'renew' && event.data.id === id && (!type || event.data.type === type));
  function eligible() { stored.relayExpires = Date.now() + 45000; stored.lastRelayIssue = Date.now() - 16000; }
  return { service, room, host, guest, guestId, stored, renew, messages, eligible };
}

test('renewal protocol requires exact fields, bounded SDP, valid UUIDs and server credentials', () => {
  assert.equal(rules.VERSION, 4);
  const id = randomUUID(), signal = data => rules.signal({ kind: 'renew', data });
  for (const type of ['request', 'ready', 'connected', 'complete']) { signal({ id, type }); assert.throws(() => signal({ id, type, value: null })); }
  for (const type of ['offer', 'answer']) { signal({ id, type, value: 'v=0\r\ntest' }); for (const value of ['', 'not SDP', 'v=0' + 'x'.repeat(128 * 1024)]) assert.throws(() => signal({ id, type, value })); }
  signal({ id, type: 'failed', value: '' }); assert.throws(() => signal({ id, type: 'failed', value: 'x'.repeat(257) }));
  const credentials = { expires: Date.now() + 60000, iceServers: [{ urls: ['turn:relay.example'], username: 'user', credential: 'password' }] };
  signal({ id, type: 'credentials', value: credentials }); assert.throws(() => signal({ id, type: 'credentials', value: { ...credentials, secret: 'forged' } }));
  for (const data of [null, { id: 'bad', type: 'request' }, { id, type: 'candidate' }, { id, type: 'request', extra: true }, { id, type: 'offer' }]) assert.throws(() => signal(data));
});

test('renewal mints separate endpoint credentials, enforces readiness/SDP order and advances expiry only on completion', async t => {
  const f = await fixture(t); f.eligible(); const id = randomUUID(), previous = f.stored.relayExpires;
  await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'credentials').length && f.messages(f.guest, id, 'credentials').length);
  const host = f.messages(f.host, id, 'credentials')[0], guest = f.messages(f.guest, id, 'credentials')[0];
  assert.equal(host.from, f.guestId); assert.equal(guest.from, undefined);
  assert.notEqual(host.data.value.iceServers[0].username, guest.data.value.iceServers[0].username);
  assert.notEqual(host.data.value.iceServers[0].credential, guest.data.value.iceServers[0].credential);
  assert.equal(f.stored.relayExpires, previous);
  await f.renew(f.guest, 'ready', id); await until(() => f.messages(f.host, id, 'ready').length);
  await f.renew(f.host, 'offer', id, 'v=0\r\nhost'); await until(() => f.messages(f.guest, id, 'offer').length);
  await f.renew(f.guest, 'answer', id, 'v=0\r\nguest'); await until(() => f.messages(f.host, id, 'answer').length);
  assert.equal(f.stored.relayExpires, previous);
  await f.renew(f.guest, 'connected', id); await until(() => f.messages(f.host, id, 'connected').length);
  assert.equal(f.stored.relayExpires, previous); await f.renew(f.host, 'complete', id); await until(() => f.messages(f.guest, id, 'complete').length);
  assert.equal(f.stored.renewal, null); assert.equal(f.stored.relayExpires, Math.min(host.data.value.expires, guest.data.value.expires));
  assert.equal(f.service.rooms.size, 1); assert.equal(f.stored.routeAck, true);
});

test('early, frequent, concurrent and quota-limited requests fail without ending the live room', async t => {
  const f = await fixture(t), early = randomUUID(); await f.renew(f.host, 'request', early); await until(() => f.messages(f.host, early, 'failed').length);
  assert.equal(f.stored.renewal, undefined); f.eligible();
  f.stored.lastRelayIssue = Date.now(); const frequent = randomUUID(); await f.renew(f.host, 'request', frequent); await until(() => f.messages(f.host, frequent, 'failed').length);
  f.eligible(); const active = randomUUID(); await f.renew(f.host, 'request', active); await until(() => f.messages(f.host, active, 'credentials').length);
  const conflict = randomUUID(); await f.renew(f.host, 'request', conflict); await until(() => f.messages(f.host, conflict, 'failed').length); assert.equal(f.stored.renewal.id, active);
  await f.renew(f.guest, 'failed', active, ''); await until(() => f.messages(f.host, active, 'failed').length); assert.equal(f.stored.renewal, null);
  // Keep the per-second signaling allowance below 40 while exhausting the shared issuance quota.
  let denied;
  for (let i = 0; i < 31; i++) {
    f.eligible(); const id = randomUUID(); await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id).length);
    if (f.messages(f.host, id, 'failed').length) { denied = id; break; }
    await f.renew(f.guest, 'failed', id, 'retry'); await until(() => f.stored.renewal === null);
  }
  assert.ok(denied); assert.equal(f.service.rooms.size, 1); assert.equal(f.host.socket.socket.readyState, 1); assert.equal(f.guest.socket.socket.readyState, 1);
});

test('failed and timed-out renewals retain old expiry, clean up and allow a later retry', async t => {
  const f = await fixture(t); f.eligible(); const previous = f.stored.relayExpires, first = randomUUID();
  await f.renew(f.host, 'request', first); await until(() => f.messages(f.host, first, 'credentials').length);
  await f.renew(f.host, 'failed', first, 'Restart failed'); await until(() => f.messages(f.guest, first, 'failed').length);
  assert.equal(f.stored.relayExpires, previous); assert.equal(f.stored.renewal, null);
  f.stored.lastRelayIssue -= 16000; const second = randomUUID(); await f.renew(f.host, 'request', second); await until(() => f.messages(f.host, second, 'credentials').length);
  f.stored.renewal.deadline = Date.now() - 1;
  await f.renew(f.guest, 'ready', second); await until(() => f.messages(f.host, second, 'failed').length && f.messages(f.guest, second, 'failed').length);
  assert.equal(f.stored.relayExpires, previous); assert.equal(f.stored.renewal, null); assert.equal(f.service.rooms.size, 1);
});

test('room nearing expiry refuses new credentials without disturbing the live route', async t => {
  const f = await fixture(t); f.eligible(); f.room.expires = Date.now() + 29000; const id = randomUUID();
  await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'failed').length);
  assert.equal(f.stored.renewal, undefined); assert.equal(f.service.rooms.size, 1); assert.equal(f.stored.routeAck, true);
});

test('guests cannot mint and unadmitted, nonservice or direct routes cannot renew', async t => {
  for (const options of [{ guestRequest: true }, { admitted: false }, { issued: false }, { stage: 'forward', issued: false }, { stage: 'upnp', issued: false }, { stage: 'stun', issued: false }]) {
    const f = await fixture(t, options); f.eligible(); const id = randomUUID(), sender = options.guestRequest ? f.guest : f.host;
    await f.renew(sender, 'request', id); await until(() => sender.events.some(event => event.type === 'error'));
    assert.equal(f.messages(f.host, id, 'credentials').length, 0); assert.equal(f.messages(f.guest, id, 'credentials').length, 0);
  }
});

test('old IDs, out-of-order controls and client-supplied credentials are rejected', async t => {
  for (const violation of ['old', 'offer-before-ready', 'complete-before-answer', 'guest-offer', 'credentials', 'malformed']) {
    const f = await fixture(t); f.eligible(); const id = randomUUID(); await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'credentials').length);
    const sender = violation === 'guest-offer' ? f.guest : f.host;
    if (violation === 'malformed') sender.socket.socket.send(JSON.stringify({ v: rules.VERSION, type: 'signal', kind: 'renew', to: f.guestId, data: { id, type: 'ready', value: 'unexpected' } }));
    else if (violation === 'credentials') await f.renew(sender, 'credentials', id, f.messages(f.host, id, 'credentials')[0].data.value);
    else await f.renew(sender, violation === 'old' ? 'failed' : violation === 'complete-before-answer' ? 'complete' : 'offer', violation === 'old' ? randomUUID() : id, violation === 'old' ? 'stale' : violation === 'complete-before-answer' ? undefined : 'v=0\r\ninvalid phase');
    await until(() => sender.events.some(event => event.type === 'error'));
  }
});

test('an idle renewal expires after its scheduled 30-second deadline and member departure cancels it', async t => {
  const f = await fixture(t); f.eligible();
  const originalTimeout = global.setTimeout, callbacks = [];
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 30000) callbacks.push(callback);
    return originalTimeout(callback, delay, ...args);
  });
  const id = randomUUID(), previous = f.stored.relayExpires;
  await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'credentials').length);
  assert.equal(callbacks.length, 1); callbacks[0]();
  await until(() => f.messages(f.host, id, 'failed').length && f.messages(f.guest, id, 'failed').length);
  assert.equal(f.stored.relayExpires, previous); assert.equal(f.stored.renewal, null);
  f.stored.lastRelayIssue -= 16000; const next = randomUUID();
  await f.renew(f.host, 'request', next); await until(() => f.messages(f.host, next, 'credentials').length);
  f.guest.socket.close(); await until(() => f.room.guests.size === 0);
  assert.equal(f.stored.renewal, null); callbacks[1]();
  assert.equal(f.messages(f.host, next, 'failed').length, 0, 'cancelled timer cannot report a stale failure');
});


test('selected ICE-generation confirmation must follow the answer and can be sent only once by the guest', async t => {
  for (const violation of ['early', 'repeated', 'host-connected', 'complete-before-connected']) {
    const f = await fixture(t); f.eligible(); const id = randomUUID();
    await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'credentials').length);
    if (violation !== 'early') {
      await f.renew(f.guest, 'ready', id); await until(() => f.messages(f.host, id, 'ready').length);
      await f.renew(f.host, 'offer', id, 'v=0\r\nhost'); await until(() => f.messages(f.guest, id, 'offer').length);
      await f.renew(f.guest, 'answer', id, 'v=0\r\nguest'); await until(() => f.messages(f.host, id, 'answer').length);
    }
    if (violation === 'repeated') { await f.renew(f.guest, 'connected', id); await until(() => f.messages(f.host, id, 'connected').length); }
    const sender = ['host-connected', 'complete-before-connected'].includes(violation) ? f.host : f.guest;
    await f.renew(sender, violation === 'complete-before-connected' ? 'complete' : 'connected', id);
    await until(() => sender.events.some(event => event.type === 'error'));
  }
});


test('late authorized controls for the last finished renewal preserve the room and a newer transaction', async t => {
  for (const completed of [false, true]) {
    const f = await fixture(t); f.eligible(); const id = randomUUID();
    await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'credentials').length);
    if (completed) {
      await f.renew(f.guest, 'ready', id); await until(() => f.messages(f.host, id, 'ready').length);
      await f.renew(f.host, 'offer', id, 'v=0\r\nhost'); await until(() => f.messages(f.guest, id, 'offer').length);
      await f.renew(f.guest, 'answer', id, 'v=0\r\nguest'); await until(() => f.messages(f.host, id, 'answer').length);
      await f.renew(f.guest, 'connected', id); await until(() => f.messages(f.host, id, 'connected').length);
      await f.renew(f.host, 'complete', id); await until(() => f.messages(f.guest, id, 'complete').length);
    } else { await f.renew(f.guest, 'failed', id, 'Guest cancelled'); await until(() => f.messages(f.host, id, 'failed').length); }
    assert.equal(f.stored.lastRenewalId, id); assert.equal(f.stored.renewal, null);
    const expiry = f.stored.relayExpires;
    for (const [client, type, value] of [[f.host, 'complete'], [f.guest, 'failed', 'Late failure'], [f.guest, 'answer', 'v=0\r\nlate']]) await f.renew(client, type, id, value);
    f.eligible(); await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'failed').length > (completed ? 0 : 1));
    assert.equal(f.stored.renewal, null, 'finished request IDs cannot be reused');
    const next = randomUUID(); await f.renew(f.host, 'request', next); await until(() => f.messages(f.host, next, 'credentials').length);
    for (const [client, type, value] of [[f.host, 'failed', 'Late host timeout'], [f.host, 'complete'], [f.guest, 'ready'], [f.guest, 'answer', 'v=0\r\nlate'], [f.guest, 'connected']]) await f.renew(client, type, id, value);
    // An ordered readiness reply proves all prior controls were processed without cancelling the new transaction.
    await f.renew(f.guest, 'ready', next); await until(() => f.messages(f.host, next, 'ready').length);
    assert.equal(f.stored.renewal.id, next); assert.equal(f.stored.renewal.phase, 'ready');
    assert.equal(f.service.rooms.size, 1); assert.equal(f.host.socket.socket.readyState, 1); assert.equal(f.guest.socket.socket.readyState, 1);
    assert.ok(expiry > Date.now());
  }
});

test('remembered renewal IDs do not excuse forged roles or client credentials', async t => {
  for (const credentials of [false, true]) {
    const f = await fixture(t); f.eligible(); const id = randomUUID();
    await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'credentials').length);
    const value = f.messages(f.host, id, 'credentials')[0].data.value;
    await f.renew(f.host, 'failed', id, 'Cancelled'); await until(() => f.messages(f.guest, id, 'failed').length);
    await f.renew(f.guest, credentials ? 'credentials' : 'complete', id, credentials ? value : undefined);
    await until(() => f.guest.events.some(event => event.type === 'error'));
  }
});


test('host failure cleanup crossing guest departure preserves the host room, but other absent-guest controls reject', async t => {
  const f = await fixture(t); f.eligible(); const id = randomUUID();
  await f.renew(f.host, 'request', id); await until(() => f.messages(f.host, id, 'credentials').length);
  f.guest.socket.close(); await until(() => f.room.guests.size === 0);
  await f.renew(f.host, 'failed', id, 'Guest disconnected');
  // Process a second failed control and a normal join on the same server to fence the asynchronous cleanup.
  await f.renew(f.host, 'failed', randomUUID(), 'Already gone');
  const events = [], newcomer = new RoomSocket(event => events.push(event)); t.after(() => newcomer.close());
  await newcomer.open({ url: 'ws://127.0.0.1:' + f.service.server.address().port + '/signaling', room: 'renew-test', password: 'test password', runtime, type: 'join', name: 'Replacement' });
  await until(() => f.host.events.filter(event => event.type === 'request').length === 2);
  assert.equal(f.service.rooms.size, 1); assert.equal(f.host.socket.socket.readyState, 1); assert.equal(f.stored.renewal, null);
  await f.renew(f.host, 'complete', id); await until(() => f.host.events.some(event => event.type === 'error'));
});
