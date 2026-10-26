'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs');
const ranks = ast.objectWith('xpTable');
const playerDataMethods = ast.component('ECPlayerData', { kd: ranks });
const scoreMethods = ast.prototypeWith('drawResourceBar', { Za: [{ barGUI: 'lumber', string: 'Lumber' }, { barGUI: 'stone', string: 'Stone' }] });
const { captureHud, GuestHud } = require('../desktop/hud.js');
const { HostActions } = require('../desktop/coop-actions.js');
const profile = () => ({ resources: [100, 50], caps: [500, 1000], amber: 10, xp: 0, points: 0, quests: null, flags: { resources: true, amber: true, rank: true } });
function guest() {
  const drawn = [], globals = { appCurrentTime: 10, simpleFontRenderer: { numberToCommaString: String }, mathDevice: { lerp: (a, b, t) => a + (b - a) * t, saturate: value => Math.max(0, Math.min(1, value)) } };
  const scores = Object.assign(Object.create(scoreMethods), { globals });
  const world = { game: { getGuiScores: () => scores, getGuiManager: () => ({ addDrawGui: (name, value, id) => drawn.push({ name, value, id }) }), getHero: () => { throw new Error('The solo hero must not be used'); } }, controls: { xpTable: ranks.xpTable, playerDataMethods, app: { globals } } };
  globals.gameManager = world.game;
  const hud = new GuestHud(world), receive = (value = profile(), sequence = 1, expected = 1) => hud.receive({ type: 'life', sequence, life: {}, hud: value }, expected);
  return { world, hud, receive, globals, drawn };
}
test('own-hero status supplies shared economy and individual progression through actual original player-data getters without saving', () => {
  const economy = { resources: [250.5, 50], caps: [500, 1000], amber: 80 };
  const actor = (xp, used, extra) => {
    const data = Object.assign(Object.create(playerDataMethods), { playerData: { progress: { desktopUpgradePoints: extra }, getResource: index => economy.resources[index], getResourceCap: index => economy.caps[index], getSoftCurrency: () => economy.amber, getXP: () => xp, getHeroUpgrade: () => used } });
    return { shouldBeDestroyed: () => false, getEC: name => name === 'ECPlayerData' ? data : name === 'ECPlayerLife' ? { state: 0, states: { NORMAL: 0, DYING: 1 } } : {} };
  };
  const first = actor(600, 0, 0), second = actor(1121, 1, 5);
  const game = { getPlayFlags: () => ({ displayResource: true, displayRank: true, displaySoftCurrency: true }), getGameEntityByName: id => id === 'first' ? first : second };
  const one = captureHud(game, first), two = captureHud(game, second);
  assert.deepEqual(one.resources, two.resources); assert.deepEqual(one.caps, [500, 1000]); assert.equal(one.amber, 80);
  assert.equal(one.xp, 600); assert.equal(two.xp, 1121); assert.equal(one.points, 1); assert.equal(two.points, 6);
  const before = JSON.stringify(economy), actions = new HostActions();
  const result = actions.execute(game, first, {}, 'first', null, 'life'); assert.deepEqual(result.hud, one); assert.equal(result.save, undefined);
  assert.match(actions.execute(game, first, {}, 'second', null, 'life'), /Only your own/); assert.equal(JSON.stringify(economy), before);
});
test('actual original HUD draw methods show host resource/cap/amber/rank and totem points, including full and maximum-rank states', () => {
  const f = guest(), state = profile(); state.resources[0] = 500; state.xp = 600; state.points = 2;
  f.receive(state); f.hud.draw();
  assert.equal(f.drawn.find(draw => draw.name === 'lumber').value.text2, '500 max (Full)');
  assert.equal(f.drawn.find(draw => draw.name === 'stone').value.text1, '50');
  assert.equal(f.drawn.find(draw => draw.name === 'resourceAmberTotal').value.text, '10');
  assert.equal(f.drawn.find(draw => draw.name === 'rankUpgrade').value.text1, '1');
  assert.equal(f.drawn.find(draw => draw.name === 'heroUpgradeNote').value.text1, '2 HERO UPGRADE');
  state.xp = 2147483647; state.points = 0; f.receive(state); f.globals.appCurrentTime += 5; f.drawn.length = 0; f.hud.draw();
  const rank = f.drawn.find(draw => draw.name === 'rank'); assert.equal(rank.value.text1, String(ranks.xpTable.length - 1)); assert.equal(rank.value.scale1, 1);
});
test('original number animations retain continuity, ignore unchanged packets and never mutate received models', () => {
  const f = guest(); f.receive(); f.globals.appCurrentTime = 10.1;
  const next = { ...profile(), resources: [200, 50], amber: 20, xp: 600, points: 1 }, original = JSON.stringify(next);
  f.receive(next); assert.equal(f.hud.data.getVisibleResource(0), 100);
  f.globals.appCurrentTime = 10.6; assert.equal(f.hud.data.getVisibleXP(), 300); assert.equal(f.hud.data.getVisibleRank(), 0); assert.equal(f.hud.data.getVisibleSoftCurrency(), 15);
  const visible = f.hud.data.getVisibleResource(0), started = f.hud.data.resourceTime[0]; f.receive(next);
  assert.equal(f.hud.data.resourceTime[0], started); assert.equal(f.hud.data.getVisibleResource(0), visible);
  f.receive({ ...next, resources: [300, 50] }); assert.equal(f.hud.data.resourceStartPoint[0], visible);
  f.globals.appCurrentTime += 5; assert.equal(f.hud.data.getVisibleResource(0), 300); assert.equal(f.hud.data.getVisibleRank(), 1);
  assert.equal(JSON.stringify(next), original);
  f.receive({ ...profile(), xp: 0 }); assert.equal(f.hud.data.getVisibleXP(), 0); assert.equal(f.hud.data.getVisibleRank(), 0);
});
test('HUD accepts only the expected status, copies packet arrays and follows host display flags/resync suppression', () => {
  const f = guest(), value = profile(); f.receive(value, 99); assert.equal(f.hud.state, undefined);
  f.receive(value); value.resources[0] = 999; assert.equal(f.hud.state.resources[0], 100);
  f.world.resyncing = true; f.hud.draw(); assert.equal(f.drawn.length, 0); f.world.resyncing = false;
  f.receive({ ...profile(), flags: { resources: false, amber: false, rank: false } }); f.hud.draw(); assert.equal(f.drawn.length, 0);
  f.receive(profile(), 999); assert.equal(f.hud.state.flags.resources, false);
});
test('HUD validation refuses malformed totals, sparse arrays, flags, authority fields and non-status payloads before changing display data', () => {
  const f = guest(); f.receive(); const before = JSON.stringify(f.hud.state);
  for (const invalid of [{ resources: Array(2) }, { resources: [-1, 0] }, { caps: [Infinity, 0] }, { amber: NaN }, { xp: 1.5 }, { xp: 2147483648 }, { points: -1 }, { points: 1e10 }, { flags: { resources: true, amber: true, rank: 1 } }, { flags: { resources: true, amber: true, rank: true, save: true } }, { save: true }]) assert.throws(() => f.receive({ ...profile(), ...invalid }), /Invalid guest HUD/);
  assert.throws(() => f.hud.receive({ type: 'revive', sequence: 1, life: {}, hud: profile() }, 1), /Invalid guest HUD/);
  assert.throws(() => f.hud.receive({ type: 'life', sequence: 1, hud: profile() }, 1), /Invalid guest HUD/);
  assert.equal(JSON.stringify(f.hud.state), before);
});
