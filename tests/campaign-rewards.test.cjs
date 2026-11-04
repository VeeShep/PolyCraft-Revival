'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ast = require('./runtime-ast.cjs');
const { CampaignRewards, REWARD_KEY, validateCampaignRewards } = require('../desktop/campaign.js');
const { Saves, emptyState, validateState } = require('../desktop/saves.cjs');
const { CoopData } = require('../desktop/coop-data.js');
const { Controls } = require('../desktop/controls.js');
function fixture(state = emptyState()) {
  const bridge = { state }, grants = [], runtime = ast.campaignRuntime({}, {}, {});
  let active = { name: 'GamestatePlaying' };
  const globals = { guiRenderer: { getv2RenderLocation: () => [0, 0] } };
  const player = { adjustXP: value => grants.push(['xp', value]), adjustResource: (index, value) => grants.push(['resource', index, value]) };
  const game = { globals, getScoreInfo: () => manager, getHero: () => ({ getEC: name => name === 'ECPlayerData' ? player : { isBuilding: () => false, isThrowing: () => false } }),
    getActiveGameState: () => active, getPlayState: () => ({ playStateName: 'PlayStateNormal' }), isScriptLocked: () => false,
    getIMGui: () => ({ doBackground() {} }), getGuiManager: () => ({ addDrawGui() {} }),
    setGameState: panel => { active = panel; game.onTransition?.(); } };
  globals.gameManager = game;
  game.eventManager = { subscribe() {}, unsubscribe() {} };
  const controls = { paused: false, ready: () => true, campaignMethods: runtime, infoPanels: { starGuiArchetypeMap: ast.assignedObject('starGuiArchetypeMap') } };
  const panels = { doCampaignEndBookend: (manager, globals, definition, score) => { game.drawn = { definition, score }; return !!game.click; } };
  const playing = { create: () => ({ name: 'GamestatePlaying', setPlayState() {} }) };
  const prototype = ast.campaignScorePanel(panels, playing);
  controls.campaignMethods.createScore = () => Object.assign(Object.create(prototype), { gameManager: game, globals });
  const manager = ast.campaignScore(globals); manager.getHQHealthFactor = () => 1;
  const ledger = game.desktopCampaignRewards = new CampaignRewards(game, bridge, controls);
  function end(victory = true) {
    const definition = runtime.archetypes.campaign_tutorial_01;
    manager.onCampaignStarted(definition); Object.assign(manager.campaignStats, { numberOfEnemiesKilled: 100000, numberOfEnemiesKilledByHero: 100000 }); manager.campaignStats.numberOfHQsDestroyed = victory ? 0 : 1;
    manager.onCampaignEnded(); return ledger.current();
  }
  return { ledger, bridge, game, controls, grants, manager, player, end };
}
test('native campaign completion stages immutable rewards synchronously, survives save/reload and restores the original panel', () => {
  const f = fixture(); assert.equal(f.bridge.state.userData[REWARD_KEY], undefined);
  const row = f.end(); assert.ok(row); assert.equal(row.owner, null); assert.equal(row.score.xpBonus, 50);
  const before = JSON.stringify(f.ledger.data); f.manager.campaignXpBonus = 999; f.ledger.stage(f.manager);
  assert.equal(JSON.stringify(f.ledger.data), before, 'same completed score cannot be staged twice');
  const reloaded = fixture(structuredClone(f.bridge.state)); assert.equal(reloaded.manager.campaignStarStatusList.length, 0);
  reloaded.ledger.update(); const panel = reloaded.game.getActiveGameState();
  assert.equal(panel.name, 'GamestateCampaignScore'); assert.equal(panel.desktopCampaignRewardId, row.id);
  panel.updateMenu(); assert.equal(reloaded.game.drawn.score.xpBonus, 50); assert.equal(reloaded.grants.length, 0);
  reloaded.game.click = true; panel.updateMenu();
  assert.deepEqual(reloaded.grants, [['xp', 50], ['resource', 0, row.score.resourceBonusList[0]], ['resource', 1, row.score.resourceBonusList[1]]]);
  assert.equal(reloaded.ledger.current(), undefined); panel.giveRewards(999, [999, 999]); assert.equal(reloaded.grants.length, 3);
  const after = fixture(structuredClone(reloaded.bridge.state)); after.ledger.update(); assert.equal(after.game.getActiveGameState().name, 'GamestatePlaying');
});
test('co-op rewards stay with the saved host, safely leave a panel on host exit, and resume only when that host returns', () => {
  const state = emptyState(), registry = new CoopData(state); registry.persist(); const host = registry.data.host;
  const f = fixture(state); f.game.desktopPlayers = { registry }; const reward = f.end(); assert.equal(reward.owner, host);
  f.ledger.update(); const panel = f.game.getActiveGameState();
  delete f.game.desktopPlayers; f.game.click = true; panel.updateMenu();
  assert.equal(f.game.getActiveGameState().name, 'GamestatePlaying'); assert.equal(f.grants.length, 0); assert.equal(f.ledger.data.pending.length, 1);
  f.ledger.update(); assert.equal(f.game.getActiveGameState().name, 'GamestatePlaying');
  assert.throws(() => f.ledger.award(reward.id, () => assert.fail('wrong owner')), /hero who earned/);
  const loaded = fixture(structuredClone(state)); loaded.game.desktopPlayers = { registry: new CoopData(loaded.bridge.state) }; loaded.ledger.update();
  loaded.game.click = true; loaded.game.getActiveGameState().updateMenu(); assert.equal(loaded.grants.length, 3); assert.equal(loaded.ledger.data.pending.length, 0);
});
test('a panel binds its exact reward across synchronous exit callbacks and cannot claim a different owner', () => {
  const f = fixture(), first = f.end(); f.ledger.update(); const panel = f.game.getActiveGameState();
  f.end(false); assert.equal(f.ledger.data.pending.length, 2);
  f.game.click = true; panel.updateMenu(); assert.equal(f.ledger.data.pending[0].id, first.id + 1); assert.equal(f.grants[0][1], 50);
  f.ledger.update(); const next = f.game.getActiveGameState();
  f.game.onTransition = () => { f.game.desktopPlayers = { registry: { data: { host: crypto.randomUUID() } } }; };
  assert.throws(() => next.updateMenu(), /hero who earned/); assert.equal(f.grants.length, 3); assert.equal(f.ledger.data.pending.length, 1);
});
test('partial native grants and reentrant saves cannot commit or retry a partially awarded campaign', () => {
  for (const failedStep of [0, 1, 2]) {
    const f = fixture(), reward = f.end(), nativeGive = ast.campaignRewards(); let step = 0;
    const apply = () => { if (step++ === failedStep) throw new Error('injected reward failure'); };
    f.player.adjustXP = apply; f.player.adjustResource = apply;
    assert.throws(() => nativeGive.call({ gameManager: f.game, desktopCampaignRewardId: reward.id }, 1, [1, 1]), /injected/);
    assert.throws(() => f.ledger.assertHealthy(), /Reload/); assert.equal(f.ledger.data.pending.length, 1);
    assert.throws(() => nativeGive.call({ gameManager: f.game, desktopCampaignRewardId: reward.id }, 1, [1, 1]), /Reload/);
    assert.throws(() => ast.method('saveLevel').call(f.game, true), /Reload/);
    const controls = new Controls(); controls.manager = () => f.game;
    f.game.saveLevel = () => assert.fail('checkpoint must refuse before serializing');
    assert.throws(() => controls.writeCheckpoint(), /Reload/);
  }
  const f = fixture(), reward = f.end();
  f.ledger.award(reward.id, () => {
    assert.throws(() => ast.method('saveLevel').call(f.game, true), /Wait for/);
    assert.throws(() => f.ledger.award(reward.id, () => assert.fail('reentrant grant')), /Wait for/);
  });
  f.ledger.assertHealthy(); assert.equal(f.ledger.data.pending.length, 0);
});
test('ledger and native metadata reject malformed, future and orphaned-owner rewards', () => {
  const f = fixture(); f.end(); const data = structuredClone(f.ledger.data);
  for (const change of [v => { v.nextId = 0; }, v => { v.pending.push(v.pending[0]); }, v => { v.pending[0].owner = 'guest'; }, v => { v.pending[0].score.resourceBonusList = Array(2); }, v => { v.pending[0].score.xpBonus = -1; }, v => { v.pending[0].score.starStatusList[0].starName = 'unknown'; }, v => { v.pending[0].extra = true; }]) {
    const bad = structuredClone(data); change(bad); assert.throws(() => validateCampaignRewards(bad), /Invalid/);
  }
  assert.throws(() => validateCampaignRewards({ ...data, version: 2 }), e => e.code === 'UNSUPPORTED_SAVE');
  const badState = structuredClone(f.bridge.state); data.pending[0].owner = crypto.randomUUID(); badState.userData[REWARD_KEY] = JSON.stringify(data);
  assert.throws(() => validateState(badState), /not the saved co-op host/);
  data.pending[0].owner = null; data.pending[0].campaign = 'missing_campaign'; badState.userData[REWARD_KEY] = JSON.stringify(data);
  assert.throws(() => fixture(badState), /Invalid campaign result/);
});
test('pending results wait for normal ready play and retain their owner through solo/co-op mode changes', () => {
  const f = fixture(); f.end();
  for (const [object, key, value] of [[f.controls, 'paused', true], [f.controls, 'guestWorld', {}], [f.controls, 'ready', () => false], [f.game, 'isScriptLocked', () => true], [f.game, 'getPlayState', () => ({ playStateName: 'PlayStateBattle' })]]) {
    const previous = object[key]; object[key] = value; f.ledger.update(); object[key] = previous;
    assert.equal(f.game.getActiveGameState().name, 'GamestatePlaying'); assert.equal(f.ledger.data.pending.length, 1);
  }
  f.game.getHero = () => ({ getEC: () => ({ isBuilding: () => true }) }); f.ledger.update();
  assert.equal(f.game.getActiveGameState().name, 'GamestatePlaying'); assert.equal(f.grants.length, 0);
});
test('format 8 migration preserves exact original bytes, sticky history, recovery and export/import; format 7 reader refuses overwrite', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-campaign-saves-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const saves = new Saves(directory), slot = saves.create('Campaign', emptyState(), 7), file = saves.file(slot.id), before = fs.readFileSync(file);
  const f = fixture(slot.state); f.end(); f.bridge.state.cheats.enabled = true;
  assert.equal(saves.save(slot.id, f.bridge.state).version, 8); assert.deepEqual(fs.readFileSync(file + '.pre-v8'), before);
  const legacy = { exports: {} }, oldSource = fs.readFileSync(path.join(__dirname, '../reference/save-schema-7/saves.cjs'), 'utf8');
  new Function('require', 'module', 'exports', oldSource)(require('node:module').createRequire(require.resolve('../desktop/saves.cjs')), legacy, legacy.exports);
  const old = new legacy.exports.Saves(directory);
  assert.throws(() => old.load(slot.id), e => e.code === 'UNSUPPORTED_SAVE'); assert.throws(() => old.save(slot.id, slot.state), /Unsupported/);
  saves.rename(slot.id, 'Retained'); const exported = path.join(directory, '../' + path.basename(directory) + '-export.json'); t.after(() => fs.rmSync(exported, { force: true }));
  saves.export(slot.id, exported); const imported = saves.import(exported); assert.equal(imported.version, 8);
  assert.deepEqual(JSON.parse(imported.state.userData[REWARD_KEY]), f.ledger.data);
  fs.writeFileSync(file, '{broken'); const recovered = saves.load(slot.id); assert.equal(recovered.recovered, true); assert.equal(recovered.state.cheats.everEnabled, true);
  assert.throws(() => old.load(slot.id), e => e.code === 'UNSUPPORTED_SAVE');
  assert.deepEqual(JSON.parse(recovered.state.userData[REWARD_KEY]), f.ledger.data); assert.deepEqual(fs.readFileSync(file + '.pre-v8'), before);
  const legacyExport = path.join(directory, '../' + path.basename(directory) + '-legacy.json'); t.after(() => fs.rmSync(legacyExport, { force: true }));
  fs.writeFileSync(legacyExport, before); const importedLegacy = saves.import(legacyExport);
  assert.deepEqual(fs.readFileSync(saves.file(importedLegacy.id) + '.pre-v8'), before);
  const next = fixture(importedLegacy.state); next.end(); saves.save(importedLegacy.id, next.bridge.state);
  assert.deepEqual(fs.readFileSync(saves.file(importedLegacy.id) + '.pre-v8'), before);
  const recoverySlot = saves.create('Legacy recovery', emptyState(), 7), recoveryFile = saves.file(recoverySlot.id);
  saves.rename(recoverySlot.id, 'Legacy backup'); const recoveryBytes = fs.readFileSync(recoveryFile + '.bak');
  fs.writeFileSync(recoveryFile, '{broken'); const fromBackup = saves.load(recoverySlot.id); assert.equal(fromBackup.recovered, true);
  const restored = fixture(fromBackup.state); restored.end(); saves.save(recoverySlot.id, restored.bridge.state);
  assert.deepEqual(fs.readFileSync(recoveryFile + '.pre-v8'), recoveryBytes);
});
