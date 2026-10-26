'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controls } = require('../desktop/controls.js');
const { GuestScene, GuestWorld } = require('../desktop/guest-world.js');
const { createDelta } = require('../desktop/world-state.js');
test('guest original-style demolition menus use presentation input only, support cancel/confirm and disappear when the target vanishes', () => {
  const calls = [], world = Object.create(GuestWorld.prototype);
  let choice = null, radial = false;
  world.guiInput = { down: false, pendingDown: false }; world.movement = { keys: new Set(), nativeFocused: true };
  world.selectedBuilding = { id: 'storage', name: 'Storage', reason: '', movable: false };
  world.scene = { entities: new Map([['storage', { record: { location: [1, 0, 2] } }]]) };
  world.controls = { guiTypes: { BUTTON_ROUND: {} }, drawDemolitionPrompt: building => { assert.equal(building.id, 'storage'); return choice; }, app: { globals: { camera: { worldToScreen: () => [100, 100] } } } };
  world.game = { getIMGui: () => ({ getRadialScaleFactor: () => 1, doButton: options => { assert.equal(options.guiArchetype, 'demolish'); return radial; } }) };
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
    mesh: { path: 'hero.dae', transform: identity(), visible: true, skin: null }, health: { current: 40, maximum: 50, bar: null, damage: null } });
  return { version: 5, tick, time: tick / 30, dayTime: 12, hero: 'hero', torch: null, camera: { mode: 'explore', dead: false, buildingAge: 1000, destination: null, lookAhead: null, timeHeld: 0, heroes: ['hero'], enemies: [], center: [0, 0, 0] }, spaces: [{
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
    v3Copy: a => [...a], v3Sub: (a, b) => a.map((value, i) => value - b[i]), v3Add: (a, b) => a.map((value, i) => value + b[i])
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
  value.spaces[0].entities[0].mesh.skin = identity(); scene.apply(value, 0);
  const node = scene.entities.get('hero').node;
  assert.deepEqual(Array.from(node.skinController.output), identity());
  assert.equal(node.renderables[0].skinController, node.skinController);
  value.spaces[0].entities[0].mesh.skin[0] = 7;
  assert.equal(node.skinController.output[0], 1);
  value.tick = 2; scene.apply(value, 200); assert.equal(node.skinController.output[0], 1);
  const controller = node.skinController;
  scene.render(300); assert.equal(node.skinController.output[0], 4); assert.equal(node.skinController, controller);
  scene.render(450); assert.equal(node.skinController.output[0], 7);
  const extreme = snapshot(3); extreme.spaces[0].entities[0].mesh.skin = identity(); extreme.spaces[0].entities[0].mesh.skin[0] = 1e9;
  scene.apply(extreme, 600); scene.render(850);
  extreme.tick = 4; extreme.spaces[0].entities[0].mesh.skin[0] = Math.fround(1e-9);
  scene.apply(extreme, 1000); scene.render(1250);
  assert.equal(node.skinController.output[0], Math.fround(1e-9), 'The settled skin copies the exact host endpoint without cancellation error');
  value.tick = 5; value.spaces[0].entities[0].mesh.skin = [NaN];
  assert.throws(() => scene.apply(value), /skin matrices/);
  scene.close();
});
function motionSetup() {
  const env = setup(), math = env.globals.mathDevice, runtime = require('./runtime-ast.cjs');
  math.precision = 1e-6; math.cosMinSlerpAngle = Math.cos(Math.PI / 40);
  for (const name of ['m43Determinant', 'quatFromM43', 'quatNormalize', 'quatDot', 'v4Dot', 'v4BuildZero', 'v4ScalarMul', 'quatConjugate', 'quatSlerp', 'v3Lerp', 'm43FromRTS']) math[name] = runtime.method(name, { A: math, F: Float32Array });
  return { ...env, scene: new GuestScene(env.globals, env.blocks), math };
}
test('guest display interpolates translation, shortest rotation and scale using the real engine math while keeping host records exact', () => {
  const { scene, math } = motionSetup(), initial = snapshot(), update = snapshot(2);
  const pose = (angle, location, scale) => Array.from(math.m43FromRTS([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], location, scale));
  const a = initial.spaces[0].entities[0], b = update.spaces[0].entities[0];
  a.location = [0, 0, 0]; a.mesh.transform = pose(179 * Math.PI / 180, a.location, [2, 3, 4]);
  b.location = [4, 0, 2]; b.mesh.transform = pose(-179 * Math.PI / 180, b.location, [4, 5, 6]);
  scene.apply(initial, 0); scene.apply(update, 200);
  const hero = scene.entities.get('hero'), canonical = JSON.stringify(hero.record);
  assert.deepEqual(hero.displayLocation, [0, 0, 0]); assert.deepEqual(hero.record.location, [4, 0, 2]);
  scene.render(300);
  assert.deepEqual(hero.displayLocation, [2, 0, 1]);
  const expected = pose(Math.PI, [2, 0, 1], [3, 4, 5]);
  hero.node.transform.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-5, 'Rotation/scale must remain intact, not collapse under matrix lerp'));
  assert.equal(JSON.stringify(hero.record), canonical); assert.deepEqual(scene.snapshot.spaces[0].entities[0].location, [4, 0, 2]);
  scene.render(320); const before = [...hero.node.transform], third = structuredClone(update); third.tick = 3;
  third.spaces[0].entities[0].location = [6, 0, 2]; third.spaces[0].entities[0].mesh.transform[9] = 6;
  scene.apply(third, 320);
  assert.deepEqual(scene.entities.get('hero').node.transform, before, 'An early update starts from the current display without snapping');
  scene.render(1000); assert.deepEqual(scene.entities.get('hero').node.transform, third.spaces[0].entities[0].mesh.transform);
  assert.equal(scene.entities.get('hero').motion, null); scene.close(); scene.render(1100);
});
test('guest display snaps teleports, long transfer gaps, changed models and degenerate transforms and removes stale motion', () => {
  const { scene } = motionSetup(), initial = snapshot(); scene.apply(initial, 0);
  const update = snapshot(2); update.spaces[0].entities[0].location[0] = 30; update.spaces[0].entities[0].mesh.transform[9] = 30;
  scene.apply(update, 200); assert.equal(scene.entities.get('hero').node.transform[9], 30); assert.equal(scene.entities.get('hero').motion, undefined);
  update.tick = 3; update.spaces[0].entities[0].location[0] = 31; update.spaces[0].entities[0].mesh.transform[9] = 31;
  scene.apply(update, 1500); assert.equal(scene.entities.get('hero').node.transform[9], 31);
  update.tick = 4; update.spaces[0].entities[0].mesh.path = 'changed.dae'; update.spaces[0].entities[0].mesh.transform[9] = 32;
  scene.apply(update, 1700); assert.equal(scene.entities.get('hero').node.transform[9], 32);
  update.tick = 5; update.spaces[0].entities[0].mesh.transform.fill(0);
  scene.apply(update, 1900); assert.deepEqual(scene.entities.get('hero').node.transform, Array(12).fill(0));
  update.tick = 6; update.spaces[0].entities[0].mesh = null;
  scene.apply(update, 2100); assert.equal(scene.entities.get('hero').node, null); scene.render(2200); scene.close();
});
test('guest display preserves mirrored scale and smooths the received torch without mutating snapshots', () => {
  const { scene, math } = motionSetup(), initial = snapshot(), update = snapshot(2);
  initial.torch = { visible: true, transform: identity() }; update.torch = { visible: true, transform: identity() }; update.torch.transform[9] = 4;
  initial.spaces[0].entities[0].mesh.transform = Array.from(math.m43FromRTS([0, 0, 0, 1], [0, 0, 0], [-2, 3, 4]));
  update.spaces[0].entities[0].mesh.transform = Array.from(math.m43FromRTS([0, 0, 0, 1], [4, 0, 0], [-4, 5, 6]));
  scene.apply(initial, 0); scene.apply(update, 200); scene.render(300);
  assert.equal(scene.torch.transform[9], 2); assert.equal(scene.snapshot.torch.transform[9], 4);
  assert.equal(scene.entities.get('hero').node.transform[0], -3);
  scene.render(500); assert.equal(scene.torch.transform[9], 4);
  update.tick = 3; update.torch.visible = false; scene.apply(update, 600); assert.equal(scene.torch.visible, false); assert.equal(scene.torchMotion, null);
  update.tick = 4; update.torch = null; scene.apply(update, 800); assert.equal(scene.torch, null); scene.close();
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
  const camera = { init() {}, setModeViewScene() {}, setHero(value) { this.heroEntity = value; }, update() { this.setDesiredFocus(this.heroEntity.getv3Location()); }, desiredV3Focus: [0, 0, 0], desiredV3Position: [0, 10, 10], setDesiredFocus(value) { this.desiredV3Focus = value; },
    setDesiredPosition(value) { this.desiredV3Position = value; }, blendLerp() {}, apply() {}, getTimeAdjustedBlendFactor: value => value, setShouldSnap() {} };
  const game = { hasLoadedLevel: true, getLoading: () => false, getHero: () => ({ getv3Location: () => [0, 0, 0] }),
    getBlockFactory: () => blocks, getGameCamera: () => camera, getGameDayTime: () => 18, setGameDayTime() {}, applyDayNightTime() {},
    gameClock: {}, getGameController: () => ({ clearInputs() {}, unlockMouse() {} }),
    guiManager: { clearDrawList() {} }, imgui: { clearDrawList() {}, clearValidation() {} }, gameLighting: { update() { this.updateHeroLightPosition(); }, updateHeroLightPosition() { throw new Error("Suspended solo torch must not be queried"); } },
    draw() {}, draw2D() {}, saveLevel() { saves++; }
  };
  const preferences = { settings: { shadows: true, sounds: true, music: true }, getMusicEnabled() { return this.settings.music; }, saveSettings() { assert.fail('guest cannot save local preferences'); } };
  let shadows = true, sounds = true, music = true;
  game.getPlayerData = () => preferences;
  game.gameLighting.getShadowsEnabled = () => shadows; game.gameLighting.setShadowsEnabled = value => { shadows = value; };
  game.gameSoundManager = { getSoundsEnabled: () => sounds, setSoundsEnabled: value => { sounds = value; }, update() {} };
  game.setMusicVolume = value => { music = !!value; };
  globals.gameManager = game;
  const app = { globals, updateGame() { simulations++; } }, controls = new Controls();
  controls.attach(app, [], {});
  controls.paused = true;
  const update = app.updateGame, draw = game.draw, save = game.saveLevel, getCamera = game.getGameCamera, heroLightUpdate = game.gameLighting.updateHeroLightPosition;
  const guiController = game.imgui.controller;
  let forwarded = 0;
  const requests = [];
  const connection = { role: 'guest', pvp: false, state: 'connected', send: async (kind, payload) => requests.push({ kind, payload }),
    onMessage() { forwarded++; }, close() { this.closed = true; this.onState?.('closed', {}); } };
  const world = new GuestWorld(controls, connection);
  assert.equal(controls.ready(), false); assert.equal(roots.includes(originalRoot), false);
  assert.notEqual(world.sessionSettings.settings, preferences.settings);
  world.sessionSettings.settings.music = false; world.sessionSettings.saveSettings();
  assert.equal(preferences.settings.music, true);
  shadows = sounds = music = false;
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
  assert.deepEqual(world.viewCamera.camera.desiredV3Focus, [2, 0, 3]); assert.deepEqual(camera.desiredV3Focus, [0, 0, 0]);
  assert.equal(globals.gameCurrentTime, 1 / 30);
  const ranked = snapshot(); ranked.tick++; ranked.hero = 'ranked-hero'; ranked.camera.heroes = [ranked.hero]; ranked.spaces[0].entities[0].id = ranked.hero;
  connection.onMessage({ kind: 'update', payload: createDelta(world.scene.snapshot, ranked) });
  assert.equal(world.identity.playerId, welcome.playerId); assert.equal(world.identity.entity, ranked.hero);
  const missing = structuredClone(ranked); missing.tick++; missing.spaces[0].entities[0].health.current--;
  const recovered = structuredClone(missing); recovered.tick++; recovered.spaces[0].entities[0].health.current--;
  const lostBase = createDelta(missing, recovered), before = JSON.stringify(world.scene.snapshot);
  connection.onMessage({ kind: 'update', payload: lostBase });
  assert.equal(world.resyncing, true); assert.equal(world.movement.available(), false);
  assert.equal(JSON.stringify(world.scene.snapshot), before, 'A missing base never partially edits the last valid world');
  assert.deepEqual(requests, [{ kind: 'resync', payload: { version: 1, tick: ranked.tick } }]);
  connection.onMessage({ kind: 'update', payload: lostBase }); assert.equal(requests.length, 1, 'Only one recovery request is outstanding');
  assert.throws(() => connection.onMessage({ kind: 'update', payload: { ...lostBase, resources: 999 } }), /Invalid world snapshot/);
  connection.onMessage({ kind: 'snapshot', payload: recovered });
  assert.equal(world.resyncing, false); assert.equal(world.scene.tick, recovered.tick);
  assert.equal(world.scene.entities.get(ranked.hero).record.health.current, 38);
  assert.equal(world.identity.playerId, welcome.playerId); assert.equal(connection.closed, undefined);
  world.targetSequence = 1;
  world.selectionRequest = 1;
  const selection = { type: 'target', sequence: 1, message: 'Building selected.', building: { id: 'storage', name: 'Storage', reason: '', movable: false } };
  assert.throws(() => connection.onMessage({ kind: 'result', payload: { ...selection, building: { ...selection.building, reason: 5 } } }), /Invalid demolition/);
  assert.throws(() => connection.onMessage({ kind: 'result', payload: { ...selection, type: 'demolish' } }), /Invalid demolition/);
  connection.onMessage({ kind: 'result', payload: selection }); assert.deepEqual(world.selectedBuilding, selection.building);
  game.getEntityFactory = () => ({ getECArchetype: name => name === 'wall' ? { buildingName: 'Wall' } : null });
  world.targetSequence = 2; world.construction.heldRequest = 2;
  connection.onMessage({ kind: 'result', payload: { type: 'held', sequence: 2, message: 'Held building state.', held: { archetype: 'wall', quantity: 1, cancelable: true } } });
  assert.equal(world.construction.placement.held, true); assert.equal(world.construction.placement.source, ranked.hero);
  assert.equal(world.lastTargetResult.type, 'target', 'Background held-state queries do not replace player action feedback');
  world.targetSequence = 3; world.construction.pending = 3;
  connection.onMessage({ kind: 'result', payload: { type: 'cancelBuild', sequence: 3, message: 'Saved.', held: null } });
  assert.equal(world.construction.placement, null); assert.equal(world.construction.pending, null);
  world.targetSequence = 4; world.lifeRequest = 4;
  const ast = require('./runtime-ast.cjs'), hudRanks = ast.objectWith('xpTable');
  controls.xpTable = hudRanks.xpTable; controls.playerDataMethods = ast.component('ECPlayerData', { kd: hudRanks });
  const hud = { resources: [100, 50], caps: [500, 1000], amber: 10, xp: 600, points: 1, quests: null, island: { hq: { current: 25, maximum: 100, changedAgo: 1 }, prepare: null, invasion: { killed: 1, total: 4 }, upcoming: null }, flags: { resources: true, amber: true, rank: true } }, feedback = world.lastTargetResult;
  const heroStatus = { type: 'life', sequence: 4, message: 'Hero life state.', life: { phase: 'waiting', remaining: 10, episode: 1, option: 'lumber', affordable: true }, hud };
  connection.onMessage({ kind: 'result', payload: heroStatus });
  assert.deepEqual(world.hud.state, hud); assert.equal(world.lastTargetResult, feedback);
  const { hud: omitted, ...incomplete } = heroStatus;
  assert.throws(() => connection.onMessage({ kind: 'result', payload: incomplete }), /Incomplete hero status/);
  assert.throws(() => connection.onMessage({ kind: 'result', payload: { ...heroStatus, hud: { ...hud, amber: NaN } } }), /Invalid guest HUD/);
  assert.equal(world.lifeState.phase, 'waiting'); assert.equal(world.lifeRequest, null); assert.equal(world.lastTargetResult.type, 'cancelBuild');
  world.targetSequence = 5; world.reviveRequest = 5;
  connection.onMessage({ kind: 'result', payload: { type: 'revive', sequence: 5, message: 'Saved.', life: { phase: 'waiting', remaining: 0.2, episode: 1, option: null, affordable: false } } });
  assert.equal(world.reviveRequest, null); assert.equal(world.lastTargetResult.type, 'revive');
  world.targetSequence = 6; world.moveRequest = 6;
  connection.onMessage({ kind: 'result', payload: { type: 'move', sequence: 6, message: 'Saved.', held: { archetype: 'wall', quantity: 1, cancelable: true } } });
  assert.equal(world.moveRequest, null); assert.equal(world.construction.placement.held, true);
  world.requestRepair('storage', [12.5, 23.5]); world.requestRepair('storage', [12.5, 23.5]);
  assert.deepEqual(requests.at(-1), { kind: 'action', payload: { type: 'repair', sequence: 7, target: 'storage', costs: [12.5, 23.5] } });
  assert.equal(world.targetSequence, 7);
  connection.onMessage({ kind: 'result', payload: { type: 'repair', sequence: 7, message: 'Saved.' } });
  assert.equal(world.repairRequest, null); assert.equal(world.lastTargetResult.type, 'repair');
  world.requestBuildingUpgrade('storage', { active: false, next: 'wall2', costs: [20, 30] });
  world.requestBuildingUpgrade('storage', { active: false, next: 'wall2', costs: [20, 30] });
  assert.deepEqual(requests.at(-1), { kind: 'action', payload: { type: 'upgradeBuilding', sequence: 8, target: 'storage', next: 'wall2', costs: [20, 30] } });
  connection.onMessage({ kind: 'result', payload: { type: 'upgradeBuilding', sequence: 8, message: 'Saved.' } }); assert.equal(world.upgradeRequest, null);
  world.requestBuildingUpgrade('storage', { active: true, next: 'wall2', episode: 1 });
  assert.deepEqual(requests.at(-1), { kind: 'action', payload: { type: 'cancelUpgrade', sequence: 9, target: 'storage', next: 'wall2', episode: 1 } });
  connection.onMessage({ kind: 'result', payload: { type: 'cancelUpgrade', sequence: 9, message: 'Saved.' } }); assert.equal(world.upgradeRequest, null);
  game.getTaskManager = () => ({ taskArchetypes: { one: {} }, criticalTaskGroup: { taskList: ['one'] }, fillerTaskGroup: { taskList: [] } });
  world.quests.receiveView({ revision: 1, visible: true, offset: false, tasks: [], completed: { id: 'taskIdcrit_0', task: 'one' } });
  world.quests.pending = world.sendQuest('questReward', 'taskIdcrit_0');
  assert.deepEqual(requests.at(-1), { kind: 'action', payload: { type: 'questReward', sequence: 10, target: world.identity.entity, quest: 'taskIdcrit_0' } });
  connection.onMessage({ kind: 'result', payload: { type: 'questReward', sequence: 10, message: 'Saved.', quests: { revision: 2, visible: true, offset: false, tasks: [], completed: null } } });
  assert.equal(world.quests.pending, null); assert.equal(world.quests.state.completed, null);
  world.quests.openRequest = world.sendQuest('questOpen', 'taskIdcrit_0');
  connection.onMessage({ kind: 'result', payload: { type: 'questOpen', sequence: 11, message: 'Quest changed.' } }); assert.equal(world.quests.openRequest, null);
  const cameraFeedback = world.lastTargetResult; world.cameraRequest = world.sendTarget('rotateCamera', world.identity.entity); world.lastLifeQuery = 0;
  assert.equal(requests.at(-1).payload.type, 'rotateCamera'); assert.equal(requests.at(-1).payload.target, world.identity.entity);
  connection.onMessage({ kind: 'result', payload: { type: 'rotateCamera', sequence: 11, message: 'Recorded.' } }); assert.equal(world.cameraRequest, 12);
  connection.onMessage({ kind: 'result', payload: { type: 'rotateCamera', sequence: 12, message: 'Recorded.' } }); assert.equal(world.cameraRequest, null); assert.equal(world.lastLifeQuery, 0); assert.equal(world.lastTargetResult, cameraFeedback);
  world.recordUiEvent('pauseGame'); world.recordUiEvent('pauseGame'); assert.equal(world.uiRequests.get('pauseGame'), 13);
  connection.onMessage({ kind: 'result', payload: { type: 'pauseGame', sequence: 12, message: 'Recorded.' } }); assert.equal(world.uiRequests.get('pauseGame'), 13);
  connection.onMessage({ kind: 'result', payload: { type: 'pauseGame', sequence: 13, message: 'Recorded.' } }); assert.equal(world.uiRequests.has('pauseGame'), false);
  controls.fullscreenChanged(true); assert.equal(requests.at(-1).payload.type, 'enterFullscreen'); assert.equal(world.uiRequests.get('enterFullscreen'), 14);
  connection.onMessage({ kind: 'result', payload: { type: 'enterFullscreen', sequence: 14, message: 'Recorded.' } }); assert.equal(world.uiRequests.size, 0); assert.equal(world.lastTargetResult, cameraFeedback); assert.equal(world.lastLifeQuery, 0);
  assert.equal(game.imgui.controller, world.guiInput);
  connection.onState('closed', {});
  assert.equal(shadows && sounds && music, true, 'original local presentation preferences restored');
  assert.deepEqual(roots, [originalRoot]); assert.equal(originalRoot.destroyed, false);
  assert.equal(app.updateGame, update); assert.equal(game.draw, draw); assert.equal(game.saveLevel, save);
  assert.equal(game.imgui.controller, guiController); assert.equal(game.getGameCamera, getCamera); assert.equal(game.gameLighting.updateHeroLightPosition, heroLightUpdate); assert.equal(world.localMenu(), false);
  assert.equal(globals.gameCurrentTime, 20); assert.equal(game.gameClock.prevEngineTime, 100);
  assert.deepEqual(Array.from(camera.desiredV3Focus), [0, 0, 0]); assert.deepEqual(Array.from(camera.desiredV3Position), [0, 10, 10]);
  assert.equal(controls.paused, true, 'An originally paused solo island stays paused after disconnect');
  assert.equal(controls.ready(), true); app.updateGame(); assert.equal(simulations, 0);
  controls.paused = false; app.updateGame(); assert.equal(simulations, 1);
  assert.equal(connection.closed, true); world.close();
});
test('an unanswered guest resync times out without repeatedly requesting snapshots or editing progress', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = Object.create(GuestWorld.prototype), sent = []; let failed, cancelled = 0, neutral = 0;
  world.scene = { tick: 17, snapshot: { tick: 17 } }; world.cancelLocalMenu = () => { cancelled++; };
  world.movement = { flush: () => { neutral++; } };
  world.connection = { send: async (kind, value) => sent.push({ kind, value }), fail: error => { failed = error; } };
  world.requestResync(); world.requestResync();
  assert.equal(cancelled, 1); assert.equal(neutral, 1); assert.equal(sent.length, 1);
  t.mock.timers.tick(14999); assert.equal(failed, undefined);
  t.mock.timers.tick(1); assert.match(failed.message, /resync timed out/);
  assert.deepEqual(world.scene.snapshot, { tick: 17 }); world.closed = true; world.requestResync(); assert.equal(sent.length, 1);
});

test('guest Pause and Resume use original artwork and block local actions without pausing the shared simulation', () => {
  const world = Object.create(GuestWorld.prototype), draws = [], buttons = [];
  let clicked = 'guest-pause', stopped = 0;
  world.controls = { drawPauseSettings() {}, paused: false, guiTypes: {}, app: { globals: { guiRenderer: { getv2RenderLocation: (x, y) => [x, y] } } } };
  world.guiInput = {}; world.movement = { keys: new Set(['KeyW']), flush() { stopped++; } };
  world.game = { gameSoundManager: { update() {} }, getIMGui: () => ({ doBackground() {}, doButton(options) { buttons.push(options); return options.id === clicked; } }), getGuiManager: () => ({ addDrawGui: name => draws.push(name) }) };
  let fullscreen = 0; world.toggleFullscreen = () => { fullscreen++; };
  clicked = 'guest-fullscreen'; world.drawPauseMenu(); assert.equal(fullscreen, 1); assert.equal(buttons[0].guiArchetype, 'fullscreen'); assert.deepEqual(buttons[0].v2ScreenLocation, [54, 52]);
  world.controls.fullscreen = true; world.drawPauseMenu(); assert.equal(buttons.at(-2).guiArchetype, 'minimize'); clicked = 'guest-pause';
  world.drawPauseMenu(); assert.equal(world.pauseMenu, true); assert.equal(world.localMenu(), true);
  assert.equal(world.movement.keys.size, 0); assert.equal(stopped, 1); assert.equal(world.controls.paused, false);
  clicked = ''; world.drawPauseMenu(); assert.deepEqual(draws, ['bgPattern', 'polycraftLogo']);
  assert.equal(buttons.at(-1).guiArchetype, 'buttonStart');
  clicked = 'guest-resume'; world.drawPauseMenu(); assert.equal(world.localMenu(), false);
});

test('a building selection uses original radial Move artwork and sends only one pending pickup intent', () => {
  const sent = [], drawn = [], world = Object.create(GuestWorld.prototype);
  world.guiInput = {}; world.movement = { nativeFocused: true, keys: new Set() };
  world.selectedBuilding = { id: 'storage', name: 'Storage', reason: '', movable: true };
  world.scene = { entities: new Map([['storage', { record: { location: [0, 0, 0] } }]]) };
  world.controls = { guiTypes: { BUTTON_ROUND: 1 }, app: { globals: { camera: { worldToScreen: () => [100, 100] } } } };
  world.game = { getGuiManager: () => ({ addDrawGui() {} }), getIMGui: () => ({ getRadialScaleFactor: () => 1, getRadialCentre: value => value, addRadialOffset: (center, index) => [center[0] + index * 20, center[1]], doButton(value) { drawn.push(value); return value.id === 'guest-move-storage'; } }) };
  world.sendTarget = (type, target) => { sent.push({ type, target }); return sent.length; };
  world.updateMenu(); world.requestMove('storage');
  assert.deepEqual(sent, [{ type: 'move', target: 'storage' }]); assert.equal(world.moveRequest, 1); assert.equal(world.selectedBuilding, null);
  assert.equal(drawn[0].guiArchetype, 'move');
});

test('captured GUI input and the fullscreen button cannot also select or attack an underlying world entity', () => {
  const world = Object.create(GuestWorld.prototype); let sent = 0;
  world.game = { getIMGui: () => ({ hasCapturedInput: () => true }) }; world.sendTarget = () => { sent++; };
  world.clickTarget({ clientX: 10, clientY: 10 }); assert.equal(sent, 0);
  world.game = { getIMGui: () => ({ hasCapturedInput: () => false, isHot: id => id === 'guest-fullscreen' }) }; world.clickTarget({ clientX: 10, clientY: 10 }); assert.equal(sent, 0);
});

test('guest health uses actual original bar sprites, colors and local off-screen damage rules at interpolated positions', t => {
  let now = 10000; t.mock.method(performance, 'now', () => now);
  const { healthMethods, drawProgressBar } = require('./runtime-ast.cjs').healthDrawing(), sprites = [], icons = [];
  let onScreen = false;
  const globals = { simpleSpriteRenderer: { addSprite: value => sprites.push(value) }, mathDevice: {
    getFactor: (a, b, value) => Math.max(0, Math.min(1, (value - a) / (b - a))), v4Lerp: (a, b, amount) => a.map((value, index) => value + (b[index] - value) * amount), v4Build: (...values) => values,
    remap: (a, b, c, d, value) => c + (d - c) * ((value - a) / (b - a)), lerp: (a, b, amount) => a + (b - a) * amount
  } };
  const record = { id: 'guest', location: [9, 0, 9], mesh: { visible: true }, health: { current: 25, maximum: 50, bar: { row: -2, scale: 2, level: 3 }, damage: { changedAt: 10, onlyOffscreen: true } } };
  const world = Object.create(GuestWorld.prototype);
  world.controls = { healthMethods, drawProgressBar, app: { globals } };
  world.scene = { snapshot: { time: 10.1 }, receivedAt: 10000, entities: new Map([['guest', { record, displayLocation: [1, 0, 2] }]]) };
  world.game = { getGameCamera: () => ({ isOnScreen: location => { assert.deepEqual(location, [1, 0, 2]); return onScreen; } }), getGuiManager: () => ({ addDrawGui: (name, value, id) => icons.push({ name, value, id }) }), getHero: () => { throw new Error('Suspended solo hero must not be queried'); } };
  const before = JSON.stringify(record); world.drawHealth();
  assert.equal(sprites.length, 2); assert.equal(sprites[0].texture, 'textures/block.dds'); assert.equal(sprites[0].blendStyle, 'no-depth'); assert.equal(sprites[1].sizeX, 0.75); assert.deepEqual(sprites[1].v4color, [1, 0.8, 0, 1]); assert.deepEqual(sprites[0].v3Location, [1, 0, 2]);
  assert.equal(icons[0].name, 'offScreenBuildingDamaged'); assert.ok(Math.abs(icons[0].value.scale - 1.4375) < 1e-9); assert.equal(icons[0].value.allowOffscreen, true);
  onScreen = true; icons.length = 0; world.drawHealth(); assert.equal(icons.length, 0);
  record.health.damage.onlyOffscreen = false; world.drawHealth(); assert.equal(icons.length, 1);
  record.health.damage.onlyOffscreen = true; onScreen = false; now = 13000; icons.length = 0; world.drawHealth(); assert.equal(icons.length, 0, 'A stalled stream cannot keep the damage icon alive past its original duration'); now = 10000;
  world.resyncing = true; sprites.length = 0; world.drawHealth(); assert.equal(sprites.length, 0); world.resyncing = false;
  record.health.maximum = 0; world.drawHealth(); assert.equal(sprites.length, 0, 'Zero maximum health must not create NaN sprites');
  record.health.maximum = 50; record.health.damage.onlyOffscreen = true; assert.equal(JSON.stringify(record), before);
  world.scene.snapshot.time = 10.1;
  const other = structuredClone(record); other.id = 'friend'; world.scene.entities.set('friend', { record: other, displayLocation: [1, 0, 2] });
  icons.length = 0; world.drawHealth(); assert.equal(sprites.length, 4); assert.equal(new Set(icons.map(icon => icon.id)).size, 2);
  world.scene.entities.delete('friend'); sprites.length = 0; record.health.bar = record.health.damage = null; world.drawHealth(); assert.equal(sprites.length, 0);
  record.health = null; world.drawHealth(); assert.equal(sprites.length, 0);
});
test('guest fullscreen requests coalesce, wait for confirmation and handle document exit and local failure', async t => {
  const originals = { desktop: global.desktop, document: global.document, error: console.error };
  t.after(() => { global.desktop = originals.desktop; global.document = originals.document; console.error = originals.error; });
  const world = Object.create(GuestWorld.prototype), status = { textContent: '' };
  world.controls = { nativeFullscreen: false }; let requests = 0, resolve, exits = 0;
  global.document = { fullscreenElement: null, getElementById: () => status, exitFullscreen: async () => { exits++; global.document.fullscreenElement = null; } };
  global.desktop = { fullscreen: () => { requests++; return new Promise(done => { resolve = done; }); } };
  world.recordUiEvent = () => assert.fail('requests alone cannot award fullscreen credit');
  const pending = world.toggleFullscreen(); await world.toggleFullscreen(); assert.equal(requests, 1);
  resolve(); await pending; assert.equal(world.fullscreenChanging, false);
  await world.toggleFullscreen(); assert.equal(requests, 1);
  world.lastFullscreenRequest = -Infinity; global.document.fullscreenElement = {};
  await world.toggleFullscreen(); assert.equal(exits, 1); assert.equal(requests, 1);
  world.lastFullscreenRequest = -Infinity; global.document.fullscreenElement = {}; world.controls.nativeFullscreen = true;
  global.desktop.fullscreen = async () => { requests++; };
  await world.toggleFullscreen(); assert.equal(exits, 2); assert.equal(requests, 2);
  world.lastFullscreenRequest = -Infinity; console.error = () => {};
  global.desktop.fullscreen = async () => { throw new Error('window unavailable'); };
  await world.toggleFullscreen(); assert.match(status.textContent, /window unavailable/); assert.equal(world.fullscreenChanging, false);
  world.closed = true; world.lastFullscreenRequest = -Infinity; status.textContent = '';
  await world.toggleFullscreen(); assert.equal(status.textContent, '');
});
test('shared original pause settings use session data while native solo settings still save', () => {
  const ast = require('./runtime-ast.cjs'), buttons = [], volume = [];
  const globals = { currentLanguage: {}, guiRenderer: { getv2RenderLocation: (x, y) => [x, y] } };
  let clicked = '', shadows = true, sounds = true, saves = 0;
  const game = { getIMGui: () => ({ doButton(options) { buttons.push(options); return options.id === clicked; } }),
    gameLighting: { getShadowsEnabled: () => shadows, setShadowsEnabled: value => { shadows = value; } },
    gameSoundManager: { getSoundsEnabled: () => sounds, setSoundsEnabled: value => { sounds = value; } },
    setMusicVolume: (value, duration) => volume.push([value, duration]) };
  globals.gameManager = game;
  const profile = Object.assign(Object.create(ast.prototypeWith('saveSettings')), { globals, settings: { shadows: true, music: true, sounds: true }, saveSettings() { saves++; } });
  const session = Object.assign(Object.create(profile), { settings: { ...profile.settings }, saveSettings() {} });
  game.getPlayerData = () => assert.fail('guest settings cannot consult the solo profile');
  const view = { gameManager: game, globals }, draw = ast.method('updateSettingsMenu', { Z: { BUTTON_NORMAL_HALF: 'half' } });
  for (const label of ['Disable Shadows', 'Disable Music', 'Disable Sound']) { clicked = 'Paused ' + label; draw.call(view, session); }
  assert.deepEqual(session.settings, { shadows: false, music: false, sounds: false });
  assert.deepEqual(profile.settings, { shadows: true, music: true, sounds: true }); assert.equal(saves, 0);
  assert.equal(shadows || sounds, false); assert.deepEqual(volume, [[0, 0]]);
  for (const label of ['Enable Shadows', 'Enable Music', 'Enable Sound']) { clicked = 'Paused ' + label; draw.call(view, session); }
  assert.deepEqual(session.settings, profile.settings); assert.equal(shadows && sounds, true); assert.deepEqual(volume.at(-1), [1, 0]);
  const music = buttons.find(button => button.id === 'Paused Disable Music');
  assert.deepEqual(Array.from(music.v2ScreenLocation), [100, 170]); assert.equal(music.guiArchetype, 'buttonHalf'); assert.equal(music.buttonType, 'half');
  game.getPlayerData = () => profile; clicked = 'Paused Disable Music'; draw.call(view);
  assert.equal(profile.settings.music, false); assert.equal(saves, 1, 'solo keeps original persistent settings behavior');
  const native = ast.prototypeWith('updateSettingsMenu', { Z: {}, za: { offline: true } }); let called = 0;
  native.updateSettingsMenu = () => { called++; }; clicked = '';
  game.getGuiManager = () => ({ addDrawGui() {} });
  game.getIMGui = () => ({ doBackground() {}, doButton: () => false });
  native.updateMenu.call({ ...native, ...view }); assert.equal(called, 1, 'original pause menu uses the shared native settings renderer');
});
