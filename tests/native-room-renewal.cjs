'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { createRoomServer } = require('../server/rooms.cjs');
const { RoomSocket } = require('../desktop/room-socket.cjs');

function retiredTurnObserver() {
  let pending = '';
  const users = new Map();
  return {
    write(chunk) {
      const lines = (pending + chunk).split('\n'); pending = lines.pop().slice(-8192);
      for (const line of lines) {
        const user = line.match(/user <(\d+:[a-f0-9-]{36})>/)?.[1], session = line.match(/session (\d+)(?::|\))/)?.[1];
        if (!user || !session) continue;
        const state = users.get(user) || { allocated: false, active: new Set(), closed: false }; users.set(user, state);
        if (line.includes('incoming packet ALLOCATE processed, success')) { state.allocated = true; state.active.add(session); }
        if (line.includes('closed (2nd stage)')) { state.closed = true; state.active.delete(session); }
      }
    },
    has: user => { const state = users.get(user); return !!state?.allocated && state.closed && state.active.size === 0; }
  };
}
async function nativeRoomRenewal(page, { port, secret, retired }) {
  const service = createRoomServer({ turn: { urls: [`turn:127.0.0.1:${port}?transport=udp`], secret, ttl: 60 } });
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
    await page.exposeFunction('networkRetiredAllocations', users => ({ expected: users.length, observed: users.filter(user => retired.has(user)).length }));
    await page.exposeFunction('networkVerifyRenewal', (name, values) => {
      const room = service.rooms.get(name); assert.ok(room);
      for (const value of values) {
        const guest = room.guests.get(value.id);
        assert.equal(guest?.relayExpires, value.expires); assert.equal(guest?.renewal, null); assert.equal(guest?.routeAck, true);
      }
    });
    for (const count of [2, 4]) {
      console.log(`Checking ${count} participants through real room signaling and repeated automatic renewal beyond initial credential expiry.`);
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
          async admitConnectedPlayer(hero, link) { admissions++; link.probing = false; link.testHero = hero; link.testTick = 0; link.testRenewals = 0; },
          requestResync(link) { resyncs++; link.testRenewals++; link.send('snapshot', { tick: ++link.testTick }).catch(() => errors.push('resync transfer')); }
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
          for (const guest of guests) {
            const { local, remote, entry } = guest;
            guest.original = [local.pc, remote.pc, local.channel, remote.channel]; guest.before = await Promise.all([pair(local), pair(remote)]);
            guest.state = host.renewals.states.get(entry.id); check(guest.state, 'Admitted relay route was not watched.');
            guest.expires = guest.state.expires; guest.renewals = 0; guest.probes = 0;
            guest.initialUsers = [local, remote].flatMap(link => link.pc.getConfiguration().iceServers.map(server => server.username));
          }
          const initialUsers = guests.flatMap(guest => guest.initialUsers);
          check(initialUsers.length === 2 * (count - 1) && initialUsers.every(user => /^\d+:[a-f0-9-]{36}$/.test(user)), 'Initial relay credentials were not observable.');
          const initialExpiry = Math.max(...initialUsers.map(user => Number(user.split(':')[0]) * 1000));
          const until = initialExpiry + 35000, deadline = until + 15000, started = performance.now();
          let nextProbe = 0;
          do {
            check(Date.now() < deadline && errors.length === 0, 'Automatic renewal endurance failed or timed out.');
            for (const guest of guests) {
              const { local, remote, entry, controller, state } = guest;
              stage = `observing automatic renewal for ${local.testHero}`;
              check(!local.closed && !remote.closed && host.renewals.states.get(entry.id) === state, 'A scheduled relay watch or connection ended.');
              check(state.failures === 0, 'Scheduled relay renewal failed.');
              if (state.expires > guest.expires && !state.tx && !controller.renewals.guest) {
                const after = await Promise.all([pair(local), pair(remote)]);
                for (let index = 0; index < 2; index++) {
                  check(after[index].local.port !== guest.before[index].local.port, 'A room peer retained its old relay allocation.');
                  check(after[index].local.usernameFragment !== guest.before[index].local.usernameFragment && after[index].remote.usernameFragment !== guest.before[index].remote.usernameFragment, 'A room peer retained its old ICE generation.');
                }
                guest.before = after; guest.expires = state.expires; guest.renewals++;
                await window.networkVerifyRenewal(settings.room, [{ id: entry.id, expires: state.expires }]);
              }
              check(local.pc === guest.original[0] && remote.pc === guest.original[1] && local.channel === guest.original[2] && remote.channel === guest.original[3], 'Room renewal replaced the admitted channel.');
              check(local.testHero === entry.heroId, 'Room renewal changed hero ownership.');
              if (performance.now() >= nextProbe && !state.tx && !controller.renewals.guest) {
                await local.send('update', { tick: ++local.testTick }); await remote.send('action', { id: ++guest.probes });
              }
            }
            if (performance.now() >= nextProbe) nextProbe = performance.now() + 1000;
            await new Promise(resolve => setTimeout(resolve, 100));
          } while (Date.now() < until || guests.some(guest => guest.renewals < 3 || guest.state.tx || guest.controller.renewals.guest));
          for (const guest of guests) {
            const { local, remote, messages } = guest;
            check(guest.renewals >= 3 && local.testRenewals === guest.renewals, 'Automatic renewal did not complete successive cycles exactly once.');
            await local.send('update', { tick: ++local.testTick }); await remote.send('action', { id: ++guest.probes });
            await wait(() => messages.length === local.testTick && hostMessages.filter(row => row.peer === local.peer).length === guest.probes);
            check(messages.every((row, index) => row.payload.tick === index + 1), 'Room renewal lost or duplicated host messages.');
            check(hostMessages.filter(row => row.peer === local.peer).every((row, index) => row.message.payload.id === index + 1), 'Room renewal lost or duplicated guest actions.');
            check(local.sentSequence === local.testTick && local.receivedSequence === guest.probes && remote.sentSequence === guest.probes && remote.receivedSequence === local.testTick, 'Room renewal reset framing counters.');
          }
          const retirement = await window.networkRetiredAllocations(initialUsers);
          check(retirement.observed === retirement.expected, `Initial TURN allocations were not retired (${retirement.observed}/${retirement.expected}).`);
          check(admissions === count - 1 && resyncs === guests.reduce((total, guest) => total + guest.renewals, 0) && errors.length === 0, 'Room renewal repeated admission/resync or encountered a transport failure.');
          await window.networkVerifyRenewal(settings.room, guests.map(guest => ({ id: guest.entry.id, expires: host.renewals.states.get(guest.entry.id).expires })));
          return { participants: count, renewalsPerGuest: guests.map(guest => guest.renewals), admissions, resyncs, sameChannels: true, freshAllocations: true, expiryCommitted: true, initialCredentialsExpired: Date.now() > initialExpiry, retiredInitialAllocations: retirement.observed, durationMs: Math.round(performance.now() - started) };
        } catch { return { failure: stage, participants: count }; }
        finally { for (const controller of controllers) controller.close(); transport.close(); for (const guest of guests) guest.remote.close(); }
      }, { count, url: `ws://127.0.0.1:${service.server.address().port}/signaling` });
      console.log(JSON.stringify(report)); assert.equal(report.failure, undefined); assert.equal(deliveryFailed, false);
      for (const socket of clients.values()) socket.close();
      await Promise.all([...deliveries]);
    }
  } finally { for (const socket of clients.values()) socket.close(); await service.close(); await Promise.all([...deliveries]); }
}
module.exports = { nativeRoomRenewal, retiredTurnObserver };
