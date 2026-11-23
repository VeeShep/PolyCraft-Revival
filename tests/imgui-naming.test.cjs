'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
const { nameImmediateModeGui, selectImmediateModeGui } = require('../scripts/name-imgui.cjs');
const definition = `function guiCtor() {}
guiCtor.prototype = {
 isHot: function (id) { return this.hotID === id; }, isActive: function (id) { return this.activeID === id; },
 mouseWentDown: function () { return this.down && !this.previous; }, mouseWentUp: function () { return !this.down && this.previous; },
 doButton: function (id) { this.hotID = id; }, doButtonFromGuiArchetype: function (art, options, id) { this.activeID = id; return art; },
 clearValidation: function () { this.previous = this.down; }, hasCapturedInput: function () { return !!this.hotID; }
};
guiCtor.create = function () { return new guiCtor(); };
function shadow(guiCtor) { return guiCtor; }
`;
const source = require('./world-model-fixture.cjs').replace('a.prototype = {', definition + '\na.prototype = {')
 .replace('instance.gameClock = c.create();', 'instance.gameClock = c.create(); instance.imgui = guiCtor.create();')
 .replace('globalThis.result = {', `game.imgui.doButton('original-button'); game.imgui.down = true; game.imgui.clearValidation();
globalThis.result = { gui: { hot: game.imgui.isHot('original-button'), captured: game.imgui.hasCapturedInput(), art: game.imgui.doButtonFromGuiArchetype('buttonHalf', {}, 'original-id'), publicKey: { guiCtor: 'guiCtor' }, shadow: shadow('untouched') },`);
function run(text) { const context = {}; vm.runInNewContext(text, context); return JSON.stringify(context.result); }
test('immediate-mode GUI naming preserves fixture behavior, artwork, public keys and shadowed locals', () => {
 const result = nameImmediateModeGui(source); assert.equal(run(result.output), run(source));
 assert.deepEqual(result.names.map(n => [n.original, n.name, n.role, n.descriptive]), [['guiCtor', 'ImmediateModeGui', 'imgui', true]]);
 assert.equal(result.output.split('\n').length, source.split('\n').length); assert.match(result.proof, /canonical input/);
 assert.throws(() => nameImmediateModeGui(result.output), /already named/);
});
test('GUI naming refuses missing, duplicate, wrong-owner, reassigned, shadowed and dynamically scoped evidence', () => {
 for (const invalid of [
  source.replace('instance.imgui = guiCtor.create();', ''),
  source.replace('instance.imgui = guiCtor.create();', 'instance.imgui = guiCtor.create(); instance.imgui = guiCtor.create();'),
  source.replace('instance.imgui = guiCtor.create();', 'var unrelated = new b(); unrelated.imgui = guiCtor.create();'),
  source.replace('mouseWentUp: function', 'unrelated: function'), source.replace('guiCtor.create = function ()', 'guiCtor.create = function (guiCtor)'),
  source.replace('function shadow', 'guiCtor = function () {}; function shadow'),
  source.replace('function shadow', 'var ImmediateModeGui = 1; function shadow'),
  source.replace('function shadow', 'function nested() { var ImmediateModeGui = 1; return guiCtor.create(); } function shadow'),
  source.replace('function shadow', 'globalThis.leak = { guiCtor }; function shadow'),
  source.replace('function shadow', 'eval("guiCtor.create()"); function shadow')
 ]) assert.throws(() => nameImmediateModeGui(invalid), /field|gameManager|method|constructor|construction|Shadowed|Reassigned|Conflicting|Changes beyond|Dynamic|Generated syntax/);
});
test('GUI naming CLI preserves baseline/earlier records and refuses repeat or damaged-baseline writes', t => {
 const { spawnSync } = require('node:child_process'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-imgui-name-'));
 t.after(() => fs.rmSync(folder, { recursive: true, force: true })); fs.mkdirSync(path.join(folder, 'scripts')); fs.mkdirSync(path.join(folder, 'reference/beta-1'), { recursive: true });
 const baseline = Buffer.from('immutable original'), baselineFile = path.join(folder, 'reference/beta-1/game.canvas.js'), runtime = path.join(folder, 'game.canvas.js'), report = path.join(folder, 'scripts/runtime-names.json'), prior = { id: 'earlier', evidence: 'retained' };
 fs.writeFileSync(baselineFile, baseline); fs.writeFileSync(runtime, source); fs.writeFileSync(report, JSON.stringify({ baselineSHA256: crypto.createHash('sha256').update(baseline).digest('hex'), passes: [prior] }));
 const command = () => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/name-imgui.cjs')], { cwd: folder, encoding: 'utf8' });
 const first = command(); assert.equal(first.status, 0, first.stderr); const text = fs.readFileSync(runtime), record = fs.readFileSync(report);
 assert.deepEqual(JSON.parse(record).passes[0], prior); assert.equal(JSON.parse(record).passes[1].id, 'immediate-mode-gui-role-name'); assert.deepEqual(fs.readFileSync(baselineFile), baseline);
 assert.equal(command().status, 1); assert.deepEqual(fs.readFileSync(runtime), text); assert.deepEqual(fs.readFileSync(report), record);
 fs.writeFileSync(baselineFile, 'changed'); assert.match(command().stderr, /Immutable Beta 1 baseline changed/); assert.deepEqual(fs.readFileSync(runtime), text); assert.deepEqual(fs.readFileSync(report), record);
});
function nativeGui(text) {
 const ast = parse(text), binding = selectImmediateModeGui(ast)[0].binding, nodes = [binding.path.node];
 traverse(ast, { AssignmentExpression(p) { const left = p.node.left; if (left.type === 'MemberExpression' && !left.computed && left.object.type === 'Identifier' && ['prototype', 'create', 'BUTTON_NORMAL'].includes(left.property.name) && p.scope.getBinding(left.object.name) === binding) nodes.push(p.node); } });
 assert.equal(nodes.length, 4); const context = {}; vm.runInNewContext(nodes.map(node => generate(node).code).join(';') + ';globalThis.Gui = ' + binding.identifier.name, context); return context.Gui;
}
function exercise(Gui) {
 const sounds = [], draws = []; let down = false, pointer = [50, 50];
 const mathDevice = { v2Build: (x,y) => [x,y], v2Sub: (a,b) => a.map((v,i) => v-b[i]), v2Add: (a,b) => a.map((v,i) => v+b[i]) };
 const gui = Gui.create({ mathDevice, debugDrawFlags: { gui: false }, guiRenderer: { getScaleFactor: () => 1, getGuiInfo: () => ({ buttonSize: [100, 40] }) } },
  { gameSoundManager: { play: name => sounds.push(name) }, getGuiManager: () => ({ addDrawGui: (art, options, id) => draws.push({ art, id, scale: options.scale }) }) },
  { getGuiDown: () => down, getv2ScreenCoord: () => pointer });
 const button = () => gui.doButtonFromGuiArchetype('buttonHalf', { v2ScreenLocation: [50,50] }, 'native-original-id');
 assert.equal(button(), false); assert.equal(gui.isHot('native-original-id'), true); assert.equal(gui.hasCapturedInput(), true); gui.clearValidation();
 down = true; assert.equal(button(), false); assert.equal(gui.isActive('native-original-id'), true); gui.clearValidation();
 down = false; assert.equal(button(), true); assert.equal(gui.isActive('native-original-id'), false); gui.clearValidation();
 assert.equal(button(), false); gui.clearValidation(); pointer = [500,500]; assert.equal(button(), false); gui.clearValidation(); assert.equal(gui.hasCapturedInput(), false);
 gui.gobbleCursor(); gui.clearValidation(); assert.equal(gui.hasCapturedInput(), true); gui.clearValidation(); assert.equal(gui.hasCapturedInput(), false);
 assert.deepEqual(sounds, ['imguiSelect', 'imguiDown', 'imguiUp', 'imguiDeselect']);
 assert.equal(draws.length, 5); assert.ok(draws.every(row => row.art === 'buttonHalf' && row.id === 'native-original-id'));
 return JSON.stringify({ sounds, draws });
}
test('actual native GUI retains hover, press/release, artwork, sounds and modal input capture before/after naming', () => {
 const baseline = fs.readFileSync(path.join(__dirname, '../game.canvas.js'), 'utf8');
 // Use the immutable original if the running bundle has already received this pass.
 const input = selectImmediateModeGui(parse(baseline))[0].binding.identifier.name === 'ImmediateModeGui'
  ? fs.readFileSync(path.join(__dirname, '../reference/beta-1/game.canvas.js'), 'utf8') : baseline;
 const result = nameImmediateModeGui(input); assert.equal(exercise(nativeGui(result.output)), exercise(nativeGui(input)));
 assert.equal(exercise(nativeGui(baseline)), exercise(nativeGui(input)));
});
