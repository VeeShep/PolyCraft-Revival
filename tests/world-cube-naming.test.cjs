'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { nameWorldCube } = require('../scripts/name-world-cube.cjs');
const source = `(function () {
function c() { this.extents = [1, 2, 3, 4, 5, 6]; }
c.prototype = { collisionCheck: function () { return true; }, collisionResolve: function () {}, stepifyFakeSphere: function () {}, updateExtents: function () {}, getExtents: function () { return this.extents; } };
c.create = function (location) { var cube = new c(); cube.location = location; return cube; };
var component = { entityComponentName: 'ECPhysicsCube', activate: function () { this.worldCube = c.create([1, 2, 3]); } };
function shadow(c) { return c; }
var view = Object.create(component); view.activate();
globalThis.result = { bounds: view.worldCube.getExtents(), location: view.worldCube.location, publicKey: { c: 'c' }, shadow: shadow('original') };
})();`;
function run(text) { const context = {}; vm.runInNewContext(text, context); return JSON.stringify(context.result); }
test('worldCube role naming preserves behavior, public keys, strings, shadows and formatting with an inverse proof', () => {
  const result = nameWorldCube(source);
  assert.equal(run(result.output), run(source));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['c', 'WorldCube', true]]);
  assert.match(result.output, /function shadow\(c\)/); assert.match(result.proof, /canonical input/);
  assert.equal(result.output.split('\n').length, source.split('\n').length);
  assert.throws(() => nameWorldCube(result.output), /already named/);
});
test('worldCube selector refuses ambiguous components, owners, factories, methods, construction, capture and dynamic scope', () => {
  for (const invalid of [
    source.replace("entityComponentName: 'ECPhysicsCube'", "entityComponentName: 'unrelated'"),
    source.replace('function shadow', "var duplicate = { entityComponentName: 'ECPhysicsCube' }; function shadow"),
    source.replace('this.worldCube =', 'unrelated.worldCube ='),
    source.replace('this.worldCube = c.create([1, 2, 3]);', 'function nested() { this.worldCube = c.create([1, 2, 3]); }'),
    source.replace('c.create([1, 2, 3])', 'c.unrelated([1, 2, 3])'),
    source.replace('this.worldCube = c.create([1, 2, 3]);', 'this.worldCube = c.create([1, 2, 3]); this.worldCube = c.create([1, 2, 3]);'),
    source.replace('stepifyFakeSphere: function', 'unrelated: function'),
    source.replace('var cube = new c()', 'var cube = new other()'),
    source.replace('c.create = function (location)', 'c.create = function (c)'),
    source.replace('function shadow', 'c = function () {}; function shadow'),
    source.replace('function shadow', 'var WorldCube = 1; function shadow'),
    source.replace('function shadow', 'function nested() { var WorldCube = 1; return c.create(); } function shadow'),
    source.replace('function shadow', 'globalThis.exposed = { c }; function shadow'),
    source.replace('function shadow', 'eval("c.create()"); function shadow')
  ]) assert.throws(() => nameWorldCube(invalid), /component|worldCube|construction|Reassigned|Conflicting|Changes beyond|Generated syntax|Dynamic/);
});
test('worldCube CLI preserves the immutable baseline and previous evidence and refuses repeat or damaged-baseline writes', t => {
  const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-cube-name-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json');
  const prior = { id: 'earlier', evidence: 'preserved' };
  fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, source); fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
  const command = () => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/name-world-cube.cjs')], { cwd: folder, encoding: 'utf8' });
  const result = command(); assert.equal(result.status, 0, result.stderr);
  const bytes = fs.readFileSync(runtime), record = fs.readFileSync(report), manifest = JSON.parse(record);
  assert.deepEqual(manifest.passes[0], prior); assert.equal(manifest.passes[1].id, 'world-cube-role-name'); assert.deepEqual(fs.readFileSync(baselineFile), baseline);
  assert.equal(command().status, 1); assert.deepEqual(fs.readFileSync(runtime), bytes); assert.deepEqual(fs.readFileSync(report), record);
  fs.writeFileSync(baselineFile, 'damaged'); assert.match(command().stderr, /Immutable Beta 1 baseline changed/); assert.deepEqual(fs.readFileSync(runtime), bytes); assert.deepEqual(fs.readFileSync(report), record);
});
test('actual native cube methods retain sphere overlap, ignored collision and low/high step behavior', () => {
  const native = require('./runtime-ast.cjs'), math = {};
  for (const name of ['aabbSphereOverlaps', 'v3Sub', 'v3Copy', 'v3Length', 'v3Normalize', 'v3ScalarMul', 'v3Add', 'v3GetY', 'v3SetY']) math[name] = native.method(name, { F: Float32Array, A: math });
  const methods = native.prototypeWith('stepifyFakeSphere', { ECPhysicsSphere: { frictionType: { GROUND: 'ground' } } });
  const cube = Object.assign(Object.create(methods), { globals: { mathDevice: math }, extents: [-.5, .5, -.5, .5, 1.5, .5], scratchpad: {} });
  const sphere = location => ({ getv3Location: () => location, getRadius: () => .4, getCanClimb: () => true });
  assert.equal(cube.collisionCheck(sphere([0, .9, -.91])), false);
  assert.equal(cube.collisionCheck(sphere([0, .9, -.89])), true);
  cube.ignoringCollision = true; assert.equal(cube.collisionCheck(sphere([0, .9, -.89])), false); cube.ignoringCollision = false;
  for (const height of [.9, 1.4]) {
    const changes = [], position = [0, height, -.9];
    cube.stepifyFakeSphere(position, sphere(position), { getv3Location: () => [0, height, -.5], setBounce: value => changes.push(['bounce', value]),
      entity: { setv3Location: value => changes.push(['location', [...value]]) }, setFrictionType: value => changes.push(['friction', value]) });
    if (height === .9) assert.deepEqual(changes, []);
    else { assert.equal(changes.length, 3); assert.deepEqual(changes[0], ['bounce', 0]); assert.deepEqual(changes[2], ['friction', 'ground']); assert.ok(changes[1][1][1] < height); }
  }
});
