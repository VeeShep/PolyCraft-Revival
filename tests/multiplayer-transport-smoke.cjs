'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-peers-'));
  const applications = [];
  const pages = [];
  const errors = [], requests = [];
  try {
    for (let index = 0; index < 4; index++) {
      const application = await electron.launch({ args: ['.'], env: { ...process.env, POLYCRAFT_TEST_DATA: path.join(directory, String(index)) }, timeout: 90000 });
      applications.push(application);
      const page = await application.firstWindow();
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true, 'Automated windows stay visible');
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      await page.waitForFunction(() => !!window.PolycraftMultiplayer);
      pages.push(page);
      await page.evaluate(() => { window.peerMessages = []; window.peerStates = []; window.peerErrors = []; });
    }
    const hostPage = pages[0];
    await hostPage.evaluate(() => {
      window.peerHost = new window.PolycraftMultiplayer.HostSession({
        pvp: true,
        onMessage: (message, connection) => window.peerMessages.push({ peer: connection.peer, ...message }),
        onState: (peer, state, details) => window.peerStates.push({ peer, state, ...details }),
        onError: (peer, error) => window.peerErrors.push({ peer, message: error.message })
      });
    });
    async function join(index) {
      const offer = await hostPage.evaluate(() => window.peerHost.createInvitation());
      const reply = await pages[index].evaluate(async invitation => {
        window.peerLink?.close();
        window.peerStates = [];
        const joined = await window.PolycraftMultiplayer.PeerLink.join(invitation, {
          onMessage: message => window.peerMessages.push(message),
          onState: (state, details) => window.peerStates.push({ state, ...details }),
          onError: error => window.peerErrors.push({ message: error.message })
        });
        window.peerLink = joined.connection;
        return joined.reply;
      }, offer.invitation);
      await hostPage.evaluate(reply => window.peerHost.acceptReply(reply), reply);
      await pages[index].waitForFunction(() => window.peerLink.state === 'connected', null, { timeout: 30000 });
      await hostPage.waitForFunction(peer => window.peerHost.peers.get(peer)?.state === 'connected', offer.peer, { timeout: 30000 });
      assert.equal(await pages[index].evaluate(() => window.peerLink.connectionPath()), 'direct');
      assert.deepEqual(await pages[index].evaluate(() => window.peerLink.pc.getConfiguration().iceServers), []);
      assert.equal(await pages[index].evaluate(() => window.peerLink.pvp), true);
      return offer.peer;
    }
    const first = await join(1);
    await hostPage.evaluate(peer => window.peerHost.peers.get(peer).send('welcome', { player: peer, tick: 1 }), first);
    await pages[1].waitForFunction(() => window.peerMessages.some(message => message.kind === 'welcome'));
    await pages[1].evaluate(() => window.peerLink.send('action', { id: 'action-1', name: 'move', position: [10, 0, 20] }));
    await hostPage.waitForFunction(() => window.peerMessages.some(message => message.kind === 'action'));
    assert.equal(await hostPage.evaluate(() => window.peerMessages[0].peer), first);
    const second = await join(2), third = await join(3);
    await assert.rejects(hostPage.evaluate(() => window.peerHost.createInvitation()), /four players/);
    await hostPage.evaluate(async () => {
      for (const connection of window.peerHost.peers.values()) {
        await connection.send('snapshot', { tick: 2, world: '🌴木'.repeat(300000), entities: [{ id: 'hero', health: 100 }] });
        await connection.send('update', { tick: 3, health: 99 });
      }
    });
    for (const page of pages.slice(1)) {
      await page.waitForFunction(() => window.peerMessages.some(message => message.kind === 'update'), null, { timeout: 30000 });
      assert.deepEqual(await page.evaluate(() => ({ kinds: window.peerMessages.filter(message => ['snapshot', 'update'].includes(message.kind)).map(message => message.kind), length: window.peerMessages.find(message => message.kind === 'snapshot').payload.world.length })), { kinds: ['snapshot', 'update'], length: 900000 });
    }
    await assert.rejects(pages[1].evaluate(() => window.peerLink.send('snapshot', {})), /cannot send/);
    console.log('PASS: four real Electron peers, separate offer/reply pairs, direct paths without outside services, fixed PvP, large Unicode snapshots and ordered updates.');

    // A malicious guest must not be able to submit authoritative state through a raw channel.
    await pages[3].evaluate(() => window.peerLink.channel.send('{'));
    await hostPage.waitForFunction(peer => !window.peerHost.peers.has(peer), third);
    assert.equal(await hostPage.evaluate(() => window.peerHost.peers.size), 2);
    assert.equal(await hostPage.evaluate(() => window.peerErrors.length), 1);
    assert.match(await hostPage.evaluate(() => window.peerErrors[0].message), /Invalid game frame JSON/);
    const replacement = await join(3);
    assert.notEqual(replacement, third);

    // Deliver exactly one chunk, then disconnect before the rest: no partial snapshot may dispatch.
    const before = await pages[3].evaluate(() => window.peerMessages.length);
    await hostPage.evaluate(peer => {
      const connection = window.peerHost.peers.get(peer);
      const data = new TextEncoder().encode(JSON.stringify({ world: 'x'.repeat(100000) }));
      const part = data.subarray(0, window.PolycraftMultiplayer.CHUNK_BYTES);
      connection.channel.send(JSON.stringify({ session: connection.session, peer, sequence: 1, transfer: 1, kind: 'snapshot', index: 0, chunks: Math.ceil(data.length / part.length), bytes: data.length, data: btoa(Array.from(part, byte => String.fromCharCode(byte)).join('')) }));
    }, replacement);
    await pages[3].waitForFunction(() => window.peerLink.incoming?.next === 1);
    await hostPage.evaluate(peer => window.peerHost.peers.get(peer).close(), replacement);
    await pages[3].waitForFunction(() => window.peerLink.closed);
    assert.equal(await pages[3].evaluate(() => window.peerMessages.length), before);
    assert.equal(await pages[3].evaluate(() => window.peerLink.incoming), null);
    assert.equal(await hostPage.evaluate(() => window.peerHost.peers.size), 2);
    await hostPage.evaluate(() => window.peerHost.close());
    await pages[1].waitForFunction(() => window.peerLink.closed);
    await pages[2].waitForFunction(() => window.peerLink.closed);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(url => /^https?:/.test(url)), []);
    console.log('PASS: malformed peer isolation, new invitation after disconnect, interrupted snapshot discarded and host close ends all connections.');
    console.log('This validates transport, not co-op gameplay, saved reconnect progress, internet NAT or TURN.');
  } finally {
    for (const application of applications.reverse()) await application.evaluate(({ app }) => app.exit()).catch(() => {});
    console.log('Disposable profiles:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
