'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuestQuests, validateQuestView } = require('../desktop/quests.js');
const { GuestWorld } = require('../desktop/guest-world.js');
const original = require('./runtime-ast.cjs').prototypeWith('doTaskUI');
const view = (revision = 1) => ({ revision, visible: true, offset: false, tasks: [{ id: 'taskIdcrit_0', task: 'one', progress: 0.5 }], completed: null });
function fixture() {
  const drawn = [], messages = [], removed = [], sent = []; let clicked, sequence = 0, flushes = 0;
  const math = { v2Build: (x, y) => [x, y], v2BuildZero: () => [0, 0], v2Copy: a => [...a], v2Add: (a, b, out = []) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; return out; }, v2AddScalarMul: (a, b, scale) => [a[0] + b[0] * scale, a[1] + b[1] * scale] };
  const globals = { gameTimeStep: 99, mathDevice: math, currentLanguage: { SUM: 'Build a wall', TITLE: 'Wall task', DESC: 'Original task instructions', COMPLETE: 'Built a wall', TASK_COMPLETE: 'Task complete', TASK_AMBER: 'Amber', TASK_XP: 'XP', TASK_ACCEPT_REWARD_BUTTON: 'Accept reward', TASK_DESCRIPTION_CLOSE_BUTTON: 'Close', TASK_NEWSFLASH_TITLE: 'New task' }, guiRenderer: { getv2RenderLocation: (x, y) => [x, y] } };
  const archetype = { summaryTextId: 'SUM', titleTextId: 'TITLE', descriptionTextId: 'DESC', completeTextId: 'COMPLETE', amberReward: 1, xpReward: 20, iconPath: 'gui/task.svg', isCritical: true };
  const manager = { taskArchetypes: { one: archetype, two: { ...archetype } }, criticalTaskGroup: { taskList: ['one', 'two'] }, fillerTaskGroup: { taskList: [] }, taskRenderer: Object.assign(Object.create(original), { NEW_TASK_HIDE_DURATION: 0 }) };
  const gui = { doButtonFromGuiArchetype: (style, args, id) => { drawn.push({ style, args, id }); return id === clicked; } };
  const game = { getTaskManager: () => manager, getIMGui: () => gui, getGuiManager: () => ({ addDrawGui: (style, args, id) => drawn.push({ style, args, id }), addGameMessage: (...args) => messages.push(args), removeGameMessage: id => removed.push(id) }), getHero: () => { throw new Error('Solo hero must not be used'); }, setGameState: () => { throw new Error('Quest UI must not change game state'); }, startPaused: () => { throw new Error('Online simulation must not pause'); } };
  const world = { game, controls: { paused: false, app: { globals } }, movement: { nativeFocused: true, keys: new Set(), flush: () => { flushes++; } }, guiInput: {}, sendQuest: (type, id) => { sent.push({ type, id }); return ++sequence; } };
  const quests = new GuestQuests(world); world.quests = quests; world.cancelLocalMenu = () => quests.cancel(); world.localMenu = () => GuestWorld.prototype.localMenu.call(world);
  return { world, quests, manager, drawn, messages, removed, sent, globals, click: id => { clicked = id; }, flushes: () => flushes };
}
test('guest task cards and descriptions use actual original artwork/text, block local movement and emit one open intent without pausing', () => {
  const f = fixture(); f.quests.receiveView(view()); f.click('guest-idTaskHelpButtontaskIdcrit_0');
  assert.equal(f.quests.update(), true); assert.equal(f.world.localMenu(), true); assert.deepEqual(f.sent, [{ type: 'questOpen', id: 'taskIdcrit_0' }]); assert.equal(f.flushes(), 1);
  f.quests.update(); const description = f.drawn.find(item => item.style === 'taskDescription'); assert.equal(description.args.text2, 'Original task instructions'); assert.equal(description.args.svg1, 'gui/task.svg');
  assert.equal(f.globals.gameTimeStep, 99); assert.ok(f.quests.renderer.globals.gameTimeStep <= 0.25);
  f.click('guest-idDescriptionCloseTaskButtontaskIdcrit_0'); f.quests.update(); assert.equal(f.world.localMenu(), false); assert.equal(f.sent.length, 1);
  assert.ok(f.messages[0][0].startsWith('guest-')); f.quests.close(); assert.deepEqual(f.removed, f.messages.map(item => item[0]));
});
test('quest cache retains original animation/opened state, rejects old revisions and closes descriptions when the task completes', () => {
  const f = fixture(); f.quests.receiveView(view()); f.click('guest-idTaskHelpButtontaskIdcrit_0'); f.quests.update(); const item = f.quests.description;
  item.displayDuration = 12; const packet = view(2); packet.tasks[0].progress = 0.75; f.quests.receiveView(packet);
  assert.equal(f.quests.description, item); assert.equal(item.displayDuration, 12); assert.equal(item.opened, true); assert.equal(item.taskProgress, 0.75);
  packet.tasks[0].progress = 0; assert.equal(item.taskProgress, 0.75); f.quests.receiveView(view(1)); assert.equal(item.taskProgress, 0.75);
  f.quests.receiveView({ ...view(3), tasks: [], completed: { id: 'taskIdcrit_0', task: 'one' } }); assert.equal(f.quests.description, null);
});
test('original reward card sends one pending intent; saved replies fence stale HUD state and refresh the status query', () => {
  const f = fixture(), pending = { ...view(3), tasks: [], completed: { id: 'taskIdcrit_0', task: 'one' } }; f.quests.receiveView(pending); f.click('guest-idAcceptTaskRewardButtontaskIdcrit_0');
  f.quests.update(); f.quests.update(); assert.equal(f.sent.length, 1); assert.equal(f.drawn.find(item => item.style === 'taskComplete').args.text4, '+20'); assert.equal(f.world.localMenu(), false);
  f.quests.receive({ type: 'questReward', sequence: 999, quests: { ...view(4), tasks: [] } }); assert.equal(f.quests.state.revision, 3);
  f.quests.receive({ type: 'questReward', sequence: f.quests.pending, quests: { ...view(5), tasks: [] } }); assert.equal(f.quests.pending, null); assert.equal(f.quests.state.completed, null); assert.equal(f.world.lastLifeQuery, -Infinity);
  f.quests.receiveView(pending); assert.equal(f.quests.state.completed, null);
});
test('stale/blurred/resync/menu task input is suppressed without losing pending ownership or running personal scripts', () => {
  const f = fixture(); f.quests.receiveView({ ...view(), tasks: [], completed: { id: 'taskIdcrit_0', task: 'one' } }); f.quests.receivedAt = performance.now() - 3000; f.click('guest-idAcceptTaskRewardButtontaskIdcrit_0'); f.quests.update(); assert.equal(f.sent.length, 0);
  assert.equal(f.drawn.at(-1).args.text1, 'WAITING FOR HOST'); f.quests.pending = 42; f.quests.description = {};
  f.world.movement.nativeFocused = false; f.quests.update(); assert.equal(f.quests.description, null); assert.equal(f.quests.pending, 42);
  f.world.movement.nativeFocused = true; f.world.resyncing = true; assert.equal(f.quests.update(), false); f.world.resyncing = false; f.world.pauseMenu = true; assert.equal(f.quests.update(), false);
});
test('quest view validation bounds known canonical rows and rejects extra authority, sparse/duplicate rows and bad revisions', () => {
  const f = fixture();
  for (const bad of [{ ...view(), revision: 0 }, { ...view(), visible: false }, { ...view(), tasks: Array(1) }, { ...view(), tasks: Array(4).fill(view().tasks[0]) }, { ...view(), tasks: [...view().tasks, ...view().tasks] }, { ...view(), tasks: [{ ...view().tasks[0], progress: NaN }] }, { ...view(), completed: { id: 'taskIdcrit_1', task: 'unknown' } }, { ...view(), reward: 999 }]) assert.throws(() => validateQuestView(bad, f.manager));
  assert.throws(() => f.quests.receive({ type: 'questReward', sequence: 1, quests: null }), /Invalid quest result/);
  assert.throws(() => f.quests.receive({ type: 'target', sequence: 1, quests: view() }), /Invalid quest result/);
});
