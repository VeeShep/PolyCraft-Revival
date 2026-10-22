'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controls } = require('../desktop/controls.js');
test('exact Amber setting bypasses Crown doubling and resources respect capacity', () => {
  const controls = new Controls();
  let amber = 5; const resources = [10, 20];
  const data = {
    getSoftCurrency: () => amber, getResource: i => resources[i], getResourceCap: i => [100, 80][i],
    playerData: { adjustSoftCurrency: delta => { amber += delta; } },
    adjustResource: (i, delta) => { resources[i] += delta; }
  };
  controls.data = () => data;
  assert.deepEqual(controls.setAmounts(500, 999, 999), { amber: 500, wood: 100, stone: 80, woodCap: 100, stoneCap: 80 });
  assert.deepEqual(controls.setAmounts(0, 0, 0), { amber: 0, wood: 0, stone: 0, woodCap: 100, stoneCap: 80 });
  for (const invalid of [-1, NaN, Infinity, 1.5, 2147483648]) assert.throws(() => controls.setAmounts(invalid, 0, 0), /whole numbers/);
});

test('fullscreen quest receives one event for each actual entry', () => {
  const controls = new Controls();
  const events = [];
  controls.manager = () => ({ getEventManager: () => ({ notify: name => events.push(name) }) });
  for (const entered of [false, true, true, false, false, true]) controls.fullscreenChanged(entered);
  assert.deepEqual(events, ['GoFullScreen', 'GoFullScreen']);
});

test('hero progression edits level, within-level XP and unspent points without erasing upgrades', () => {
  const controls = new Controls();
  controls.xpTable = [0, 600, 1121];
  controls.app = { globals: { appCurrentTime: 20 } };
  let totalXP = 650;
  let saved = 0; let refreshed = 0; let events = 0;
  const progress = { xp: totalXP };
  const data = {
    playerData: { progress, addXP: amount => { totalXP += amount; progress.xp = totalXP; } },
    getLevel: () => totalXP >= 1121 ? 2 : totalXP >= 600 ? 1 : 0,
    getXP: () => totalXP, getUpgradedLevel: () => 1,
    getUpgradePoints: () => Math.max(0, data.getLevel() + (progress.desktopUpgradePoints || 0) - 1),
    saveProgress: () => saved++, sendLevelUpEvent: () => events++,
    adjustXP: amount => { data.playerData.addXP(amount); if (data.getLevel() > 1) refreshed++; }
  };
  controls.data = () => data;
  controls.manager = () => ({ refreshHeroEntity: () => refreshed++ });
  assert.deepEqual(controls.setProgression(2, 20, 50), { level: 2, xp: 20, points: 50, maxLevel: 2 });
  assert.equal(totalXP, 1141);
  assert.equal(progress.desktopUpgradePoints, 49);
  // A normal totem purchase raises spent upgrades by one and consumes one point.
  data.getUpgradedLevel = () => 2;
  data.getUpgradePoints = () => Math.max(0, data.getLevel() + (progress.desktopUpgradePoints || 0) - data.getUpgradedLevel());
  assert.equal(controls.progression().points, 49);
  assert.deepEqual(controls.setProgression(0, 100, 0), { level: 0, xp: 100, points: 0, maxLevel: 2 });
  assert.equal(data.getUpgradedLevel(), 2);
  assert.equal(refreshed, 2); assert.equal(events, 1); assert.equal(saved, 2);
  for (const args of [[-1, 0, 0], [3, 0, 0], [1, 521, 0], [0, -1, 0], [0, 0.5, 0], [0, 0, -1], [0, 0, 1000001], [NaN, 0, 0], [2, 2147483647, 0]]) {
    assert.throws(() => controls.setProgression(...args));
    assert.equal(totalXP, 100, 'Invalid input must not mutate progression');
  }
});

test('direct totem cheats validate the whole edit, refresh real upgrades and preserve points', () => {
  const controls = new Controls();
  const upgrades = { movementSpeed: 1, maxHealth: 0, total: 1 };
  const progress = {};
  let refreshes = 0; let menuRefreshes = 0; let saves = 0; let events = 0;
  const data = {
    playerData: { progress, getHeroUpgrade: type => upgrades[type] || 0, setHeroUpgrade: (type, value) => { upgrades.total += value - (upgrades[type] || 0); upgrades[type] = value; } },
    getUpgradePoints: () => Math.max(0, 3 + (progress.desktopUpgradePoints || 0) - upgrades.total),
    getUpgradedLevel: () => upgrades.total, getLevel: () => 3, saveProgress: () => saves++
  };
  const shrine = {
    archetype: { upgradeTypes: ['movementSpeed', 'maxHealth'].map(type => ({ upgradeType: type, upgradeDisplayName: type, levels: Array(6) })) },
    evaluateupgradeTypesValidity: () => menuRefreshes++
  };
  controls.data = () => data;
  controls.manager = () => ({ getGameSpaceList: () => [{ getEntitiesWithEC: () => [{ getEC: () => shrine }] }], getHero: () => ({ getEC: () => ({ refreshUpgrades: () => refreshes++ }) }), getEventManager: () => ({ notify: () => events++ }) });
  assert.equal(controls.totemUpgrades().length, 2);
  for (const values of [{ movementSpeed: 5, maxHealth: 6 }, { movementSpeed: 2 }, { movementSpeed: 5, maxHealth: 1, bogus: 1 }, { movementSpeed: -1, maxHealth: 0 }, { movementSpeed: 1.5, maxHealth: 0 }, { movementSpeed: NaN, maxHealth: 0 }]) {
    assert.throws(() => controls.setTotemUpgrades(values));
    assert.deepEqual(upgrades, { movementSpeed: 1, maxHealth: 0, total: 1 });
  }
  controls.setTotemUpgrades({ movementSpeed: 5, maxHealth: 5 });
  assert.equal(data.getUpgradePoints(), 2); assert.equal(upgrades.total, 10);
  assert.equal(refreshes, 1); assert.equal(menuRefreshes, 1); assert.equal(saves, 1); assert.equal(events, 1);
  controls.setTotemUpgrades({ movementSpeed: 0, maxHealth: 0 });
  assert.equal(data.getUpgradePoints(), 2); assert.equal(upgrades.total, 0);
  controls.setTotemUpgrades({ movementSpeed: 0, maxHealth: 0 });
  assert.equal(refreshes, 2, 'Unchanged values must not reapply health upgrades or fire events');
});

test('all eight original totem stats apply their original maximum and base values', () => {
  const runtime = require('./runtime-ast.cjs');
  const component = runtime.component('ECHeroUpgrades');
  component.archetype = runtime.objectWith('movementSpeedFactors');
  let level = 5; const stats = {};
  component.playerData = { getHeroUpgrade: () => level };
  const targets = {
    ECLocomotion: { setFastSpeedFactor: value => { stats.speed = value; } },
    ECResourceCarrier: { setEncumberedSpeedFactor: value => { stats.carrySpeed = value; }, adjustMaxBlocks: value => { stats.capacity = value; }, setAddedBlocksPerChop: value => { stats.chop = value; } },
    ECFirearm: { setDamageFactor: value => { stats.damage = value; }, setReloadSpeedFactor: value => { stats.reload = value; } },
    ECHealth: { getBaseMaxHealth: () => 100, upgradeMaxHealth: value => { stats.health = value; }, setExplosionDamageFactor: value => { stats.resistance = value; } }
  };
  component.getEntityEC = name => targets[name];
  component.refreshUpgrades();
  assert.deepEqual(stats, { speed: 1.2, carrySpeed: 1.2, damage: 1.2, reload: 1.2, health: 120, resistance: 0.8, capacity: 10, chop: 5 });
  level = 0; component.refreshUpgrades();
  assert.deepEqual(stats, { speed: 1, carrySpeed: 1, damage: 1, reload: 1, health: 100, resistance: 1, capacity: 0, chop: 0 });
});

test('demolition allows owned player buildings and protects map structures, anchors and stacks', () => {
  const controls = new Controls(); let destroyed = 0; let cleaned = 0;
  const make = (id, extra = {}) => {
    const components = { ECBuilding: { getBuildingName: () => id, getBuildingType: () => 'Storage', getLevel: () => 1, getBuildingsAbove: () => [] }, ECFaction: { getFactionName: () => 'hero' }, ...extra.components };
    return { shouldPlayerSave: true, shouldBeDestroyed: () => false, getEC: name => components[name], getName: () => id, getv3Location: () => [1, 2, 3], setToBeDestroyed: () => destroyed++, ...extra };
  };
  const entities = [make('storage'), make('map', { shouldLevelSave: true }), make('anchor', { components: { ECPlacedBuildingTracker: {} } }), make('scaffold', { components: { ECScaffold: {} } }), make('lower', { components: { ECBuilding: { getBuildingName: () => 'Wall', getBuildingType: () => 'Wall', getLevel: () => 1, getBuildingsAbove: () => [{}] } } }), make('enemy', { components: { ECFaction: { getFactionName: () => 'enemy' } } })];
  controls.data = () => ({});
  controls.manager = () => ({ getFactionManager: () => ({ getHeroFactionName: () => 'hero' }), getGameSpaceList: () => [{ getEntitiesWithEC: () => entities, destroyDeadEntities: () => cleaned++ }], getGameEntityByName: id => entities.find(entity => entity.getName() === id) });
  assert.equal(entities.filter(entity => controls.demolitionInfo(entity)).length, 5);
  for (const id of ['map', 'anchor', 'scaffold', 'lower', 'enemy', 'missing']) assert.throws(() => controls.demolishBuilding(id));
  assert.equal(destroyed, 0); assert.equal(cleaned, 0);
  controls.demolishBuilding('storage'); assert.equal(destroyed, 1); assert.equal(cleaned, 1);
});

test('demolition confirmation uses the original game dialog and buttons, then restores the play state', async () => {
  const controls = new Controls();
  
  let clicked; let escape = false; let paused = false; let resumed = 0; let text;
  const drawn = [];
  const previous = { name: 'GamestatePlaying', enterState: () => resumed++, exitState() {} };
  let state = previous;
  const controller = { clearInputs() {}, setModeMenuScreen() {}, update() {}, isPressed: () => escape };
  const game = { getActiveGameState: () => state, isPaused: () => paused, getGameController: () => controller, onEnterMenu() {}, startPaused: () => { paused = true; }, exitPaused: () => { paused = false; }, getGameSoundManager: () => ({ update() {} }),
    getGuiManager: () => ({ addDrawGui: (archetype, args) => { assert.equal(archetype, 'modalMessageFrame'); text = args.text1; assert.match(text, /No refund/); assert.match(text, /capacity/i); } }),
    getIMGui: () => ({ doBackground() {}, doButton: options => { drawn.push(options); return clicked === options.id; } }),
    setGameState: value => { state.exitState(); state = value; state.enterState(); }
  };
  controls.manager = () => game;
  controls.app = { globals: { guiRenderer: { getv2RenderLocation: (x, y) => [x, y] }, inputDevice: { keyCodes: { ESCAPE: 27 } } } };
  for (const [choice, expected] of [['demolition-cancel', false], ['demolition-confirm', true], ['escape', false]]) {
    clicked = undefined; escape = false;
    const result = controls.confirmDemolition({ name: 'Lumber Storage' });
    assert.equal(state.name, 'GamestateDemolition'); assert.equal(paused, true);
    state.update(); assert.match(text, /Demolish Lumber Storage/);
    assert.equal(drawn.at(-2).guiArchetype, 'shopClose'); assert.equal(drawn.at(-1).guiArchetype, 'demolitionConfirm');
    clicked = choice; escape = choice === 'escape'; state.update();
    assert.equal(await result, expected); assert.equal(state, previous); assert.equal(paused, false);
  }
  assert.equal(resumed, 3);
});

test('the documented secret code opens Cheats only for focused gameplay and consumes game shortcuts', () => {
  const { CHEAT_CODE, createCheatCodeHandler } = require('../desktop/controls.js');
  assert.equal(CHEAT_CODE, 'moreamberplease');
  let focused = false; let opened = 0; let consumed = 0; let time = 0;
  const handler = createCheatCodeHandler(() => focused, () => opened++);
  const type = value => { for (const key of value) handler({ key, timeStamp: time += 50, preventDefault() { consumed++; }, stopImmediatePropagation() {} }); };
  type(CHEAT_CODE); assert.equal(opened, 0); assert.equal(consumed, 0);
  focused = true; type(CHEAT_CODE); assert.equal(opened, 1); assert.equal(consumed, CHEAT_CODE.length);
  type(CHEAT_CODE.toUpperCase()); assert.equal(opened, 1);
  type('moreamber'); time += 4000; type('please'); assert.equal(opened, 1);
  type(CHEAT_CODE); assert.equal(opened, 2);
  const controls = new Controls(); controls.app = { globals: {} };
  controls.settings({ enabled: false, invincible: true, instantBuild: true });
  assert.deepEqual(controls.app.globals.desktopCheats, {});
  controls.settings({ enabled: true, invincible: true }); assert.equal(controls.cheatsEnabled(), true);
});
