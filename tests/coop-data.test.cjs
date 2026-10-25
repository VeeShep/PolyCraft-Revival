'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoop, validateCoop, CoopData, KEY } = require('../desktop/coop-data.js');
const { emptyState } = require('../desktop/saves.cjs');
const runtime = require('./runtime-ast.cjs');

test('co-op records start separately from solo data and keep one host plus three distinct saved guest heroes', () => {
  const state = emptyState(); state.userData.progress = '{"xp":9000}'; state.userItems.amber = { amount: 20 };
  const coop = new CoopData(state);
  assert.equal(Object.hasOwn(state.userData, KEY), false, 'Reading alone does not start co-op or migrate a save');
  assert.equal(coop.data.players[0].progress.xp, 0); assert.equal(coop.data.economy.softCurrency, 0);
  assert.deepEqual(coop.data.economy.userItems, {});
  for (const name of ['One', 'Two', 'Three']) coop.addPlayer(name);
  const before = state.userData[KEY];
  assert.throws(() => coop.addPlayer('Five'), /four saved/);
  assert.equal(state.userData[KEY], before);
  const loaded = new CoopData(state);
  assert.deepEqual(loaded.data, coop.data);
  assert.equal(new Set(loaded.data.players.map(player => player.id)).size, 4);
  assert.equal(loaded.data.host, loaded.data.players[0].id);
  assert.equal(state.userData.progress, '{"xp":9000}'); assert.deepEqual(state.userItems.amber, { amount: 20 });
  assert.throws(() => loaded.player('__proto__'), /does not belong/);
});
test('co-op validation rejects incompatible records, duplicate identities, invalid progression, balances and inventories', () => {
  for (const mutate of [
    value => { value.extra = true; }, value => { value.players.push(structuredClone(value.players[0])); },
    value => { value.host = 'missing'; }, value => { value.players[0].progress.xp = -1; },
    value => { value.players[0].progress.desktopUpgradePoints = Infinity; },
    value => { value.players[0].heroUpgrades = { movementSpeed: 6, total: 6 }; },
    value => { value.players[0].heroUpgrades = { movementSpeed: 1, total: 0 }; },
    value => { value.players[0].gameStats.totalEnemiesKilled = '2'; },
    value => { value.players[0].location = [0, NaN, 1]; },
    value => { value.players[0].health = { current: 100, maximum: 50 }; },
    value => { value.players[0].inventory.weapon = '../unsafe'; },
    value => { value.players[0].rotation = Infinity; },
    value => { value.players[0].inventory.mainWeapon = '../unsafe'; },
    value => { value.players[0].inventory.temporaryAmmo = -1; },
    value => { value.players[0].inventory.carried = [3]; },
    value => { value.economy.resource[0] = 1.5; }, value => { value.economy.softCurrency = -5; },
    value => { value.economy.userItems = { unknown: { amount: 1 } }; },
    value => { value.economy.pendingPlacements = 1; },
    value => { value.players[0].shareData = JSON.parse('{"__proto__":1}'); }
  ]) {
    const value = createCoop(); mutate(value); assert.throws(() => validateCoop(value), /Invalid co-op/);
  }
  const future = createCoop(); future.version++;
  assert.throws(() => validateCoop(future), error => error.code === 'UNSUPPORTED_SAVE');
  assert.throws(() => new CoopData({ userData: { [KEY]: '' } }));
});
test('schema 1 migrates on an owned copy and schema 4 retains weapon state and defaults missing held inventory to empty', () => {
  const legacy = require('../reference/coop-schema-1/coop-data.js').createCoop();
  legacy.players[0].inventory = { weapon: 'wp_h_pistol', ammo: 3, carried: [7, 8] };
  const state = emptyState(), original = JSON.stringify(legacy);
  state.userData[KEY] = original;
  const registry = new CoopData(state), hero = registry.data.players[0];
  assert.equal(state.userData[KEY], original, 'Reading alone never replaces the original record');
  assert.equal(registry.data.version, 4); assert.equal(hero.construction, null); assert.equal(hero.rotation, 0);
  assert.deepEqual(hero.inventory, { weapon: 'wp_h_pistol', mainWeapon: 'wp_h_pistol', ammo: 3, temporaryAmmo: 0, carried: [7, 8] });
  hero.rotation = -0.8;
  hero.inventory = { weapon: 'wp_h_bombs', mainWeapon: 'wp_h_pistol', ammo: 2, temporaryAmmo: 13, carried: [7, 8] };
  registry.persist();
  assert.deepEqual(new CoopData(state).data, registry.data);
  assert.throws(() => require('../reference/coop-schema-1/coop-data.js').validateCoop(registry.data), error => error.code === 'UNSUPPORTED_SAVE');
});
test('actual original player-data methods share the co-op economy and world settings while preserving separate XP/upgrades/stats and solo inventory', () => {
  const state = emptyState(), coop = new CoopData(state), guest = coop.addPlayer('Friend');
  const solo = Object.create(runtime.prototypeWith('initHeroUpgrades'));
  solo.init({ cheats: { grindless: false } });
  solo.progress.xp = 700; solo.resource = [90, 60]; solo.resourceCap = [200, 100]; solo.softCurrency = 900;
  solo.saveData = (key, value) => { state.userData[key] = JSON.stringify(value); };
  const hostModel = coop.createPlayerData(solo, coop.data.host), guestModel = coop.createPlayerData(solo, guest.id);
  hostModel.addXP(30); hostModel.saveProgress(); guestModel.addXP(55); guestModel.saveProgress();
  guestModel.setHeroUpgrade('movementSpeed', 2); guestModel.addKill(); guestModel.saveGameStats();
  hostModel.adjustResource(0, 17); guestModel.adjustResource(0, -5); hostModel.adjustSoftCurrency(40); guestModel.adjustSoftCurrency(-10);
  assert.equal(hostModel.getResource(0), 12); assert.equal(guestModel.getResource(0), 12);
  assert.equal(hostModel.getSoftCurrency(), 30); assert.equal(guestModel.getSoftCurrency(), 30);
  assert.equal(hostModel.getXP(), 30); assert.equal(guestModel.getXP(), 55);
  assert.equal(hostModel.getHeroUpgrade('movementSpeed'), 0); assert.equal(guestModel.getHeroUpgrade('movementSpeed'), 2);
  assert.equal(hostModel.getTotalEnemiesKilled(), 0); assert.equal(guestModel.getTotalEnemiesKilled(), 1);
  assert.equal(solo.getXP(), 700); assert.equal(solo.getSoftCurrency(), 900); assert.deepEqual(solo.resource, [90, 60]);
  guestModel.setScriptFlag('sharedQuest', true);
  assert.equal(hostModel.getScriptFlags().sharedQuest, true); assert.equal(solo.getScriptFlags().sharedQuest, true);
  guestModel.setShadowsEnabled(true); assert.equal(hostModel.getShadowsEnabled(), true);
  assert.equal(JSON.parse(state.userData.scriptFlags).sharedQuest, true);
  assert.equal(Object.hasOwn(state.userData, 'progress'), false, 'Co-op XP never writes the solo progression key');
  const restored = new CoopData(state), restoredGuest = restored.createPlayerData(solo, guest.id);
  assert.equal(restoredGuest.getXP(), 55); assert.equal(restoredGuest.getHeroUpgrade('movementSpeed'), 2);
  assert.equal(restoredGuest.getSoftCurrency(), 30);
  assert.throws(() => restoredGuest.saveData('unknown', {}), /Unsupported/);
  assert.throws(() => restoredGuest.loadData('unknown', () => {}), /Unsupported/);
});

test('held construction validates complete flags, bounded references and quantities, rejecting sparse vectors and duplicate moved identities', () => {
  const { validateConstruction } = require('../desktop/coop-data.js');
  const held = { archetype: 'a_b_wall', quantity: 2, instant: false, infinite: false, isNew: true, cannotCancel: true, payWhenPlacing: false, parent: 'HQ_1', moveFrom: null, lastPlaced: [1, 2, 3] };
  assert.deepEqual(validateConstruction(structuredClone(held)), held);
  for (const change of [{ extra: true }, { quantity: 0 }, { quantity: Infinity }, { archetype: '../wall' }, { infinite: 1 }, { parent: '' }, { parent: 'x'.repeat(257) }, { lastPlaced: Array(3) }, { lastPlaced: [0, NaN, 0] }, { moveFrom: 'Wall_1' }]) assert.throws(() => validateConstruction({ ...held, ...change }), /Invalid co-op/);
  const data = createCoop(), guest = new CoopData(emptyState()).addPlayer('Friend');
  data.players.push(guest);
  for (const player of data.players) { player.location = [0, 0, 0]; player.construction = { ...held, quantity: 1, isNew: false, moveFrom: 'Wall_1' }; }
  assert.throws(() => validateCoop(data), /two heroes/);
  data.players[1].construction.moveFrom = 'Wall_2'; assert.equal(validateCoop(data), data);
  for (const mutate of [value => { value.players[0].location = Array(3); }, value => { value.players[0].inventory.carried = Array(2); }, value => { value.economy.resource = Array(2); }]) {
    const value = structuredClone(data); mutate(value); assert.throws(() => validateCoop(value), /Invalid co-op/);
  }
});
