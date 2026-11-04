'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
const { nameCamera } = require('../scripts/name-camera.cjs');
const tree = parse(fs.readFileSync(path.join(__dirname, '../reference/turbulenz-2cd2857/camera.js'), 'utf8'));
traverse(tree, {
  Program(p) { p.scope.rename('Camera', 'ReferenceCamera'); },
  FunctionDeclaration(p) { if (p.node.id.name === 'Camera') p.scope.parent.rename('Camera', 'cameraCtor'); }
});
const fixture = generate(tree).code.replace('return cameraCtor;', `cameraCtor.prototype.gameExtension = function () { return 'assets/camera.dds'; };
function shadow(cameraCtor) { return cameraCtor; }
cameraCtor.shadow = shadow; return cameraCtor;`);
function run(source) {
  const put = (values, out = []) => { values.forEach((value, i) => { out[i] = value; }); return out; };
  const md = { m43BuildIdentity: () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], m44Build: (...values) => put(values.slice(0, 16), values[16]), v4Build: (x, y, z, w, out) => put([x, y, z, w], out), planeNormalize: (value, out) => put(value.map(v => v / Math.hypot(...value.slice(0, 3))), out) };
  const context = { md };
  vm.runInNewContext(source + `
var camera = ReferenceCamera.create(md), projections = [];
for (var mode of ['perspective', 'parallel', 'infinite']) {
 camera.parallel = mode === 'parallel'; camera.infinite = mode === 'infinite';
 camera.updateProjectionMatrix(); projections.push(camera.projectionMatrix.slice());
}
globalThis.result = { projections, planes: camera.frustumPlanes, extension: camera.gameExtension(), shadow: ReferenceCamera.shadow('unchanged'), publicMethods: Object.keys(ReferenceCamera.prototype).sort() };`, context);
  return JSON.stringify(context.result);
}
test('Camera naming preserves perspective/parallel/infinite projection, factory, frustum, game extensions and shadowed locals with inverse proof', () => {
  const result = nameCamera(fixture);
  assert.equal(run(result.output), run(fixture));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['cameraCtor', 'Camera', false]]);
  assert.equal(result.names[0].matchingFactory, 'create'); assert.deepEqual(result.names[0].matchingMethods, ['updateFrustumPlanes']);
  assert.match(result.proof, /canonical input/); assert.match(result.output, /function shadow\(cameraCtor\)/);
  assert.equal(result.output.split('\n').length, fixture.split('\n').length);
  assert.throws(() => nameCamera(result.output), /already named/);
});
test('Camera naming refuses missing or duplicate core methods, mismatched factory/body, ambiguity and captured names', () => {
  const shadowed = parse(fixture);
  traverse(shadowed, { AssignmentExpression(p) {
    if (p.node.left.object?.name === 'cameraCtor' && p.node.left.property?.name === 'create') p.get('right').scope.rename('md', 'cameraCtor');
  } });
  assert.throws(() => nameCamera(generate(shadowed).code), /unshadowed Camera constructor/);
  for (const source of [
    fixture.replace('cameraCtor.prototype.lookAt', 'cameraCtor.prototype.unrelated'),
    fixture + '\n' + fixture,
    fixture.replace('this.extractFrustumPlanes(this.viewProjectionMatrix, this.frustumPlanes)', 'this.extractFrustumPlanes(this.matrix, this.frustumPlanes)'),
    fixture.replace('c.viewProjectionMatrix = c.projectionMatrix.slice();', 'c.viewProjectionMatrix = [];'),
    fixture.replace('cameraCtor.shadow = shadow;', 'cameraCtor.prototype.lookAt = function () {}; cameraCtor.shadow = shadow;'),
    fixture.replace('cameraCtor.shadow = shadow;', 'var Camera = 1; cameraCtor.shadow = shadow;'),
    fixture.replace('cameraCtor.shadow = shadow;', 'function capture() { var Camera = 1; return new cameraCtor(); } cameraCtor.shadow = shadow;')
  ]) assert.throws(() => nameCamera(source), /inventory|method differs|factory differs|unshadowed|Duplicate|Conflicting|Changes beyond/);
});
test('Camera CLI preserves immutable baseline and earlier passes, records pinned evidence and refuses repeat application', t => {
  const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-camera-name-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json');
  fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, fixture);
  const prior = { id: 'previous', inputSHA256: 'preserved' };
  fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
  const runCommand = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/name-camera.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = runCommand(); assert.equal(first.status, 0, first.stderr);
  const bytes = fs.readFileSync(runtime), reportBytes = fs.readFileSync(report), result = JSON.parse(reportBytes);
  assert.deepEqual(result.passes[0], prior); assert.equal(result.passes[1].names[0].upstream.sha256, 'b035fbda8c1a87e88fe7225d07321e5082b6c670a9967776f26b8a7412d6d7b8');
  assert.deepEqual(fs.readFileSync(baselineFile), baseline); assert.notEqual(runCommand().status, 0);
  assert.deepEqual(fs.readFileSync(runtime), bytes); assert.deepEqual(fs.readFileSync(report), reportBytes);
});
