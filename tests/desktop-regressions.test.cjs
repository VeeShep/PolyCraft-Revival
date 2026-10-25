'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('./runtime-ast.cjs');

test('fullscreen is allowed only for the local game; the desktop toggle reaches the window', async () => {
  const handlers = {};
  const session = {
    webRequest: { onBeforeRequest() {} },
    setPermissionCheckHandler(handler) { this.check = handler; },
    setPermissionRequestHandler(handler) { this.request = handler; }
  };
  let window;
  class Window {
    constructor() {
      window = this;
      this.webContents = { session, mainFrame: { url: 'polycraft://game/desktop/index.html' }, setWindowOpenHandler() {}, on() {}, setBackgroundThrottling(value) { this.throttled = value; } };
    }
    on() {}
    loadURL() { return Promise.resolve(); }
    isFullScreen() { return !!this.fullscreen; }
    setFullScreen(value) { this.fullscreen = value; }
  }
  const electron = {
    app: { whenReady: () => Promise.resolve(), getPath: () => '/unused', getVersion: () => 'test', on() {} },
    BrowserWindow: Window, crashReporter: { start() {} },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    dialog: {}, Menu: { buildFromTemplate: value => value, setApplicationMenu() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : name === './saves.cjs' ? { Saves: class {} } : name === './logging.cjs' ? { createLogger: () => () => {} } : name === './direct-network.cjs' ? require('../desktop/direct-network.cjs') : require(name),
    __dirname: path.join(__dirname, '../desktop'), process: { env: {}, platform: 'darwin', versions: {}, on() {} }, URL, Response
  });
  await new Promise(resolve => setImmediate(resolve));
  const contents = window.webContents;
  assert.equal(session.check(contents, 'fullscreen', 'polycraft://game'), true);
  assert.equal(session.check(contents, 'fullscreen', 'polycraft://game/'), true);
  for (const [sender, permission, origin] of [[null, 'fullscreen', 'polycraft://game'], [contents, 'media', 'polycraft://game'], [contents, 'fullscreen', 'https://example.com']]) assert.equal(session.check(sender, permission, origin), false);
  const ask = (sender, permission, details) => { let result; session.request(sender, permission, value => { result = value; }, details); return result; };
  const local = { isMainFrame: true, requestingUrl: 'polycraft://game/desktop/index.html' };
  assert.equal(ask(contents, 'fullscreen', local), true);
  assert.equal(ask(contents, 'fullscreen', { ...local, isMainFrame: false }), false);
  assert.equal(ask(contents, 'fullscreen', { ...local, requestingUrl: 'https://example.com' }), false);
  assert.equal(ask(contents, 'media', local), false);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  await assert.rejects(handlers['polycraft:direct']({ sender: null, senderFrame: contents.mainFrame }, 'start', {}), /Invalid caller/);
  await assert.rejects(handlers['polycraft:direct'](event, 'unexpected', {}), /Invalid direct network operation/);
  assert.equal(await handlers['polycraft:version'](event), 'test');
  await handlers['polycraft:reportGraphics'](event, JSON.stringify({ defaultDepthBits: 24, floatPolicy: 'highp' }));
  for (const value of [null, '{}'.repeat(5000), '[]', 'null', 'broken']) await assert.rejects(handlers['polycraft:reportGraphics'](event, value));
  await handlers['polycraft:onlineMode'](event, true);
  assert.equal(contents.throttled, false);
  await handlers['polycraft:onlineMode'](event, false);
  assert.equal(contents.throttled, true);
  await assert.rejects(handlers['polycraft:onlineMode'](event, 'true'), /Invalid online mode/);
  await handlers['polycraft:fullscreen'](event);
  assert.equal(window.isFullScreen(), true);
  await handlers['polycraft:fullscreen'](event);
  assert.equal(window.isFullScreen(), false);
});

test('the original Craft Resource menu explains unavailable storage and shows offers as room appears', () => {
  function Shop() {}
  Shop.prototype = runtime.prototypeWith('setButtonPanal', { window: {}, H: { LUMBER: 0, STONE: 1, NUM_RESOURCES: 2 }, Z: { BUTTON_NORMAL: 0 }, Za: [{ string: 'Lumber' }, { string: 'Stone' }] });
  const shop = new Shop();
  let caps = [0, 0]; let amounts = [0, 0]; let text = []; let buttons = [];
  const player = { getResourceCap: i => caps[i], getResource: i => amounts[i] };
  const gui = { doBackground() {}, doButton: options => { buttons.push(options); return false; }, doText: message => text.push(message) };
  shop.gameManager = { getHero: () => ({ getEC: () => player }), getIMGui: () => gui, getGuiManager: () => ({ addDrawGui() {} }) };
  shop.globals = { guiRenderer: { getv2RenderLocation: () => [0, 0] }, currentLanguage: { GUI_BUTTON_PLAY: 'Play' }, gamePurchaseManager: { getOwned: () => false } };
  const frame = () => { text = []; buttons = []; shop.updateMenu(); return buttons.filter(b => ['shopStone', 'shopLumber'].includes(b.guiArchetype)); };
  shop.setButtonPanal('resource');
  assert.equal(frame().length, 0);
  assert.match(text[0], /Build resource storage/);
  caps = [40, 30]; amounts = [40, 30];
  assert.equal(frame().length, 0);
  assert.match(text[0], /storage is full/);
  amounts = [10, 20];
  assert.ok(frame().length > 0);
  assert.deepEqual(text, []);
  shop.setButtonPanal('amber');
  frame();
  assert.deepEqual(text, []);
});

test('mouse pointer events retain the original mouse input while touch keeps its handler', () => {
  for (const name of ['Down', 'Move', 'Up', 'Cancel']) {
    const handler = runtime.method('onPointer' + name);
    const delivered = [];
    const input = {
      convertPointerToTurbulenzTouch: value => value,
      createTurbulenzTouchEvent: value => value,
      sendEventToHandlers: (handlers, value) => delivered.push(value.pointerType),
      handlers: { touchstart: [], touchmove: [], touchend: [] }, removePointerById() {}
    };
    for (const pointerType of ['mouse', 4, 'touch', 'pen']) handler.call(input, { pointerType });
    assert.deepEqual(delivered, ['touch', 'pen']);
  }
});

test('desktop WASD moves relative to the camera, stops on release and preserves click destinations', () => {
  const update = runtime.method('updateMovementFromKeys', { window: { desktop: {} } });
  const vector = (a, b, amount, out = []) => { for (let i = 0; i < 3; i++) out[i] = a[i] + b[i] * amount; return out; };
  let destination = 'clicked'; let clears = 0;
  const locomotion = { setDestination: value => { destination = Array.from(value); }, clearDestination: () => { clears++; destination = null; } };
  const controller = {
    inputDevice: { keyCodes: { W: 'W', A: 'A', S: 'S', D: 'D' } }, pressedKeys: {},
    getHeroLocation: () => [10, 0, 10], heroEntity: { getEC: () => locomotion },
    globals: { camera: { matrix: [] }, mathDevice: {
      m43At: () => [0, 0, 1], m43Right: () => [1, 0, 0], v3Normalize: (a, out = a) => { const length = Math.hypot(...a); for (let i = 0; i < 3; i++) out[i] = a[i] / length; return out; },
      v3BuildZero: () => [0, 0, 0], v3AddScalarMul: vector, v3LengthSq: a => a.reduce((sum, n) => sum + n * n, 0),
      v3ScalarMul: (a, amount, out) => { for (let i = 0; i < 3; i++) out[i] = a[i] * amount; return out; }, v3Add: (a, b) => vector(a, b, 1)
    } }
  };
  update.call(controller); assert.equal(destination, 'clicked');
  for (const [key, expected] of [['W', [10, 0, 5]], ['S', [10, 0, 15]], ['A', [5, 0, 10]], ['D', [15, 0, 10]]]) {
    controller.pressedKeys = { [key]: true }; update.call(controller); assert.deepEqual(destination, expected);
  }
  controller.pressedKeys = {}; update.call(controller); assert.equal(destination, null); assert.equal(clears, 1);
  destination = 'new click'; update.call(controller); assert.equal(destination, 'new click');
});

test('the engine and totem use editable unspent points and show the same count', () => {
  const methods = runtime.component('ECPlayerData');
  const data = {
    getUpgradePoints: methods.getUpgradePoints, canUpgrade: methods.canUpgrade,
    playerData: { progress: { desktopUpgradePoints: 20 } }, getLevel: () => 3, getUpgradedLevel: () => 2,
    getVisibleXP: () => 10, getVisibleRank: () => 3, getVisibleNextRankXP: () => 100,
    getVisibleCurrentRankXP: () => 0, getTimeSinceAddedXP: () => 0
  };
  assert.equal(data.getUpgradePoints(), 21); assert.equal(data.canUpgrade(), true);
  const notes = [];
  const hud = { getFlashFactor: () => 1, getPulse: () => 1, globals: { gameManager: { getGuiManager: () => ({ addDrawGui: (name, args) => notes.push({ name, ...args }) }) } } };
  runtime.method('drawRanking').call(hud, { getEC: () => data });
  assert.equal(notes.find(n => n.name === 'heroUpgradeNote').text1, '21 HERO UPGRADE');
  data.getUpgradedLevel = () => 23;
  assert.equal(data.getUpgradePoints(), 0); assert.equal(data.canUpgrade(), false);
});

test('returning to the app restores canvas input even when hover state is stale', () => {
  const canvas = {};
  const window = { document: { activeElement: canvas } };
  const method = name => runtime.method(name, { window });
  const input = { canvas, isHovering: false, isWindowFocused: false, handlers: { mouseenter: [] },
    onFocus() { this.isWindowFocused = true; }, setEventHandlersMouseEnter() { this.mouseHandlers = true; },
    sendEventToHandlers() {}, onMouseDown() { this.downs = (this.downs || 0) + 1; this.onFocus(); }, addInternalEventListener() {}
  };
  method('onWindowFocus').call(input);
  assert.equal(input.isWindowFocused, true, 'App return restores keyboard input without waiting for another click');
  input.isWindowFocused = false;
  method('canvasOnMouseDown').call(input, { screenX: 10, screenY: 20 });
  assert.equal(input.downs, 1); assert.equal(input.isWindowFocused, true); assert.equal(input.isHovering, true);
  input.isWindowFocused = false;
  method('canvasOnMouseDown').call(input, { screenX: 11, screenY: 21 });
  assert.equal(input.downs, 2, 'First click must work even when a previous hover flag remains true');
  assert.equal(input.isWindowFocused, true);
  window.document.activeElement = { tagName: 'INPUT' }; input.isWindowFocused = false;
  method('onWindowFocus').call(input);
  assert.equal(input.isWindowFocused, false, 'Returning to a cheat field must not steal input focus');
});

test('returning with an already focused canvas reinstalls the actual root mouse-down listener', () => {
  const window = {}, registrations = [];
  const enter = runtime.method('setEventHandlersMouseEnter', { window });
  const input = { isFocused: () => true, onMouseDown() {}, onMouseUp() {}, onMouseOver() {}, onWheel() {}, emptyEvent() {},
    addInternalEventListener: (target, type, callback) => registrations.push({ target, type, callback }) };
  enter.call(input);
  assert.ok(registrations.some(listener => listener.target === window && listener.type === 'mousedown' && listener.callback === input.onMouseDown), 'Focus must not suppress restoration of a mouse-down handler removed by blur');
});

test('normal shop opens Craft Resource and preserves its conversion flow; premium tabs require cheat mode', () => {
  let enabled = false;
  function Shop() {}
  Shop.prototype = runtime.prototypeWith('setButtonPanal', { window: { PolycraftControls: { cheatsEnabled: () => enabled } }, H: { LUMBER: 0, STONE: 1, NUM_RESOURCES: 2 }, Z: { BUTTON_NORMAL: {} } });
  const shop = new Shop();
  shop.setButtonPanal('amber'); assert.equal(shop.panelName, 'resource');
  assert.deepEqual(Array.from(shop.tabList, tab => tab.text1), ['Craft Resource']);
  shop.globals = { guiRenderer: { getv2RenderLocation: (x, y) => [x, y] }, currentLanguage: { GUI_BUTTON_PLAY: 'Play' } };
  shop.gameManager = {
    getHero: () => ({ getEC: () => ({ getResource: () => 0, getResourceCap: () => 100 }) }),
    getIMGui: () => ({ doBackground() {}, doButton: () => true }),
    getGuiManager: () => ({ addDrawGui() {} }),
    togglePause() { shop.closed = true; }
  };
  shop.updateButton = (x, y) => { assert.ok(Number.isFinite(x) && Number.isFinite(y), 'Every tab/button must have a finite position'); };
  shop.updateMenu(); shop.handleClickEvent(); assert.equal(shop.closed, true);
  shop.setButtonPanal('convert'); assert.equal(shop.panelName, 'convert');
  enabled = true; shop.setButtonPanal('amber'); assert.equal(shop.panelName, 'amber');
  assert.ok(shop.buttonList.some(button => button.text2?.includes('CLAIM FREE')));
  shop.setButtonPanal('resource'); assert.ok(shop.tabList.some(tab => tab.text1 === 'Amber Shop'));
});
