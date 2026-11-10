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
test('rejoin readiness separates normal, waiting and dying guests without weakening movement or phase checks', () => {
  const callbacks = [];
  traverse(parse(fs.readFileSync(path.join(__dirname, 'coop-worker-acknowledgement.cjs'), 'utf8')), { CallExpression(p) {
    if (p.node.callee.property?.name === 'waitForFunction' && p.node.arguments[0]?.params?.[0]?.name === 'phase') callbacks.push(p.node.arguments[0]);
  } });
  assert.equal(callbacks.length, 1);
  const state = { hud: { state: {} }, lifeState: { phase: 'waiting' }, movement: { available: () => false } };
  const ready = vm.runInNewContext('(' + generate(callbacks[0]).code + ')', { window: { guestWorld: state } });
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
