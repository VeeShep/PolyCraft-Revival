'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const observe = require('./coop-campaign-audit.cjs'), native = require('./runtime-ast.cjs');
const modelPrototype = native.prototypeWith('saveResource');
const pickupMethods = Object.fromEntries(['giveToCollector', 'onPickupXp', 'onPickupSoftCurrency'].map(name => [name, native.method(name)]));
function fixture() {
  const bank = { amber: 61, resource: [300, 133] }, entities = [], listeners = new Map(), active = new Map();
  const game = { getGameSpaceList: () => [{ getEntitiesWithEC: () => entities }], gameClock: { getFrameIndex: () => 17 },
    eventManager: { subscribe(name, callback) { listeners.set(name, callback); }, unsubscribe(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); }, notify(name, data) { listeners.get(name)?.(data); } } };
  for (const [id, xp] of [['host', 0], ['guest', 450]]) {
    const model = Object.assign(Object.create(modelPrototype), { progress: { xp }, resource: bank.resource, resourceCap: [500, 500], globals: { cheats: { grindless: false } }, saveResource() {}, saveSoftCurrency() {} });
    Object.defineProperty(model, 'softCurrency', { get: () => bank.amber, set: value => { bank.amber = value; } });
    const data = { adjustXP: amount => model.addXP(amount), adjustSoftCurrency: amount => model.adjustSoftCurrency(amount) };
    active.set(id, { model, hero: { getName: () => id, getv3Location: () => [1, 2, 3], isManagedByThisMachine: () => true, getEC: name => name === 'ECPlayerData' ? data : null } });
  }
  const factory = { getECArchetype: name => name === 'a_r_amber' ? { softCurrency: 1 } : { xp: Number(/xp(\d+)$/.exec(name)[1]) },
    createActiveEntityInstance(name) {
      const archetype = factory.getECArchetype(name), pickup = Object.assign(Object.create(pickupMethods), { archetype, xp: archetype.xp, gameManager: game,
        onPickupCarriedResource() {}, onPickupResource() {} });
      const entity = { getName: () => 'drop-' + entities.length, getEC: () => pickup }; const id = 'drop-' + entities.length; entity.getName = () => id; entities.push(entity); return entity;
    } };
  game.getEntityFactory = () => factory;
  for (const name of ['giveAmberReward', 'giveXpReward', 'giveReward', 'getRewardAmountList', 'giveRewardQuantityList', 'getRewardQuantityList']) game[name] = native.method(name);
  const definition = { xpReward: 300, amberReward: 1 }, manager = { gameManager: game, taskArchetypes: { winCampaign: definition } };
  game.desktopQuestRewards = { data: { pending: [{ id: 'quest', task: 'winCampaign' }] }, manager,
    award(id, hero) { const index = this.data.pending.findIndex(row => row.id === id); if (index < 0) return false; native.method('giveTaskReward').call(manager, definition, hero); this.data.pending.splice(index, 1); return true; } };
  game.desktopCampaignRewards = { data: { pending: [{ id: 1, owner: 'host', score: { xpBonus: 50, resourceBonusList: [0, 250] } }] },
    award(id, give) { const index = this.data.pending.findIndex(row => row.id === id); if (index < 0) return false; const score = this.data.pending[index].score; give(score.xpBonus, score.resourceBonusList); this.data.pending.splice(index, 1); return true; } };
  const root = { hostWorld: { game, players: { active } } };
  return { root, game, active, entities, bank, listeners };
}
test('campaign audit separates three original100XP quest pickups from unrelated combat XP and preserves native collector credit', () => {
  const f = fixture(), guest = f.active.get('guest'), award = f.game.desktopQuestRewards.award;
  observe(f.root); guest.model.addXP(5);
  assert.equal(f.game.desktopQuestRewards.award('quest', guest.hero), true);
  const quest = f.root.nativeCampaignAudit.quests[0]; assert.equal(quest.xp, 300); assert.equal(quest.amber, 1); assert.equal(quest.drops.length, 4);
  guest.model.addXP(5);
  for (const entity of f.entities) entity.getEC().giveToCollector(guest.hero);
  assert.equal(guest.model.getXP(), 760); assert.equal(f.active.get('host').model.getXP(), 0); assert.equal(f.bank.amber, 62);
  for (const drop of quest.drops) { assert.equal(drop.grants.length, 1); const grant = drop.grants[0]; assert.equal(grant.player, 'guest'); assert.equal(grant.after.xp - grant.before.xp, drop.xp); assert.equal(grant.after.amber - grant.before.amber, drop.amber); }
  assert.deepEqual(f.root.nativeCampaignAudit.errors, []); f.root.restoreNativeCampaignAudit(); assert.equal(f.listeners.size, 0); assert.equal(f.game.desktopQuestRewards.award, award); assert.equal(Object.hasOwn(f.entities[0].getEC(), 'giveToCollector'), false);
});
test('campaign audit observes host-only native score grant and forwards receiver, arguments and return values', () => {
  const f = fixture(); observe(f.root); const host = f.active.get('host').model;
  assert.equal(f.game.desktopCampaignRewards.award(1, (xp, resources) => { host.addXP(xp); resources.forEach((amount, type) => host.adjustResource(type, amount)); }), true);
  assert.equal(f.game.desktopCampaignRewards.award(1, () => assert.fail('Duplicate grant')), false);
  assert.equal(f.root.nativeCampaignAudit.claims.length, 1); const claim = f.root.nativeCampaignAudit.claims[0]; assert.equal(claim.owner, 'host'); assert.equal(claim.after.xp - claim.before.xp, 50); assert.deepEqual(claim.after.resource, [300, 383]); assert.equal(f.active.get('guest').model.getXP(), 450);
  f.root.restoreNativeCampaignAudit();
});
test('campaign audit retains native errors, bounds diagnostic records and preserves later owners during cleanup', () => {
  const f = fixture(), failure = new Error('Native award failure'); f.game.desktopQuestRewards.award = function (...args) { assert.equal(this, f.game.desktopQuestRewards); assert.deepEqual(args, ['quest', null, 'extra']); throw failure; };
  observe(f.root); assert.throws(() => observe(f.root), /already active/); assert.throws(() => f.game.desktopQuestRewards.award('quest', null, 'extra'), error => error === failure);
  for (let i = 0; i < 520; i++) f.game.eventManager.notify('CampaignStarted'); assert.equal(f.root.nativeCampaignAudit.events.length, 512); assert.equal(f.root.nativeCampaignAudit.overflow, true);
  const later = () => {}, other = {}; f.game.desktopQuestRewards.award = later; const restore = f.root.restoreNativeCampaignAudit; f.root.nativeCampaignAudit = other; restore(); assert.equal(f.game.desktopQuestRewards.award, later); assert.equal(f.root.nativeCampaignAudit, other);
});
test('campaign audit serializes without Node closures and diagnostic read errors do not replace native exceptions', () => {
  const f = fixture(), failure = new Error('Native failure'); f.game.getGameSpaceList = () => { throw new Error('Observer read failed'); }; f.game.desktopQuestRewards.award = () => { throw failure; };
  vm.runInNewContext('(' + observe.toString() + ')()', { window: f.root });
  assert.throws(() => f.game.desktopQuestRewards.award('quest'), error => error === failure); assert.match(f.root.nativeCampaignAudit.errors[0], /Observer read failed/); f.root.restoreNativeCampaignAudit();
});

test('campaign audit observes all spawned enemies and native completion independently of credited kill events', () => {
  const f = fixture(), methods = native.component('ECAttackWavesManager');
  const wave = { archetype: { waves: [{}] }, nextWaveIndex: 0, spawnedEntityList: [], isComplete: methods.isComplete, getNumberOfAliveSpawnedEnemies: methods.getNumberOfAliveSpawnedEnemies,
    spawnWave() { this.spawnedEntityList.push(...Array.from({ length: 14 }, (_, i) => ({ getName: () => 'enemy-' + i }))); this.nextWaveIndex++; return 'native'; } };
  observe(f.root); f.root.observeNativeCampaignWave(wave); f.root.observeNativeCampaignWave(wave);
  assert.equal(wave.isComplete(), false); assert.equal(wave.spawnWave(), 'native'); assert.equal(wave.isComplete(), false);
  for (let i = 0; i < 12; i++) f.game.eventManager.notify('EnemyKilled', { victim: wave.spawnedEntityList[i], isCritical: true });
  wave.spawnedEntityList.length = 0; assert.equal(wave.isComplete(), true);
  const audit = f.root.nativeCampaignAudit; assert.equal(audit.kills.length, 12); assert.equal(audit.waves.length, 1); assert.equal(audit.waves[0].spawned.length, 14); assert.equal(audit.waves[0].remaining, 0); assert.equal(audit.waves[0].completed, true); assert.equal(audit.waves[0].nextWave, audit.waves[0].waveCount);
  f.root.restoreNativeCampaignAudit(); assert.equal(Object.hasOwn(wave, 'isComplete'), true); assert.equal(wave.isComplete, methods.isComplete); assert.equal(f.root.observeNativeCampaignWave, undefined);
});
