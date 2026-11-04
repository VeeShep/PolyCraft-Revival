'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { PeerLink } = require('../desktop/multiplayer.js');
const certificate = byte => Array(32).fill(byte).join(':');
const sdp = (byte, generation) => `v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:0\r\na=sctp-port:5000\r\na=fingerprint:sha-256 ${certificate(byte)}\r\na=ice-ufrag:peer${generation}\r\na=ice-pwd:secretPasswordNumber000${generation}\r\n`;
const servers = [{ urls: ['turn:relay.example'], username: 'future:user', credential: 'private' }];
class NativePeer extends EventTarget {
  constructor(config) { super(); this.config = config; this.signalingState = 'stable'; this.iceGatheringState = 'complete'; this.connectionState = 'connected'; this.iceConnectionState = 'connected'; }
  getConfiguration() { return this.config; }
  setConfiguration(config) { this.config = config; }
  async createOffer(options) { assert.equal(options.iceRestart, true); return { type: 'offer', sdp: sdp('AA', 2) }; }
  async createAnswer() { return { type: 'answer', sdp: sdp('BB', 2) }; }
  async setLocalDescription(value) {
    if (value.type === 'rollback') { this.localDescription = this.oldLocal; this.signalingState = 'stable'; return; }
    this.oldLocal = this.localDescription; this.localDescription = value; this.signalingState = value.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(value) {
    if (value.type === 'rollback') { this.remoteDescription = this.oldRemote; this.signalingState = 'stable'; return; }
    this.oldRemote = this.remoteDescription; this.remoteDescription = value; this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async getStats() { return new Map([['transport', { type: 'transport', selectedCandidatePairId: 'pair' }], ['pair', { state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' }], ['local', { usernameFragment: this.localDescription.sdp.match(/a=ice-ufrag:(\w+)/)[1] }], ['remote', { usernameFragment: this.remoteDescription.sdp.match(/a=ice-ufrag:(\w+)/)[1] }]]); }
  close() { this.connectionState = 'closed'; }
}
function fixture(t, role = 'host') {
  const previous = global.RTCPeerConnection; global.RTCPeerConnection = NativePeer;
  const candidateEvents = [], states = [], link = new PeerLink({ role, session: crypto.randomUUID(), peer: crypto.randomUUID(), nonce: crypto.randomUUID(), pvp: false, expires: Date.now() + 60000, trickle: true, onCandidate: value => candidateEvents.push(value), onState: value => states.push(value) });
  global.RTCPeerConnection = previous; t.after(() => link.close());
  const channel = { readyState: 'open', bufferedAmount: 0, sent: [], send(value) { this.sent.push(value); }, close() { this.readyState = 'closed'; } };
  link.channel = channel; link.state = 'connected';
  link.pc.localDescription = { type: role === 'host' ? 'offer' : 'answer', sdp: sdp(role === 'host' ? 'AA' : 'BB', 1) };
  link.pc.remoteDescription = { type: role === 'host' ? 'answer' : 'offer', sdp: sdp(role === 'host' ? 'BB' : 'AA', 1) };
  return { link, channel, states, candidateEvents };
}
test('ICE renewal replaces credentials on the same authenticated data transport without resetting frames or emitting join states', async t => {
  const host = fixture(t), guest = fixture(t, 'guest');
  await host.link.send('snapshot', { tick: 1 });
  const signal = new AbortController(), offer = await host.link.restartOffer(servers, signal.signal);
  host.link.pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate:renewal' }) } }); assert.deepEqual(host.candidateEvents, []);
  const answer = await guest.link.restartAnswer(offer, servers, signal.signal); await host.link.acceptRestartAnswer(answer);
  await host.link.confirmRestart(); await guest.link.confirmRestart();
  host.link.finishRestart(); guest.link.finishRestart(); await host.link.send('snapshot', { tick: 2 });
  assert.equal(host.link.channel, host.channel); assert.equal(host.link.sentTransfer, 2); assert.equal(host.link.sentSequence, 2);
  assert.equal(host.link.pc.config.iceServers[0].credential, 'private'); assert.equal(host.link.iceRenewal, null); assert.equal(guest.link.iceRenewal, null);
  assert.deepEqual(host.states, []); assert.deepEqual(guest.states, []); assert.equal(host.link.state, 'connected');
});
test('renewal rejects certificate/media/mid/port changes, unchanged ICE credentials, wrong role and concurrent restart', async t => {
  for (const changed of [sdp('CC', 2), sdp('AA', 2).replace('m=application', 'm=video'), sdp('AA', 2).replace('a=mid:0', 'a=mid:1'), sdp('AA', 2).replace('5000', '5001'), sdp('AA', 1), 'v=0\r\n', 'v=0' + 'x'.repeat(128 * 1024)]) {
    const guest = fixture(t, 'guest'); await assert.rejects(guest.link.restartAnswer(changed, servers), /ICE|transport|peer/); assert.equal(guest.link.pc.signalingState, 'stable');
  }
  const host = fixture(t); await assert.rejects(host.link.restartAnswer(sdp('AA', 2), servers), /Only guests/);
  await host.link.restartOffer(servers); await assert.rejects(host.link.restartOffer(servers), /not ready/);
  await assert.rejects(host.link.acceptRestartAnswer(sdp('CC', 2)), /authenticated peer/); await host.link.cancelRestart();
  assert.equal(host.link.pc.signalingState, 'stable'); assert.equal(host.link.closed, false);
});
test('cancelling an outstanding native offer prevents late description writes and cleans up without closing the channel', async t => {
  const { link } = fixture(t), controller = new AbortController(), original = link.pc.getConfiguration();
  let release; link.pc.createOffer = () => new Promise(resolve => { release = () => resolve({ type: 'offer', sdp: sdp('AA', 2) }); });
  const pending = link.restartOffer(servers, controller.signal); controller.abort(); await link.cancelRestart();
  await assert.rejects(link.restartOffer(servers), /not ready/); release(); await assert.rejects(pending, /cancelled/);
  assert.equal(link.pc.localDescription.sdp, sdp('AA', 1)); assert.deepEqual(link.pc.getConfiguration(), original); assert.equal(link.iceRenewal, null); assert.equal(link.closed, false);
});
test('renewal gathering times out or cancels without changing the admitted state, and close releases pending listeners', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { link, states } = fixture(t); link.pc.iceGatheringState = 'gathering';
  const pending = link.restartOffer(servers); await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(8000);
  await assert.rejects(pending, /timed out/); assert.equal(link.iceRenewal, null); assert.equal(link.closed, false); assert.deepEqual(states, []);
  const closing = link.restartOffer(servers); await new Promise(resolve => setImmediate(resolve)); link.close(); await assert.rejects(closing, /cancelled/); assert.equal(link.iceRenewal, null);
});
test('an old or unobservable selected ICE generation cannot complete renewal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { link } = fixture(t); await link.restartOffer(servers); await link.acceptRestartAnswer(sdp('BB', 2));
  link.pc.getStats = async () => new Map([['transport', { type: 'transport', selectedCandidatePairId: 'old' }], ['old', { state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' }], ['local', { usernameFragment: 'peer1' }], ['remote', { usernameFragment: 'peer1' }]]);
  const checking = link.confirmRestart(); await new Promise(resolve => setImmediate(resolve)); assert.throws(() => link.finishRestart(), /pending/);
  t.mock.timers.tick(8000); await assert.rejects(checking, /generation did not connect/); await link.cancelRestart(); assert.equal(link.closed, false);
});
