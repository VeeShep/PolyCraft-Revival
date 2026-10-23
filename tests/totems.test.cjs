'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { totemMenu, upgradeTotem, GuestTotem } = require('../desktop/totems.js');
const { HostActions } = require('../desktop/coop-actions.js');
const runtime = require('./runtime-ast.cjs');
function setup() {
  const economy = { amber: 150 }, host = { level: 5, upgrades: { movementSpeed: 2 } }, guest = { level: 1, upgrades: {} };
  const controls = { xpTable: [0, 100, 200, 300, 400, 500] }, players = { active: new Map() };
  let active = true;
  const game = { getGuiManager: () => ({ addGameMessage() {} }), getGameSoundManager: () => ({ play() {} }), getEventManager: () => ({ notify() {} }), isScriptLocked: () => false };
  function hero(model, id) {
    const current = { getEC: key => ({ ECHeroUpgrades: { getHeroUpgrade: name => model.upgrades[name] || 0, setHeroUpgrade: (name, level) => { model.upgrades[name] = level; } },
      ECPlayerData: { getLevel: () => model.level, getUpgradePoints: () => Math.max(0, model.level + (model.bonus || 0) - Object.values(model.upgrades).reduce((sum, value) => sum + value, 0)),
        getSoftCurrency: () => economy.amber, adjustSoftCurrency: amount => { economy.amber += amount; }, levelUp() { model.level++; players.active.get(id).hero = hero(model, id); current.destroyed = true; } },
      ECHealth: { getHealth: () => 50 }, ECPlayerBuilder: { isBuilding: () => false, isThrowing: () => false } })[key], shouldBeDestroyed: () => !!current.destroyed };
    return current;
  }
  players.active.set('host', { hero: hero(host, 'host') }); players.active.set('guest', { hero: hero(guest, 'guest') });
  const definition = { svgPath: 'gui/icon_totem_agility_n.svg', upgradeTypes: [
    { upgradeType: 'movementSpeed', upgradeDisplayName: 'Spirit of Speed', minimumHeroLevel: 0, prerequisiteText: 'None', prerequisites: [], levels: Array.from({ length: 6 }, () => ({ levelText: 'Faster Movement' })) },
    { upgradeType: 'carrySpeed', upgradeDisplayName: 'Spirit of Labour', minimumHeroLevel: 3, prerequisiteText: 'Spirit of Speed', prerequisites: [{ upgradeType: 'movementSpeed', level: 1 }], levels: Array.from({ length: 6 }, () => ({ levelText: 'Faster when carrying' })) }
  ] };
  const source = { getName: () => 'Agility', shouldBeDestroyed: () => false, getEC: key => key === 'ECHeroShrine' ? shrine : key === 'ECInteractable' ? { getActive: () => active } : undefined };
  const shrine = { ...runtime.component('ECHeroShrine'), archetype: definition, gameManager: game, entity: source, upgradeLevels: [2, 0] };
  game.getGameEntityByName = id => id === 'Agility' ? source : null;
  return { economy, host, guest, controls, players, game, source, shrine, definition, hero: () => players.active.get('guest').hero, deactivate: () => { active = false; } };
}
test('totem menu reads the assigned hero, retains original locks and never changes the shared shrine cache or host progression', () => {
  const f = setup(), before = JSON.stringify(f.host), cache = [...f.shrine.upgradeLevels];
  const menu = totemMenu(f.hero(), f.source, f.controls);
  assert.equal(menu.products[0].level, 0); assert.equal(menu.products[0].available, true);
  assert.equal(menu.products[1].available, false); assert.match(menu.products[1].text, /Need to upgrade/);
  f.guest.level = 0; assert.equal(totemMenu(f.hero(), f.source, f.controls).products[0].available, false);
  f.guest.bonus = 1; assert.equal(totemMenu(f.hero(), f.source, f.controls).products[0].available, true, 'Existing host-granted points work at level zero'); f.guest.bonus = 0;
  f.guest.level = 5; f.guest.upgrades.movementSpeed = 5;
  assert.equal(totemMenu(f.hero(), f.source, f.controls).products[0].available, false);
  assert.equal(JSON.stringify(f.host), before); assert.deepEqual(f.shrine.upgradeLevels, cache);
  f.deactivate(); assert.equal(totemMenu(f.hero(), f.source, f.controls), null);
});
test('point upgrades use the original shrine method, reject stale levels/price modes and cannot spend through level/prerequisite/max locks', () => {
  const f = setup(), action = { index: 0, level: 0, amber: false }, before = JSON.stringify(f.host);
  const result = upgradeTotem(f.game, f.hero(), f.players, f.source, action, f.controls);
  assert.equal(result.save, true); assert.equal(result.totem.points, 0); assert.equal(f.guest.upgrades.movementSpeed, 1); assert.equal(f.economy.amber, 150);
  assert.match(upgradeTotem(f.game, f.hero(), f.players, f.source, action, f.controls), /changed/);
  assert.match(upgradeTotem(f.game, f.hero(), f.players, f.source, { index: 1, level: 0, amber: true }, f.controls), /requirements/);
  assert.equal(JSON.stringify(f.host), before); assert.deepEqual(f.shrine.upgradeLevels, [2, 0]);
  f.guest.level = 5; f.guest.upgrades.movementSpeed = 5;
  assert.match(upgradeTotem(f.game, f.hero(), f.players, f.source, { index: 0, level: 5, amber: false }, f.controls), /requirements/);
});
test('the 75-Amber boost replaces the guest hero then upgrades its fresh components, without touching host progress or charging a stale offer', () => {
  const f = setup(); f.guest.upgrades.movementSpeed = 1;
  const oldHero = f.hero(), before = JSON.stringify(f.host);
  assert.match(upgradeTotem(f.game, f.hero(), f.players, f.source, { index: 0, level: 1, amber: false }, f.controls), /changed/);
  assert.equal(f.economy.amber, 150);
  const result = upgradeTotem(f.game, f.hero(), f.players, f.source, { index: 0, level: 1, amber: true }, f.controls);
  assert.equal(result.save, true); assert.notEqual(f.hero(), oldHero); assert.equal(oldHero.destroyed, true);
  assert.equal(f.guest.level, 2); assert.equal(f.guest.upgrades.movementSpeed, 2); assert.equal(result.totem.points, 0);
  assert.equal(f.economy.amber, 75); assert.equal(JSON.stringify(f.host), before);
  assert.equal(totemMenu(f.hero(), f.source, f.controls).products[1].available, true, 'A boost can reach the required level without bypassing prerequisites');
  f.economy.amber = 74;
  assert.match(upgradeTotem(f.game, f.hero(), f.players, f.source, { index: 0, level: 2, amber: true }, f.controls), /requirements/); assert.equal(f.economy.amber, 74);
  f.economy.amber = 150; f.guest.level = 5; f.guest.upgrades = { movementSpeed: 4, carrySpeed: 1 };
  assert.match(upgradeTotem(f.game, f.hero(), f.players, f.source, { index: 0, level: 4, amber: true }, f.controls), /requirements/); assert.equal(f.economy.amber, 150);
});
test('totem actions validate replay, extra authority fields, expected level and exact Amber consent before queueing, then recheck each purchase', () => {
  const f = setup(), first = { type: 'upgrade', sequence: 1, target: 'Agility', index: 0, level: 0, amber: false };
  for (const change of [{ index: 2 }, { level: -1 }, { amber: 'yes' }, { playerId: 'host' }, { sequence: 2 }]) assert.throws(() => new HostActions().receive({ ...first, ...change }), /Invalid/);
  const actions = new HostActions(); actions.receive(first); actions.receive({ ...first, sequence: 2 });
  assert.equal(actions.apply(f.game, f.hero(), f.players, f.controls).save, true);
  assert.match(actions.apply(f.game, f.hero(), f.players, f.controls).message, /changed/);
  assert.equal(f.economy.amber, 150); assert.equal(f.guest.upgrades.movementSpeed, 1);
  const selected = actions.execute(f.game, f.hero(), f.players, 'Agility', f.controls);
  assert.equal(selected.totem.source, 'Agility'); assert.equal(selected.totem.products[0].level, 1);
});
function guestSetup() {
  const f = setup(), sent = [], drawn = []; let clicked = false;
  const world = { controls: { xpTable: f.controls.xpTable, guiTypes: { BUTTON_ROUND: 'round' }, app: { globals: { camera: { worldToScreen: () => [100, 100] }, graphicsDevice: { height: 681 }, guiRenderer: { getScaleFactor: () => 1 } } } },
    movement: { nativeFocused: true }, scene: { entities: new Map([['Agility', { record: { archetype: 'totem', location: [0, 0, 0] } }]]) },
    game: { getEntityFactory: () => ({ getECArchetype: name => name === 'totem' ? f.definition : null }), getGuiManager: () => ({ addDrawGui() {} }),
      getIMGui: () => ({ getRadialScaleFactor: () => 1, getRadialSize: () => 150, getRadialCentre: value => value, addRadialOffset: value => value, doButtonFromGuiArchetype: (style, options, id) => { drawn.push({ style, options, id }); return clicked && id.endsWith('-0'); } }) },
    sendUpgrade: (...args) => { sent.push(args); return 1; }, sendTarget: () => 2 };
  const ui = new GuestTotem(world); world.cancelLocalMenu = () => ui.cancel();
  return { f, ui, world, drawn, sent, click: () => { clicked = true; }, menu: () => totemMenu(f.hero(), f.source, f.controls) };
}
test('guest totem UI uses original artwork, prevents repeat purchases while waiting and closes on saved acknowledgement or cancellation', () => {
  const { ui, world, drawn, sent, click, menu } = guestSetup();
  ui.receive({ type: 'target', totem: menu() }, true); ui.update();
  assert.equal(drawn[0].style, 'heroUpgradeValid'); assert.equal(drawn[0].options.svg1, 'gui/icon_totem_agility_n.svg');
  click(); ui.update(); ui.update(); assert.deepEqual(sent, [['Agility', 0, 0, false]]);
  ui.receive({ type: 'upgrade', sequence: 1, totem: menu(), message: 'Hero upgraded and saved.' }, false); assert.equal(ui.menu, null);
  ui.receive({ type: 'target', totem: menu() }, true); world.resyncing = true; ui.update(); assert.equal(ui.menu, null);
});
test('guest totem menus reject malformed, sparse, unknown-source and out-of-range data before replacing the current menu', () => {
  const { ui, menu } = guestSetup(); ui.receive({ type: 'target', totem: menu() }, true); const before = structuredClone(ui.menu);
  for (const mutate of [value => { value.source = 'unknown'; }, value => { value.points = -1; }, value => { value.level = 99; }, value => { value.products = Array(2); }, value => { value.products[0].level = 6; }, value => { value.products[0].available = 1; }, value => { value.products[0].text = 'x'.repeat(513); }, value => { value.products[0].resources = 999; }]) {
    const value = menu(); mutate(value); assert.throws(() => ui.receive({ type: 'target', totem: value }, true), /Invalid totem/); assert.deepEqual(ui.menu, before);
  }
});

test('guest totem radial menus retain space for the lower label at the canvas edge', () => {
  const { ui, world, drawn, menu } = guestSetup(), gui = world.game.getIMGui();
  world.game.getIMGui = () => ({ ...gui, getRadialCentre: () => [100, 680], addRadialOffset: (center, index) => [center[0], center[1] + (index ? -150 : 150)] });
  ui.receive({ type: 'target', totem: menu() }, true); ui.update();
  assert.equal(drawn[0].options.v2ScreenLocation[1], 561);
  for (const button of drawn) assert.ok(button.options.v2ScreenLocation[1] <= world.controls.app.globals.graphicsDevice.height - 120);
});
