'use strict';
// Network-only CI check: no game bundle, bridge, island, or production service is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createHmac, randomUUID } = require('node:crypto');
const { _electron: electron } = require('playwright-core');

async function run() {
  assert.equal(process.platform, 'linux', 'Run this check on the disposable Linux CI runner.');
  assert.equal(process.env.CI, 'true', 'This check is reserved for CI; desktop game tests remain deferred.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-network-only-'));
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const secret = randomUUID();
  const { nativeRoomRenewal, retiredTurnObserver } = require('./native-room-renewal.cjs'), retired = retiredTurnObserver();
  let application, turn;
  try {
    turn = spawn('turnserver', ['-c', '/dev/null', '--listening-ip=127.0.0.1', '--relay-ip=127.0.0.1', `--listening-port=${port}`,
      '--min-port=49160', '--max-port=49260', '--allow-loopback-peers', '--use-auth-secret', `--static-auth-secret=${secret}`,
      '--realm=polycraft-ci.invalid', '--relay-threads=1', '--max-allocate-lifetime=30', '--verbose', '--no-tls', '--no-dtls', '--no-cli', '--simple-log', '--log-file=stdout',
      `--pidfile=${path.join(directory, 'turn.pid')}`, `--userdb=${path.join(directory, 'turn.sqlite')}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    turn.stdout.setEncoding('utf8'); turn.stdout.on('data', chunk => retired.write(chunk));
    let turnError;
    turn.once('error', error => { turnError = error; });
    const deadline = Date.now() + 10000;
    for (;;) {
      if (turnError) throw turnError;
      if (turn.exitCode !== null) throw new Error('The disposable coturn server exited before readiness.');
      const ready = await new Promise(resolve => {
        const socket = net.connect(port, '127.0.0.1');
        socket.setTimeout(200);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
      });
      if (ready) break;
      if (Date.now() >= deadline) throw new Error('The disposable coturn server did not start.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const main = path.join(directory, 'main.cjs'), html = path.join(directory, 'index.html');
    fs.writeFileSync(html, '<!doctype html><title>PolyCraft NETWORK ONLY — NO ISLANDS</title><h1>Network-only disposable CI test</h1>');
    fs.writeFileSync(main, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.POLYCRAFT_TEST_DATA);
app.whenReady().then(() => { const window = new BrowserWindow({ show: true, title: 'PolyCraft NETWORK ONLY — NO ISLANDS', webPreferences: { nodeIntegration: false, contextIsolation: true } }); window.loadFile(${JSON.stringify(html)}); });
app.on('window-all-closed', () => app.quit());`);
    application = await electron.launch({ args: ['--no-sandbox', main], env: { ...process.env, POLYCRAFT_TEST_DATA: path.join(directory, 'profile') }, timeout: 60000 });
    const page = await application.firstWindow();
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    await page.addScriptTag({ path: path.resolve(__dirname, '../desktop/multiplayer.js') });
    function credentials() {
      const username = `${Math.floor(Date.now() / 1000) + 180}:${randomUUID()}`;
      return [{ urls: [`turn:127.0.0.1:${port}?transport=udp`], username, credential: createHmac('sha1', secret).update(username).digest('base64') }];
    }
    const failures = [];
    for (const count of [2, 4]) {
      for (const relay of [false, true]) {
        console.log(`Checking ${count} participants, ${relay ? 'forced relay' : 'direct'}, using disposable network-only peers.`);
        const report = await page.evaluate(async ({ count, relay, initial, fresh }) => {
          let stage = 'joining', generationFailure, signaledCandidates;
          const check = (value, message) => { if (!value) { stage = message; throw new Error(message); } };
          const wait = async predicate => {
            const deadline = performance.now() + 12000;
            while (!await predicate()) {
              check(performance.now() < deadline, 'Network-only condition timed out.');
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          };
          const errors = [], hostMessages = [], guests = [];
          const host = new PolycraftMultiplayer.HostSession({ iceServers: initial, onMessage: (message, link) => hostMessages.push({ message, peer: link.peer }), onError: () => errors.push('host transport failed') });
          const forceRelay = link => { if (relay) link.pc.setConfiguration({ ...link.pc.getConfiguration(), iceTransportPolicy: 'relay' }); };
          async function pairInfo(link) {
            const stats = await link.pc.getStats();
            const transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId);
            const pair = transport && stats.get(transport.selectedCandidatePairId);
            const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
            return { local, remote, transport };
          }
          try {
            for (let index = 1; index < count; index++) {
              const invitation = await host.createInvitation({ onCreated: forceRelay });
              const messages = [];
              const joined = await PolycraftMultiplayer.PeerLink.join(invitation.invitation, { iceServers: initial, onCreated: forceRelay, onMessage: message => messages.push(message), onError: () => errors.push('guest transport failed') });
              guests.push({ link: joined.connection, messages, peer: invitation.peer });
              await host.acceptReply(joined.reply);
              await wait(() => joined.connection.state === 'connected' && host.peers.get(invitation.peer)?.state === 'connected');
            }
            const summaries = [];
            for (const guest of guests) {
              const local = host.peers.get(guest.peer), remote = guest.link;
              const channels = [local.channel, remote.channel], pcs = [local.pc, remote.pc];
              const [previous, guestPrevious] = await Promise.all([pairInfo(local), pairInfo(remote)]);
              check((await local.diagnostics()).path === (relay ? 'relayed' : 'direct'), 'Unexpected selected connection path.');
              await local.send('update', { tick: 1 }); await remote.send('action', { id: 1 });
              await wait(() => guest.messages.length === 1 && hostMessages.filter(row => row.peer === guest.peer).length === 1);
              if (relay) {
                const abort = new AbortController();
                stage = 'creating a restart offer';
                const offer = await local.restartOffer(fresh, abort.signal);
                await local.send('update', { tick: 2 });
                stage = 'creating a restart answer';
                const answer = await remote.restartAnswer(offer, fresh, abort.signal);
                const candidateSummary = sdp => {
                  const fragment = sdp.match(/^a=ice-ufrag:([^\r\n]+)$/m)?.[1];
                  const candidates = sdp.split(/\r?\n/).filter(line => line.startsWith('a=candidate:'));
                  return { count: candidates.length, explicitFragment: candidates.filter(line => line.includes(' ufrag ')).length, matchingGeneration: candidates.filter(line => line.split(' ufrag ')[1]?.split(' ')[0] === fragment).length };
                };
                signaledCandidates = { offer: candidateSummary(offer), answer: candidateSummary(answer) };
                stage = 'applying the restart answer';
                await local.acceptRestartAnswer(answer);
                stage = 'confirming the selected new generation';
                try { await Promise.all([local.confirmRestart().then(() => local.send('snapshot', { tick: 3 })), remote.confirmRestart()]); }
                catch {
                  generationFailure = await Promise.all([local, remote].map(async link => {
                    const selected = await pairInfo(link);
                    const fragment = description => description.sdp.match(/^a=ice-ufrag:([^\r\n]+)$/m)?.[1];
                    const nativePair = link.pc.sctp?.transport?.iceTransport?.getSelectedCandidatePair();
                    const baseline = link === local ? previous : guestPrevious;
                    const signaled = (description, candidate) => description.sdp.split(/\r?\n/).filter(line => line.startsWith('a=candidate:')).some(line => {
                      const value = new RTCIceCandidate({ candidate: line.slice(2), sdpMid: '0' });
                      return value.address === candidate?.address && value.port === candidate?.port && value.protocol === candidate?.protocol;
                    });
                    return { role: link.role, connected: link.pc.connectionState === 'connected', iceConnected: ['connected', 'completed'].includes(link.pc.iceConnectionState), channelOpen: link.channel?.readyState === 'open',
                      confirmed: !!link.iceRenewal?.confirmed, localObservable: typeof selected.local?.usernameFragment === 'string', remoteObservable: typeof selected.remote?.usernameFragment === 'string',
                      localMatches: selected.local?.usernameFragment === fragment(link.pc.localDescription), remoteMatches: selected.remote?.usernameFragment === fragment(link.pc.remoteDescription),
                      nativeLocalMatches: nativePair?.local.usernameFragment === fragment(link.pc.localDescription), nativeRemoteMatches: nativePair?.remote.usernameFragment === fragment(link.pc.remoteDescription),
                      localPortChanged: selected.local?.port !== baseline.local?.port, remotePortChanged: selected.remote?.port !== baseline.remote?.port,
                      localSignaled: signaled(link.pc.localDescription, selected.local), remoteSignaled: signaled(link.pc.remoteDescription, selected.remote),
                      transportFragmentMatches: selected.transport?.iceLocalUsernameFragment === fragment(link.pc.localDescription) };
                  }));
                  check(false, 'Selected new ICE generation was not confirmed.');
                }
                local.finishRestart(); remote.finishRestart();
                const selected = await pairInfo(local);
                check(selected.local?.usernameFragment !== previous.local?.usernameFragment && selected.remote?.usernameFragment !== previous.remote?.usernameFragment, 'Selected ICE generation did not change.');
                const guestSelected = await pairInfo(remote);
                check(selected.local?.port !== previous.local?.port && guestSelected.local?.port !== guestPrevious.local?.port, 'Fresh TURN allocations did not replace both old relay ports.');
              } else {
                check(!local.iceRenewal && !remote.iceRenewal && local.pc.getConfiguration().iceServers.length === 0 && remote.pc.getConfiguration().iceServers.length === 0, 'Direct peers must not request relay renewal.');
                await local.send('update', { tick: 2 }); await local.send('snapshot', { tick: 3 });
              }
              check((await local.diagnostics()).path === (relay ? 'relayed' : 'direct'), 'Connection escaped the required test path.');
              check(local.channel === channels[0] && remote.channel === channels[1] && local.pc === pcs[0] && remote.pc === pcs[1], 'Renewal replaced the admitted transport.');
              await local.send('update', { tick: 4 }); await remote.send('action', { id: 2 });
              await wait(() => guest.messages.length === 4 && hostMessages.filter(row => row.peer === guest.peer).length === 2);
              check(guest.messages.map(row => row.payload.tick).join(',') === '1,2,3,4', 'Host messages were lost, duplicated or reordered.');
              check(hostMessages.filter(row => row.peer === guest.peer).map(row => row.message.payload.id).join(',') === '1,2', 'Guest messages were lost, duplicated or reordered.');
              check(local.sentSequence === 4 && remote.sentSequence === 2 && local.receivedSequence === 2 && remote.receivedSequence === 4, 'Framing counters reset during renewal.');
              summaries.push({ path: relay ? 'relayed' : 'direct', sameChannel: true, newGeneration: relay, freshAllocation: relay, hostFrames: 4, guestFrames: 2 });
            }
            check(errors.length === 0, 'Native transport reported an error.');
            return { participants: count, links: summaries };
          } catch { return { failure: stage, participants: count, relay, generationFailure, signaledCandidates }; }
          finally { host.close(); for (const guest of guests) guest.link.close(); }
        }, { count, relay, initial: relay ? credentials() : [], fresh: relay ? credentials() : [] });
        console.log(JSON.stringify(report));
        if (report.failure) failures.push(report);
      }
    }
    assert.deepEqual(failures, [], 'The sanitized network reports above identify failed steps.');
    await nativeRoomRenewal(page, { port, secret, retired });
  } finally {
    if (application) await application.close();
    if (turn?.pid && turn.exitCode === null) {
      const exited = new Promise(resolve => turn.once('exit', resolve));
      turn.kill(); await exited;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
run().catch(() => { console.error('Network-only native WebRTC/coturn check failed. No SDP, credentials or saves are recorded.'); process.exitCode = 1; });
