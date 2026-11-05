'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { craftMenu, craftOffer, GuestCraft } = require('../desktop/crafting.js');
const { HostActions } = require('../desktop/coop-actions.js');
const { GuestWorld } = require('../desktop/guest-world.js');
const { CoopData } = require('../desktop/coop-data.js');
const { emptyState } = require('../desktop/saves.cjs');
const runtime = require('./runtime-ast.cjs');
const window = { PolycraftControls: { cheatsEnabled: () => true } };
const methods = runtime.prototypeWith('getFillFractionText', { window, H: { LUMBER: 0, STONE: 1, NUM_RESOURCES: 2 }, Za: [{ string: 'Wood', convertMetricName: 'wood' }, { string: 'Stone', convertMetricName: 'stone' }], Z: { BUTTON_NORMAL: {} } });
const remap = runtime.staticMethod('A', 'remap', { A: { getFactor: (a, b, x) => (x - a) / (b - a), saturate: x => Math.max(0, Math.min(1, x)), lerp: (a, b, x) => a + (b - a) * x } });
function setup(count = 2) {
  const state = emptyState(), registry = new CoopData(state), metrics = [];
  for (let index = 1; index < count; index++) registry.addPlayer('Friend ' + index);
  const globals = { cheats: { grindless: false }, mathDevice: { remap }, metricsManager: { sendGameMetric: (...args) => metrics.push(args) } };
  const solo = Object.create(runtime.prototypeWith('initHeroUpgrades')); solo.init(globals);
  solo.resourceCap = [1000, 1000]; solo.resource = [900, 900]; solo.softCurrency = 999;
  solo.saveData = (key, value) => { state.userData[key] = JSON.stringify(value); };
  registry.data.economy.softCurrency = 10;
  const models = registry.data.players.map(player => registry.createPlayerData(solo, player.id));
  const heroes = models.map(model => ({ shouldBeDestroyed: () => false, getEC: key => key === 'ECPlayerData' ? model : null }));
  let locked = false;
  const game = { globals, isScriptLocked: () => locked, getGameEntityByName: id => heroes[Number(id)] };
  const controls = { shopMethods: methods, app: { globals } };
  const actions = heroes.map(() => new HostActions(() => 0));
  function run(player, type, choice = {}) {
    const queue = actions[player];
    queue.receive({ type, target: String(player), sequence: queue.sequence + 1, ...choice });
    return queue.apply(game, heroes[player], null, controls);
  }
  return { state, registry, models, heroes, game, controls, actions, run, metrics, solo, lock: value => { locked = value; } };
}
test('crafting retains original pricing boundaries, six native slots, duplicate-price hiding and full/absent storage behavior', () => {
  const f = setup(), menu = craftMenu(f.heroes[1], 1), view = Object.assign(Object.create(methods), { globals: f.game.globals });
  for (const [amount, cost] of [[0, 0], [1, 1], [50, 1], [51, 2], [500, 5], [501, 6], [5000, 25], [5001, 26], [50000, 125], [50001, 126], [500000, 600], [500001, 601], [5000000, 3000], [5000001, 3001]]) assert.equal(view.getCostForResourceAmount(amount), cost);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => craftOffer(menu, index, f.controls)), [
    { resource: 1, fraction: 0.1, amount: 100, cost: 2 }, { resource: 1, fraction: 0.5, amount: 500, cost: 5 }, { resource: 1, fraction: 1, amount: 1000, cost: 8 },
    { resource: 0, fraction: 0.1, amount: 100, cost: 2 }, { resource: 0, fraction: 0.5, amount: 500, cost: 5 }, { resource: 0, fraction: 1, amount: 1000, cost: 8 }
  ]);
  menu.resources = [990, 990]; assert.deepEqual([0, 1, 2, 3, 4, 5].map(index => craftOffer(menu, index, f.controls)?.cost || null), [1, null, null, 1, null, null]);
  menu.resources = [...menu.caps]; assert.ok([0, 1, 2, 3, 4, 5].every(index => !craftOffer(menu, index, f.controls)));
  menu.resources = menu.caps = [0, 0]; assert.equal(craftOffer(menu, 0, f.controls), null);
});
test('guest crafting uses native paid conversions even with cheats enabled, shares resources, persists them and leaves solo data alone', () => {
  const f = setup(); const quote = f.run(1, 'craftMenu');
  const result = f.run(1, 'craftResource', { quote: quote.craft.quote, index: 0 });
  assert.equal(result.save, true); assert.equal(result.craft.quote, 2);
  assert.equal(f.models[0].getSoftCurrency(), 8); assert.equal(f.models[0].getResource(1), 100);
  assert.deepEqual(f.metrics, [['stone', 2]]); assert.equal(f.solo.softCurrency, 999); assert.deepEqual(f.solo.resource, [900, 900]);
  const restored = new CoopData(f.state); assert.deepEqual(restored.data.economy.resource, [0, 100]); assert.equal(restored.data.economy.softCurrency, 8);
});
test('two and four participants cannot overspend shared Amber or reuse an old crafting quote', () => {
  for (const count of [2, 4]) {
    const f = setup(count); f.registry.data.economy.softCurrency = 2;
    const quotes = f.heroes.map((_, index) => f.run(index, 'craftMenu').craft.quote);
    const results = f.heroes.map((_, index) => f.run(index, 'craftResource', { quote: quotes[index], index: index % 2 ? 3 : 0 }));
    assert.equal(results.filter(result => result.save).length, 1); assert.equal(f.registry.data.economy.softCurrency, 0);
    assert.equal(f.registry.data.economy.resource.reduce((a, b) => a + b), 100);
    const repeated = f.run(0, 'craftResource', { quote: quotes[0], index: 0 }); assert.equal(repeated.save, undefined); assert.match(repeated.message, /changed/);
  }
});
test('shared storage and capacity changes invalidate stale offers instead of silently changing a purchase', () => {
  for (const change of [f => { f.registry.data.economy.resource[1] = 950; }, f => { f.solo.resourceCap[1] = 500; }, f => { f.registry.data.economy.resource[1] = 1000; }]) {
    const f = setup(), quote = f.run(1, 'craftMenu').craft.quote; change(f);
    const before = JSON.stringify(f.registry.data.economy), result = f.run(1, 'craftResource', { quote, index: 0 });
    assert.equal(result.save, undefined); assert.match(result.message, /changed/); assert.equal(JSON.stringify(f.registry.data.economy), before); assert.equal(result.craft.quote, 2);
  }
});
test('craft intents reject malformed, extra-authority, replayed and hidden choices without mutating the shared economy', () => {
  const valid = { type: 'craftResource', target: '1', sequence: 2, quote: 1, index: 0 };
  for (const extra of [{ index: -1 }, { index: 6 }, { index: 0.5 }, { quote: 0 }, { quote: 2 }, { quote: '1' }, { amount: 999 }, { cost: 0 }, { playerId: 'host' }, { archetype: 'tree' }]) {
    const actions = new HostActions(); actions.receive({ type: 'craftMenu', sequence: 1, target: '1' }); assert.throws(() => actions.receive({ ...valid, ...extra }), /Invalid/); assert.equal(actions.sequence, 1);
  }
  const f = setup(); f.run(1, 'craftMenu'); assert.throws(() => f.actions[1].receive({ type: 'craftMenu', target: '1', sequence: 1 }), /repeated/);
  assert.match(f.actions[1].execute(f.game, f.heroes[1], null, '0', f.controls, 'craftMenu', { sequence: 2 }), /not available/);
  f.lock(true); assert.match(f.run(1, 'craftMenu').message, /not available/); f.lock(false);
  f.registry.data.economy.resource[1] = 990;
  const quote = f.run(1, 'craftMenu'); assert.equal(f.run(1, 'craftResource', { quote: quote.craft.quote, index: 1 }).save, undefined);
  assert.equal(f.registry.data.economy.softCurrency, 10); assert.equal(f.metrics.length, 0);
});
function guestSetup() {
  const f = setup(), world = Object.create(GuestWorld.prototype), buttons = [], drawn = [], sent = [];
  let clicked = '', flushes = 0;
  Object.assign(world, { controls: f.controls, identity: { entity: '1' }, guiInput: {}, targetSequence: 0, scene: { snapshot: {} }, movement: { nativeFocused: true, keys: new Set(), flush() { flushes++; } },
    connection: { state: 'connected', send: async (kind, payload) => sent.push({ kind, payload }) } });
  f.game.globals.guiRenderer = { getv2RenderLocation: (x, y, anchor) => [x, y, anchor] }; f.game.globals.currentLanguage = { GUI_BUTTON_PLAY: 'Play' }; f.controls.guiTypes = {};
  world.game = { getIMGui: () => ({ doBackground() {}, doText: text => drawn.push(text), doButton(options) { buttons.push(options); return options.id === clicked; } }), getGuiManager: () => ({ addDrawGui: name => drawn.push(name) }) };
  world.craft = new GuestCraft(world);
  return { ...f, world, ui: world.craft, sent, buttons, drawn, click: id => { clicked = id; }, flushes: () => flushes };
}
test('guest Shop button opens a local menu and stops movement while requesting the host menu', () => {
  const f = guestSetup(); f.click('guest-shop'); f.world.drawPauseMenu();
  assert.equal(f.world.localMenu(), true); assert.equal(f.flushes(), 1); assert.equal(f.sent[0].payload.type, 'craftMenu');
  const button = f.buttons.find(button => button.id === 'guest-shop'); assert.equal(button.guiArchetype, 'shop'); assert.deepEqual(button.v2ScreenLocation, [85, 113, 'topLeft']);
});
test('guest crafting renders original native Craft tab/cards/close and sends one purchase without editing local data', () => {
  const f = guestSetup(); f.ui.open(); f.ui.receive({ type: 'craftMenu', sequence: 1, craft: craftMenu(f.heroes[1], 1) }); f.ui.update();
  assert.equal(f.ui.view.panelName, 'resource'); assert.deepEqual(Array.from(f.ui.view.tabList, tab => tab.guiArchetype), ['shopTabCraftUp']);
  assert.equal(f.ui.view.buttonList.length, 6); assert.ok(f.buttons.some(button => button.guiArchetype === 'shopStone' && button.text2 === 'Craft Stone\n2 AMBER'));
  assert.ok(f.buttons.every(button => !button.passive)); assert.ok(f.drawn.includes('bgPattern'));
  f.click('shopFill by Stone2'); f.ui.update(); f.ui.update();
  assert.deepEqual(f.sent[1].payload, { type: 'craftResource', target: '1', sequence: 2, quote: 1, index: 0 }); assert.equal(f.sent.length, 2);
  assert.equal(f.registry.data.economy.resource[1], 0); assert.equal(f.solo.softCurrency, 999);
  f.ui.receive({ type: 'craftResource', sequence: 2, craft: craftMenu(f.heroes[1], 2) }); assert.equal(f.ui.pending, null);
  f.click('Shop Resume'); f.ui.update(); assert.equal(f.world.localMenu(), false);
});
test('cancel, focus loss and resync clear pending craft UI and late replies cannot reopen it', () => {
  for (const reason of ['cancel', 'focus', 'resync', 'paused']) {
    const f = guestSetup(); f.ui.open();
    if (reason === 'cancel') f.world.cancelLocalMenu();
    else { if (reason === 'focus') f.world.movement.nativeFocused = false; if (reason === 'resync') f.world.resyncing = true; if (reason === 'paused') f.world.controls.paused = true; f.ui.update(); }
    f.ui.receive({ type: 'craftMenu', sequence: 1, craft: craftMenu(f.heroes[1], 1) }); assert.equal(f.ui.menu, false); assert.equal(f.ui.view, null);
  }
  const f = guestSetup(); f.ui.open(); f.click('Shop Resume'); f.ui.update(); assert.equal(f.ui.menu, false);
});
test('native guest crafting displays the original full-storage and no-storage messages without drawing resource offers', () => {
  for (const caps of [[0, 0], [1000, 1000]]) {
    const f = guestSetup(); f.ui.open();
    f.ui.receive({ type: 'craftMenu', sequence: 1, craft: { quote: 1, caps, resources: [...caps], amber: 10 } });
    f.ui.update();
    assert.ok(f.drawn.some(text => text.startsWith(caps[0] ? 'Your wood and stone storage is full.' : 'Build resource storage to unlock crafting.')));
    assert.ok(!f.buttons.some(button => ['shopStone', 'shopLumber'].includes(button.guiArchetype)));
    f.click('Shop Resume'); f.ui.update(); assert.equal(f.ui.menu, false);
  }
});
test('craft UI validates every host reply, including late, sparse and wrongly typed details, before changing presentation', () => {
  const f = guestSetup(); f.ui.open(); const menu = craftMenu(f.heroes[1], 1);
  for (const mutate of [m => { m.quote = 2; }, m => { m.caps = Array(2); }, m => { m.resources = [1, -1]; }, m => { m.amber = Infinity; }, m => { m.amber = '10'; }, m => { m.extra = true; }]) {
    const bad = structuredClone(menu); mutate(bad); assert.throws(() => f.ui.receive({ type: 'craftMenu', sequence: 1, craft: bad }), /Invalid crafting/); assert.equal(f.ui.view, null);
  }
  assert.throws(() => f.ui.receive({ type: 'life', sequence: 1, craft: menu }), /Invalid crafting/);
  f.ui.receive({ type: 'craftMenu', sequence: 1, craft: menu }); f.ui.state.resources[0] = 999; assert.equal(menu.resources[0], 0);
});
