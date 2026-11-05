'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { nameWorldFactories } = require('../scripts/name-world-factories.cjs');
const definitions = `
function factoryA() {} function factoryB() {} function entityCtor() {} function blockCtor() {}
factoryA.prototype = {
 createEntity: function (name) { return entityCtor.create(name); },
 createInactiveEntityInstance: function (name) { return this.createEntity(name); }, getEntityArchetype: function () { return 'original'; }
};
factoryA.create = function () { return new factoryA(); };
factoryB.prototype = { createBlockInstance: function (name) { return blockCtor.create(name); }, getArchetype: function () { return 'original'; } };
factoryB.create = function () { return new factoryB(); };
entityCtor.prototype = {
 getECSaveData: function () { return this.components; }, deserializeECSaveData: function (data) { this.components = data; },
 getv3Location: function () { return [1, 2, 3]; }, getGameSpace: function () { return 'original-space'; }, addEC: function (key, value) { this.components[key] = value; }
};
entityCtor.create = function (name) { var result = new entityCtor(); result.name = name; result.components = {}; return result; };
blockCtor.prototype = {
 getArchetypeName: function () { return this.name; }, getv3Location: function () { return [3, 2, 1]; },
 addToGameSpace: function (space) { space.blocks.push(this); }, removeFromGameSpace: function (space) { space.blocks.splice(space.blocks.indexOf(this), 1); }
};
blockCtor.create = function (name) { var result = new blockCtor(); result.name = name; return result; };
function shadowFactory(factoryA) { return factoryA; }
`;
const source = require('./world-model-fixture.cjs').replace('a.prototype = {', definitions + '\na.prototype = {')
  .replace('instance.gameClock = c.create();', 'instance.gameClock = c.create(); instance.entityFactory = factoryA.create(); instance.blockFactory = factoryB.create();')
  .replace('globalThis.result = {', `var created = game.entityFactory.createInactiveEntityInstance('original-hero'), block = game.blockFactory.createBlockInstance('original-block');
created.addEC('ECHealth', { health: 20 }); var restored = game.entityFactory.createEntity('restored'); restored.deserializeECSaveData(created.getECSaveData());
space.blocks = []; block.addToGameSpace(space); block.removeFromGameSpace(space);
globalThis.result = { entityData: restored.getECSaveData(), block: block.getArchetypeName(), blocks: space.blocks.length, factoryShadow: shadowFactory('unchanged'),`);
function run(text) { const context = {}; vm.runInNewContext(text, context); return JSON.stringify(context.result); }
test('world-factory names preserve entity component data, blocks, save/archetype keys, public factory roles and shadowed names with inverse proof', () => {
  const result = nameWorldFactories(source); assert.equal(run(result.output), run(source));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['factoryA', 'EntityFactory', true], ['factoryB', 'BlockFactory', true], ['entityCtor', 'GameEntity', true], ['blockCtor', 'GameBlock', true]]);
  assert.match(result.output, /function shadowFactory\(factoryA\)/); assert.match(result.proof, /canonical input/);
  assert.equal(result.output.split('\n').length, source.split('\n').length); assert.throws(() => nameWorldFactories(result.output), /already named/);
});
test('world-factory naming refuses duplicate/wrong-owner roles, wrong products, shadowed construction, reassignment and capture', () => {
  for (const invalid of [
    source.replace('instance.entityFactory = factoryA.create();', 'instance.entityFactory = factoryA.create(); instance.entityFactory = factoryA.create();'),
    source.replace('instance.entityFactory = factoryA.create();', 'var unrelated = new b(); unrelated.entityFactory = factoryA.create();'),
    source.replace('instance.entityFactory = factoryA.create();', 'instance.entityFactory = factoryB.create();'),
    source.replace('return entityCtor.create(name);', 'return blockCtor.create(name);'),
    source.replace('return entityCtor.create(name);', 'factoryB.create(); return entityCtor.create(name);'),
    source.replace('factoryA.create = function ()', 'factoryA.create = function (factoryA)'),
    source.replace('function shadowFactory(factoryA)', 'factoryA = function () {}; function shadowFactory(factoryA)'),
    source.replace('function shadowFactory(factoryA)', 'var EntityFactory = 1; function shadowFactory(factoryA)'),
    source.replace('function shadowFactory(factoryA)', 'function nested() { var GameEntity = 1; return entityCtor.create(); } function shadowFactory(factoryA)')
  ]) assert.throws(() => nameWorldFactories(invalid), /assignment|gameManager|method|constructor|construction|Shadowed|Reassigned|Conflicting|Changes beyond/);
});
test('world-factory CLI preserves baseline and earlier naming evidence, records descriptive roles and refuses repeats', t => {
  const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-factory-names-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true })); fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json'), prior = { id: 'earlier', inputSHA256: 'preserved' };
  fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, source); fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
  const command = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/name-world-factories.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = command(); assert.equal(first.status, 0, first.stderr); const bytes = fs.readFileSync(runtime), record = fs.readFileSync(report);
  assert.deepEqual(JSON.parse(record).passes[0], prior); assert.equal(JSON.parse(record).passes[1].names.length, 4); assert.deepEqual(fs.readFileSync(baselineFile), baseline);
  assert.notEqual(command().status, 0); assert.deepEqual(fs.readFileSync(runtime), bytes); assert.deepEqual(fs.readFileSync(report), record);
});
test('actual native factories retain component/save-flag forwarding, mandatory grid component and block defaults', () => {
  const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default, tree = parse(fs.readFileSync(path.join(__dirname, '../game.canvas.js'), 'utf8')), found = {};
  traverse(tree, { AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.property?.name !== 'prototype' || right.type !== 'ObjectExpression') return;
    for (const name of ['createEntity', 'createBlockInstance']) {
      const method = right.properties.find(property => property.key?.name === name && property.value?.type === 'FunctionExpression');
      if (method) { assert.ok(!found[name]); found[name] = { owner: left.object.name, method: method.value }; }
    }
  } });
  let product; traverse(tree, { CallExpression(p) { const c = p.node.callee; if (p.node.start >= found.createEntity.method.start && p.node.end <= found.createEntity.method.end && c.type === 'MemberExpression' && c.property.name === 'create') { assert.ok(!product); product = c.object.name; } } });
  const created = [], components = [], globals = { mathDevice: { v3BuildOne: () => [1, 1, 1] } }, entity = { data: {}, addEC(ec) { this.data[ec.name] = ec; }, getEC(name) { return this.data[name]; } };
  const create = vm.runInNewContext('(' + generate(found.createEntity.method).code + ')', { [product]: { create(...args) { created.push(args); return entity; } }, ECBase: { createFromName(name, g, data) { components.push({ name, g, data }); return { name, data }; } } });
  const definition = { shouldLevelSave: false, shouldPlayerSave: true, ECHealth: { health: 20 }, ECMesh: null }, location = [1, 2, 3];
  assert.equal(create.call({ globals, isValidECName: name => name.startsWith('EC') }, 'hero', 'family', definition, location, 0.5), entity);
  assert.deepEqual(created, [['hero', 'family', globals, location, false, true, 0.5]]); assert.deepEqual(components.map(row => row.name), ['ECHealth', 'ECMesh', 'ECGameGridEntity']);
  assert.equal(components[0].data, definition.ECHealth); assert.equal(Object.keys(components[1].data).length, 0); assert.equal(components[2].data, undefined);
  const blockMethod = found.createBlockInstance.method, blockProduct = blockMethod.body.body.find(node => node.type === 'ReturnStatement').argument.callee.object.name, blockCalls = [], archetype = { v3CreationScale: [2, 2, 2] };
  const block = vm.runInNewContext('(' + generate(blockMethod).code + ')', { [found.createBlockInstance.owner]: { archetypes: { tile: archetype } }, [blockProduct]: { create(...args) { blockCalls.push(args); return args[0]; } } });
  assert.equal(block.call({ globals }, 'tile', location), 'tile'); assert.deepEqual(blockCalls[0], ['tile', archetype, location, archetype.v3CreationScale, 0, globals]);
});
