'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { namePresentationModels } = require('../scripts/name-presentation-models.cjs');
const roles = [
  ['lightingCtor', 'gameLighting', 'GameLighting', ['setTargetSetting', 'applyToGlobalLights', 'setShadowsEnabled', 'drawShadowMap']],
  ['soundCtor', 'gameSoundManager', 'GameSoundManager', ['setListenerWorldLocation', 'playSoundOnSource', 'attachSource', 'destroy']],
  ['effectCtor', 'effectFactory', 'EffectFactory', ['createVisualEffectInstance', 'createEffectInstance', 'playPersistentEffect', 'stopPersistentEffect']]
];
const definitions = roles.map(([ctor, role, , methods]) => `function ${ctor}() { this.calls = []; }
${ctor}.prototype = { ${methods.map(method => `${method}: function (value) { this.calls.push(['${method}', value]); return this; }`).join(', ')} };
${ctor}.create = function () { return new ${ctor}(); };`).join('\n');
const source = require('./world-model-fixture.cjs')
  .replace('a.prototype = {', definitions + '\nfunction presentationShadow(soundCtor) { return soundCtor; }\na.prototype = {')
  .replace('instance.gameClock = c.create();', 'instance.gameClock = c.create(); ' + roles.map(([ctor, role]) => `instance.${role} = ${ctor}.create();`).join(' '))
  .replace('globalThis.result = {', roles.map(([, role, , methods]) => methods.map(method => `game.${role}.${method}('original');`).join(' ')).join('\n') +
    `\nglobalThis.result = { presentation: { lighting: game.gameLighting.calls, audio: game.gameSoundManager.calls, effects: game.effectFactory.calls, shadow: presentationShadow('unchanged'), publicKey: { soundCtor: 'soundCtor' }, asset: 'aud_hero_chop' },`);
function run(text) { const context = {}; vm.runInNewContext(text, context); return JSON.stringify(context.result); }
test('presentation role names preserve calls, public keys, asset strings and shadowed bindings with inverse proof', () => {
  const result = namePresentationModels(source);
  assert.equal(run(result.output), run(source));
  assert.deepEqual(result.names.map(entry => [entry.original, entry.name, entry.descriptive]), roles.map(([ctor, , name]) => [ctor, name, true]));
  assert.equal(result.output.split('\n').length, source.split('\n').length);
  assert.equal(result.proof, 'Scoped reverse rename restores the canonical input syntax tree');
  assert.throws(() => namePresentationModels(result.output), /already named/);
});
test('presentation selector rejects missing/duplicate roles, wrong owners/factories, shadowing, capture and dynamic scope', () => {
  for (const invalid of [
    source.replace('instance.gameLighting = lightingCtor.create();', ''),
    source.replace('instance.gameLighting = lightingCtor.create();', 'instance.gameLighting = lightingCtor.create(); instance.gameLighting = lightingCtor.create();'),
    source.replace('instance.gameLighting = lightingCtor.create();', 'var unrelated = new b(); unrelated.gameLighting = lightingCtor.create();'),
    source.replace('instance.gameLighting = lightingCtor.create();', 'instance.gameLighting = soundCtor.create();'),
    source.replace('drawShadowMap: function', 'unrelatedMethod: function'),
    source.replace('soundCtor.create = function ()', 'soundCtor.create = function (soundCtor)'),
    source.replace('function presentationShadow', 'effectCtor = function () {}; function presentationShadow'),
    source.replace('function presentationShadow', 'var GameLighting = 1; function presentationShadow'),
    source.replace('function presentationShadow', 'function nested() { var GameSoundManager = 1; return soundCtor.create(); } function presentationShadow'),
    source.replace('function presentationShadow', 'eval("soundCtor.create()"); function presentationShadow'),
    source.replace('function presentationShadow', 'with (globalThis) { soundCtor.create(); } function presentationShadow'),
    source.replace('function presentationShadow', 'globalThis.exposed = { effectCtor }; function presentationShadow'),
    source.replace('(function () {', '').replace('})();', '')
  ]) assert.throws(() => namePresentationModels(invalid), /field|gameManager|method|constructor|construction|Shadowed|Reassigned|Conflicting|Changes beyond|Dynamic|Generated syntax|private/);
});
test('presentation CLI retains baseline and prior evidence and refuses repeat or damaged-baseline writes', t => {
  const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-presentation-names-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true })); fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
  const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json'), prior = { id: 'earlier', inputSHA256: 'preserved' };
  fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, source); fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
  const execute = () => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/name-presentation-models.cjs')], { cwd: folder, encoding: 'utf8' });
  const first = execute(); assert.equal(first.status, 0, first.stderr);
  const record = fs.readFileSync(report), text = fs.readFileSync(runtime), manifest = JSON.parse(record);
  assert.deepEqual(manifest.passes[0], prior); assert.equal(manifest.passes[1].id, 'presentation-model-role-names'); assert.equal(manifest.passes[1].names.length, 3);
  assert.deepEqual(fs.readFileSync(baselineFile), baseline); assert.equal(execute().status, 1); assert.deepEqual(fs.readFileSync(report), record); assert.deepEqual(fs.readFileSync(runtime), text);
  fs.writeFileSync(baselineFile, 'damaged'); const damaged = execute(); assert.equal(damaged.status, 1); assert.match(damaged.stderr, /Immutable Beta 1 baseline changed/);
  assert.deepEqual(fs.readFileSync(report), record); assert.deepEqual(fs.readFileSync(runtime), text);
});
