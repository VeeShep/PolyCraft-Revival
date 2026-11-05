'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { nameUiModels } = require('../scripts/name-ui-models.cjs');
const definitions = `
function cameraCtor() {} function eventCtor() {} function guiCtor() {} function scoresCtor() {}
cameraCtor.prototype = {
 setDesiredFocus: function (v) { this.focus = v.slice(); }, setDesiredPosition: function (v) { this.position = v.slice(); },
 getCameraValues: function () { return this.focus; }, update: function () { this.frames++; }
};
cameraCtor.create = function () { var value = new cameraCtor(); value.frames = 0; return value; };
eventCtor.prototype = {
 subscribe: function (name, fn) { this.events[name] = fn; }, unsubscribe: function (name) { delete this.events[name]; },
 notify: function (name, value) { if (this.events[name]) this.events[name](value); }, reset: function () { this.events = {}; }
};
eventCtor.create = function () { var value = new eventCtor(); value.reset(); return value; };
guiCtor.prototype = {
 addDrawGui: function (name, args, id) { this.rows.push({ name: name, args: args, id: id }); }, clearDrawList: function () { this.rows.length = 0; },
 completeDraw: function () { this.last = this.rows.slice(); }, addGameMessage: function (name) { this.message = name; }
};
guiCtor.create = function () { var value = new guiCtor(); value.rows = []; return value; };
scoresCtor.prototype = {
 drawResourceBar: function (hero, index) { this.resource = index; }, drawSoftCurrency: function (hero) { this.hero = hero; },
 drawRanking: function (hero) { this.rank = hero.rank; }, setPrepareTimeRemaining: function (v) { this.remaining = v; }
};
scoresCtor.create = function () { return new scoresCtor(); };
function uiShadow(cameraCtor) { return cameraCtor; }
`;
const source = require('./world-model-fixture.cjs').replace('a.prototype = {', definitions + '\na.prototype = {')
  .replace('instance.gameClock = c.create();', 'instance.gameClock = c.create(); instance.gameCamera = cameraCtor.create(); instance.eventManager = eventCtor.create(); instance.guiManager = guiCtor.create(); instance.gameScoresUI = scoresCtor.create();')
  .replace('globalThis.result = {', `game.gameCamera.setDesiredFocus([1,2,3]); game.gameCamera.setDesiredPosition([4,5,6]); game.gameCamera.update();
var notice; game.eventManager.subscribe('quest-original', function (v) { notice = v; }); game.eventManager.notify('quest-original', 'earned'); game.eventManager.unsubscribe('quest-original');
game.guiManager.addDrawGui('shopLumber', { text: 'original' }, 'shop-id'); game.guiManager.completeDraw(); game.guiManager.clearDrawList();
game.gameScoresUI.drawResourceBar('hero', 0); game.gameScoresUI.drawSoftCurrency('hero'); game.gameScoresUI.drawRanking({ rank: 2 }); game.gameScoresUI.setPrepareTimeRemaining(12);
globalThis.result = { ui: { focus: game.gameCamera.getCameraValues(), frames: game.gameCamera.frames, event: notice, queue: game.guiManager.last, resource: game.gameScoresUI.resource, rank: game.gameScoresUI.rank, remaining: game.gameScoresUI.remaining, shadow: uiShadow('untouched'), publicKey: { cameraCtor: 'cameraCtor' } },`);
function run(text) { const context = {}; vm.runInNewContext(text, context); return JSON.stringify(context.result); }
test('UI-model role names preserve event/GUI/camera behavior, public keys and shadowed locals with inverse proof', () => {
  const result = nameUiModels(source); assert.equal(run(result.output), run(source));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), [['cameraCtor', 'GameCamera', true], ['eventCtor', 'GameEventManager', true], ['guiCtor', 'GuiManager', true], ['scoresCtor', 'GameScoresUI', true]]);
  assert.equal(result.proof, 'Scoped reverse rename restores the canonical input syntax tree');
  assert.throws(() => nameUiModels(result.output), /already named/);
});
test('UI-model selection refuses duplicate/wrong-owner roles, wrong factory methods, shadowing, reassignment and capture', () => {
  for (const invalid of [
    source.replace('instance.gameCamera = cameraCtor.create();', 'instance.gameCamera = cameraCtor.create(); instance.gameCamera = cameraCtor.create();'),
    source.replace('instance.gameCamera = cameraCtor.create();', 'var unrelated = new b(); unrelated.gameCamera = cameraCtor.create();'),
    source.replace('instance.gameCamera = cameraCtor.create();', 'instance.gameCamera = guiCtor.create();'),
    source.replace('setDesiredFocus: function', 'missingFocus: function'),
    source.replace('cameraCtor.create = function ()', 'cameraCtor.create = function (cameraCtor)'),
    source.replace('function uiShadow(cameraCtor)', 'cameraCtor = function () {}; function uiShadow(cameraCtor)'),
    source.replace('function uiShadow(cameraCtor)', 'var GuiManager = 1; function uiShadow(cameraCtor)'),
    source.replace('function uiShadow(cameraCtor)', 'function nested() { var GameCamera = 1; return cameraCtor.create(); } function uiShadow(cameraCtor)')
  ]) assert.throws(() => nameUiModels(invalid), /field|gameManager|method|constructor|construction|Shadowed|Reassigned|Conflicting|Changes beyond/);
});
test('UI-model CLI preserves immutable baseline and earlier evidence, appends provenance and refuses repeat application', t => {
  const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-ui-model-names-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true })); fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json'), prior = { id: 'earlier', inputSHA256: 'preserved' };
  fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, source); fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
  const execute = () => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/name-ui-models.cjs')], { cwd: folder, encoding: 'utf8' });
  assert.equal(execute().status, 0); const record = fs.readFileSync(report), text = fs.readFileSync(runtime);
  const manifest = JSON.parse(record); assert.deepEqual(manifest.passes[0], prior); assert.equal(manifest.passes[1].id, 'ui-model-role-names'); assert.equal(manifest.passes[1].names.length, 4);
  assert.deepEqual(fs.readFileSync(baselineFile), baseline); assert.equal(execute().status, 1); assert.deepEqual(fs.readFileSync(report), record); assert.deepEqual(fs.readFileSync(runtime), text);
});
test('actual native event manager forwards ordered arguments, unsubscribes and resets without renaming event identifiers', () => {
  const runtime = require('./runtime-ast.cjs'), prototype = runtime.prototypeWith('notify'), calls = [], handlers = [];
  const signal = { subscribe: fn => handlers.push(fn), unsubscribe: fn => handlers.splice(handlers.indexOf(fn), 1), notify: (...args) => handlers.forEach(fn => fn(...args)), unsubscribeAll: () => { handlers.length = 0; calls.push('cleared'); } };
  const manager = Object.assign(Object.create(prototype), { events: { PauseGame: signal } }), listener = (...args) => calls.push(args);
  manager.subscribe('PauseGame', listener); manager.notify('PauseGame', 'guest', 2); manager.notify('unknown', 9); manager.unsubscribe('PauseGame', listener); manager.notify('PauseGame', 'unused'); manager.reset();
  assert.deepEqual(calls, [['guest', 2], 'cleared']); assert.equal(Object.keys(manager.events).length, 0);
});
test('actual native GUI queues retain artwork/IDs, stable layer/submission order, previous frames and draw-list identity', () => {
  const runtime = require('./runtime-ast.cjs'), events = [], prototype = runtime.prototypeWith('addDrawGui', { i: { archetypes: { low: { layer: 0 }, high: { layer: 2 } } } });
  const previous = { archetypeName: 'old', argumentObject: { text: 'old' } };
  const gui = Object.assign(Object.create(prototype), { globals: { guiRenderer: { begin: () => events.push('begin'), end: () => events.push('end'), flush: () => events.push('flush'), render: name => events.push(name) } }, drawList: [], drawGuiMap: {}, prevDrawGuiMap: { previous },
    drawGui(name, args, id) { events.push(id); this.drawGuiMap[id] = { archetypeName: name, argumentObject: args }; }, fadeOutTween(row) { assert.equal(row, previous); events.push('fade'); } });
  const list = gui.drawList, args = { text: 'original' }; gui.addDrawGui('high', args, 'high-id'); gui.addDrawGui('low', {}, 'first-low'); gui.addDrawGui('low', {}, 'second-low');
  assert.equal(gui.drawList[0].argumentObject, args); gui.completeDraw();
  assert.deepEqual(events, ['begin', 'first-low', 'second-low', 'flush', 'high-id', 'old', 'fade', 'end']); assert.equal(gui.prevDrawGuiMap['high-id'].argumentObject, args); assert.equal(Object.keys(gui.drawGuiMap).length, 0);
  gui.clearDrawList(); assert.equal(gui.drawList, list); assert.equal(list.length, 0);
});
test('actual native game camera retains copied typed vectors, FOV conversion and dead/building/explore priorities', () => {
  const runtime = require('./runtime-ast.cjs'), prototype = runtime.prototypeWith('getCurrentV3Position');
  const copy = (value, out = new Float32Array(3)) => { out.set(value); return out; };
  let dead = false, buildingAge = 10;
  const camera = Object.assign(Object.create(prototype), { globals: { mathDevice: { v3Copy: copy } }, currentV3Position: new Float32Array([1, 2, 3]),
    cameraValueLibrary: { dead: 'dead', building: 'building', explore: 'explore', war: 'war' }, gameManager: { getPlayFlags: () => ({ cameraMode: 'war' }) },
    heroEntity: { getEC: name => name === 'ECPlayerLife' ? { isDead: () => dead } : { getTimeSinceBuilding: () => buildingAge } } });
  const focus = new Float32Array([4, 5, 6]); camera.setDesiredFocus(focus); focus[0] = 100; assert.deepEqual(Array.from(camera.getDesiredV3Focus()), [4, 5, 6]);
  camera.setDesiredPosition([7, 8, 9]); assert.deepEqual(Array.from(camera.desiredV3Position), [7, 8, 9]); assert.equal(camera.getCurrentV3Position(), camera.currentV3Position);
  camera.setDesiredFOV(60); assert.ok(Math.abs(camera.desiredFOV - Math.PI / 3) < 1e-12); assert.equal(camera.getCameraValues(), 'war');
  buildingAge = 0; assert.equal(camera.getCameraValues(), 'building'); dead = true; assert.equal(camera.getCameraValues(), 'dead');
  delete camera.heroEntity; camera.gameManager.getPlayFlags = () => ({}); assert.equal(camera.getCameraValues(), 'explore');
});
