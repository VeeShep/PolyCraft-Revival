'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controls } = require('../desktop/controls.js');
const { GuestScene, GuestWorld } = require('../desktop/guest-world.js');
test('guest original-style demolition menus use presentation input only, support cancel/confirm and disappear when the target vanishes', () => {
  const calls = [], world = Object.create(GuestWorld.prototype);
  let choice = null, radial = false;
  world.guiInput = { down: false, pendingDown: false }; world.movement = { keys: new Set(), nativeFocused: true };
  world.selectedBuilding = { id: 'storage', name: 'Storage', reason: '' };
  world.scene = { entities: new Map([['storage', { record: { location: [1, 0, 2] } }]]) };
  world.controls = { guiTypes: { BUTTON_ROUND: {} }, drawDemolitionPrompt: building => { assert.equal(building.id, 'storage'); return choice; }, app: { globals: { camera: { worldToScreen: () => [100, 100] } } } };
  world.game = { getIMGui: () => ({ doButton: options => { assert.equal(options.guiArchetype, 'demolish'); return radial; } }) };
  world.sendTarget = (type, id) => calls.push({ type, id });
  world.updateMenu(); assert.equal(world.localMenu(), true); assert.equal(world.demolition, undefined);
  radial = true; world.updateMenu(); assert.equal(world.demolition.id, 'storage'); assert.equal(world.selectedBuilding, null);
  choice = false; world.updateMenu(); assert.equal(world.localMenu(), false); assert.deepEqual(calls, []);
  world.demolition = { id: 'storage', name: 'Storage' }; choice = true; world.updateMenu();
  assert.deepEqual(calls, [{ type: 'demolish', id: 'storage' }]); assert.equal(world.localMenu(), false);
  world.demolition = { id: 'storage', name: 'Storage' }; world.scene.entities.clear(); world.updateMenu();
  assert.equal(world.localMenu(), false); assert.equal(calls.length, 1);
});
const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function snapshot(tick = 1) {
  const entity = id => ({ id, archetype: null, interactive: true, location: [2, 0, 3], scale: [1, 1, 1], rotation: 0,
    mesh: { path: 'hero.dae', transform: identity(), visible: true, skin: null }, health: { current: 40, maximum: 50 } });
  return { version: 3, tick, time: tick / 30, dayTime: 12, hero: 'hero', torch: null, spaces: [{
    extents: [-10, -10, -10, 10, 10, 10], transform: identity(),
    blocks: [{ archetype: 'grass', location: [1, 0, 2], scale: [2, 1, 2], rotation: 0 }],
    entities: [entity('hero'), entity('pickup')]
  }] };
}
function setup() {
  const roots = [], calls = [];
  const scene = { rootNodes: roots, addRootNode(node) { roots.push(node); }, removeRootNode(node) { roots.splice(roots.indexOf(node), 1); } };
  function node(path) {
    const value = { path, dynamic: false, destroyed: false,
      isInScene: () => roots.includes(value),
      setDynamic() { this.dynamic = true; }, setLocalTransform(value) { this.transform = Array.from(value); },
      enableHierarchy(value) { this.visible = value; }, destroy() { this.destroyed = true; },
      renderables: [{ isSkinned: () => true }]
    };
    roots.push(value); return value;
  }
  const math = {
    m43BuildScale: scale => [scale[0], 0, 0, 0, scale[1], 0, 0, 0, scale[2], 0, 0, 0],
    m43Translate: (transform, location) => { transform.splice(9, 3, ...location); },
    v3Sub: (a, b) => a.map((value, i) => value - b[i]), v3Add: (a, b) => a.map((value, i) => value + b[i])
  };
  const loader = {
    pathRemapping: { 'hero.dae': 'staticmax/hero', 'grass.dae': 'staticmax/grass', 'changed.dae': 'staticmax/changed', 'pending.dae': 'staticmax/pending' },
    assetCache: { 'hero.dae': { loaded: {} }, 'grass.dae': { loaded: {} }, 'changed.dae': { loaded: {} } },
    load(path, transform) { calls.push(path); if (path === this.failPath) throw new Error('GPU allocation failed'); const result = node(path); result.setLocalTransform(transform); return result; }
  };
  const globals = { scene, mathDevice: math, simpleSceneLoader: loader, gameCurrentTime: 20, appCurrentTime: 100,
    graphicsDevice: { createTechniqueParameterBuffer({ numFloats }) { const output = new Float32Array(numFloats); output.setData = data => output.set(data); return output; } },
    simpleFontRenderer: { clearFontList() {} }, simpleSpriteRenderer: { clearSpriteList() {} },
    debugDraw: { clearDebugLineList() {} }, guiRenderer: { clearShakeAmount() {} }
  };
  const blocks = { getArchetypeList: () => ['grass'], getArchetype: () => ({ path: 'grass.dae' }) };
  return { globals, blocks, loader, roots, calls, node };
}
test('guest terrain and meshes reconcile identities, transformations, visibility, mesh replacement and removal without ECS activation', () => {
  const { globals, blocks, calls } = setup();
  const scene = new GuestScene(globals, blocks), initial = snapshot();
  scene.apply(initial);
  assert.equal(calls.length, 3);
  assert.deepEqual(scene.terrain[0].transform, [2, 0, 0, 0, 1, 0, 0, 0, 2, 1, 0, 2]);
  const terrain = scene.terrain[0], hero = scene.entities.get('hero').node, pickup = scene.entities.get('pickup').node;
  initial.spaces[0].entities[0].location[0] = 999;
  assert.equal(scene.entities.get('hero').record.location[0], 2, 'Received arrays are independently owned');
  const update = snapshot(2);
  update.spaces[0].entities[0].mesh.transform[9] = 7;
  update.spaces[0].entities[0].mesh.visible = false;
  update.spaces[0].entities.pop();
  scene.apply(update);
  assert.equal(calls.length, 3, 'Unchanged terrain/models are reused');
  assert.equal(scene.entities.get('hero').node, hero); assert.equal(hero.transform[9], 7); assert.equal(hero.visible, false);
  assert.equal(pickup.destroyed, true);
  update.tick = 3; update.spaces[0].entities[0].mesh.path = 'changed.dae'; update.spaces[0].blocks[0].location[0] = 5;
  scene.apply(update);
  assert.equal(hero.destroyed, true); assert.equal(terrain.destroyed, true);
  scene.close(); scene.close();
  assert.equal(globals.scene.rootNodes.length, 0);
  assert.throws(() => scene.apply(snapshot(4)), /closed/);
});
test('host skin matrices update a render-only controller without advancing an animation or sharing caller arrays', () => {
  const { globals, blocks } = setup(), scene = new GuestScene(globals, blocks), value = snapshot();
  value.spaces[0].entities[0].mesh.skin = identity(); scene.apply(value);
  const node = scene.entities.get('hero').node;
  assert.deepEqual(Array.from(node.skinController.output), identity());
  assert.equal(node.renderables[0].skinController, node.skinController);
  value.spaces[0].entities[0].mesh.skin[0] = 7;
  assert.equal(node.skinController.output[0], 1);
  value.tick = 2; scene.apply(value); assert.equal(node.skinController.output[0], 7);
  value.tick = 3; value.spaces[0].entities[0].mesh.skin = [NaN];
  assert.throws(() => scene.apply(value), /skin matrices/);
  scene.close();
});
test('invalid assets, stale ticks and incomplete mesh loads leave the previous guest scene intact', () => {
  const { globals, blocks, loader } = setup(), scene = new GuestScene(globals, blocks);
  scene.apply(snapshot()); const roots = globals.scene.rootNodes.slice();
  const invalid = [
    value => { value.spaces[0].entities[0].mesh.path = 'https://bad/mesh'; },
    value => { value.spaces[0].entities[0].mesh.path = 'unknown.dae'; },
    value => { value.spaces[0].blocks[0].archetype = 'constructor'; },
    value => { value.hero = 'absent'; },
    value => { value.spaces[0].entities[0].mesh.path = 'pending.dae'; },
    value => { value.tick = 1; }
  ];
  for (const mutate of invalid) {
    const value = snapshot(2); mutate(value);
    assert.throws(() => scene.apply(value));
    assert.deepEqual(globals.scene.rootNodes, roots); assert.equal(scene.tick, 1);
  }
  loader.failPath = 'changed.dae';
  const value = snapshot(2); value.spaces[0].blocks[0].location[0] = 5; value.spaces[0].entities[0].mesh.path = 'changed.dae';
  assert.throws(() => scene.apply(value), /GPU allocation/);
  assert.deepEqual(globals.scene.rootNodes, roots, 'Staged terrain is cleaned on a later load failure');
  scene.close();
});
test('guest boundary freezes the local simulation and persistence, receives state, then restores original solo roots and hooks on disconnect', async t => {
  const previousDocument = global.document;
  global.document = { exitPointerLock() {} };
  t.after(() => { global.document = previousDocument; });
  const { globals, blocks, node, roots } = setup();
  const originalRoot = node('solo'); let simulations = 0, saves = 0;
  const camera = { desiredV3Focus: [0, 0, 0], desiredV3Position: [0, 10, 10], setDesiredFocus(value) { this.desiredV3Focus = value; },
    setDesiredPosition(value) { this.desiredV3Position = value; }, blendLerp() {}, apply() {}, getTimeAdjustedBlendFactor: value => value, setShouldSnap() {} };
  const game = { hasLoadedLevel: true, getLoading: () => false, getHero: () => ({ getv3Location: () => [0, 0, 0] }),
    getBlockFactory: () => blocks, getGameCamera: () => camera, getGameDayTime: () => 18, setGameDayTime() {}, applyDayNightTime() {},
    gameClock: {}, getGameController: () => ({ clearInputs() {}, unlockMouse() {} }),
    guiManager: { clearDrawList() {} }, imgui: { clearDrawList() {}, clearValidation() {} }, gameLighting: { update() {} },
    draw() {}, draw2D() {}, saveLevel() { saves++; }
  };
  globals.gameManager = game;
  const app = { globals, updateGame() { simulations++; } }, controls = new Controls();
  controls.attach(app, [], {});
  controls.paused = true;
  const update = app.updateGame, draw = game.draw, save = game.saveLevel;
  const guiController = game.imgui.controller;
  let forwarded = 0;
  const connection = { role: 'guest', pvp: false, onMessage() { forwarded++; }, close() { this.closed = true; this.onState?.('closed', {}); } };
  const world = new GuestWorld(controls, connection);
  assert.equal(controls.ready(), false); assert.equal(roots.includes(originalRoot), false);
  assert.throws(() => controls.writeCheckpoint(), /host saves/);
  assert.throws(() => game.saveLevel(), /host saves/);
  await assert.rejects(controls.checkpoint({ state: {} }));
  const welcome = { version: 1, playerId: crypto.randomUUID(), name: 'Guest', entity: snapshot().hero, pvp: false };
  assert.throws(() => connection.onMessage({ kind: 'welcome', payload: { ...welcome, playerId: '../unknown' } }), /Invalid/);
  assert.throws(() => connection.onMessage({ kind: 'welcome', payload: { ...welcome, pvp: true } }), /Invalid/);
  connection.onMessage({ kind: 'welcome', payload: welcome });
  assert.deepEqual(world.identity, welcome);
  assert.throws(() => connection.onMessage({ kind: 'welcome', payload: welcome }), /Repeated/);
  assert.throws(() => connection.onMessage({ kind: 'snapshot', payload: { ...snapshot(), hero: 'someone-else' } }), /different hero/);
  connection.onMessage({ kind: 'snapshot', payload: snapshot() }); app.updateGame();
  assert.equal(simulations, 0); assert.equal(saves, 0); assert.equal(forwarded, 2);
  assert.deepEqual(camera.desiredV3Focus, [2, 0, 3]);
  assert.equal(globals.gameCurrentTime, 1 / 30);
  const ranked = snapshot(); ranked.tick++; ranked.hero = 'ranked-hero'; ranked.spaces[0].entities[0].id = ranked.hero;
  connection.onMessage({ kind: 'update', payload: ranked });
  assert.equal(world.identity.playerId, welcome.playerId); assert.equal(world.identity.entity, ranked.hero);
  world.targetSequence = 1;
  world.selectionRequest = 1;
  const selection = { type: 'target', sequence: 1, message: 'Building selected.', building: { id: 'storage', name: 'Storage', reason: '' } };
  assert.throws(() => connection.onMessage({ kind: 'result', payload: { ...selection, building: { ...selection.building, reason: 5 } } }), /Invalid demolition/);
  assert.throws(() => connection.onMessage({ kind: 'result', payload: { ...selection, type: 'demolish' } }), /Invalid demolition/);
  connection.onMessage({ kind: 'result', payload: selection }); assert.deepEqual(world.selectedBuilding, selection.building);
  assert.equal(game.imgui.controller, world.guiInput);
  connection.onState('closed', {});
  assert.deepEqual(roots, [originalRoot]); assert.equal(originalRoot.destroyed, false);
  assert.equal(app.updateGame, update); assert.equal(game.draw, draw); assert.equal(game.saveLevel, save);
  assert.equal(game.imgui.controller, guiController); assert.equal(world.localMenu(), false);
  assert.equal(globals.gameCurrentTime, 20); assert.equal(game.gameClock.prevEngineTime, 100);
  assert.deepEqual(Array.from(camera.desiredV3Focus), [0, 0, 0]); assert.deepEqual(Array.from(camera.desiredV3Position), [0, 10, 10]);
  assert.equal(controls.paused, true, 'An originally paused solo island stays paused after disconnect');
  assert.equal(controls.ready(), true); app.updateGame(); assert.equal(simulations, 0);
  controls.paused = false; app.updateGame(); assert.equal(simulations, 1);
  assert.equal(connection.closed, true); world.close();
});
