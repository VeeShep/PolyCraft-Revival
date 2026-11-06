'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { once } = require('node:events');
const net = require('node:net');
const { createRoomServer } = require('../server/rooms.cjs');

(async () => {
  const turn = JSON.parse(process.env.POLYCRAFT_TEST_TURN_RENEWAL || 'null');
  assert.ok(turn && /^turn:127\.0\.0\.1:\d+\?transport=udp$/.test(turn.urls) && typeof turn.secret === 'string' && turn.secret.length >= 32, 'Use the owned loopback auth-secret TURN fixture.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-room-game-renewal-'));
  const service = createRoomServer({ turn: { urls: [turn.urls], secret: turn.secret, ttl: 60 } });
  const applications = [], pages = [], errors = [], requests = [];
  const settings = { room: 'temporary-game-renewal', password: 'temporary room renewal password', name: 'Renewal guest' };
  let guestFile, guestBytes, guestState, directPort;
  async function focus(index) {
    await applications[index].evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); const window = BrowserWindow.getAllWindows()[0]; window.moveTop(); window.focus(); });
    await pages[index].bringToFront(); await pages[index].locator('#turbulenz_game_engine_canvas').focus();
    await pages[index].waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused() && (!window.polycraft.controls.guestWorld || window.polycraft.controls.guestWorld.movement.available()));
  }
  try {
    service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
    settings.url = 'ws://127.0.0.1:' + service.server.address().port + '/signaling';
    const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); directPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    for (const role of ['host', 'guest']) {
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
    const [host, guest] = pages, saves = path.join(directory, 'guest', 'saves');
    guestFile = path.join(saves, fs.readdirSync(saves).find(name => name.endsWith('.json'))); guestBytes = fs.readFileSync(guestFile); guestState = await guest.evaluate(() => JSON.stringify(window.polycraft.bridge.state));
    const hero = await host.evaluate(async ({ settings, directPort }) => {
      const session = window.renewalSession, room = window.renewalRoom;
      await session.connect('host', { iceServers: [], autoNative: { address: '127.0.0.1', port: directPort, upnp: false }, trickle: true, onCandidate: (value, link) => room.candidate(value, link) }, '', true);
      // Stage unavailable native forwarding; relay-only ICE makes the STUN stage fail naturally.
      session.transport.forwardEndpoint = null;
      await room.open('host', settings); return session.addGuest('Renewal guest');
    }, { settings, directPort });
    await guest.evaluate(settings => window.renewalRoom.open('guest', settings), settings);
    await host.waitForFunction(() => window.renewalRoom.requests.size === 1);
    await host.evaluate(async hero => { const room = window.renewalRoom, entry = [...room.requests.values()][0]; await room.approve(entry.id, hero); await entry.running; if (!entry.route?.admitted || entry.route.stage !== 'turn') throw new Error('Expected admitted real TURN game route.'); }, hero);
    await guest.waitForFunction(() => !!window.polycraft.controls.guestWorld?.scene.snapshot);
    const staged = await host.evaluate(hero => window.renewalSession.world.atBoundary(() => {
      const world = window.renewalSession.world, actor = world.players.active.get(hero).hero, before = Array.from(actor.getv3Location());
      actor.getEC('ECLocomotion').clearDestination(); actor.teleport(world.game.placeOnGround([-125, 0, -85], 0.5));
      const locomotion = actor.getEC('ECLocomotion');
      return { before, location: Array.from(actor.getv3Location()), locomotionActive: locomotion.active, mobile: locomotion.mobile, normalSpeed: locomotion.archetype.normalSpeed, fixed: actor.getEC('ECPhysicsSphere').isFixed() };
    }), hero);
    console.log('Staged native movement location:', JSON.stringify(staged));
    async function moveGuest() {
      await focus(1); const location = await host.evaluate(hero => Array.from(window.renewalSession.world.players.active.get(hero).hero.getv3Location()), hero);
      let moved = false;
      for (const key of ['w', 'd', 's', 'a']) {
        await guest.keyboard.down(key); await guest.waitForTimeout(500);
        const input = await host.evaluate(hero => { const world = window.renewalSession.world, actor = world.players.active.get(hero).hero, input = world.guestSlots.get(hero).input; return { position: Array.from(actor.getv3Location()), sequence: input.sequence, move: input.move, moving: input.moving, scriptLocked: world.game.isScriptLocked(), health: actor.getEC('ECHealth').getHealth() }; }, hero);
        const local = await guest.evaluate(() => { const world = window.polycraft.controls.guestWorld; return { keys: [...world.movement.keys], available: world.movement.available(), sequence: world.movement.sequence, resyncing: world.resyncing }; });
        await guest.keyboard.up(key); console.log('Native renewal movement probe:', JSON.stringify({ key, input, local }));
        moved = Math.hypot(input.position[0] - location[0], input.position[2] - location[2]) > 0.2;
        if (moved) break;
      }
      assert.ok(moved, 'Native keyboard movement must reach the host after renewal.');
      await guest.waitForFunction(({ hero, location }) => { const world = window.polycraft.controls.guestWorld, record = world.scene.entities.get(world.identity.entity)?.record; return world.identity.playerId === hero && record && Math.hypot(record.location[0] - location[0], record.location[2] - location[2]) > 0.2; }, { hero, location });
      assert.equal(await host.evaluate(() => window.renewalSession.world.players.active.size), 2);
    }
    await moveGuest(); console.log('Native movement baseline passes before renewal.');
    async function sample(page, hostSide, first) {
      return page.evaluate(async ({ hostSide, first }) => {
        const session = window.renewalSession, room = window.renewalRoom, entry = hostSide && [...room.requests.values()][0], link = hostSide ? entry.route.link : session.connection;
        const stats = await link.pc.getStats(), transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId), pair = transport && stats.get(transport.selectedCandidatePairId), local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
        if (first) window.renewalOriginal = { pc: link.pc, channel: link.channel };
        const state = hostSide && room.renewals.states.get(entry.id);
        return { path: (await link.diagnostics()).path, same: link.pc === window.renewalOriginal.pc && link.channel === window.renewalOriginal.channel, closed: link.closed, port: local?.port, localGeneration: local?.usernameFragment, remoteGeneration: remote?.usernameFragment, expires: hostSide ? state.expires : undefined, failures: state?.failures || 0, pending: hostSide ? !!state.tx : !!room.renewals.guest, sequence: link.sentSequence, tick: hostSide ? session.world.game.gameClock.getFrameIndex() : session.world.scene.tick, users: first ? link.pc.getConfiguration().iceServers.map(server => server.username) : undefined };
      }, { hostSide, first });
    }
    let before = [await sample(host, true, true), await sample(guest, false, true)];
    assert.equal(before.flatMap(row => row.users).length, 2); assert.ok(before.flatMap(row => row.users).every(user => /^\d+:[a-f0-9-]{36}$/.test(user)));
    const initialExpiry = Math.max(...before.flatMap(row => row.users).map(user => Number(user.split(':')[0]) * 1000));
    assert.ok(Number.isFinite(initialExpiry)); const deadline = Date.now() + 150000; let renewals = 0;
    while (renewals < 3 || Date.now() <= initialExpiry + 1000) {
      assert.ok(Date.now() < deadline, 'Three automatic full-game renewals must finish within the test deadline.');
      const current = [await sample(host, true, false), await sample(guest, false, false)];
      for (const row of current) { assert.equal(row.same, true); assert.equal(row.closed, false); assert.equal(row.failures, 0); }
      if (current[0].expires > before[0].expires && !current.some(row => row.pending)) {
        for (let index = 0; index < 2; index++) { assert.equal(current[index].path, 'relayed'); assert.ok(Number.isInteger(current[index].port)); assert.equal(typeof current[index].localGeneration, 'string'); assert.equal(typeof current[index].remoteGeneration, 'string'); assert.notEqual(current[index].port, before[index].port); assert.notEqual(current[index].localGeneration, before[index].localGeneration); assert.notEqual(current[index].remoteGeneration, before[index].remoteGeneration); assert.ok(current[index].sequence > before[index].sequence); assert.ok(current[index].tick > before[index].tick); }
        const room = service.rooms.get(settings.room), entry = [...room.guests.values()][0]; assert.equal(entry.relayExpires, current[0].expires); assert.equal(entry.renewal, null); assert.equal(entry.routeAck, true);
        await moveGuest();
        renewals++; before = current; console.log('Automatic live-game renewal:', renewals, { sameChannels: true, freshICE: true, movementReplicated: true, serverCommitted: true });
      }
      await guest.waitForTimeout(250);
    }
    await host.evaluate(() => window.renewalSession.end());
    await guest.waitForFunction(() => !window.polycraft.controls.guestWorld && window.polycraft.controls.ready());
    assert.equal(await guest.evaluate(() => JSON.stringify(window.polycraft.bridge.state)), guestState); assert.deepEqual(fs.readFileSync(guestFile), guestBytes);
    const hostSaves = path.join(directory, 'host', 'saves'), data = JSON.parse(fs.readFileSync(path.join(hostSaves, fs.readdirSync(hostSaves).find(name => name.endsWith('.json'))))).state.userData;
    assert.ok(JSON.parse(data.desktopCoop).players.some(player => player.id === hero)); assert.deepEqual(errors, []); assert.deepEqual(requests.filter(url => /^https?:/i.test(url)), []);
    console.log('PASS: full original game and room service retain the assigned hero, existing peer connections/data channels, ongoing snapshots and keyboard movement through three automatic service-issued TURN renewals beyond initial credential expiry; server commits, host save and guest solo isolation pass.');
  } catch (error) { fs.mkdirSync('test-results', { recursive: true }); for (let index = 0; index < pages.length; index++) await pages[index].screenshot({ path: 'test-results/room-game-renewal-failure-' + index + '.png' }).catch(() => {}); throw error; }
  finally { for (const app of applications) { await app.evaluate(({ app }) => app.exit()).catch(() => {}); app.process().kill('SIGKILL'); } await service.close(); console.log('Disposable live-renewal profiles:', directory); }
})().catch(error => { console.error(error); process.exitCode = 1; });
