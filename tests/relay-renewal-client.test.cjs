'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { RelayRenewals } = require('../desktop/relay-renewal.js');
function fixture(t, diagnostics = async () => ({ path: 'relayed' })) {
  const sent = [], notices = [], link = { peer: crypto.randomUUID(), state: 'connected', closed: false, diagnostics, async cancelRestart() { this.cancelled = (this.cancelled || 0) + 1; } };
  const entry = { id: crypto.randomUUID(), route: { stage: 'turn', admitted: true, link } };
  const room = { role: 'host', relayService: true, connected: true, options: { iceServers: [] }, requests: new Map([[entry.id, entry]]), session: { transport: { peers: new Map([[link.peer, link]]) }, notify: value => notices.push(value) }, async send(kind, data, to) { sent.push({ kind, data, to }); } };
  const renewals = new RelayRenewals(room); renewals.watch(entry, Date.now() + 60000); t.after(() => renewals.close());
  return { room, renewals, entry, link, sent, notices, state: renewals.states.get(entry.id) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('scheduled renewal has one bounded transaction, times out without closing gameplay and stops after bounded retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const f = fixture(t); t.mock.timers.tick(30000); await flush();
  assert.equal(f.sent[0].data.type, 'request'); const first = f.state.tx;
  await f.renewals.start(f.state); assert.equal(f.state.tx, first); assert.equal(f.sent.length, 1);
  for (let failure = 1; failure <= 3; failure++) {
    t.mock.timers.tick(20000); await flush(); assert.equal(f.link.closed, false); assert.equal(f.state.failures, failure);
    if (failure < 3) { t.mock.timers.tick(15000); await flush(); }
  }
  assert.equal(f.renewals.states.size, 0); t.mock.timers.tick(1000000); await flush();
  assert.equal(f.sent.filter(row => row.data.type === 'request').length, 3); assert.ok(f.notices.every(value => !/username|credential=|sdp=/i.test(value)));
});
test('unobservable or stalled route statistics never mint credentials and are cancellable within a bounded probe', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, () => new Promise(() => {})); clearTimeout(f.state.timer);
  const pending = f.renewals.start(f.state); await flush(); t.mock.timers.tick(2000); await pending;
  assert.equal(f.sent.length, 0); assert.equal(f.state.failures, 1); assert.equal(f.state.probing, false);
  const checking = f.renewals.start(f.state); await flush(); f.renewals.close(); await checking;
  assert.equal(f.sent.length, 0); assert.equal(f.renewals.states.size, 0); assert.equal(f.link.closed, false);
});
test('removing or replacing a watch during statistics collection cannot start an obsolete renewal', async t => {
  let resolve; const f = fixture(t, () => new Promise(done => { resolve = done; })); clearTimeout(f.state.timer);
  const pending = f.renewals.start(f.state); await flush();
  f.renewals.watch(f.entry, Date.now() + 120000); resolve({ path: 'relayed' }); await pending;
  assert.equal(f.sent.length, 0); assert.notEqual(f.renewals.states.get(f.entry.id), f.state); assert.equal(f.link.closed, false);
});
test('replacing the admitted link before an async native operation cannot negotiate or send for the old peer', async t => {
  const f = fixture(t); clearTimeout(f.state.timer); await f.renewals.start(f.state); const tx = f.state.tx; let calls = 0;
  f.link.restartOffer = async () => { calls++; return 'v=0\r\nobsolete'; };
  const event = data => ({ kind: 'renew', from: f.entry.id, data: { id: tx.id, ...data } });
  f.renewals.handle(event({ type: 'credentials', value: { expires: Date.now() + 60000, iceServers: [{ urls: ['turn:relay.example'], username: 'private', credential: 'private' }] } }));
  f.renewals.handle(event({ type: 'ready' })); f.room.session.transport.peers.set(f.link.peer, { ...f.link });
  await tx.running; assert.equal(calls, 0); assert.equal(f.renewals.states.size, 0); assert.equal(tx.controller.signal.aborted, true);
  assert.equal(f.sent.filter(row => row.data.type !== 'request').length, 0);
});
