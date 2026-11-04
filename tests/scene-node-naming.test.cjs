'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
const { nameSceneNode } = require('../scripts/name-scene-node.cjs');
const upstream = fs.readFileSync(path.join(__dirname, '../reference/turbulenz-2cd2857/scenenode.js'), 'utf8');
const ast = parse(upstream);
traverse(ast, {
  Program(p) { p.scope.rename('SceneNode', 'ReferenceNode'); },
  FunctionDeclaration(p) { if (p.node.id.name === 'SceneNode') p.scope.parent.rename('SceneNode', 'nodeCtor'); }
});
const fixture = generate(ast).code;
function run(source) {
  const context = { TurbulenzEngine: { getMathDevice: () => ({ m43BuildIdentity: () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }) } };
  vm.runInNewContext(source + `
    var node = ReferenceNode.create({ name: 'island', disabled: true });
    node.customLocalExtents = [0, 0, 0, 1, 1, 1]; node.customWorldExtents = [1, 1, 1, 2, 2, 2]; node.lightInstances = [{}];
    node.updateRequired = function () { this.required = true; }; node.childNeedsUpdateCount = 0; node.childNeedsUpdate();
    globalThis.result = { name: node.getName(), parent: node.getParent(), disabled: node.getDisabled(), local: node.getCustomLocalExtents(), world: node.getCustomWorldExtents(), light: node.hasLightInstances(), required: node.required, count: node.childNeedsUpdateCount, publicMethods: Object.keys(ReferenceNode.prototype).sort() };`, context);
  return JSON.stringify(context.result);
}
test('pinned SceneNode matching preserves constructor, seven verified methods and all public method names with inverse proof', () => {
  const result = nameSceneNode(fixture);
  assert.equal(run(result.output), run(fixture));
  assert.equal(result.names.length, 1); assert.equal(result.names[0].original, 'nodeCtor'); assert.equal(result.names[0].name, 'SceneNode');
  assert.equal(result.names[0].descriptive, false); assert.equal(result.names[0].matchingMethods.length, 7);
  assert.match(result.names[0].evidence, /57 matching/); assert.match(result.proof, /canonical input/);
  assert.throws(() => nameSceneNode(result.output), /already named/);
});
test('SceneNode naming refuses incomplete/duplicate inventories, different verified bodies and conflicting bindings', () => {
  for (const source of [
    fixture.replace('nodeCtor.prototype.getParent', 'nodeCtor.prototype.unrelated'),
    fixture + '\n' + fixture,
    fixture.replace('return this.name;', 'return this.name + "changed";'),
    fixture.replace('return nodeCtor;', 'nodeCtor.prototype.getName = function () { return this.name; }; return nodeCtor;'),
    fixture.replace('return nodeCtor;', 'var SceneNode = 1; return nodeCtor;')
  ]) assert.throws(() => nameSceneNode(source), /inventory|method differs|Duplicate|Conflicting/);
});
test('SceneNode CLI preserves baseline and prior reports, records upstream provenance and refuses repeats', t => {
  const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-scene-name-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json');
  fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, fixture);
  const prior = { id: 'previous', inputSHA256: 'preserved' };
  fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
  const runCommand = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/name-scene-node.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = runCommand(); assert.equal(first.status, 0, first.stderr);
  const bytes = fs.readFileSync(runtime), reportBytes = fs.readFileSync(report), result = JSON.parse(reportBytes);
  assert.deepEqual(result.passes[0], prior); assert.equal(result.passes[1].names[0].upstream.commit, '2cd2857c3f5f00d1d0f31bcb1577f905eee4c068');
  assert.deepEqual(fs.readFileSync(baselineFile), baseline); assert.notEqual(runCommand().status, 0);
  assert.deepEqual(fs.readFileSync(runtime), bytes); assert.deepEqual(fs.readFileSync(report), reportBytes);
});
