'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
const { nameGameMonitor, selectGameMonitor } = require('../scripts/name-game-monitor.cjs');
const definition = `function monitorCtor() {}
monitorCtor.prototype = {
 start: function () { this.running = true; }, stop: function () { this.running = false; }, reset: function () { this.gathered = this.deposited = 0; },
 getSampleIndex: function (time) { return Math.floor(time / 60) % 60; }, getAverage: function (key) { return this[key]; },
 getAverageGathered: function () { return this.getAverage('gathered'); }, getAverageDeposited: function () { return this.getAverage('deposited'); },
 onInteractWithResourceDispenser: function (event) { this.gathered += event.amount; }, onResourceDeposited: function (event) { this.deposited += event.amount; }
};
monitorCtor.create = function () { var value = new monitorCtor(); value.reset(); return value; };
function monitorShadow(monitorCtor) { return monitorCtor; }
`;
const source = require('./world-model-fixture.cjs').replace('a.prototype = {', definition + '\na.prototype = {')
 .replace('instance.gameClock = c.create();', 'instance.gameClock = c.create(); instance.gameMonitor = monitorCtor.create();')
 .replace('globalThis.result = {', `game.gameMonitor.start(); game.gameMonitor.onInteractWithResourceDispenser({ amount: 3 }); game.gameMonitor.onResourceDeposited({ amount: 5 }); game.gameMonitor.stop();
globalThis.result = { monitor: { gathered: game.gameMonitor.getAverageGathered(), deposited: game.gameMonitor.getAverageDeposited(), index: game.gameMonitor.getSampleIndex(120), running: game.gameMonitor.running, publicKey: { monitorCtor: 'monitorCtor' }, shadow: monitorShadow('unchanged') },`);
function run(text) { const context = {}; vm.runInNewContext(text, context); return JSON.stringify(context.result); }
test('GameMonitor role naming preserves behavior, public keys, strings and shadowed locals with inverse proof', () => {
 const result = nameGameMonitor(source); assert.equal(run(result.output), run(source));
 assert.deepEqual(result.names.map(n => [n.original, n.name, n.role, n.descriptive]), [['monitorCtor', 'GameMonitor', 'gameMonitor', true]]);
 assert.equal(result.output.split('\n').length, source.split('\n').length); assert.match(result.proof, /canonical input/); assert.throws(() => nameGameMonitor(result.output), /already named/);
});
test('monitor naming refuses incorrect owners, ambiguous roles, changed methods, capture, reassignment and dynamic scope', () => {
 for (const invalid of [
  source.replace('instance.gameMonitor = monitorCtor.create();', ''),
  source.replace('instance.gameMonitor = monitorCtor.create();', 'instance.gameMonitor = monitorCtor.create(); instance.gameMonitor = monitorCtor.create();'),
  source.replace('instance.gameMonitor = monitorCtor.create();', 'var unrelated = new b(); unrelated.gameMonitor = monitorCtor.create();'),
  source.replace('onResourceDeposited: function', 'unrelated: function'), source.replace('monitorCtor.create = function ()', 'monitorCtor.create = function (monitorCtor)'),
  source.replace('function monitorShadow', 'monitorCtor = function () {}; function monitorShadow'), source.replace('function monitorShadow', 'var GameMonitor = 1; function monitorShadow'),
  source.replace('function monitorShadow', 'function nested() { var GameMonitor = 1; return monitorCtor.create(); } function monitorShadow'),
  source.replace('function monitorShadow', 'globalThis.leak = { monitorCtor }; function monitorShadow'), source.replace('function monitorShadow', 'eval("monitorCtor.create()"); function monitorShadow')
 ]) assert.throws(() => nameGameMonitor(invalid), /field|gameManager|method|constructor|construction|Shadowed|Reassigned|Conflicting|Changes beyond|Dynamic|Generated syntax/);
});
test('monitor naming CLI preserves original baseline and earlier records, and refuses repeat or damaged-baseline writes', t => {
 const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-monitor-name-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
 fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
 const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json'), prior = { id: 'earlier', evidence: 'retained' };
 fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, source); fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
 const command = () => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/name-game-monitor.cjs')], { cwd: folder, encoding: 'utf8' });
 const first = command(); assert.equal(first.status, 0, first.stderr); const text = fs.readFileSync(runtime), record = fs.readFileSync(report), manifest = JSON.parse(record);
 assert.deepEqual(manifest.passes[0], prior); assert.equal(manifest.passes[1].id, 'game-monitor-role-name'); assert.deepEqual(fs.readFileSync(baselineFile), baseline);
 assert.equal(command().status, 1); assert.deepEqual(fs.readFileSync(runtime), text); assert.deepEqual(fs.readFileSync(report), record);
 fs.writeFileSync(baselineFile, 'changed'); assert.match(command().stderr, /Immutable Beta 1 baseline changed/); assert.deepEqual(fs.readFileSync(runtime), text); assert.deepEqual(fs.readFileSync(report), record);
});
function monitorClass(text) {
 const ast = parse(text), binding = selectGameMonitor(ast)[0].binding, nodes = [binding.path.node];
 traverse(ast, { AssignmentExpression(p) { const left = p.node.left; if (left.type === 'MemberExpression' && !left.computed && left.object.type === 'Identifier' && ['prototype', 'create'].includes(left.property.name) && p.scope.getBinding(left.object.name) === binding) nodes.push(p.node); } });
 assert.equal(nodes.length, 3); const context = {}; vm.runInNewContext(nodes.map(node => generate(node).code).join(';') + ';globalThis.Monitor = ' + binding.identifier.name, context); return context.Monitor;
}
function exercise(Monitor) {
 const listeners = new Map(), globals = { gameCurrentTime: 30, gameManager: { eventManager: { subscribe: (name, fn) => listeners.set(name, fn), unsubscribe(name, fn) { assert.equal(listeners.get(name), fn); listeners.delete(name); } } } };
 const monitor = Monitor.create(globals), actor = hero => ({ hasEC: () => hero }), gather = (hero, amount, type) => listeners.get('InteractWithResourceDispenser')({ interactor: actor(hero), amount, resourceDispenser: { getEC: () => ({ getResourceType: () => type }) } });
 monitor.start(); gather(true, 2, 0); gather(false, 5, 0); listeners.get('ResourceDeposited')({ entity: actor(false), amount: 4, type: 0 });
 assert.equal(monitor.getAverageGathered(0), 10); assert.equal(monitor.getAverageDeposited(0), 8);
 globals.gameCurrentTime = 120; gather(false, 3, 1); assert.equal(monitor.getAverageGathered(1), 1.5);
 const result = JSON.stringify({ data: monitor.data, index: monitor.getSampleIndex(3600) }); monitor.stop(); assert.equal(listeners.size, 0); monitor.reset(); assert.equal(monitor.data.gathered.hero[0], 0); return result;
}
test('actual original monitor callbacks, hero/worker accounting, time buckets and unsubscribe behavior survive naming', () => {
 const baseline = fs.readFileSync(path.join(__dirname, '../reference/beta-1/game.canvas.js'), 'utf8'), renamed = nameGameMonitor(baseline);
 assert.equal(exercise(monitorClass(renamed.output)), exercise(monitorClass(baseline)));
});
