'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { nameWorldModels } = require('../scripts/name-world-models.cjs');
const source = `(function () {
  function a() {} function b() {} function c() { this.time = 0; }
  a.prototype = {
    saveLevel: function () { var state = d.Serialize.serializePlayerSave(this); d.SaveLoad.saveLevelToUserData('AdventureIncGameState', state, this.store); },
    getGameSpaceList: function () { return this.spaces; }, serializeGameSpaces: function () {}, deserializeGameSpaces: function () {}
  };
  a.create = function () { var instance = new a(); instance.gameClock = c.create(); return instance; };
  b.prototype = {
    getEntityList: function () { return this.entities; }, getBlockList: function () { return []; },
    getExtents: function () { return [0, 0, 0, 10, 10, 10]; }, addEntities: function (list) { this.entities.push(...list); }
  };
  b.create = function (name) { var instance = new b(); instance.name = name; instance.entities = []; return instance; };
  c.prototype = {
    tick: function () { if (!this.stopped) this.time += 1; }, pause: function () { this.stopped = true; }, resume: function () { this.stopped = false; },
    getCurrentTime: function () { return this.time; }, getTimeStep: function () { return 1; }
  };
  c.create = function () { return new c(); };
  var d = {
    createEmptyLevel: function () { return { gameSpaceList: [] }; },
    Parse: { parseLevelData: function (data) { return data; }, parseGameSpaceData: function (data) { return data; }, deserializeGameSpaceList: function (list) { return list; } },
    Serialize: {
      serializePlayerSave: function (game) { return d.Serialize.serializeLevel(game); },
      serializeLevel: function (game) { return { gameSpaceList: game.getGameSpaceList().map(space => d.Serialize.serializeGameSpace(space)) }; },
      serializeGameSpace: function (space) { return { entityList: space.getEntityList().map(entity => d.Serialize.serializeEntity(entity)) }; },
      serializeEntity: function (entity) { return { name: entity.name, v3Location: entity.location }; }
    },
    SaveLoad: {
      saveLevelToUserData: function (key, data, store) { store[key] = JSON.stringify(data, d.SaveLoad.typedArrayReplacer); },
      loadLevelFromUserData: function (key, store) { return JSON.parse(store[key]); },
      typedArrayReplacer: function (key, value) { return value instanceof Float32Array ? Array.from(value) : value; }
    }
  };
  function start() { var game = a.create(); this.protoGame = this.globals.gameManager = game; return game; }
  function shadow(d) { return d; }
  var app = { globals: {} }, game = start.call(app), space = b.create('GameSpace');
  space.addEntities([{ name: 'hero', location: new Float32Array([1, 2, 3]) }]); game.spaces = [space]; game.store = {};
  game.gameClock.tick(); game.gameClock.pause(); game.gameClock.tick(); game.gameClock.resume(); game.gameClock.tick(); game.saveLevel();
  globalThis.result = { saved: game.store, loaded: d.SaveLoad.loadLevelFromUserData('AdventureIncGameState', game.store), time: game.gameClock.getCurrentTime(), shadow: shadow('unchanged'), asset: 'assets/d.dds', publicKey: { d: 'preserved' }, manager: app.globals.gameManager === game };
})();`;
function run(text) { const context = {}; vm.runInNewContext(text, context); return JSON.stringify(context.result); }
test('world-model role names preserve persistence keys, typed vectors, clock pause/resume, public fields and shadowed names with inverse proof', () => {
  const result = nameWorldModels(source);
  assert.equal(run(result.output), run(source));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['a', 'GameManager', true], ['b', 'GameSpace', true], ['c', 'GameClock', true], ['d', 'LevelPersistence', true]]);
  assert.match(result.output, /function shadow\(d\)/); assert.match(result.proof, /canonical input/);
  assert.equal(result.output.split('\n').length, source.split('\n').length);
  assert.throws(() => nameWorldModels(result.output), /already named/);
});
test('world-model naming refuses ambiguous roles, mismatched namespaces, shadowed factories, reassignment and capture', () => {
  for (const invalid of [
    source.replace("b.create('GameSpace')", "b.create('OtherSpace')"),
    source.replace('this.protoGame = this.globals.gameManager = game;', 'this.protoGame = this.globals.gameManager = game; this.globals.gameManager = game;'),
    source.replace('this.protoGame = this.globals.gameManager = game;', 'game = b.create(); this.protoGame = this.globals.gameManager = game;'),
    source.replace('serializeGameSpaces: function', 'unrelated: function'),
    source.replace('instance.gameClock = c.create();', 'instance.gameClock = b.create();'),
    source.replace('c.create = function ()', 'c.create = function (c)'),
    source.replace('d.SaveLoad.saveLevelToUserData', 'other.SaveLoad.saveLevelToUserData'),
    source.replace('typedArrayReplacer: function', 'unrelatedReplacer: function'),
    source.replace('function shadow(d)', 'a = function () {}; function shadow(d)'),
    source.replace('function shadow(d)', 'var LevelPersistence = 1; function shadow(d)'),
    source.replace('function shadow(d)', 'function nested() { var GameSpace = 1; return new b(); } function shadow(d)')
  ]) assert.throws(() => nameWorldModels(invalid), /factory|construction|property|namespace|Shadowed|Reassigned|Conflicting|Changes beyond/);
});
test('world-model naming CLI appends four descriptive roles without changing baseline or earlier passes and refuses repeats', t => {
  const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-world-names-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json');
  fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, source);
  const prior = { id: 'earlier', inputSHA256: 'preserved' };
  fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
  const command = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/name-world-models.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = command(); assert.equal(first.status, 0, first.stderr);
  const bytes = fs.readFileSync(runtime), record = fs.readFileSync(report), manifest = JSON.parse(record);
  assert.deepEqual(manifest.passes[0], prior); assert.equal(manifest.passes[1].names.length, 4);
  assert.deepEqual(fs.readFileSync(baselineFile), baseline); assert.notEqual(command().status, 0);
  assert.deepEqual(fs.readFileSync(runtime), bytes); assert.deepEqual(fs.readFileSync(report), record);
});
test('actual native level persistence keeps player/level filters, original save keys, typed geometry and script ownership', () => {
  const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
  const tree = parse(fs.readFileSync(path.join(__dirname, '../game.canvas.js'), 'utf8')), matches = [];
  traverse(tree, { VariableDeclarator(p) {
    const init = p.node.init;
    if (init?.type === 'ObjectExpression' && init.properties.some(property => property.key?.name === 'createEmptyLevel')) matches.push(p.node);
  } });
  assert.equal(matches.length, 1);
  const definition = matches[0], persistence = vm.runInNewContext('(function () { var ' + definition.id.name + ' = ' + generate(definition.init).code + '; return ' + definition.id.name + '; })()', { Date: class { getTime() { return 1234567890000; } } });
  const vector = (...values) => new Float32Array(values), shape = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const entity = (name, player, level) => ({ name, archetypeName: player ? 'hero' : null, familyName: 'custom', shouldPlayerSave: player, shouldLevelSave: level,
    getv3Location: () => vector(1, 2, 3), getRotationY: () => 0.25, getV3Scale: () => vector(1, 1, 1), getCustomArchetype: () => ({ shouldLevelSave: true }), getECSaveData(mode) { assert.equal(mode, 'checkpoint'); return { originalComponent: { preserved: true } }; } });
  const space = { calculateExtents: () => vector(0, 0, 0, 10, 2, 10), getM43FullTransform: () => new Float32Array(shape),
    getEntityList: () => [entity('saved-hero', true, false), entity('level-structure', false, true), entity('transient', false, false)],
    getBlockList: () => [{ getArchetypeName: () => 'original-block', getv3Location: () => vector(0, 0, 0), getV3Scale: () => vector(1, 1, 1), getRotationY: () => 0 }] };
  let scriptCalls = 0;
  const game = { versionNumber: '1.0.0.25', saveVersionNumber: '1.0', uniqueIndex: 12, uniqueLevelIndex: 34, getGameSpaceList: () => [space], gameScriptManager: { serialize() { scriptCalls++; return { originalScript: true }; } } };
  const player = persistence.Serialize.serializePlayerSave(game, 'checkpoint'), level = persistence.Serialize.serializeLevelSave(game, 'checkpoint');
  assert.equal(scriptCalls, 1); assert.equal(level.scriptData, null); assert.equal(player.scriptData.originalScript, true);
  assert.equal(player.gameSpaceList[0].blockList, null); assert.equal(level.gameSpaceList[0].blockList[0].archetype, 'original-block');
  assert.deepEqual(Array.from(player.gameSpaceList[0].entityList, row => row.name), ['saved-hero']);
  assert.deepEqual(Array.from(level.gameSpaceList[0].entityList, row => row.name), ['level-structure']);
  let storedKey, stored, acknowledged;
  persistence.SaveLoad.saveLevelToUserData('AdventureIncGameState', player, { set(key, value, success) { storedKey = key; stored = JSON.parse(value); success(key); } }, key => { acknowledged = key; }, () => assert.fail('Unexpected native save failure'));
  assert.equal(storedKey, 'AdventureIncGameState'); assert.equal(acknowledged, storedKey);
  assert.equal(stored.saveVersionNumber, '1.0'); assert.equal(stored.timeStamp, 1234567890);
  assert.deepEqual(stored.gameSpaceList[0].m43Transform, shape); assert.deepEqual(stored.gameSpaceList[0].entityList[0].v3Location, [1, 2, 3]);
  assert.deepEqual(stored.gameSpaceList[0].entityList[0].ecData, { originalComponent: { preserved: true } });
});
