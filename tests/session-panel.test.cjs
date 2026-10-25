'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PlaytestSession, iceSettings } = require('../desktop/session-panel.js');
const { validateIceServers } = require('../desktop/multiplayer.js');
function fixture() {
  const calls = [], controls = { ready: () => true, manager: () => ({ getActiveGameState: () => ({ name: 'GamestatePlaying' }) }) };
  const registry = { data: { host: 'host', players: [{ id: 'host', name: 'Host' }] }, addPlayer(name) { const record = { id: 'guest-' + this.data.players.length, name }; this.data.players.push(record); return record; }, player(id) { return this.data.players.find(player => player.id === id); } };
  const runtime = { polycraft: { controls, bridge: {} }, desktop: { async onlineMode(value) { calls.push(['online', value]); } },
    PolycraftMultiplayer: { validateIceServers, HostSession: class {
      constructor(options) { this.options = options; this.pvp = options.pvp; this.peers = new Map(); calls.push(['transport', options]); }
      close() { calls.push(['transport-close']); }
      async acceptReply(reply) { calls.push(['reply', reply]); }
    }, PeerLink: { async join(invitation, options) {
      calls.push(['join', invitation, options]);
      const connection = { pvp: false, close() { calls.push(['peer-close']); options.onState('closed', {}); } };
      return { connection, reply: 'guest-reply' };
    } } },
    PolycraftOnlineWorld: { async startHostingWorld(_, transport) {
      calls.push(['host']); const world = { players: { registry }, peerPlayers: new Map(), guestSlots: new Map(),
        async enablePlayers() { calls.push(['enable']); }, async close() { calls.push(['host-close']); },
        async createPlayerInvitation(id) { calls.push(['invite', id]); return { peer: 'peer-' + id, invitation: 'offer-' + id }; } };
      return world;
    } },
    PolycraftGuestWorld: { GuestWorld: class { constructor(_, connection) { this.connection = connection; this.original = { paused: controls.paused }; runtime.lastGuest = this; calls.push(['guest-world']); } close() { if (this.closed) return; this.closed = true; controls.pause?.(this.original.paused); calls.push(['guest-close']); this.connection.close(); } } }
  };
  const session = new PlaytestSession(runtime);
  return { runtime, controls, session, calls, registry };
}
test('connection cancellation creates no transport, world or external-service access', async () => {
  for (const role of ['host', 'guest']) {
    const f = fixture(); assert.equal(await f.session.connect(role, {}, '', false), false); assert.deepEqual(f.calls, []);
  }
});
test('internet settings keep default LAN empty, validate separate STUN/TURN fields and do not accept credentials in URLs', () => {
  assert.deepEqual(iceSettings('', '', '', '', validateIceServers), []);
  const values = iceSettings(' stun:host:3478\n', 'turns:relay:5349?transport=tcp', 'user', 'secret', validateIceServers);
  assert.deepEqual(values, [{ urls: ['stun:host:3478'] }, { urls: ['turns:relay:5349?transport=tcp'], username: 'user', credential: 'secret' }]);
  for (const args of [['turn:a', '', '', ''], ['', 'stun:a', '', ''], ['', 'turn:relay', '', ''], ['stun:user:password@host', '', '', '']]) assert.throws(() => iceSettings(...args, validateIceServers));
});
test('host lifecycle retains selected saved identities, uses host invitation validation and preserves a session after save failure for retry', async () => {
  const f = fixture(); await f.session.connect('host', { pvp: true, iceServers: [] }, '', true);
  assert.equal(f.session.role, 'host'); assert.equal(f.session.transport.pvp, true);
  const id = f.session.addGuest('One'); await f.session.invite(id); assert.equal(f.session.outgoing, 'offer-' + id);
  const second = f.session.addGuest('Two'); await f.session.invite(second);
  f.session.selectGuest(id); assert.equal(f.session.outgoing, 'offer-' + id);
  f.session.transport.options.onState('peer-' + id, 'closed', { reason: 'timed out' }); assert.equal(f.session.outgoing, ''); assert.equal(f.session.offers.has(second), true);
  await f.session.accept('reply'); assert.deepEqual(f.calls.at(-1), ['reply', 'reply']);
  await assert.rejects(f.session.connect('guest', { iceServers: [] }, '', true), /end any current session/);
  const close = f.session.world.close; f.session.world.close = async () => { throw new Error('disk full'); };
  await assert.rejects(f.session.end(), /disk full/); assert.equal(f.session.role, 'host'); assert.equal(f.session.stopping, false);
  f.session.world.close = close; await f.session.end(); assert.equal(f.session.world, null); assert.equal(f.session.outgoing, '');
});
test('failed host initialization closes its world and guest failure restores background behavior without leaving a partial session', async () => {
  const f = fixture(), start = f.runtime.PolycraftOnlineWorld.startHostingWorld;
  f.runtime.PolycraftOnlineWorld.startHostingWorld = async (...args) => { const world = await start(...args); world.enablePlayers = async () => { throw new Error('invalid saved hero'); }; return world; };
  await assert.rejects(f.session.connect('host', { pvp: false, iceServers: [] }, '', true), /invalid saved hero/);
  assert.deepEqual(f.calls.at(-1), ['host-close']); assert.equal(f.session.world, undefined);
  f.runtime.PolycraftMultiplayer.PeerLink.join = async () => { throw new Error('expired invitation'); };
  await assert.rejects(f.session.connect('guest', { iceServers: [] }, 'offer', true), /expired/);
  assert.deepEqual(f.calls.slice(-2), [['online', true], ['online', false]]); assert.equal(f.session.world, undefined);
});
test('guest join supplies local ICE settings, installs the renderer before returning a reply and leaves without saving a solo island', async () => {
  const f = fixture(), servers = [{ urls: ['stun:host:3478'] }];
  await f.session.connect('guest', { iceServers: servers }, 'offer', true);
  assert.equal(f.session.outgoing, 'guest-reply'); assert.equal(f.session.role, 'guest');
  assert.deepEqual(f.calls.map(call => call[0]), ['online', 'join', 'guest-world']);
  assert.deepEqual(f.calls[1][2].iceServers, servers);
  await f.session.end(); assert.equal(f.session.role, null); assert.deepEqual(f.calls.at(-1), ['online', false]);
});
test('menu cannot start a session from an original game menu or an existing externally started session', async () => {
  for (const setup of [f => { f.controls.onlineWorld = {}; }, f => { f.controls.ready = () => false; }, f => { f.controls.manager = () => ({ getActiveGameState: () => ({ name: 'GamestatePaused' }) }); }]) {
    const f = fixture(); setup(f); await assert.rejects(f.session.connect('host', { iceServers: [] }, '', true)); assert.deepEqual(f.calls, []);
  }
});
test('the real panel waits for the development disclaimer, supports cancellation and restores solo input on close', async () => {
  class Element {
    constructor() { this.listeners = new Map(); this.value = ''; this.children = []; this.open = false; }
    addEventListener(name, callback, options) { const entries = this.listeners.get(name) || []; entries.push({ callback, once: options?.once }); this.listeners.set(name, entries); }
    fire(name, event = {}) { const entries = [...(this.listeners.get(name) || [])]; return Promise.all(entries.map(entry => { if (entry.once) this.listeners.set(name, this.listeners.get(name).filter(item => item !== entry)); return entry.callback(event); })); }
    querySelectorAll() { return []; } replaceChildren(...values) { this.children = values; } get options() { return this.children; }
    focus() {} showModal() { this.open = true; } close(value) { this.returnValue = value; this.open = false; return this.fire('close'); }
  }
  const f = fixture(), elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  f.controls.paused = false; f.controls.pause = value => { f.controls.paused = value; };
  f.runtime.polycraft.bridge.state = { cheats: { enabled: false } }; f.runtime.polycraft.runAction = callback => callback();
  const context = { ...f.runtime, document: { getElementById: get, createElement: () => new Element(), querySelector: () => null }, setInterval() {}, navigator: {} };
  vm.runInNewContext(fs.readFileSync('desktop/session-panel.js', 'utf8'), context);
  await get('multiplayer').fire('click'); assert.equal(f.controls.paused, true);
  let attempt = get('host-island').fire('click'); await Promise.resolve();
  assert.equal(get('multiplayer-warning').open, true); assert.deepEqual(f.calls, []);
  await get('multiplayer-warning').close('cancel'); await attempt; assert.deepEqual(f.calls, []);
  attempt = get('host-island').fire('click'); await Promise.resolve(); await get('multiplayer-warning').close('continue'); await attempt;
  assert.equal(f.calls.some(call => call[0] === 'host'), true); assert.equal(get('connection-settings').disabled, true);
  await get('close-multiplayer').fire('click'); assert.equal(f.controls.paused, false);
  await get('end-session').fire('click');
  await get('multiplayer').fire('click'); get('join-invitation').value = 'offer';
  attempt = get('join-island').fire('click'); await Promise.resolve(); await get('multiplayer-warning').close('continue'); await attempt;
  assert.equal(f.runtime.lastGuest.original.paused, false, 'Temporary connection-menu pause must not freeze solo after disconnect');
  assert.equal(get('cheats').hidden, true); assert.equal(get('slots').disabled, true); assert.equal(get('save-now').disabled, true);
  await get('close-multiplayer').fire('click');
  const join = f.calls.find(call => call[0] === 'join'); join[2].onState('closed', { reason: 'host left' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controls.paused, false); assert.equal(get('slots').disabled, false); assert.equal(get('save-now').disabled, false);
  assert.match(get('multiplayer-status').textContent, /host left/);
  await get('multiplayer').fire('click'); get('join-invitation').value = 'another-offer';
  attempt = get('join-island').fire('click'); await Promise.resolve(); await get('multiplayer-warning').close('continue'); await attempt;
  await get('end-session').fire('click');
  assert.equal(f.controls.paused, true, 'Leaving with the dialog open must keep the restored solo game paused');
  await get('close-multiplayer').fire('click'); assert.equal(f.controls.paused, false);

  f.runtime.polycraft.runAction = async () => { throw new Error('Wait for the current save'); };
  await get('multiplayer').fire('click'); assert.equal(get('multiplayer-dialog').open, false); assert.equal(f.controls.paused, false);
});
