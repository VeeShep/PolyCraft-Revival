'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { nameInputControllers } = require('../scripts/name-input-controllers.cjs');
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
