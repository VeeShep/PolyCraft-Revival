'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { once } = require('node:events');
const net = require('node:net');
const { createRoomServer } = require('../server/rooms.cjs');

(async () => {
  assert.ok(process.argv.slice(2).every(value => value === '--four-players'), 'Only --four-players is supported.');
  const count = process.argv.includes('--four-players') ? 4 : 2;
  const roles = count === 2 ? ['host', 'guest'] : ['host', 'guest-one', 'guest-two', 'guest-three'];
  const turn = JSON.parse(process.env.POLYCRAFT_TEST_TURN_RENEWAL || 'null');
  assert.ok(turn && /^turn:127\.0\.0\.1:\d+\?transport=udp$/.test(turn.urls) && typeof turn.secret === 'string' && turn.secret.length >= 32, 'Use the owned loopback auth-secret TURN fixture.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-room-game-renewal-'));
  const service = createRoomServer({ turn: { urls: [turn.urls], secret: turn.secret, ttl: 60 } });
  const applications = [], pages = [], errors = [], requests = [], guests = [];
  const settings = { room: 'temporary-game-renewal', password: 'temporary room renewal password', name: 'Renewal guest' };
  let directPort;
  async function focus(index) {
    await applications[index].evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); const window = BrowserWindow.getAllWindows()[0]; window.moveTop(); window.focus(); });
    await pages[index].bringToFront(); await pages[index].locator('#turbulenz_game_engine_canvas').focus();
    await pages[index].waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && (!window.polycraft.controls.guestWorld || window.polycraft.controls.guestWorld.movement.available()));
  }
  try {
    service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
    settings.url = 'ws://127.0.0.1:' + service.server.address().port + '/signaling';
    const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); directPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    for (const role of roles) {
      const app = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: path.join(directory, role) }, timeout: 90000 });
      applications.push(app); const page = await app.firstWindow(); pages.push(page);
      await app.evaluate(({ BrowserWindow }, role) => { const window = BrowserWindow.getAllWindows()[0]; if (!window.isVisible()) throw new Error('Temporary game must be visible.'); window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary ' + role + ' — live room relay renewal'); }, role);
      page.on('pageerror', error => errors.push(role + ': ' + error.message)); page.on('request', request => requests.push(request.url()));
      await page.locator('#new-name').fill('Temporary renewal ' + role);
      await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#new-game button').click({ noWaitAfter: true })]);
      await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
      await focus(pages.length - 1); const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox();
      const play = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
      await canvas.focus(); await page.mouse.move(bounds.x + play[0], bounds.y + play[1]);
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
      await page.mouse.click(bounds.x + play[0], bounds.y + play[1], { delay: 100 });
      await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
      await page.evaluate(async () => {
        const game = window.polycraft.controls.manager(); game.runScripts = false; game.setScriptLocked(false); game.activeGameState.setPlayState('PlayStateNormal'); await window.polycraft.checkpoint();
        const PeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends PeerConnection { constructor(configuration) { super({ ...configuration, iceTransportPolicy: 'relay' }); } };
        window.renewalSession = new window.PolycraftSessionPanel.PlaytestSession(window);
        window.renewalRoom = new window.PolycraftAutoRooms.AutoRoomSession(window.renewalSession, window, { forward: 500, upnp: 500, stun: 1000, turn: 12000, admission: 8000, total: 24000 });
        window.renewalSession.room = window.renewalRoom; window.renewalRoom.options = { iceServers: [] };
      });
      console.log('Visible renewal game ready:', role);
    }
    const host = pages[0];
    const ids = await host.evaluate(async ({ settings, directPort, count }) => {
      const session = window.renewalSession, room = window.renewalRoom;
      await session.connect('host', { iceServers: [], autoNative: { address: '127.0.0.1', port: directPort, upnp: false }, trickle: true, onCandidate: (value, link) => room.candidate(value, link) }, '', true);
      // Stage unavailable native forwarding; relay-only ICE makes the STUN stage fail naturally.
      session.transport.forwardEndpoint = null;
      await room.open('host', settings); return Array.from({ length: count - 1 }, (_, index) => session.addGuest('Renewal guest ' + (index + 1)));
    }, { settings, directPort, count });
    for (let index = 1; index < count; index++) {
      const page = pages[index], hero = ids[index - 1], name = 'Renewal guest ' + index, saves = path.join(directory, roles[index], 'saves');
      const file = path.join(saves, fs.readdirSync(saves).find(name => name.endsWith('.json'))), bytes = fs.readFileSync(file), state = await page.evaluate(() => JSON.stringify(window.polycraft.bridge.state));
      await page.evaluate(settings => window.renewalRoom.open('guest', settings), { ...settings, name });
      await host.waitForFunction(name => [...window.renewalRoom.requests.values()].some(entry => entry.name === name), name);
      await host.evaluate(async ({ name, hero }) => { const room = window.renewalRoom, entry = [...room.requests.values()].find(entry => entry.name === name); await room.approve(entry.id, hero); await entry.running; if (!entry.route?.admitted || entry.route.stage !== 'turn') throw new Error('Expected admitted real TURN game route.'); }, { name, hero });
      await page.waitForFunction(() => !!window.polycraft.controls.guestWorld?.scene.snapshot);
      const staged = await host.evaluate(({ hero, index }) => window.renewalSession.world.atBoundary(() => {
        const world = window.renewalSession.world, actor = world.players.active.get(hero).hero, before = Array.from(actor.getv3Location());
        actor.getEC('ECLocomotion').clearDestination(); actor.teleport(world.game.placeOnGround([-125 + 4 * (index - 1), 0, -85], 0.5));
        const locomotion = actor.getEC('ECLocomotion');
        return { before, location: Array.from(actor.getv3Location()), locomotionActive: locomotion.active, mobile: locomotion.mobile, normalSpeed: locomotion.archetype.normalSpeed, fixed: actor.getEC('ECPhysicsSphere').isFixed() };
      }), { hero, index });
      console.log('Staged native movement location:', index, JSON.stringify(staged));
      guests.push({ page, index, hero, file, bytes, state, renewals: 0 });
    }
    async function moveGuest({ page: guest, index, hero }) {
      await focus(index); const location = await host.evaluate(hero => Array.from(window.renewalSession.world.players.active.get(hero).hero.getv3Location()), hero);
      let moved = false;
      for (const key of ['w', 'd', 's', 'a']) {
        await guest.keyboard.down(key); await guest.waitForTimeout(500);
        const input = await host.evaluate(hero => { const world = window.renewalSession.world, actor = world.players.active.get(hero).hero, input = world.guestSlots.get(hero).input; return { position: Array.from(actor.getv3Location()), sequence: input.sequence, move: input.move, moving: input.moving, scriptLocked: world.game.isScriptLocked(), health: actor.getEC('ECHealth').getHealth() }; }, hero);
        const local = await guest.evaluate(() => { const world = window.polycraft.controls.guestWorld; return { keys: [...world.movement.keys], available: world.movement.available(), sequence: world.movement.sequence, resyncing: world.resyncing }; });
        await guest.keyboard.up(key); console.log('Native renewal movement probe:', JSON.stringify({ guest: index, key, input, local }));
        moved = Math.hypot(input.position[0] - location[0], input.position[2] - location[2]) > 0.2;
        if (moved) break;
      }
      assert.ok(moved, 'Native keyboard movement must reach the host.');
      await guest.waitForFunction(({ hero, location }) => { const world = window.polycraft.controls.guestWorld, record = world.scene.entities.get(world.identity.entity)?.record; return world.identity.playerId === hero && record && Math.hypot(record.location[0] - location[0], record.location[2] - location[2]) > 0.2; }, { hero, location });
      assert.equal(await host.evaluate(() => window.renewalSession.world.players.active.size), count);
    }
    for (const guest of guests) await moveGuest(guest);
    console.log('Native movement baselines pass before renewal:', guests.length);
    async function sample(page, hostSide, first, hero) {
      return page.evaluate(async ({ hostSide, first, hero }) => {
        const session = window.renewalSession, room = window.renewalRoom, entry = hostSide && [...room.requests.values()].find(entry => entry.heroId === hero), link = hostSide ? entry.route.link : session.connection;
        const stats = await link.pc.getStats(), transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId), pair = transport && stats.get(transport.selectedCandidatePairId), local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
        window.renewalOriginals ||= new Map();
        if (first) window.renewalOriginals.set(link.peer, { pc: link.pc, channel: link.channel });
        const original = window.renewalOriginals.get(link.peer);
        const state = hostSide && room.renewals.states.get(entry.id);
        return { requestId: hostSide ? entry.id : undefined, path: (await link.diagnostics()).path, same: link.pc === original.pc && link.channel === original.channel, closed: link.closed, port: local?.port, localGeneration: local?.usernameFragment, remoteGeneration: remote?.usernameFragment, expires: hostSide ? state.expires : undefined, failures: state?.failures || 0, pending: hostSide ? !!state.tx : !!room.renewals.guest, sequence: link.sentSequence, tick: hostSide ? session.world.game.gameClock.getFrameIndex() : session.world.scene.tick, users: first ? link.pc.getConfiguration().iceServers.map(server => server.username) : undefined };
      }, { hostSide, first, hero });
    }
    for (const guest of guests) guest.before = [await sample(host, true, true, guest.hero), await sample(guest.page, false, true, guest.hero)];
    const users = guests.flatMap(guest => guest.before.flatMap(row => row.users));
    assert.equal(users.length, 2 * guests.length); assert.ok(users.every(user => /^\d+:[a-f0-9-]{36}$/.test(user)));
    const initialExpiry = Math.max(...users.map(user => Number(user.split(':')[0]) * 1000));
    assert.ok(Number.isFinite(initialExpiry)); const deadline = Date.now() + 150000;
    while (guests.some(guest => guest.renewals < 3) || Date.now() <= initialExpiry + 1000) {
      assert.ok(Date.now() < deadline, 'Three automatic full-game renewals per guest must finish within the test deadline.');
      for (const guest of guests) {
        const before = guest.before, current = [await sample(host, true, false, guest.hero), await sample(guest.page, false, false, guest.hero)];
        for (const row of current) { assert.equal(row.same, true); assert.equal(row.closed, false); assert.equal(row.failures, 0); }
        if (current[0].expires > before[0].expires && !current.some(row => row.pending)) {
          console.log('Renewal framing before input:', guest.index, { before: before.map(row => row.sequence), current: current.map(row => row.sequence) });
          for (let index = 0; index < 2; index++) { assert.equal(current[index].path, 'relayed'); assert.ok(Number.isInteger(current[index].port)); assert.equal(typeof current[index].localGeneration, 'string'); assert.equal(typeof current[index].remoteGeneration, 'string'); assert.notEqual(current[index].port, before[index].port); assert.notEqual(current[index].localGeneration, before[index].localGeneration); assert.notEqual(current[index].remoteGeneration, before[index].remoteGeneration); assert.ok(current[index].sequence >= before[index].sequence); assert.ok(current[index].tick > before[index].tick); }
          const room = service.rooms.get(settings.room), entry = room.guests.get(current[0].requestId); assert.equal(entry.relayExpires, current[0].expires); assert.equal(entry.renewal, null); assert.equal(entry.routeAck, true);
          await moveGuest(guest);
          const after = [await sample(host, true, false, guest.hero), await sample(guest.page, false, false, guest.hero)];
          for (let index = 0; index < 2; index++) { assert.equal(after[index].same, true); assert.equal(after[index].closed, false); assert.ok(after[index].sequence > before[index].sequence); assert.ok(after[index].tick > before[index].tick); }
          guest.renewals++; guest.before = after; console.log('Automatic live-game renewal:', guest.index, guest.renewals, { sameChannels: true, freshICE: true, movementReplicated: true, serverCommitted: true });
        }
      }
      await pages[1].waitForTimeout(250);
    }
    await host.evaluate(() => window.renewalSession.end());
    for (const guest of guests) {
      await guest.page.waitForFunction(() => !window.polycraft.controls.guestWorld && window.polycraft.controls.ready());
      assert.equal(await guest.page.evaluate(() => JSON.stringify(window.polycraft.bridge.state)), guest.state); assert.deepEqual(fs.readFileSync(guest.file), guest.bytes);
    }
    const hostSaves = path.join(directory, 'host', 'saves'), data = JSON.parse(fs.readFileSync(path.join(hostSaves, fs.readdirSync(hostSaves).find(name => name.endsWith('.json'))))).state.userData;
    const registry = JSON.parse(data.desktopCoop); assert.equal(registry.players.length, count);
    for (const guest of guests) assert.ok(registry.players.some(player => player.id === guest.hero));
    assert.deepEqual(errors, []); assert.deepEqual(requests.filter(url => /^https?:/i.test(url)), []);
    console.log('PASS: full original game and room service retain all assigned heroes, existing peer connections/data channels, ongoing snapshots and keyboard movement through three automatic service-issued TURN renewals per guest beyond initial credential expiry; server commits, host save and every guest solo isolation pass.', { players: count, renewals: guests.map(guest => guest.renewals) });
  } catch (error) { fs.mkdirSync('test-results', { recursive: true }); for (let index = 0; index < pages.length; index++) await pages[index].screenshot({ path: 'test-results/room-game-renewal-failure-' + index + '.png' }).catch(() => {}); throw error; }
  finally { for (const app of applications) { await app.evaluate(({ app }) => app.exit()).catch(() => {}); app.process().kill('SIGKILL'); } await service.close(); console.log('Disposable live-renewal profiles:', directory); }
})().catch(error => { console.error(error); process.exitCode = 1; });
