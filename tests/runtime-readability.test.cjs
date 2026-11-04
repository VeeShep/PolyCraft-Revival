'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { nameInputControllers } = require('../scripts/name-input-controllers.cjs');
const { nameDataModels } = require('../scripts/name-data-models.cjs');
const source = `(function () {
  function a() {} function b() {}
  function shadow(a) { return a; }
  b.create = function () { var value = new b(); value.a = 'a'; return value; };
  a.create = function () { var value = new a(); value.controllerActionA = b.create(); value.controllerActionB = b.create(); return value; };
  var game = {}; game.gameController = a.create();
  globalThis.result = { publicKey: game.gameController.controllerActionA.a, second: game.gameController.controllerActionB.a, shadow: shadow('original'), asset: 'assets/a.dds' };
})();`;
test('scope-aware controller naming preserves public keys, assets, shadowed locals and execution behavior', () => {
  const result = nameInputControllers(source), before = {}, after = {};
  vm.runInNewContext(source, before); vm.runInNewContext(result.output, after);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result));
  assert.match(result.output, /function GameInputController/); assert.match(result.output, /function HeroControllerAction/); assert.match(result.output, /function shadow\(a\)/);
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['a', 'GameInputController', true], ['b', 'HeroControllerAction', true]]);
  assert.equal(result.output.split('\n').length, source.split('\n').length, 'unrelated formatting stays unchanged');
  assert.match(result.proof, /canonical input/); assert.notEqual(result.inputSHA256, result.outputSHA256);
  assert.throws(() => nameInputControllers(result.output), /already named/);
});
const dataSource = `(function () {
  function a() { this.xp = 0; }
  a.prototype = { saveProgress: function () { this.xp += 3; return this.xp; }, saveHeroUpgrades: function () { return 'heroUpgrades'; } };
  a.create = function () { return new a(); };
  function b() { this.tasks = []; }
  b.prototype = { saveCompletedTasks: function (task) { this.tasks.push(task); }, giveTaskReward: function () { return this.tasks.slice(); } };
  b.create = function () { return new b(); };
  function c() { this.victory = false; }
  c.prototype = { getCampaignScoreInfo: function () { return this.victory; }, onCampaignEnded: function () { this.victory = true; } };
  c.create = function () { return new c(); };
  var game = {};
  game.playerData = a.create(); game.taskManager = b.create(); game.scoreInfo = c.create();
  function shadow(a) { return a; }
  game.playerData.saveProgress(); game.taskManager.saveCompletedTasks('taskIdcrit_1'); game.scoreInfo.onCampaignEnded();
  globalThis.result = { keys: Object.keys(game), xp: game.playerData.saveProgress(), upgrades: game.playerData.saveHeroUpgrades(), tasks: game.taskManager.giveTaskReward(), victory: game.scoreInfo.getCampaignScoreInfo(), shadow: shadow('a') };
})();`;
test('data-model naming preserves native progression/task/score methods and public data keys with inverse proof', () => {
  const result = nameDataModels(dataSource), before = {}, after = {};
  vm.runInNewContext(dataSource, before); vm.runInNewContext(result.output, after);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['a', 'PlayerDataModel', true], ['b', 'QuestTaskManager', true], ['c', 'CampaignScoreInfo', true]]);
  assert.match(result.proof, /canonical input/); assert.match(result.output, /function shadow\(a\)/);
  assert.equal(result.output.split('\n').length, dataSource.split('\n').length);
  assert.throws(() => nameDataModels(result.output), /already named/);
});
test('data-model naming refuses ambiguous factories, missing native methods, captured names and global bindings', () => {
  for (const source of [
    dataSource.replace('game.playerData = a.create();', ''),
    dataSource.replace('game.playerData = a.create();', 'game.playerData = a.create(); game.playerData = a.create();'),
    dataSource.replace('game.scoreInfo = c.create();', 'game.scoreInfo = b.create();'),
    dataSource.replace('saveHeroUpgrades: function', 'unrelated: function'),
    dataSource.replace('function shadow(a)', 'function nested() { var PlayerDataModel = 1; return new a(); } function shadow(a)'),
    dataSource.replace('function shadow(a)', 'a = function () {}; function shadow(a)'),
    dataSource.replace('(function () {', '').replace('})();', '')
  ]) assert.throws(() => nameDataModels(source), /factory|native data|Generated syntax|Changes beyond|Reassigned|private/);
});
test('data-model CLI records its proof without changing immutable baseline or earlier naming passes', t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-data-names-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable baseline'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json');
  fs.writeFileSync(path.join(folder, 'reference/beta-1/game.canvas.js'), baseline); fs.writeFileSync(runtime, dataSource);
  const oldPass = { id: 'previous', inputSHA256: 'preserved' };
  fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [oldPass] }));
  const run = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/name-data-models.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = run(); assert.equal(first.status, 0, first.stderr);
  const output = fs.readFileSync(runtime, 'utf8'), manifestText = fs.readFileSync(report, 'utf8'), manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.passes[0], oldPass); assert.equal(manifest.passes[1].id, 'data-model-role-names'); assert.equal(manifest.passes[1].names.length, 3);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'reference/beta-1/game.canvas.js')), baseline);
  assert.notEqual(run().status, 0); assert.equal(fs.readFileSync(runtime, 'utf8'), output); assert.equal(fs.readFileSync(report, 'utf8'), manifestText);
});
test('controller naming refuses ambiguous factories, reassignment and destination-name collisions', () => {
  for (const invalid of [source.replace('value.controllerActionB = b.create()', 'value.controllerActionB = a.create()'), source.replace('var game = {};', 'b = function () {}; var game = {};'), source.replace('var game = {};', 'var GameInputController = 1; var game = {};'), source.replace('var game = {};', 'globalThis.publicValue = GameInputController; var game = {};'), source.replace('game.gameController = a.create();', 'game.gameController = a.create(); game.gameController = a.create();')]) assert.throws(() => nameInputControllers(invalid), /constructor|factory|Conflicting/);
});
test('reverse proof rejects a rename that would capture a reference inside a child scope', () => {
  const invalid = source.replace('var game = {};', 'function nested() { var GameInputController = 1; return a.create(); } var game = {};');
  assert.throws(() => nameInputControllers(invalid), /Conflicting|Changes beyond/);
});
test('the naming command preserves baseline bytes and existing reports and refuses repeat or damaged-baseline runs', t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-readable-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable baseline'), baselinePath = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json');
  fs.writeFileSync(baselinePath, baseline); fs.writeFileSync(runtime, source);
  fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), formattedSHA256: 'original-format-checkpoint', names: [{ original: 'old', name: 'ExistingVerifiedName' }] }));
  const run = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/name-input-controllers.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = run(); assert.equal(first.status, 0, first.stderr); assert.deepEqual(fs.readFileSync(baselinePath), baseline);
  const output = fs.readFileSync(runtime, 'utf8'), manifestText = fs.readFileSync(report, 'utf8'), manifest = JSON.parse(manifestText);
  assert.equal(manifest.formattedSHA256, 'original-format-checkpoint'); assert.deepEqual(manifest.names, [{ original: 'old', name: 'ExistingVerifiedName' }]); assert.equal(manifest.passes[0].names.length, 2);
  const repeated = run(); assert.notEqual(repeated.status, 0); assert.match(repeated.stderr, /already recorded/); assert.equal(fs.readFileSync(runtime, 'utf8'), output); assert.equal(fs.readFileSync(report, 'utf8'), manifestText);
  fs.writeFileSync(baselinePath, 'damaged test fixture'); const damaged = run(); assert.notEqual(damaged.status, 0); assert.match(damaged.stderr, /Immutable Beta 1 baseline changed/); assert.equal(fs.readFileSync(runtime, 'utf8'), output); assert.equal(fs.readFileSync(report, 'utf8'), manifestText);
});
const { namePlayStates } = require('../scripts/name-play-states.cjs');
const playSource = `(function () {
  function Base() {}
  Base.prototype.playStateCreationMap = {};
  Base.extend = function (definition) { function State() {} State.prototype = definition; return State; };
  var a = Base.extend({ playStateName: 'PlayStateBattle', asset: 'assets/a.dds' });
  a.create = function () { return new a(); };
  Base.prototype.playStateCreationMap[a.prototype.playStateName] = a;
  var b = Base.extend({ playStateName: 'PlayStateNormal', a: 'a' });
  b.create = function () { return new b(); };
  Base.prototype.playStateCreationMap[b.prototype.playStateName] = b;
  var c = Base.extend({ playStateName: 'PlayStatePrepareForBattle' });
  c.create = function () { return new c(); };
  Base.prototype.playStateCreationMap[c.prototype.playStateName] = c;
  function shadow(a) { return a; }
  globalThis.result = { states: Object.keys(Base.prototype.playStateCreationMap).map(function (name) { return Base.prototype.playStateCreationMap[name].create().playStateName; }), key: b.create().a, shadow: shadow('original'), asset: a.create().asset };
})();`;
test('literal play-state naming preserves factory lookup, public properties, assets and shadowed locals with inverse proof', () => {
  const result = namePlayStates(playSource), before = {}, after = {};
  vm.runInNewContext(playSource, before); vm.runInNewContext(result.output, after);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['a', 'PlayStateBattle', false], ['b', 'PlayStateNormal', false], ['c', 'PlayStatePrepareForBattle', false]]);
  assert.equal(result.output.split('\n').length, playSource.split('\n').length); assert.match(result.output, /function shadow\(a\)/);
  assert.match(result.proof, /canonical input/); assert.throws(() => namePlayStates(result.output), /already named/);
});
test('play-state naming rejects missing/duplicate labels, mismatched registrations, reassignment and captured names', () => {
  for (const source of [
    playSource.replace("playStateName: 'PlayStateNormal'", "playStateName: 'PlayStateBattle'"),
    playSource.replace('Base.prototype.playStateCreationMap[b.prototype.playStateName] = b;', ''),
    playSource.replace('Base.prototype.playStateCreationMap[b.prototype.playStateName] = b;', 'Base.prototype.playStateCreationMap[a.prototype.playStateName] = b;'),
    playSource.replace('function shadow(a)', 'a = function () {}; function shadow(a)'),
    playSource.replace('function shadow(a)', 'var PlayStateBattle = 1; function shadow(a)'),
    playSource.replace('function shadow(a)', 'globalThis.external = PlayStateBattle; function shadow(a)'),
    playSource.replace('function shadow(a)', 'function nested() { var PlayStateBattle = 1; return a.create(); } function shadow(a)'),
    playSource.replace('function shadow(a)', 'globalThis.publicObject = { a }; function shadow(a)'),
    playSource.replace('function shadow(a)', 'eval("a.create()"); function shadow(a)'),
    playSource.replace('function shadow(a)', 'with (globalThis) { a.create(); } function shadow(a)'),
    playSource.replace('(function () {', '').replace('})();', '')
  ]) assert.throws(() => namePlayStates(source), /constructor|registration|Conflicting|Changes beyond|Generated syntax|Dynamic|private/);
});
test('play-state CLI preserves baseline and earlier reports and refuses a repeated or damaged-baseline pass', t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-play-names-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable baseline'), baselinePath = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json');
  fs.writeFileSync(baselinePath, baseline); fs.writeFileSync(runtime, playSource);
  const oldPass = { id: 'previous', inputSHA256: 'preserved' };
  fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), names: [{ name: 'ExistingVerifiedName' }], passes: [oldPass] }));
  const run = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/name-play-states.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = run(); assert.equal(first.status, 0, first.stderr); assert.deepEqual(fs.readFileSync(baselinePath), baseline);
  const output = fs.readFileSync(runtime, 'utf8'), manifestText = fs.readFileSync(report, 'utf8'), manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.passes[0], oldPass); assert.deepEqual(manifest.names, [{ name: 'ExistingVerifiedName' }]); assert.equal(manifest.passes[1].names.length, 3);
  assert.notEqual(run().status, 0); assert.equal(fs.readFileSync(runtime, 'utf8'), output); assert.equal(fs.readFileSync(report, 'utf8'), manifestText);
  fs.writeFileSync(baselinePath, 'damaged'); const damaged = run(); assert.notEqual(damaged.status, 0); assert.match(damaged.stderr, /Immutable Beta 1 baseline changed/);
  assert.equal(fs.readFileSync(runtime, 'utf8'), output); assert.equal(fs.readFileSync(report, 'utf8'), manifestText);
});
