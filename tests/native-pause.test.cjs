'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const nativePause = require('./coop-native-pause.cjs');
function fixture(t, mode = 'normal') {
  const prior = global.window, events = [], agents = [{ lastUpdateTime: 1 }, { lastUpdateTime: 1 }], failure = new Error('pause rendering wait failed');
  t.after(() => { if (prior === undefined) delete global.window; else global.window = prior; }); t.mock.method(console, 'log', () => {});
  let tick = 10;
  const workers = agents.map((agent, index) => ({ getName: () => 'worker-' + index, shouldBeDestroyed: () => false, getEC: () => agent }));
  const game = { activeGameState: { name: 'GamestatePlaying' }, gameClock: { getFrameIndex: () => tick },
    getBuildingManager: () => ({ getBuildingsAtMinLevel: type => [{ getEC: name => name === 'ECWildlingHouse' ? { getWildling: () => workers[type === 'Lumberling Hut' ? 0 : 1] } : null }] }),
    getGameEntityByName: id => workers.find(worker => worker.getName() === id),
    getGuiManager: () => ({ prevDrawGuiMap: game.activeGameState.name === 'GamestatePaused' ? { 'Paused Resume': { scale: 1 } } : {} }) };
  const guestWorld = { pauseMenu: false, movement: { available: () => !guestWorld.pauseMenu } };
  const guestGame = { getGuiManager: () => ({ prevDrawGuiMap: guestWorld.pauseMenu ? { 'guest-resume': { scale: 1 } } : {} }) };
  const windows = { host: { hostWorld: { game }, polycraft: { controls: { manager: () => game } } }, guest: { guestWorld, polycraft: { controls: { manager: () => guestGame } } } };
  const page = role => {
    let presses = 0;
    return { async evaluate(callback, argument) { global.window = windows[role]; return structuredClone(await callback(argument)); },
      keyboard: { async press(key) { assert.equal(key, 'p'); presses++; events.push(role + ':key'); if (mode === 'wait-error' && presses === 2) throw new Error('cleanup key failed'); if (role === 'guest') guestWorld.pauseMenu = !guestWorld.pauseMenu; else game.activeGameState.name = game.activeGameState.name === 'GamestatePlaying' ? 'GamestatePaused' : 'GamestatePlaying'; } },
      async waitForFunction(callback, argument, options) { assert.equal(options.timeout, 5000); if (mode === 'wait-error') throw failure; global.window = windows[role]; assert.equal(callback(argument), true); },
      async waitForTimeout(ms) { assert.equal(ms, 1500); assert.equal(role === 'guest' ? guestWorld.pauseMenu : game.activeGameState.name === 'GamestatePaused', true); if (mode !== 'frozen-clock') tick += 30; for (const [index, agent] of agents.entries()) if (mode !== 'frozen-ai' || index === 0) agent.lastUpdateTime += .5; },
      async screenshot(options) { assert.equal(options.timeout, 5000); assert.ok(options.path.endsWith('native-' + role + '-pause.png')); events.push(role + ':screenshot'); } };
  };
  return { args: { host: page('host'), guest: page('guest'), async focus() { events.push('focus:guest'); }, async focusHost() { events.push('focus:host'); }, hostFile: '/private/tmp/disposable/saves/island.json' }, events, game, guestWorld, failure };
}
test('native pause test uses keyboard-opened rendered menus and observes host ticks plus both worker update timestamps', async t => {
  const f = fixture(t); await nativePause(f.args);
  for (const role of ['guest', 'host']) { assert.equal(f.events.filter(event => event === role + ':key').length, 2); assert.ok(f.events.includes(role + ':screenshot')); }
  assert.equal(f.guestWorld.pauseMenu, false); assert.equal(f.game.activeGameState.name, 'GamestatePlaying');
});
for (const [mode, message] of [['frozen-clock', /simulation clock running/], ['frozen-ai', /worker AI updating/]]) test('native pause test rejects ' + mode + ' and closes its menu', async t => {
  const f = fixture(t, mode); await assert.rejects(nativePause(f.args), message);
  assert.equal(f.guestWorld.pauseMenu, false); assert.ok(!f.events.includes('focus:host'));
});
test('native pause test preserves the original render failure even if its cleanup key also fails', async t => {
  const f = fixture(t, 'wait-error'); await assert.rejects(nativePause(f.args), error => error === f.failure);
  assert.equal(f.events.filter(event => event === 'guest:key').length, 2);
});
