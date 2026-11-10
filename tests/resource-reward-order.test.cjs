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
