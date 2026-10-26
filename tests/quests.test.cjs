'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { KEY, QuestRewards, validateQuests } = require('../desktop/quests.js');
const { Saves, emptyState } = require('../desktop/saves.cjs');
const { CoopData } = require('../desktop/coop-data.js');
const { Controls } = require('../desktop/controls.js');
const original = require('./runtime-ast.cjs').prototypeWith('awardCompletedTaskList');
const ledger = (pending = []) => ({ version: 1, pending });
function fixture(state = emptyState()) {
  const bridge = { state }, flags = JSON.parse(state.userData.taskFlags || '{}'), gifts = [], queue = [];
  const definitions = { one: { amberReward: 1, xpReward: 20 }, two: { amberReward: 2, xpReward: 30 } };
  const data = { getTaskFlags: () => flags, setTaskFlag(name, value) { flags[name] = value; state.userData.taskFlags = JSON.stringify(flags); } };
  const game = { getPlayerData: () => data, getHero: () => ({ getv3Location: () => [1, 2, 3] }), giveAmberReward: (value, position) => gifts.push(['amber', value, [...position]]), giveXpReward: (value, position) => gifts.push(['xp', value, [...position]]) };
  const manager = Object.assign(Object.create(original), { gameManager: game, taskArchetypes: definitions, completedTaskRenderInfo: null, activeTaskRenderInfo: null,
    criticalTaskGroup: { taskList: ['one', 'two'], handleEvents: () => queue.splice(0), destroy() {} }, fillerTaskGroup: { taskList: [], handleEvents: () => [], destroy() {} }, badgeTaskGroup: { destroy() {} } });
  game.getTaskManager = () => manager;
  const info = index => ({ taskId: 'taskIdcrit_' + index, taskArchetypeName: ['one', 'two'][index], taskArchetype: definitions[['one', 'two'][index]], taskProgress: 1 });
  return { game, manager, bridge, flags, gifts, queue, info, attach: () => new QuestRewards(game, bridge) };
}
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-quests-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
test('actual task manager completion keeps an unclaimed reward across reload and original acceptance pays once', () => {
  const f = fixture(), quests = f.attach(); f.queue.push(f.info(0)); f.manager.updateCompletedTasks();
  assert.equal(f.flags.one, true); assert.equal(f.gifts.length, 0); assert.deepEqual(JSON.parse(f.bridge.state.userData[KEY]), ledger([{ id: 'taskIdcrit_0', task: 'one' }]));
  const restored = fixture(structuredClone(f.bridge.state)), next = restored.attach(); restored.manager.updateCompletedTasks();
  assert.equal(restored.manager.completedTaskRenderInfo.taskArchetypeName, 'one');
  restored.manager.awardCompletedTaskList([restored.manager.completedTaskRenderInfo]);
  assert.deepEqual(restored.gifts, [['amber', 1, [1, 2, 3]], ['xp', 20, [1, 2, 3]]]); assert.deepEqual(next.data, ledger());
  restored.manager.awardCompletedTaskList([restored.info(0)]); assert.equal(next.award('taskIdcrit_0'), false); assert.equal(restored.gifts.length, 2);
  next.close(); quests.close();
});
test('multiple completed tasks retain original automatic rewards and the last pending card without replay after another reload', () => {
  const f = fixture(), quests = f.attach(); f.queue.push(f.info(0), f.info(1)); f.manager.updateCompletedTasks();
  assert.equal(f.gifts.length, 2); assert.equal(f.manager.completedTaskRenderInfo.taskArchetypeName, 'two'); assert.deepEqual(quests.data.pending, [{ id: 'taskIdcrit_1', task: 'two' }]);
  const copy = fixture(structuredClone(f.bridge.state)), restored = copy.attach(); copy.manager.updateCompletedTasks(); assert.equal(copy.gifts.length, 0);
  copy.manager.awardCompletedTaskList([copy.info(1)]); assert.deepEqual(copy.gifts.map(item => item[1]), [2, 30]);
  const clean = fixture(structuredClone(copy.bridge.state)), cleanRewards = clean.attach(); clean.manager.updateCompletedTasks(); assert.equal(clean.manager.completedTaskRenderInfo, null); assert.equal(clean.gifts.length, 0);
  cleanRewards.close(); restored.close(); quests.close();
});
test('hosting captures a known live legacy pending card, without inferring unpaid rewards from historical completion flags', () => {
  const f = fixture(); f.flags.one = true; f.flags.two = true; f.manager.completedTaskRenderInfo = f.info(1);
  const quests = f.attach(); assert.deepEqual(quests.data.pending, [{ id: 'taskIdcrit_1', task: 'two' }]);
  f.manager.updateCompletedTasks(); f.manager.awardCompletedTaskList([f.info(1)]); assert.deepEqual(f.gifts.map(item => item[1]), [2, 30]);
  f.manager.awardCompletedTaskList([f.info(0)]); assert.equal(f.gifts.length, 2); quests.close();
  const debug = fixture(); debug.manager.completedTaskRenderInfo = debug.info(0);
  const pending = debug.attach(); pending.award('taskIdcrit_0'); assert.equal(debug.flags.one, true); pending.close();
  const reload = fixture(structuredClone(debug.bridge.state)), next = reload.attach(); reload.manager.updateCompletedTasks();
  assert.equal(reload.gifts.length, 0); assert.equal(reload.manager.completedTaskRenderInfo, null); next.close();
});
test('partial reward exceptions latch saving before world writes; the previous checkpoint remains untouched', t => {
  const root = temp(t), saves = new Saves(root), slot = saves.create('Safe'), bytes = fs.readFileSync(saves.file(slot.id));
  const f = fixture(slot.state), quests = f.attach(); f.queue.push(f.info(0)); f.manager.updateCompletedTasks();
  f.game.giveXpReward = () => { throw new Error('Reward creation failed'); };
  assert.throws(() => f.manager.awardCompletedTaskList([f.info(0)]), /Reward creation failed/); assert.equal(quests.data.pending.length, 1);
  const controls = new Controls(); controls.app = { globals: { gameManager: f.game } }; f.game.saveLevel = () => { throw new Error('World save must not start'); };
  assert.throws(() => controls.writeCheckpoint(), /Reload the last saved checkpoint/); assert.throws(() => quests.award('taskIdcrit_0'), /Reload/); assert.throws(() => quests.close(), /Reload/);
  assert.deepEqual(fs.readFileSync(saves.file(slot.id)), bytes);
});
test('ledger validation rejects unknown/future/duplicate records and failed staging leaves the prior ledger intact', () => {
  for (const data of [{ version: 1, pending: Array(1) }, ledger([{ id: 'arbitrary', task: 'one' }]), ledger([{ id: 'taskIdcrit_0', task: '../bad' }]), ledger([{ id: 'taskIdcrit_0', task: 'one' }, { id: 'taskIdcrit_0', task: 'two' }]), ledger([{ id: 'taskIdcrit_0', task: 'one' }, { id: 'taskIdcrit_1', task: 'one' }]), { ...ledger(), paid: true }]) assert.throws(() => validateQuests(data), /Invalid/);
  assert.throws(() => validateQuests({ version: 2, pending: [] }), error => error.code === 'UNSUPPORTED_SAVE');
  const f = fixture(), quests = f.attach(), before = f.bridge.state.userData[KEY];
  assert.throws(() => quests.stage([{ ...f.info(0), taskArchetypeName: 'unknown' }]), /Unknown pending/); assert.equal(f.bridge.state.userData[KEY], before); quests.close();
});
test('quest ledger migration preserves exact format-6 bytes and an immutable older reader rejects new primary and recovery envelopes', t => {
  const root = temp(t), directory = path.join(root, 'saves'), OldSaves = require('../reference/coop-schema-4/saves.cjs').Saves, old = new OldSaves(directory), state = emptyState(); new CoopData(state).persist();
  const slot = old.create('Before', state), file = old.file(slot.id), bytes = fs.readFileSync(file), saves = new Saves(directory), current = saves.load(slot.id);
  assert.equal(current.version, 6); assert.equal(Object.hasOwn(current.state.userData, KEY), false);
  current.state.userData[KEY] = JSON.stringify(ledger([{ id: 'taskIdcrit_0', task: 'one' }])); current.state.cheats.everEnabled = true;
  saves.save(slot.id, current.state); assert.equal(saves.load(slot.id).version, 7); assert.deepEqual(fs.readFileSync(file + '.pre-v7'), bytes);
  const latest = fs.readFileSync(file); assert.throws(() => old.save(slot.id, old.create('Other').state), error => error.code === 'UNSUPPORTED_SAVE'); assert.deepEqual(fs.readFileSync(file), latest);
  saves.rename(slot.id, 'After'); assert.deepEqual(fs.readFileSync(file + '.pre-v7'), bytes); assert.equal(saves.load(slot.id).state.cheats.everEnabled, true);
  const exported = path.join(root, 'island.export'); saves.export(slot.id, exported); const imported = saves.import(exported); assert.deepEqual(JSON.parse(imported.state.userData[KEY]), ledger([{ id: 'taskIdcrit_0', task: 'one' }]));
  fs.unlinkSync(file); assert.throws(() => old.load(slot.id), error => error.code === 'UNSUPPORTED_SAVE'); const recovered = saves.load(slot.id); assert.equal(recovered.recovered, true); assert.equal(recovered.version, 7); assert.equal(recovered.state.cheats.everEnabled, true);
  saves.remove(slot.id); assert.equal(fs.existsSync(file + '.pre-v7'), false);
});
test('imported originals and failed backup/primary migration writes retain retryable bytes; ordinary solo saves stay format 2', t => {
  const root = temp(t), original = new (require('../reference/coop-schema-4/saves.cjs').Saves)(path.join(root, 'old')), state = emptyState(); new CoopData(state).persist();
  const slot = original.create('Import', state), source = original.file(slot.id), bytes = fs.readFileSync(source), saves = new Saves(path.join(root, 'new'));
  const imported = saves.import(source), file = saves.file(imported.id); assert.deepEqual(fs.readFileSync(file + '.pre-v7'), bytes);
  let failBackup = true, failPrimary = false;
  const io = { ...fs, linkSync(from, to) { if (failBackup && to.endsWith('.pre-v7')) throw new Error('Backup refused'); return fs.linkSync(from, to); }, renameSync(from, to) { if (failPrimary && to === source) throw new Error('Primary refused'); return fs.renameSync(from, to); } };
  const migration = new Saves(original.directory, io), loaded = migration.load(slot.id); loaded.state.userData[KEY] = JSON.stringify(ledger());
  assert.throws(() => migration.save(slot.id, loaded.state), /Backup refused/); assert.deepEqual(fs.readFileSync(source), bytes);
  failBackup = false; failPrimary = true; assert.throws(() => migration.save(slot.id, loaded.state), /Primary refused/); assert.deepEqual(fs.readFileSync(source), bytes);
  failPrimary = false; migration.save(slot.id, loaded.state); assert.deepEqual(fs.readFileSync(source + '.pre-v7'), bytes); assert.equal(migration.load(slot.id).version, 7);
  assert.equal(saves.create('Solo').version, 2);
});
test('format-6 reference readers retain their original source hashes', () => {
  const dir = path.join(__dirname, '../reference/coop-schema-4');
  for (const line of fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')) { const [hash, file] = line.split(/\s+/); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex'), hash); }
});

test('task-manager attachment enables tracking for co-op history or a saved ledger, and leaves untracked solo saves alone', () => {
  for (const tracked of ['none', 'coop', 'ledger']) {
    const f = fixture(), controls = new Controls(); controls.app = { globals: { gameManager: f.game } }; controls.bridge = f.bridge;
    if (tracked === 'coop') new CoopData(f.bridge.state).persist(); if (tracked === 'ledger') f.bridge.state.userData[KEY] = JSON.stringify(ledger());
    controls.attachTaskManager(f.manager, f.manager.taskArchetypes);
    assert.equal(!!f.game.desktopQuestRewards, tracked !== 'none'); f.game.desktopQuestRewards?.close();
  }
});

test('the actual original task-manager factory restores tracked rewards after groups exist and detaches on destruction', () => {
  const f = fixture(); f.flags.one = true; f.bridge.state.userData[KEY] = JSON.stringify(ledger([{ id: 'taskIdcrit_0', task: 'one' }]));
  const controls = new Controls(); controls.app = { globals: { gameManager: f.game } }; controls.bridge = f.bridge;
  function Manager() {} Manager.prototype = original;
  const group = list => ({ taskList: list.flat(), handleEvents: () => [], destroy() {} });
  const create = require('./runtime-ast.cjs').taskManagerFactory({ manager: Manager, renderer: { create: () => ({}) }, groups: { create: (_globals, _game, list) => group(list) }, badges: { create: () => ({ destroy() {} }) }, tasks: { archetypes: f.manager.taskArchetypes, criticalTaskList: [['one', 'two']], fillerTaskList: [] }, window: { PolycraftControls: controls } });
  const manager = create({}, f.game, f.flags);
  assert.equal(f.game.desktopQuestRewards.manager, manager); manager.updateCompletedTasks();
  assert.equal(manager.completedTaskRenderInfo.taskArchetypeName, 'one'); assert.equal(f.gifts.length, 0);
  manager.destroy(); assert.equal(f.game.desktopQuestRewards, undefined);
});

test('migration from a recovered format-6 backup preserves its exact bytes, and newer/mismatched ledger formats never fall back silently', t => {
  const root = temp(t), old = new (require('../reference/coop-schema-4/saves.cjs').Saves)(root), state = emptyState(); new CoopData(state).persist();
  const slot = old.create('Recovery', state), file = old.file(slot.id); old.save(slot.id, state);
  const bytes = fs.readFileSync(file + '.bak'); fs.writeFileSync(file, 'broken');
  const saves = new Saves(root), recovered = saves.load(slot.id); assert.equal(recovered.recovered, true);
  recovered.state.userData[KEY] = JSON.stringify(ledger()); saves.save(slot.id, recovered.state);
  assert.deepEqual(fs.readFileSync(file + '.pre-v7'), bytes); assert.equal(saves.load(slot.id).version, 7);
  const current = JSON.parse(fs.readFileSync(file)); current.version = 6; fs.writeFileSync(file, JSON.stringify(current));
  assert.throws(() => saves.load(slot.id), error => error.code === 'UNSUPPORTED_SAVE');
  current.version = 7; current.state.userData[KEY] = JSON.stringify({ version: 2, pending: [] }); fs.writeFileSync(file, JSON.stringify(current));
  assert.throws(() => saves.load(slot.id), error => error.code === 'UNSUPPORTED_SAVE');
});

test('original quest conditions count shared construction/harvest/hero kills and safely ignore missing or destroyed aggressors', () => {
  const ast = require('./runtime-ast.cjs'), built = ast.assignedObject('buildingBuilt'), chop = ast.assignedObject('chopTree', { H: { LUMBER: 0 } }), mine = ast.assignedObject('mineStone', { H: { STONE: 1 } }), killed = ast.assignedObject('enemyKilledByHero');
  const game = { getHero: () => { throw new Error('Shared building counts must not select the host hero'); }, getBuildingManager: () => ({ getBuildingsAtMinLevel: () => ['host-building', 'guest-building'] }) };
  assert.equal(built.isComplete({}, game, { buildingType: 'Wall', count: 2 }), true);
  assert.equal(chop.evaluator({ resourceType: 0, hero: 'guest' }), true); assert.equal(mine.evaluator({ resourceType: 1, hero: 'guest' }), true);
  const victim = { familyName: 'wildling' }, params = { familyName: 'wildling' };
  for (const aggressor of [undefined, null, { toBeDestroyed: true }, { getEC: () => null }]) assert.equal(killed.evaluator({ victim, aggressor }, params), false);
  assert.equal(killed.evaluator({ victim, aggressor: { getEC: () => ({}) } }, params), true);
});
