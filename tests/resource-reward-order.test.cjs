'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
function block(file, select) {
  const found = [];
  traverse(parse(fs.readFileSync(path.join(__dirname, file), 'utf8')), { IfStatement(p) { if (select(p.node.test)) found.push(p.node.consequent); } });
  assert.equal(found.length, 1);
  return '(async () => ' + generate(found[0]).code + ')()';
}
function evaluatedCallback(file, variable) {
  const found = [];
  traverse(parse(fs.readFileSync(path.join(__dirname, file), 'utf8')), { VariableDeclarator(p) {
    const call = p.node.init?.argument;
    if (p.node.id.name === variable && call?.callee?.object?.name === 'host' && call.callee.property?.name === 'evaluate') found.push(call.arguments[0]);
  } });
  assert.equal(found.length, 1, file + ':' + variable);
  return generate(found[0]).code;
}
test('guest setup retries real focus once only after native focus loss and retains all readiness failures', async () => {
  const { waitForGuestReady } = require('./coop-worker-acknowledgement.cjs');
  const timeout = Object.assign(new Error('not ready'), { name: 'TimeoutError' });
  for (const [focused, secondFailure] of [[false, false], [true, false], [false, true]]) {
    let waits = 0, focuses = 0;
    const page = { async waitForFunction(_read, phase) { assert.equal(phase, 'normal'); if (++waits === 1 || secondFailure) throw timeout; }, async evaluate() { return focused; } };
    const result = waitForGuestReady(page, 'normal', async () => { focuses++; });
    if (focused || secondFailure) await assert.rejects(result, error => error === timeout); else await result;
    assert.equal(focuses, focused ? 0 : 1); assert.equal(waits, focused ? 1 : 2);
  }
});
test('save timing observes original sync/async calls without changing results or errors and restores property ownership', async () => {
  const { installSaveTiming } = require('./save-timing.cjs');
  let time = 0, disconnected = false; const expected = new Error('native failure'), promise = Promise.resolve('saved');
  const game = { saveLevel() { assert.equal(this, game); return 42; } }, original = function (argument) { assert.equal(this, controls); assert.equal(argument, 'bridge'); return promise; };
  const controls = Object.create({ checkpoint: original }); controls.manager = () => game; controls.writeCheckpoint = () => { throw expected; };
  const before = controls.writeCheckpoint, window = { polycraft: { controls } };
  vm.runInNewContext('(' + installSaveTiming.toString() + ')()', { window, performance: { now: () => ++time }, document: { getElementById: () => ({}) }, requestAnimationFrame() {}, MutationObserver: class { observe() {} disconnect() { disconnected = true; } } });
  assert.equal(controls.checkpoint('bridge'), promise); assert.equal(game.saveLevel(), 42); assert.throws(() => controls.writeCheckpoint(), error => error === expected); await promise;
  assert.deepEqual(Array.from(window.saveTiming.records, row => row.phase).sort(), ['checkpoint', 'saveLevel', 'writeCheckpoint']);
  window.saveTiming.restore(); assert.equal(disconnected, true); assert.equal(window.saveTiming, undefined); assert.equal(Object.hasOwn(controls, 'checkpoint'), false); assert.equal(controls.checkpoint, original); assert.equal(controls.writeCheckpoint, before);
});
test('native speedup observer forwards payment receiver/arguments/result and restores own or inherited methods', async () => {
  for (const own of [true, false]) {
    let funds = 96, complete = .001; const actor = { getName: () => 'assigned', getEC: () => ({ getSoftCurrency: () => funds, getXP: () => 310 }) };
    const calls = [], original = function (...args) { assert.equal(this, scaffold); assert.equal(args[0], actor); calls.push(args); funds -= 50; complete = 1; return 'native-result'; };
    const scaffold = Object.assign(Object.create({ instantlyBuild: original }), { getCostToInstantlyBuild: () => 50, canEntityAffordInstantBuild: () => true, getBuildCompleteFraction: () => complete });
    if (own) scaffold.instantlyBuild = original;
    const entity = { getName: () => 'scaffold', getEC: () => scaffold }, world = { players: { active: new Map([['guest', { hero: actor }]]) }, atRewardBoundary: read => read(),
      game: { getBuildingManager: () => ({ getBuildingsAtMinLevel: () => [entity] }), getPlayerData: () => ({ getXP: () => 0 }) } };
    const window = { hostWorld: world }, observe = vm.runInNewContext('(' + evaluatedCallback('coop-natural-speedup.cjs', 'setup') + ')', { window });
    const before = await observe('guest'); assert.equal(before.amber, 96); assert.equal(funds, 96); assert.equal(complete, .001);
    assert.equal(scaffold.instantlyBuild(actor, 'forwarded'), 'native-result'); assert.deepEqual(calls, [[actor, 'forwarded']]);
    assert.deepEqual(Array.from(window.naturalSpeedupPayments, row => [row.actor, row.cost, row.before, row.after, row.complete]), [['assigned', 50, 96, 46, 1]]);
    window.restoreNaturalSpeedup(); assert.equal(scaffold.instantlyBuild, original); assert.equal(Object.hasOwn(scaffold, 'instantlyBuild'), own); assert.equal(window.naturalSpeedupPayments, undefined);
  }
});
test('Outpost continuation admits only the earned clean-stage party before copying files or opening a game', async () => {
  const code = block('worker-reload-smoke.cjs', node => node.name === 'outpostContinuation');
  const valid = { speedupOnly: false, state: { userData: { taskFlags: JSON.stringify({ goToCaves: true }) } }, pending: [], party: JSON.stringify({ players: [{}, { progress: { xp: 290 } }] }),
    buildings: [{ archetypeName: 'a_b_defencefactory' }, { archetypeName: 'a_b_wildlinghouse_war' }] };
  await vm.runInNewContext(code, { ...structuredClone(valid), assert });
  for (const change of [f => f.pending.push({ task: 'buildStonelingHut' }), f => { f.state.userData.taskFlags = '{}'; }, f => { f.state.userData.taskFlags = JSON.stringify({ goToCaves: true, buildOutpost: true }); },
    f => { f.party = JSON.stringify({ players: [{}, { progress: { xp: 310 } }] }); }, f => f.buildings.pop(), f => f.buildings.push({ ...f.buildings[0] })]) {
    const fixture = structuredClone(valid); change(fixture);
    await assert.rejects(vm.runInNewContext(code, { ...fixture, assert }), assert.AssertionError);
  }
});
test('speedup-only continuation requires earned310XP and an unfinished original Outpost, without relaxing placement-stage guards', async () => {
  const code = block('worker-reload-smoke.cjs', node => node.name === 'outpostContinuation');
  const valid = { speedupOnly: true, state: { userData: { taskFlags: JSON.stringify({ goToCaves: true, buildOutpost: true }) } }, pending: [], party: JSON.stringify({ players: [{}, { progress: { xp: 310 } }] }),
    buildings: [{ archetypeName: 'a_b_defencefactory' }, { archetypeName: 'a_b_wildlinghouse_war' }, { archetypeName: 'a_b_scaffold', ecData: { ECScaffold: { plannedObject: 'a_b_outpost', buildComplete: .01 } } }] };
  await vm.runInNewContext(code, { ...structuredClone(valid), assert });
  for (const change of [f => f.pending.push({}), f => { f.state.userData.taskFlags = JSON.stringify({ goToCaves: true }); }, f => { f.state.userData.taskFlags = JSON.stringify({ goToCaves: true, buildOutpost: true, speedUpOutpost: true }); },
    f => { f.party = JSON.stringify({ players: [{}, { progress: { xp: 290 } }] }); }, f => f.buildings.pop(), f => f.buildings.push({ ...f.buildings[2] }), f => { f.buildings[2].ecData.ECScaffold.buildComplete = 1; }, f => f.buildings.push({ archetypeName: 'a_b_outpost' })]) {
    const fixture = structuredClone(valid); change(fixture); await assert.rejects(vm.runInNewContext(code, { ...fixture, assert }), assert.AssertionError);
  }
});
test('natural Defence reward approach excludes old pickups, new worker resources and destroyed reward remnants', () => {
  const entity = (id, pickup, destroyed = false) => ({ getName: () => id, getEC: () => pickup, shouldBeDestroyed: () => destroyed });
  const entities = [entity('old', { xp: 20, archetype: {} }), entity('stone', { xp: 0, archetype: { resource: [0, 1] } }),
    entity('dead', { xp: 20, archetype: {} }, true), entity('xp', { xp: 20, archetype: {} }), entity('amber', { xp: 0, archetype: { softCurrency: 1 } })];
  const select = vm.runInNewContext('(' + evaluatedCallback('coop-natural-defence.cjs', 'drops') + ')', { window: { hostWorld: { game: { getGameSpaceList: () => [{ getEntitiesWithEC: () => entities }] } } } });
  assert.deepEqual(Array.from(select(['old'])), ['xp', 'amber']);
});
test('natural Defendling recipe selects the original war hut and rejects simultaneous factory construction', async () => {
  const build = require('./coop-natural-building.cjs'), stop = new Error('Stop before UI interaction');
  const host = { async waitForFunction() {}, async evaluate(_read, { definition }) {
    assert.deepEqual(definition, { family: 'defendlinghutworkshop', type: 'Defendling Hut', archetype: 'a_b_wildlinghouse_war', task: 'buildDefendlingHut', costs: [10, 0, 0] });
    throw stop;
  } };
  await assert.rejects(build({ host, worker: 'war' }), error => error === stop);
  await assert.rejects(build({ worker: 'war', defenceFactory: true }), assert.AssertionError);
});
test('natural Outpost placement uses the original recipe and cannot be combined with a short-build recipe', async () => {
  const build = require('./coop-natural-building.cjs'), stop = new Error('Stop before UI interaction');
  const host = { async waitForFunction() {}, async evaluate(_read, { definition }) {
    assert.deepEqual(definition, { family: 'outpostworkshop', type: 'Outpost', archetype: 'a_b_outpost', task: 'buildOutpost', costs: [100, 0, 0] });
    throw stop;
  } };
  await assert.rejects(build({ host, outpost: true }), error => error === stop);
  for (const other of [{ defenceFactory: true }, { worker: 'war' }, { lumbermill: true }]) await assert.rejects(build({ outpost: true, ...other }), assert.AssertionError);
});
test('natural building observation distinguishes an unfinished original scaffold from a completed building after saving', async () => {
  const actor = {}, events = [], scaffold = { buildTime: 1800, getPlannedObject: () => 'a_b_outpost', getBuildTimeRemaining: () => 1790,
    getCostToInstantlyBuild: () => 50, canEntityAffordInstantBuild(hero) { assert.equal(hero, actor); return true; } };
  const source = { getName: () => 'outpost', getEC: () => scaffold }, menu = { source: 'outpost', products: [] };
  const world = { players: { active: new Map([['guest', { hero: actor }]]) }, game: { runScripts: true, getBuildingManager: () => ({ getBuildingsAtMinLevel(type, level, includeScaffolds) { assert.equal(type, 'Outpost'); assert.equal(level, 1); assert.equal(includeScaffolds, true); return [source]; } }) },
    construction: { pending: new Set(), menu(hero, entity) { assert.equal(hero, actor); assert.equal(entity, source); return menu; } } };
  const observe = vm.runInNewContext('(' + evaluatedCallback('coop-natural-building.cjs', 'result') + ')', { window: {
    hostWorld: world, nativeBuildingIncome: { wood: 2, stone: 1, amber: 0 }, polycraft: { async checkpoint(fresh) { assert.equal(fresh, true); events.push('saved'); }, controls: { amounts: () => ({ wood: 264, stone: 69, amber: 95 }) } }
  } });
  const result = await observe({ type: 'Outpost', hero: 'guest', outpost: true });
  assert.deepEqual(events, ['saved']); assert.equal(result.scaffolds.length, 1); assert.equal(result.scaffolds[0].remaining, 1790);
  assert.equal(result.scaffolds[0].cost, 50); assert.equal(result.scaffolds[0].menu, menu); assert.equal(result.scaffolds[0].affordable, true);
  source.getEC = () => null;
  assert.equal((await observe({ type: 'Outpost', hero: 'guest', outpost: true })).scaffolds.length, 0);
});
test('original building lookup excludes unfinished scaffolds unless its includeScaffolds argument is true', () => {
  const native = require('./runtime-ast.cjs'), scaffold = { getBuildCompleteFraction: () => .01 }, entity = { getEC: () => scaffold };
  const manager = { globals: { gameManager: { getEntityFactory: () => ({}) } }, buildings: [{ getBuildingType: () => 'Outpost', getLevel: () => 1, entity }] };
  const find = native.method('getBuildingsAtMinLevel');
  assert.equal(find.call(manager, 'Outpost', 1, false).length, 0);
  assert.equal(find.call(manager, 'Outpost', 1, true)[0], entity);
  scaffold.getBuildCompleteFraction = () => 1;
  assert.equal(find.call(manager, 'Outpost', 1, false)[0], entity);
});
test('Outpost return walks the native route before requiring workshop eligibility or querying its menu', async () => {
  const events = [], stop = new Error('Stop at native eligibility'), m = { exports: {} }; let reads = 0;
  const source = { id: 'workshop', location: [100, 0, 0], existing: 0, menu: null, route: [[0, 0, 0], [1, 0, 0], [100, 0, 0]] };
  const host = { async evaluate() { events.push('lookup'); return source; }, async waitForFunction(_read, id) { assert.equal(id, source.id); events.push('eligibility'); throw stop; } };
  const guest = { async evaluate(_read, args) { events.push('waypoint:' + args.destination[0]); return reads++ === 0 ? { distance: 100, waypointDistance: .1 } : reads === 2 ? { distance: 100, waypointDistance: 10, key: 'd' } : { distance: 4 }; },
    keyboard: { async down(key) { events.push('down:' + key); }, async up(key) { events.push('up:' + key); } }, async waitForTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'coop-natural-building.cjs'), 'utf8'), { module: m, require, console: { log() {} } });
  await assert.rejects(m.exports({ host, guest, outpost: true, focus: async () => events.push('focus') }), error => error === stop);
  assert.deepEqual(events, ['lookup', 'focus', 'waypoint:1', 'waypoint:100', 'down:d', 'up:d', 'waypoint:100', 'eligibility']);
});
test('Outpost footprint search uses native-validated ground at its authored marker instead of the excluded village', () => {
  const actor = { getv3Location: () => [100, .9, 100] }, source = { getv3Location: () => [0, 1, 0] }, hq = { getv3Location: () => [0, 0, 0] };
  const world = { players: { active: new Map([['guest', { hero: actor }]]) }, game: { getGameEntityByName: () => source, getGameSpaceList: () => [{ getEntitiesWithFamilyName: () => [hq] }] },
    construction: { preview(hero, entity, index, location) { assert.equal(hero, actor); assert.equal(entity, source); assert.equal(index, 0); return { preview: { valid: location[0] === 108 && location[2] === 100 } }; } } };
  const locations = vm.runInNewContext('(' + evaluatedCallback('coop-natural-building.cjs', 'locations') + ')', { window: { hostWorld: world } });
  assert.deepEqual(Array.from(locations({ hero: 'guest', source: 'workshop', index: 0, paid: true, marker: [100, .9, 100] }), row => Array.from(row)), [[108, .9, 100]]);
  assert.equal(locations({ hero: 'guest', source: 'workshop', index: 0, paid: true }).length, 0);
});
test('original canPlaceAnywhere never bypasses the inclusive32unit village exclusion for Outposts', () => {
  const native = require('./runtime-ast.cjs'), definition = native.archetypeComponent('a_s_buildRadius', 'ECBuildingPlacementRadius');
  const radius = Object.assign(native.component('ECBuildingPlacementRadius'), { archetype: { square: true, ...definition }, getv3Location: () => [0, 0, 0], _super() {},
    globals: { mathDevice: { v3Sub: (a, b) => a.map((v, i) => v - b[i]), v3Abs: (a, out) => { for (let i = 0; i < 3; i++) out[i] = Math.abs(a[i]); return out; } } } });
  radius.init(null, definition);
  const builder = { gameManager: { getEntitiesWithEC: () => [{ getEC: () => radius }] } }, obeys = native.method('obeysBuildingPlacementRadiusEntities');
  assert.equal(definition.buildingRadius, 32);
  for (const position of [[0, 0, 0], [32, 0, 32], [-32, 0, -32]]) assert.equal(obeys.call(builder, position, false, 'Outpost', true), false);
  assert.equal(obeys.call(builder, [32.01, 0, 0], false, 'Outpost', true), true);
  assert.equal(obeys.call(builder, [0, 0, 0], false, 'HQ', false), true);
});
test('natural tunnel journey refuses completed quests, unlocked movement, another nearby hero or missing navigation before sending input', async () => {
  const guide = require('./coop-natural-guide.cjs');
  const valid = { complete: false, canMove: false, others: [{ distance: 100 }], route: [[0, 0, 0], [10, 0, 10]] };
  for (const invalid of [{ complete: true }, { canMove: true }, { others: [{ distance: 14.99 }] }, { route: null }]) {
    await assert.rejects(guide({ host: { evaluate: async () => ({ ...valid, ...invalid }) }, focus: () => assert.fail('No input before setup admission') }), assert.AssertionError);
  }
});
test('normal tunnel driver re-aims through ordinary input after a stalled partial waypoint instead of waiting forever', async () => {
  const stop = new Error('Second ordinary waypoint click'), m = { exports: {} }; let reads = 0, clicks = 0;
  const setup = { complete: false, canMove: false, others: [{ distance: 100 }], route: [[0, 0, 0], [50, 0, 0]] };
  const host = { async evaluate() { return reads++ === 0 ? setup : { complete: false, position: [5, 0, 0], waypointDistance: 45, moving: true }; } };
  const guest = { locator: () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 100 }) }), mouse: { async move() {} }, async evaluate() { return true; }, async waitForTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'coop-natural-guide.cjs'), 'utf8'), { module: m, console: { log() {} }, require: name => name === './coop-ground-click.cjs' ? async () => { if (++clicks === 2) throw stop; return { location: [6, 0, 0] }; } : require(name) });
  await assert.rejects(m.exports({ host, guest, focus: async () => {} }), error => error === stop);
  assert.equal(clicks, 2); assert.ok(reads <= 12, 'A stalled click must be retried within the bounded normal-input window.');
});
test('natural reward audit forwards native receiver, arguments and result and restores own or inherited award methods', () => {
  for (const own of [false, true]) {
    const calls = [], guest = { getName: () => 'guest' }, original = function (...args) { assert.equal(this, ledger); calls.push(args); return args[0] === 'wake' || args[0] === 'build'; };
    const ledger = Object.assign(Object.create({ award: original }), { data: { pending: [{ id: 'wake', task: 'wakeUpWildling' }, { id: 'build', task: 'buildDefendlingHut' }] }, manager: { taskArchetypes: { wakeUpWildling: { xpReward: 100, amberReward: 1 }, buildDefendlingHut: { xpReward: 20, amberReward: 1 } } } });
    if (own) ledger.award = original;
    const window = { hostWorld: { game: { desktopQuestRewards: ledger, getHero: () => ({ getName: () => 'host' }) } } };
    const observe = vm.runInNewContext('(' + evaluatedCallback('coop-natural-defence.cjs', 'observation') + ')', { window });
    assert.equal(observe(), true); assert.equal(ledger.award('wake'), true); assert.equal(ledger.award('build', guest), true); assert.equal(ledger.award('missing'), false);
    assert.deepEqual(calls, [['wake'], ['build', guest], ['missing']]);
    assert.deepEqual(Array.from(window.naturalDefenceAwards, row => [row.task, row.xp, row.actor, row.explicitHero]), [['wakeUpWildling', 100, 'host', false], ['buildDefendlingHut', 20, 'guest', true]]);
    window.restoreNaturalDefenceAwards(); assert.equal(ledger.award, original); assert.equal(Object.hasOwn(ledger, 'award'), own); assert.equal(window.naturalDefenceAwards, undefined);
  }
});
test('campaign combat staging waits for prior native rewards before retaining its actor and XP baseline', async () => {
  for (const [file, variable] of [['coop-campaign-acceptance.cjs', 'combat'], ['coop-campaign-victory.cjs', 'actor']]) {
    let queued, release;
    const world = { atBoundary() { assert.fail('Campaign staging must wait for pending native rewards.'); }, atRewardBoundary(read) { queued = read; return new Promise(resolve => { release = resolve; }); } };
    const callback = vm.runInNewContext('(' + evaluatedCallback(file, variable) + ')', { window: { polycraft: { controls: { onlineWorld: world } } } });
    const pending = callback({ id: 'enemy', hero: 'guest' });
    assert.equal(typeof queued, 'function'); release('reward-ready'); assert.equal(await pending, 'reward-ready');
  }
});
test('campaign staging skips a victim that disappears, is destroyed or dies before the reward boundary', async () => {
  const callback = evaluatedCallback('coop-campaign-victory.cjs', 'actor');
  for (const enemy of [null, { shouldBeDestroyed: () => true }, { shouldBeDestroyed: () => false, getEC: () => ({ getHealth: () => 0 }) }]) {
    const world = { game: { getGameEntityByName: () => enemy }, atRewardBoundary: read => read(), atBoundary: read => read() };
    const choose = vm.runInNewContext('(' + callback + ')', { window: { polycraft: { controls: { onlineWorld: world } } } });
    assert.equal(await choose({ id: 'enemy', hero: 'guest' }), null);
  }
});
test('campaign post-shot observation resolves a replacement hero by player identity while retaining original kill attribution', () => {
  const current = { getEC: name => name === 'ECFirearm' ? { getAmmo: () => 3 } : { getTargetEntity: () => null }, getName: () => 'replacement-entity' };
  const world = { game: { getGameEntityByName: () => null }, players: { active: new Map([['guest', { hero: current }]]) } };
  const observe = vm.runInNewContext('(' + evaluatedCallback('coop-campaign-victory.cjs', 'attempt') + ')', {
    window: { polycraft: { controls: { onlineWorld: world } }, campaignVictoryKills: [{ victim: 'enemy', aggressor: 'original-entity' }] }
  });
  const result = observe({ id: 'enemy', actor: 'original-entity', hero: 'guest' });
  assert.equal(result.killed, true); assert.equal(result.ammo, 3); assert.equal(result.target, undefined);
});
function fixture() {
  const events = [], guest = { async waitForFunction() { events.push('next-task'); } };
  const button = async id => events.push('collect:' + id);
  return { events, guest, button, require: name => async args => {
    if (name.endsWith('coop-natural-deposit.cjs')) events.push('deposit:' + (args.resource ?? 0));
    else if (name.endsWith('coop-natural-resources.cjs')) events.push('gather:' + Number(args.stone));
    else if (name.endsWith('coop-native-pause.cjs')) events.push('native-pause');
    else if (name.endsWith('coop-natural-workers.cjs')) events.push('worker-productivity');
    else if (name.endsWith('coop-natural-building.cjs')) events.push('build:' + (args.worker || (args.stonemill ? 'stonemill' : 'lumbermill')));
    else assert.fail('Unexpected gameplay helper: ' + name);
  } };
}
test('natural wood progression collects its original reward before click navigation and building', async () => {
  const f = fixture();
  await vm.runInNewContext(block('coop-identities-smoke.cjs', test => test.name === 'naturalLumbermill'), { require: f.require, controls: { button: f.button, guest: f.guest } });
  assert.deepEqual(f.events, ['collect:guest-idAcceptTaskRewardButtontaskIdcrit_6', 'next-task', 'deposit:0', 'build:lumbermill']);
});
test('recovered stone and combined worker progression clear each completed reward before its deposit', async () => {
  const f = fixture(), host = { async waitForFunction() { f.events.push('workers-spawned'); } };
  const context = { assert, require: f.require, stone: true, host, guest: f.guest, guests: [{ page: f.guest }], applications: [{}], focusGuest() {}, focus() {}, focusHost() {}, button: f.button,
    expected: { coop: { players: [{}, { id: 'assigned' }] } }, file: 'disposable/saves/island.json', process: { argv: ['--stonemill', '--workers'] }, console: { log() {} } };
  await vm.runInNewContext(block('coop-recovered-party.cjs', test => test.type === 'CallExpression' && test.callee.property?.name === 'includes' && test.arguments[0]?.value === '--stonemill'), context);
  const stone = 'collect:guest-idAcceptTaskRewardButtontaskIdcrit_8', combined = 'collect:guest-idAcceptTaskRewardButtontaskIdcrit_10';
  assert.ok(f.events.indexOf(stone) < f.events.indexOf('deposit:1'), JSON.stringify(f.events));
  assert.ok(f.events.indexOf('gather:1') < f.events.indexOf(combined), JSON.stringify(f.events));
  assert.ok(f.events.indexOf(combined) < f.events.lastIndexOf('deposit:1'), JSON.stringify(f.events));
  assert.equal(f.events.filter(event => event === stone).length, 1); assert.equal(f.events.filter(event => event === combined).length, 1);
  assert.ok(f.events.indexOf('deposit:0') < f.events.indexOf(combined), 'The incomplete combined wood phase has no reward to collect.');
  assert.deepEqual(f.events.slice(-8), ['next-task', 'build:lumber', 'collect:guest-idAcceptTaskRewardButtontaskIdcrit_11', 'next-task', 'build:stone', 'workers-spawned', 'worker-productivity', 'native-pause']);
});

function finalSaveFixture({ inherited = false, delayed = false, timeout = false } = {}) {
  const state = { userData: { desktopCoop: '{}' } }, bridge = {}, w = { polycraft: {} };
  let releaseOriginal;
  const originalGate = delayed ? new Promise(resolve => { releaseOriginal = resolve; }) : Promise.resolve();
  const checkpoint = async function (value) { assert.equal(this, w.polycraft.controls); assert.equal(value, bridge); await originalGate; return state; };
  w.polycraft.controls = inherited ? Object.create({ checkpoint }) : { checkpoint };
  w.hostWorld = { finalUpdate: true, close: () => w.polycraft.controls.checkpoint(bridge) };
  const context = vm.createContext({ window: w, assert, stageReward: async () => ({ pending: true }) });
  const host = {
    async evaluate(callback) { return vm.runInContext('(' + callback.toString() + ')()', context); },
    async waitForFunction(callback) {
      if (timeout) throw new Error('Temporary observation timeout');
      for (let i = 0; i < 5; i++) { if (await this.evaluate(callback)) return; await new Promise(resolve => setImmediate(resolve)); }
      assert.fail('The final acknowledgement gate did not arm.');
    }
  };
  const source = parse(fs.readFileSync(path.join(__dirname, 'coop-reward-transitions.cjs'), 'utf8'));
  for (const name of ['holdFinalSave', 'finalSaveRecovery']) {
    const node = source.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name); assert.ok(node);
    vm.runInContext(generate(node).code, context);
  }
  return { w, state, checkpoint, host, context, releaseOriginal };
}
for (const reject of [false, true]) test('native final-save observer preserves method ownership and supports held acknowledgement reject=' + reject, async () => {
  const f = finalSaveFixture({ inherited: reject });
  await f.context.holdFinalSave(f.host);
  assert.equal(f.w.failedFinalCapture, f.state); assert.equal(f.w.finalCloseResult, null);
  if (reject) f.w.rejectFinalCapture(); else f.w.resolveFinalCapture();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.w.finalCloseResult, reject ? 'Temporary final-save acknowledgement failure.' : 'success');
  f.w.restoreFinalCheckpoint(); assert.equal(f.w.polycraft.controls.checkpoint, f.checkpoint);
  assert.equal(Object.hasOwn(f.w.polycraft.controls, 'checkpoint'), !reject);
});
test('timed-out native final-save observation restores its hook and cannot arm an orphaned gate after capture completes later', async () => {
  const f = finalSaveFixture({ delayed: true, timeout: true, inherited: true });
  await assert.rejects(f.context.finalSaveRecovery({ host: f.host, guests: [], focusGuest: async () => {} }), /Temporary observation timeout/);
  assert.equal(f.w.polycraft.controls.checkpoint, f.checkpoint); assert.equal(Object.hasOwn(f.w.polycraft.controls, 'checkpoint'), false);
  f.releaseOriginal(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.w.finalCloseResult, 'Temporary final-save observer cancelled.'); assert.equal(f.w.rejectFinalCapture, null);
});
test('reward-sensitive hosting waits for the original solo quest XP and its owned callbacks before rebinding', () => {
  const callbacks = [];
  traverse(parse(fs.readFileSync(path.join(__dirname, 'coop-worker-acknowledgement.cjs'), 'utf8')), { IfStatement(p) {
    let condition = p.node.test;
    while (condition.type === 'LogicalExpression') condition = condition.left;
    if (condition.type !== 'CallExpression' || condition.arguments[0]?.value !== '--health-item-transitions' || p.node.consequent.type !== 'BlockStatement') return;
    const statement = p.node.consequent.body.find(row => row.expression?.argument?.callee?.property?.name === 'waitForFunction');
    if (!statement) return;
    assert.equal(statement.expression.type, 'AwaitExpression');
    callbacks.push(statement.expression.argument.arguments[0]);
  } });
  assert.equal(callbacks.length, 1);
  const actor = {}, state = { xp: 24, pending: false };
  const game = { getPlayerData: () => ({ getXP: () => state.xp }), getTaskManager: () => ({ taskArchetypes: { buildStonelingHut: { xpReward: 25 } } }), getHero: () => actor };
  const ready = vm.runInNewContext('(' + generate(callbacks[0]).code + ')', { window: { polycraft: { controls: { manager: () => game } },
    PolycraftCoopPlayers: { CoopPlayers: { hasPendingRewards(current, hero) { assert.equal(current, game); assert.equal(hero, actor); return state.pending; } } } } });
  assert.equal(ready(), false); state.xp = 25; state.pending = true; assert.equal(ready(), false); state.pending = false; assert.equal(ready(), true);
});
test('worker hosting forwards its explicit PvP option into an immutable native session before hero binding', async () => {
  const callbacks = [];
  traverse(parse(fs.readFileSync(path.join(__dirname, 'coop-worker-acknowledgement.cjs'), 'utf8')), { AssignmentExpression(p) {
    if (p.node.left.object?.name === 'window' && p.node.left.property?.name === 'hostSession') callbacks.push(p.findParent(parent => parent.isArrowFunctionExpression()).node);
  } });
  assert.equal(callbacks.length, 1);
  for (const pvp of [false, true]) {
    const w = { PolycraftMultiplayer: require('../desktop/multiplayer.js'), polycraft: { controls: {}, bridge: {} },
      PolycraftOnlineWorld: { async startHostingWorld() { return {}; } } };
    await vm.runInNewContext('(' + generate(callbacks[0]).code + ')', { window: w })(pvp);
    assert.equal(w.hostSession.pvp, pvp); assert.equal(Object.getOwnPropertyDescriptor(w.hostSession, 'pvp').writable, false); w.hostSession.close();
  }
});
test('PvP firing-lane muzzle math matches original firing with scaled and tilted mesh axes', () => {
  const expressions = [];
  traverse(parse(fs.readFileSync(path.join(__dirname, 'coop-pvp-life.cjs'), 'utf8')), { VariableDeclarator(p) { if (p.node.id.name === 'muzzleOffset') expressions.push(p.node.init); } });
  assert.equal(expressions.length, 1);
  const fire = require('./runtime-ast.cjs').method('fireAtLocation');
  for (const axes of [[[1.25, 0, 0], [0, 1.25, 0], [0, 0, 1.25]], [[0, 0, 2], [.3, 1.2, 0], [-1.5, .2, 0]]]) {
    const offset = [.4, -.25, -.4], capsule = [1, 2, 3]; let origin;
    const computed = vm.runInNewContext('(' + generate(expressions[0]).code + ')', { axes, offset });
    const mesh = { getX: () => axes[0], getY: () => axes[1], getZ: () => axes[2] };
    const firearm = { globals: { mathDevice: { v3Copy: a => [...a], v3AddScalarMul: (a, b, scale, out) => { for (let i = 0; i < 3; i++) out[i] = a[i] + b[i] * scale; return out; } } },
      entity: { isManagedByThisMachine: () => true }, getEntityEC: name => name === 'ECMesh' ? mesh : { getv3CapsuleTopLocation: () => capsule },
      hasShootOffset: true, archetype: { shootOffset: offset }, getProjectilesPerShot: () => 1, getMaxRandomSpreadAngle: () => 0,
      createProjectiles: (_type, _count, _target, _direction, muzzle) => { origin = muzzle; }, playFire() {}, playFireEffect() {}, beginRechamber() {}, ammo: 2, temporaryWeaponAmmo: 0 };
    fire.call(firearm, [5, 2, 3], [1, 0, 0]);
    assert.ok(origin.every((value, i) => Math.abs(value - capsule[i] - computed[i]) < 1e-12));
    assert.notDeepEqual(Array.from(computed), offset);
  }
});
test('native revive observer forwards the original receiver, arguments and result and records exact resource changes', () => {
  const observers = [];
  traverse(parse(fs.readFileSync(path.join(__dirname, 'coop-pvp-life.cjs'), 'utf8')), { AssignmentExpression(p) {
    if (p.node.left.object?.name === 'life' && p.node.left.property?.name === 'payToRevive' && p.node.right.type === 'FunctionExpression') observers.push(p.node.right);
  } });
  assert.equal(observers.length, 1);
  for (const result of [true, false]) {
    const data = { amber: 11, wood: 132, getSoftCurrency() { return this.amber; }, getResource() { return this.wood; } }, trace = { payments: [] }, calls = [];
    const life = { getTimeToRespawn: () => .2 }, args = [0, 50, false];
    const observe = vm.runInNewContext('(' + generate(observers[0]).code + ')', { trace, game: { getPlayerData: () => data }, sample: () => ({ amber: data.amber, wood: data.wood }),
      pay(...values) { assert.equal(this, life); calls.push(values); if (result) data.wood -= values[1]; return result; } });
    assert.equal(observe.apply(life, args), result); assert.deepEqual(calls, [args]); assert.equal(trace.payments.length, 1);
    assert.equal(trace.payments[0].result, result); assert.equal(trace.payments[0].before.wood, 132); assert.equal(trace.payments[0].after.wood, result ? 82 : 132);
    assert.equal(trace.payments[0].after.amber, 11);
  }
});
test('original GUI can retain Amber animation metadata while actually rendering current lumber artwork and price', () => {
  const draws = [], entry = { archetypeName: 'respawnButtonAmber', argumentObject: {}, scale: 1 };
  const gui = { prevDrawGuiMap: { 'guest-revive': entry }, drawGuiMap: {}, globals: { guiRenderer: { begin() {}, end() {}, render: (name, args) => draws.push({ name, price: args.text2 }) } } };
  require('./runtime-ast.cjs').method('drawGui').call(gui, 'respawnButtonLumber', { text2: '50' }, 'guest-revive');
  assert.deepEqual(draws, [{ name: 'respawnButtonLumber', price: '50' }]);
  assert.equal(gui.drawGuiMap['guest-revive'].archetypeName, 'respawnButtonAmber');
  assert.equal(gui.drawGuiMap['guest-revive'].argumentObject.text2, '50');
});
function soloRewardFixture(t) {
  const prior = { window: global.window, document: global.document }, state = { xp: 0, pending: false }, events = [];
  t.after(() => { for (const key of ['window', 'document']) { if (prior[key] === undefined) delete global[key]; else global[key] = prior[key]; } });
  const pickup = { shouldBeDestroyed: () => false, getEC: () => ({ xp: 20, getCollectorName: () => undefined }), getName: () => 'original-reward', getv3Location: () => [2, 0, 0] };
  const game = { getHero: () => ({ getv3Location: () => [0, 0, 0] }), getPlayerData: () => ({ getXP: () => state.xp }), getTaskManager: () => ({ taskArchetypes: { buildStonelingHut: { xpReward: 20 } } }),
    getGameSpaceList: () => [{ getEntitiesWithEC: () => [pickup] }],
    getGameController: () => ({ isActive: () => true }), getIMGui: () => ({ hasCapturedInput: () => false }) };
  global.window = { polycraft: { controls: { manager: () => game, app: { globals: { camera: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] } } } } }, desktop: { windowFocused: async () => true }, PolycraftCoopPlayers: { CoopPlayers: { hasPendingRewards: () => state.pending } } };
  global.document = { hasFocus: () => true };
  const page = { locator: () => ({ boundingBox: async () => ({ x: 10, y: 20, width: 800, height: 600 }) }), mouse: { move: async (...args) => events.push(['pointer', ...args]) },
    evaluate: async callback => callback(), waitForFunction: async (callback, _arg, options) => { assert.equal(options.timeout, 5000); assert.equal(await callback(), true); },
    keyboard: { down: async key => events.push(['down', key]), up: async key => { events.push(['up', key]); state.xp = 20; } },
    waitForTimeout: async () => { if (state.failure) throw state.failure; } };
  return { state, events, page, focus: async () => events.push(['focus']) };
}
test('solo quest readiness approaches an unclaimed original reward with normal camera-relative keyboard input', async t => {
  const f = soloRewardFixture(t); await require('./solo-quest-reward.cjs')(f);
  assert.deepEqual(f.events.filter(row => ['down', 'up'].includes(row[0])), [['down', 'd'], ['up', 'd']]);
  assert.equal(f.state.xp, 20);
});
test('already settled or incoming solo quest XP needs no extra movement before the original readiness guard', async t => {
  const f = soloRewardFixture(t);
  for (const state of [{ xp: 20, pending: false }, { xp: 0, pending: true }]) {
    Object.assign(f.state, state); await require('./solo-quest-reward.cjs')(f);
  }
  assert.ok(!f.events.some(row => row[0] === 'down'));
});
test('failed normal solo quest approach releases held keys and preserves the original failure', async t => {
  const f = soloRewardFixture(t), failure = f.state.failure = new Error('Interrupted ordinary movement');
  await assert.rejects(require('./solo-quest-reward.cjs')(f), error => error === failure);
  assert.deepEqual(f.events.filter(row => ['down', 'up'].includes(row[0])), [['down', 'd'], ['up', 'd']]);
});
test('rejoin readiness separates normal, waiting and dying guests without weakening movement or phase checks', async () => {
  const { waitForGuestReady } = require('./coop-worker-acknowledgement.cjs'); let callback;
  await waitForGuestReady({ async waitForFunction(read) { callback = read; } }, 'normal', () => { throw new Error('Unexpected refocus'); });
  const state = { hud: { state: {} }, lifeState: { phase: 'waiting' }, movement: { available: () => false } };
  const ready = vm.runInNewContext('(' + callback.toString() + ')', { window: { guestWorld: state } });
  assert.equal(ready('waiting'), true); assert.equal(ready('dying'), true); assert.equal(ready('normal'), false);
  state.lifeState.phase = 'dying'; assert.equal(ready('waiting'), false); assert.equal(ready('dying'), true); assert.equal(ready('normal'), false);
  state.movement.available = () => true; assert.equal(ready('waiting'), false); assert.equal(ready('dying'), false); assert.equal(ready('normal'), true);
  state.lifeState.phase = 'normal'; state.movement.available = () => false; assert.equal(ready('waiting'), false); assert.equal(ready('dying'), false);
  state.lifeState.phase = 'unknown'; assert.equal(ready('unknown'), false);
  state.hud.state = null; state.movement.available = () => true; assert.ok(!ready('normal'));
});
test('dying departure arms its observer before the normal attack callback and closes only after the native dying sample', async () => {
  const events = [], stop = new Error('Stop at the real disconnect boundary'); let reads = 0;
  const host = { async evaluate() {
    switch (reads++) {
      case 0: events.push('armed'); return { actor: { health: 50, life: { phase: 'normal' } } };
      case 1: events.push('sample'); return { actor: { health: 0, life: { phase: 'dying', remaining: .8 } } };
      case 2: events.push('damage'); return { projectiles: [{ archetype: 'pj_h_pistol_weak' }], hits: [{ amount: 90, after: 0 }], deaths: [{ state: 1, expected: 1 }] };
    }
  }, async waitForFunction() { events.push('wait-dying'); } };
  const guest = { async evaluate() { events.push('close'); throw stop; } }, m = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'coop-death-rejoin.cjs'), 'utf8'), { module: m, require, console: { log() {} } });
  await assert.rejects(m.exports({ host, guest, before: { health: 50 }, attack: async () => events.push('attack') }), error => error === stop);
  assert.deepEqual(events, ['armed', 'attack', 'wait-dying', 'sample', 'damage', 'close']);
});
test('natural gear observation waits for a reward-ready boundary before any live hero capture', async () => {
  let captureCount = 0, readLater, ready = false;
  const players = { active: new Map(Array.from({ length: 4 }, (_, id) => [id, { hero: { getEC: () => ({ hasWeapon: () => true }) } }])),
    registry: { player: id => ({ name: String(id) }) }, captureHero() { assert.equal(ready, true); captureCount++; return { inventory: { weapon: 'starter', mainWeapon: 'starter' } }; } };
  const world = { players, atRewardBoundary(read) { return new Promise(resolve => { readLater = () => { ready = true; resolve(read()); }; }); } };
  const host = { async evaluate(callback) { return vm.runInNewContext('(' + callback.toString() + ')()', { window: { hostWorld: world } }); } };
  const m = { exports: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'coop-natural-gear.cjs'), 'utf8'), { module: m, require, console: { log() {} } });
  const pending = m.exports({ host }).before();
  assert.equal(captureCount, 0); assert.equal(typeof readLater, 'function');
  readLater(); await pending; assert.equal(captureCount, 4);
});
test('natural reward/combat observations wait and re-resolve actors after checkpoint-driven replacement', async () => {
  for (const [file, variable, final] of [['coop-natural-weapon.cjs', 'target', false], ['coop-natural-crate.cjs', 'target', false], ['coop-natural-weapon.cjs', 'after', true], ['coop-natural-bandits.cjs', 'result', true]]) {
    const callbacks = [];
    traverse(parse(fs.readFileSync(path.join(__dirname, file), 'utf8')), { VariableDeclarator(p) {
      const call = p.node.init?.type === 'AwaitExpression' && p.node.init.argument;
      if (p.node.id.name === variable && call?.type === 'CallExpression' && call.callee.object?.name === 'host' && call.callee.property?.name === 'evaluate') callbacks.push(call.arguments[0]);
    } });
    assert.equal(callbacks.length, 1, file + ':' + variable);
    let captures = 0, readLater, ready = false;
    const actor = name => ({ name, getv3Location: () => [0, 0, 0], getEC: () => ({ getHealth: () => 42 }) }), old = actor('old'), replacement = actor('replacement');
    const actions = { ApplyDamageToEntity() {} }, factory = { createProjectile() {} };
    const target = { getName: () => 'target', getFamilyName: () => file.includes('weapon') ? 'tutorialgun' : 'tutorialcrate', getv3Location: () => [1, 0, 0], getDistanceUsingSize: () => 1,
      getEC: name => name === 'ECPickup' ? { item: 'starter', archetype: { attractRadius: 6 } } : name === 'ECHealth' ? { getHealth: () => 50 } : {} };
    const world = { players: { active: new Map([['guest', { hero: old }]]), canDamage: () => true,
      captureHero(current) { assert.equal(ready, true); assert.equal(current, replacement); captures++; return { inventory: { weapon: 'replacement' } }; } },
      game: { runScripts: true, getGameSpaceList: () => [{ getEntitiesWithEC: () => [target] }], getProjectileFactory: () => factory, actionManager: { actionFunctionMap: actions }, getGameEntityByName: () => null,
        getPlayerData: () => ({ getTaskFlags: () => ({ defeatWildlings: true, pickupWeapon: true }) }) },
      atRewardBoundary(read) { return new Promise(resolve => { readLater = () => { ready = true; resolve(read()); }; }); } };
    const w = { hostWorld: world, naturalBanditKills: [], polycraft: { bridge: { state: { userData: { desktopCoop: JSON.stringify({ players: [{ id: 'guest', inventory: { weapon: 'replacement' } }] }) } } },
      async checkpoint(fresh) { assert.equal(fresh, true); world.players.active.set('guest', { hero: replacement }); } } };
    const callback = vm.runInNewContext('(' + generate(callbacks[0]).code + ')', { window: w });
    const pending = callback(file.includes('weapon') && final ? { hero: 'guest', target: 'target' } : 'guest');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(captures, 0); assert.equal(typeof readLater, 'function'); world.players.active.set('guest', { hero: replacement });
    readLater(); const result = await pending; assert.equal(captures, 1);
    assert.equal((result.before || result.weapon || result.inventory).weapon, 'replacement');
    w.restoreNaturalCrateObserver?.();
  }
});
