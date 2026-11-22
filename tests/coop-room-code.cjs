'use strict';
const waitForAsyncCondition = require('./wait-for-async-condition.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { once } = require('node:events');
const { createRoomServer } = require('../server/rooms.cjs');

function focusWindow({ app, BrowserWindow }) {
  const window = BrowserWindow.getAllWindows()[0];
  app.focus({ steal: true }); window.show(); window.moveTop(); window.focus(); window.webContents.focus();
  const state = { time: Date.now(), focused: window.isFocused(), visible: window.isVisible(), minimized: window.isMinimized(), contentsFocused: window.webContents.isFocused(), focusedWindow: BrowserWindow.getFocusedWindow()?.id ?? null };
  window.roomFocusAttempts ||= []; window.roomFocusAttempts.push(state); if (window.roomFocusAttempts.length > 10) window.roomFocusAttempts.shift();
  return state;
}
function bindHost(root = window) {
  const world = root.polycraft.controls.onlineWorld;
  if (!world?.players || world.closed || root.restoreWorkerRoomErrors) throw new Error('A fresh UI-hosted world is required.');
  root.hostWorld = world; root.hostSession = world.transport; root.workerConnectionErrors = [];
  const previous = world.transport.onError;
  const observe = function (...args) { root.workerConnectionErrors.push(args[1]?.message || String(args[1])); return previous?.apply(this, args); };
  world.transport.onError = observe;
  root.restoreWorkerRoomErrors = () => { if (world.transport.onError === observe) world.transport.onError = previous; delete root.restoreWorkerRoomErrors; };
}
function bindGuest({ hero, root = window }) {
  const world = root.polycraft.controls.guestWorld;
  if (!world?.scene.snapshot || world.connection.closed || world.identity.playerId !== hero) throw new Error('The UI must admit the exact saved guest hero before observation.');
  root.guestWorld = world; root.connection = world.connection;
}
module.exports = async function roomCode({ host, focusHost, directory }) {
  const service = createRoomServer(), settings = { room: 'temporary-earned-island', password: 'temporary room password' }, admissions = [];
  let stage = 'start local room service';
  const click = async (page, focused, selector) => { await focused(); await page.locator(selector).click(); };
  const connection = async (page, focused, selector) => {
    await click(page, focused, selector); await page.locator('#multiplayer-warning[open]').waitFor();
    await click(page, focused, '#multiplayer-warning button[value="continue"]'); await page.locator('#multiplayer-warning').waitFor({ state: 'hidden' });
  };
  const configure = async (page, focused) => {
    await click(page, focused, '#multiplayer');
    await page.locator('#room-server').fill(settings.url); await page.locator('#room-name').fill(settings.room); await page.locator('#room-password').fill(settings.password);
    await page.locator('#webrtc-settings > summary').click();
    await page.locator('#stun-urls').fill(settings.stun);
    assert.equal(await page.locator('#turn-urls').inputValue(), '');
  };
  const capture = async (page, app) => {
    const details = { stage, host: await host.locator('#multiplayer-status').textContent().catch(() => 'unavailable'), guest: page && await page.locator('#multiplayer-status').textContent().catch(() => 'unavailable') };
    if (app) details.native = await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; return window && { focused: window.isFocused(), visible: window.isVisible(), minimized: window.isMinimized(), contentsFocused: window.webContents.isFocused(), events: window.focusTrace, attempts: window.roomFocusAttempts }; }).catch(error => ({ unavailable: error.message }));
    fs.writeFileSync(path.join(directory, 'room-code-ui-failure.json'), JSON.stringify(details, null, 2));
    if (page) await page.screenshot({ path: path.join(directory, 'room-code-ui-failure.png'), timeout: 5000 }).catch(() => {});
  };
  try {
    service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
    const port = service.server.address().port; settings.url = 'ws://127.0.0.1:' + port + '/signaling'; settings.stun = 'stun:127.0.0.1:' + port;
    const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const directPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    stage = 'host room through menu'; await configure(host, focusHost);
    await host.locator('#direct-settings > summary').click(); await host.locator('#direct-address').fill('127.0.0.1'); await host.locator('#direct-port').fill(String(directPort));
    assert.equal(await host.locator('#direct-upnp').isChecked(), false); assert.equal(await host.locator('#session-pvp').isChecked(), false);
    await connection(host, focusHost, '#host-room'); await host.waitForFunction(() => !!window.polycraft.controls.onlineWorld?.players);
    await host.waitForFunction(() => document.getElementById('multiplayer-status').textContent.includes('is open'));
    assert.equal(await host.locator('#room-password').inputValue(), ''); assert.equal(service.rooms.size, 1); await host.evaluate(bindHost);
    await click(host, focusHost, '#close-multiplayer');
  } catch (error) { await capture(); await service.close(); throw error; }
  return {
    async join({ page, app, hero, index }) {
      const focused = async () => {
        await app.evaluate(focusWindow);
        await page.bringToFront(); await waitForAsyncCondition(page, async () => document.hasFocus() && await window.desktop.windowFocused(), null, { timeout: 5000 });
      };
      try {
        stage = 'request guest ' + (index + 1); await configure(page, focused); const name = 'Temporary earned guest ' + (index + 1); await page.locator('#room-guest-name').fill(name);
        if (index === 0) {
          stage = 'reject incorrect password'; await page.locator('#room-password').fill(settings.password.toUpperCase()); await connection(page, focused, '#join-room');
          await page.waitForFunction(() => document.getElementById('multiplayer-status').textContent.includes('incorrect'));
          assert.equal(service.rooms.get(settings.room).guests.size, 0); assert.equal(await page.evaluate(() => !!window.polycraft.controls.guestWorld), false); assert.equal(await page.locator('#room-password').inputValue(), '');
          await page.locator('#room-password').fill(settings.password);
        }
        stage = 'approve saved hero for guest ' + (index + 1); await connection(page, focused, '#join-room');
        assert.equal(await page.evaluate(() => !!window.polycraft.controls.guestWorld), false, 'Room password alone must not admit a saved hero.');
        await click(host, focusHost, '#multiplayer'); const option = host.locator('#room-request option').filter({ hasText: name }); await option.waitFor({ state: 'attached' });
        assert.equal(await option.count(), 1); await host.locator('#room-request').selectOption(await option.getAttribute('value')); await host.locator('#room-hero').selectOption(hero);
        await click(host, focusHost, '#approve-room-guest'); await page.waitForFunction(() => !!window.polycraft.controls.guestWorld?.scene.snapshot, null, { timeout: 45000 });
        await page.evaluate(bindGuest, { hero }); const route = await page.evaluate(() => window.connection.diagnostics());
        assert.equal(route.path, 'direct TCP/TLS'); assert.equal(await page.evaluate(() => window.connection.kind), 'direct');
        assert.equal(await page.locator('#manual-invite-tools').isHidden(), true); assert.equal(await page.locator('#room-password').inputValue(), '');
        await click(host, focusHost, '#close-multiplayer'); await click(page, focused, '#close-multiplayer');
        admissions.push({ hero, path: route.path, approved: true }); fs.writeFileSync(path.join(directory, 'room-code-admissions.json'), JSON.stringify(admissions, null, 2));
        console.log('PASS: real room menu approves saved hero without invitation copying:', JSON.stringify({ guest: index + 1, hero, path: route.path }));
      } catch (error) { await capture(page, app); throw error; }
    },
    async end() {
      stage = 'end room through menu'; assert.equal(admissions.length, 3); await click(host, focusHost, '#multiplayer'); await click(host, focusHost, '#end-session');
      await host.waitForFunction(() => !window.polycraft.controls.onlineWorld);
      const deadline = Date.now() + 5000; while (service.rooms.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(service.rooms.size, 0); console.log('PASS: actual End session saves the island and removes the room.');
    },
    async close() { await host.evaluate(() => window.restoreWorkerRoomErrors?.()).catch(() => {}); await service.close(); }
  };
};
module.exports.bindHost = bindHost;
module.exports.bindGuest = bindGuest;

module.exports.focusWindow = focusWindow;
