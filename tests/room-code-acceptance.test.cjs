'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), path = require('node:path');
const { bindHost, bindGuest, focusWindow } = require('./coop-room-code.cjs');
test('room UI observation binds the actual host world and forwards transport errors without changing their result', () => {
  const failure = new Error('native error'), calls = [], transport = { onError(...args) { assert.equal(this, transport); calls.push(args); throw failure; } };
  const previous = transport.onError, world = { players: {}, transport }, root = { polycraft: { controls: { onlineWorld: world } } };
  vm.runInNewContext('(' + bindHost.toString() + ')()', { window: root });
  assert.equal(root.hostWorld, world); assert.equal(root.hostSession, transport);
  assert.throws(() => transport.onError('peer', failure, 'extra'), error => error === failure); assert.deepEqual(calls, [['peer', failure, 'extra']]); assert.deepEqual(Array.from(root.workerConnectionErrors), ['native error']);
  root.restoreWorkerRoomErrors(); assert.equal(transport.onError, previous); assert.equal(root.restoreWorkerRoomErrors, undefined);
});
test('room UI observation refuses missing/closed worlds and duplicate observers, and preserves later error handlers', () => {
  for (const world of [null, {}, { players: {}, closed: true }]) assert.throws(() => bindHost({ polycraft: { controls: { onlineWorld: world } } }), /fresh UI-hosted/);
  const world = { players: {}, transport: {} }, root = { polycraft: { controls: { onlineWorld: world } } };
  bindHost(root); assert.throws(() => bindHost(root), /fresh UI-hosted/);
  const later = () => {}; world.transport.onError = later; root.restoreWorkerRoomErrors(); assert.equal(world.transport.onError, later);
});
test('room UI guest binding requires an actual snapshot, live connection and the assigned saved identity', () => {
  const world = { scene: { snapshot: {} }, identity: { playerId: 'saved-hero' }, connection: { closed: false } }, root = { polycraft: { controls: { guestWorld: world } } };
  for (const mutate of [w => { w.scene.snapshot = null; }, w => { w.identity.playerId = 'other-hero'; }, w => { w.connection.closed = true; }]) {
    const bad = structuredClone(world), denied = { polycraft: { controls: { guestWorld: bad } } }; mutate(bad);
    assert.throws(() => bindGuest({ hero: 'saved-hero', root: denied }), /exact saved guest/); assert.equal(denied.guestWorld, undefined); assert.equal(denied.connection, undefined);
  }
  vm.runInNewContext('(' + bindGuest.toString() + ')({hero:"saved-hero"})', { window: root }); assert.equal(root.guestWorld, world); assert.equal(root.connection, world.connection);
});
test('room-code CLI is restricted to the isolated earned four-player motion phase before fixture reads or launch', () => {
  const { spawnSync } = require('node:child_process');
  for (const flags of [['--room-code'], ['--coop', '--room-code'], ['--coop', '--natural-campaign', '--room-code'], ['--coop', '--natural-outpost', '--room-code']]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'worker-reload-smoke.cjs'), ...flags], { encoding: 'utf8', env: { ...process.env, POLYCRAFT_WORKER_FIXTURE: '/missing-room-ui-fixture' } });
    assert.equal(result.status, 1); assert.match(result.stderr, /Room-code acceptance requires/); assert.doesNotMatch(result.stderr, /ENOENT|electron.launch/);
  }
});

test('room test activates real window/content APIs while retaining native focus refusal and bounded observations', () => {
  const calls = [], window = { id: 7, show: () => calls.push('show'), moveTop: () => calls.push('top'), focus: () => calls.push('window-focus'), isFocused: () => false, isVisible: () => true, isMinimized: () => false,
    webContents: { focus: () => calls.push('contents-focus'), isFocused: () => true } };
  const modules = { app: { focus: options => { assert.equal(options.steal, true); calls.push('app-focus'); } }, BrowserWindow: { getAllWindows: () => [window], getFocusedWindow: () => null } };
  const focus = vm.runInNewContext('(' + focusWindow.toString() + ')');
  const result = focus(modules); assert.deepEqual(calls, ['app-focus', 'show', 'top', 'window-focus', 'contents-focus']); assert.equal(result.focused, false); assert.equal(result.contentsFocused, true); assert.equal(result.focusedWindow, null);
  for (let i = 0; i < 15; i++) focus(modules); assert.equal(window.roomFocusAttempts.length, 10); assert.ok(window.roomFocusAttempts.every(row => row.focused === false));
});
