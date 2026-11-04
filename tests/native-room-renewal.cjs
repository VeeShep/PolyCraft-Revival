'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { createRoomServer } = require('../server/rooms.cjs');
const { RoomSocket } = require('../desktop/room-socket.cjs');

async function nativeRoomRenewal(page, { port, secret }) {
  const service = createRoomServer({ turn: { urls: [`turn:127.0.0.1:${port}?transport=udp`], secret, ttl: 120 } });
  const clients = new Map(), deliveries = new Set();
  let deliveryFailed = false;
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  try {
    for (const file of ['direct-transport.js', 'auto-transport.js', 'room-protocol.js', 'rooms.js', 'relay-renewal.js', 'auto-rooms.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../desktop', file) });
    }
    await page.evaluate(() => { window.networkRoomListeners = new Map(); });
    await page.exposeFunction('networkRoomRequest', (client, operation, options) => {
      if (!clients.has(client)) clients.set(client, new RoomSocket(event => {
        const pending = page.evaluate(({ client, event }) => {
          for (const listener of window.networkRoomListeners.get(client) || []) listener(event);
        }, { client, event }).catch(() => { deliveryFailed = true; }).finally(() => deliveries.delete(pending));
        deliveries.add(pending);
      }));
      return clients.get(client).request(operation, options);
    });
    await page.exposeFunction('networkRenewalWindow', (name, ids) => {
      const room = service.rooms.get(name); assert.ok(room);
      for (const id of ids) {
        const guest = room.guests.get(id); assert.ok(guest?.routeAck && guest.relayIssued);
        // Exercise the normal renewal protocol now, without claiming a real two-minute expiry test.
        guest.relayExpires = Date.now() + 30000; guest.lastRelayIssue = Date.now() - 16000;
      }
    });
    await page.exposeFunction('networkVerifyRenewal', (name, values) => {
      const room = service.rooms.get(name); assert.ok(room);
      for (const value of values) {
        const guest = room.guests.get(value.id);
        assert.equal(guest?.relayExpires, value.expires); assert.equal(guest?.renewal, null); assert.equal(guest?.routeAck, true);
      }
    });
    for (const count of [2, 4]) {
      console.log(`Checking ${count} participants through real room signaling, native ICE and coturn renewal.`);
      const report = await page.evaluate(async ({ count, url }) => {
        let stage = 'opening room';
        const controllers = [], guests = [], hostMessages = [], errors = [];
        const check = (value, message) => { if (!value) { stage = message; throw new Error(message); } };
        const wait = async condition => {
          const deadline = performance.now() + 25000;
          while (!condition()) { check(performance.now() < deadline, 'Room-network condition timed out.'); await new Promise(resolve => setTimeout(resolve, 20)); }
        };
        const forceRelay = link => link.pc.setConfiguration({ ...link.pc.getConfiguration(), iceTransportPolicy: 'relay' });
        const runtime = client => ({
          desktop: {
            onRoom(listener) { const listeners = window.networkRoomListeners.get(client) || new Set(); listeners.add(listener); window.networkRoomListeners.set(client, listeners); return () => listeners.delete(listener); },
            room: (operation, options) => window.networkRoomRequest(client, operation, options),
            direct: async operation => { check(operation === 'stop', 'Network-only test must not access native listeners or routers.'); }
          },
          polycraft: { checkpoint: async () => {}, runAction: operation => Promise.resolve().then(operation) },
          PolycraftDirect,
          PolycraftMultiplayer: { ...PolycraftMultiplayer, PeerLink: { join: (invitation, options) => PolycraftMultiplayer.PeerLink.join(invitation, { ...options, onCreated: link => { forceRelay(link); options.onCreated?.(link); } }) } }
        });
        const budgets = { forward: 500, upnp: 500, stun: 1000, turn: 12000, admission: 8000, total: 24000 };
        let host, admissions = 0, resyncs = 0;
        const hostRuntime = runtime(`${count}-host`);
        const transport = new PolycraftAutoTransport.AutoHostSession({ desktop: hostRuntime.desktop, iceServers: [], onCandidate: (candidate, link) => host.candidate(candidate, link), onMessage: (message, link) => hostMessages.push({ peer: link.peer, message }), onError: peer => { if (transport.peers.get(peer)?.probing === false) errors.push('host transport'); } });
        const offer = transport.offer.bind(transport);
        transport.offer = (stage, created, servers) => offer(stage, link => { forceRelay(link); created?.(link); }, servers);
        const hostSession = { transport, changed() {}, notify() {}, world: {
          async admitConnectedPlayer(hero, link) { admissions++; link.probing = false; link.testHero = hero; },
          requestResync(link) { resyncs++; link.send('snapshot', { tick: 3 }).catch(() => errors.push('resync transfer')); }
        } };
        host = new PolycraftAutoRooms.AutoRoomSession(hostSession, hostRuntime, budgets); host.options = { iceServers: [] }; controllers.push(host);
        const settings = { url, room: `native-renewal-${count}`, password: 'disposable network-only password', name: 'Guest' };
        async function pair(link) {
          const stats = await link.pc.getStats(), transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId);
          const selected = transport && stats.get(transport.selectedCandidatePairId);
          return selected && { local: stats.get(selected.localCandidateId), remote: stats.get(selected.remoteCandidateId) };
        }
        try {
          await host.open('host', settings);
          for (let index = 1; index < count; index++) {
            stage = `joining guest ${index}`;
            const messages = [], session = { changed() {}, notify() {}, async attachGuest(link) { this.connection = link; this.world = {}; link.probing = false; link.onMessage = message => messages.push(message); } };
            const controller = new PolycraftAutoRooms.AutoRoomSession(session, runtime(`${count}-${index}`), budgets); controller.options = { iceServers: [] }; controllers.push(controller);
            await controller.open('guest', settings);
            await wait(() => [...host.requests.values()].some(entry => !entry.route));
            const entry = [...host.requests.values()].find(entry => !entry.route);
            await host.approve(entry.id, `saved-hero-${index}`); await entry.running;
            check(entry.route?.admitted && entry.route.stage === 'turn' && controller.guestAttempt?.selected, 'Room did not admit the native relay route.');
            const local = entry.route.link, remote = session.connection;
            check((await local.diagnostics()).path === 'relayed' && (await remote.diagnostics()).path === 'relayed', 'Room route did not use coturn.');
            guests.push({ entry, controller, local, remote, messages });
          }
          await window.networkRenewalWindow(settings.room, guests.map(guest => guest.entry.id));
          for (const guest of guests) {
            stage = `renewing ${guest.local.testHero}`;
            const { local, remote, entry, controller, messages } = guest;
            const original = [local.pc, remote.pc, local.channel, remote.channel], before = await Promise.all([pair(local), pair(remote)]);
            const state = host.renewals.states.get(entry.id); check(state, 'Admitted relay route was not watched.'); clearTimeout(state.timer); state.expires = Date.now() + 30000;
            const priorExpiry = state.expires;
            await local.send('update', { tick: 1 }); await remote.send('action', { id: 1 });
            await wait(() => messages.length === 1 && hostMessages.filter(row => row.peer === local.peer).length === 1);
            await host.renewals.start(state);
            await wait(() => state.expires > priorExpiry && !state.tx && !controller.renewals.guest);
            clearTimeout(state.timer);
            const after = await Promise.all([pair(local), pair(remote)]);
            for (let index = 0; index < 2; index++) {
              check(after[index].local.port !== before[index].local.port, 'A room peer retained its old relay allocation.');
              check(after[index].local.usernameFragment !== before[index].local.usernameFragment && after[index].remote.usernameFragment !== before[index].remote.usernameFragment, 'A room peer retained its old ICE generation.');
            }
            check(local.pc === original[0] && remote.pc === original[1] && local.channel === original[2] && remote.channel === original[3], 'Room renewal replaced the admitted channel.');
            await local.send('update', { tick: 4 }); await remote.send('action', { id: 2 });
            await wait(() => messages.length === 3 && hostMessages.filter(row => row.peer === local.peer).length === 2);
            check(messages.map(row => row.payload.tick).join(',') === '1,3,4', 'Room renewal lost or duplicated host messages.');
            check(hostMessages.filter(row => row.peer === local.peer).map(row => row.message.payload.id).join(',') === '1,2', 'Room renewal lost or duplicated guest actions.');
            check(local.sentSequence === 3 && local.receivedSequence === 2 && remote.sentSequence === 2 && remote.receivedSequence === 3, 'Room renewal reset framing counters.');
            check(local.testHero === entry.heroId, 'Room renewal changed hero ownership.');
          }
          check(admissions === count - 1 && resyncs === count - 1 && errors.length === 0, 'Room renewal repeated admission/resync or encountered a transport failure.');
          await window.networkVerifyRenewal(settings.room, guests.map(guest => ({ id: guest.entry.id, expires: host.renewals.states.get(guest.entry.id).expires })));
          return { participants: count, renewedGuests: guests.length, admissions, resyncs, sameChannels: true, freshAllocations: true, expiryCommitted: true };
        } catch { return { failure: stage, participants: count }; }
        finally { for (const controller of controllers) controller.close(); transport.close(); for (const guest of guests) guest.remote.close(); }
      }, { count, url: `ws://127.0.0.1:${service.server.address().port}/signaling` });
      console.log(JSON.stringify(report)); assert.equal(report.failure, undefined); assert.equal(deliveryFailed, false);
      for (const socket of clients.values()) socket.close();
      await Promise.all([...deliveries]);
    }
  } finally { for (const socket of clients.values()) socket.close(); await service.close(); await Promise.all([...deliveries]); }
}
module.exports = { nativeRoomRenewal };
