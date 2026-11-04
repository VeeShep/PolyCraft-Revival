'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { captureSnapshot, validateSnapshot, createDelta, validateDelta, applyDelta, LIMITS } = require('../desktop/world-state.js');
function fixture() {
  const location = new Float32Array([2, 3, 4]), scale = new Float32Array([1, 1, 1]);
  const transform = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 3, 4]);
  const mesh = { node: { disabled: false }, getMeshPath: () => 'models/hero.dae', getm43Transform: () => transform };
  const entity = (id, destroyed = false) => ({ name: id, shouldLevelSave: false, shouldPlayerSave: false,
    shouldBeDestroyed: () => destroyed, getEC: name => name === 'ECMesh' ? mesh : name === 'ECHealth' ? { getHealth: () => 31, getMaxHealth: () => 50, shouldDrawBar: () => false, archetype: { drawOffScreenIconIfDamagedRecently: false } } : name === 'ECTarget' && id === 'hero' ? {} : null,
    getGameSpace: () => space, getv3Location: () => location, getV3Scale: () => scale, getRotationY: () => 0
  });
  const entities = [entity('hero'), entity('pickup'), entity('removed', true)];
  const block = { getArchetypeName: () => 'island', getGameSpace: () => space, getv3Location: () => location, getV3Scale: () => scale, getRotationY: () => 0 };
  const space = { getv3Location: () => [0, 0, 0], calculateExtents: () => [-20, -20, -20, 20, 20, 20], getM43FullTransform: () => transform, getBlockList: () => [block], getEntityList: () => entities };
  const game = { gameClock: { getFrameIndex: () => 17 }, globals: { gameCurrentTime: 0.5 }, getGameDayTime: () => 12,
    getPlayFlags: () => ({}), applyToHeroEntities: apply => apply(entities[0]), getFactionManager: () => ({ applyToEnemies() {} }), getHero: () => entities[0], getGameSpaceList: () => [space] };
  return { game, entities, location, scale, transform, mesh };
}
test('replication captures unsaved heroes and transient objects, excludes destroyed entities and owns every vector', () => {
  const { game, location, scale, transform } = fixture();
  const snapshot = captureSnapshot(game);
  assert.deepEqual(snapshot.spaces[0].entities.map(entity => entity.id), ['hero', 'pickup']);
  assert.deepEqual(snapshot.spaces[0].entities[0].health, { current: 31, maximum: 50, bar: null, damage: null });
  assert.equal(snapshot.tick, 17);
  assert.equal(snapshot.time, 0.5);
  assert.deepEqual(snapshot.spaces[0].entities.map(entity => entity.interactive), [true, false]);
  const before = JSON.stringify(snapshot);
  location.fill(100); scale.fill(100); transform.fill(100);
  assert.equal(JSON.stringify(snapshot), before, 'Later simulation cannot mutate queued network state');
  assert.deepEqual(JSON.parse(before), snapshot, 'Transfer is plain JSON without typed-array objects');
});
test('actual original health rules supply bars and timed damage metadata without querying the host camera or changing health', () => {
  const f = fixture(), original = require('./runtime-ast.cjs').component('ECHealth'), get = f.entities[0].getEC;
  const health = Object.assign(Object.create(original), { health: 31, startHealth: 50, healthChangedTime: 0.4, healthBarScale: 2, globals: f.game.globals,
    archetype: { drawInWorldBarIfDamagedRecently: true, drawOffScreenIconIfDamagedRecently: true, onlyDrawIconIfOffScreen: true, worldBarRow: -2, barLevel: 3 }, shouldRegen: () => false });
  f.entities[0].getEC = name => name === 'ECHealth' ? health : get(name);
  f.game.getGameCamera = () => { throw new Error('Host camera must not decide guest indicators'); };
  const capture = () => captureSnapshot(f.game), before = JSON.stringify(health), state = capture();
  assert.deepEqual(state.spaces[0].entities[0].health, { current: 31, maximum: 50, bar: { row: -2, scale: 2, level: 3 }, damage: { changedAt: 0.4, onlyOffscreen: true } });
  assert.equal(JSON.stringify(health), before);
  f.game.gameClock.getFrameIndex = () => 18; f.game.globals.gameCurrentTime = 0.6;
  const delta = createDelta(state, capture()); assert.equal(delta.spaces.length, 0, 'Absolute change time must not resend every health component each tick');
  health.disableHealthBar = true; assert.equal(capture().spaces[0].entities[0].health.bar, null);
  health.disableHealthBar = false; f.game.globals.gameCurrentTime = 3;
  const expired = capture(); assert.equal(expired.spaces[0].entities[0].health.bar, null); assert.equal(expired.spaces[0].entities[0].health.damage, null);
  assert.deepEqual(applyDelta(state, createDelta(state, expired)), expired);
  health.healing = true; assert.notEqual(capture().spaces[0].entities[0].health.bar, null); health.healing = false;
  health.shouldRegen = () => true; assert.notEqual(capture().spaces[0].entities[0].health.bar, null);
});
test('health view parsing rejects missing or unbounded metadata and arbitrary GUI authority in full snapshots and deltas', () => {
  const base = captureSnapshot(fixture().game);
  for (const extra of [{ bar: {} }, { bar: { row: 0, scale: -1, level: 1 } }, { bar: { row: 1001, scale: 1, level: 1 } }, { bar: { row: 0, scale: 1, level: 65 } }, { bar: { row: 0, scale: 1, level: 1.5 } }, { bar: { row: 0, scale: Infinity, level: 1 } }, { damage: { changedAt: NaN, onlyOffscreen: true } }, { damage: { changedAt: 0, onlyOffscreen: 1 } }, { damage: { changedAt: 0, onlyOffscreen: true, icon: 'arbitrary' } }, { bar: undefined }]) {
    const next = structuredClone(base); Object.assign(next.spaces[0].entities[0].health, extra);
    assert.throws(() => validateSnapshot(next), /Invalid world snapshot/);
    const delta = { version: 2, audioKeep: [], effectsKeep: [], baseTick: base.tick, tick: base.tick + 1, time: base.time, dayTime: base.dayTime, hero: base.hero, music: base.music, audio: base.audio, effects: base.effects, combat: base.combat, torch: base.torch, camera: base.camera, spaces: [{ index: 0, remove: [], entities: [{ id: base.hero, health: next.spaces[0].entities[0].health }] }] };
    assert.throws(() => validateDelta(delta), /Invalid world snapshot/);
  }
});
test('camera context follows the assigned hero and owns original movement, phase and actor interests across deltas', () => {
  const f = fixture(), actor = f.entities[1], get = actor.getEC, destination = [8, 3, 9], ahead = [5, 3, 6]; let seen;
  actor.getEC = name => name === 'ECPlayerLife' ? { isDead: () => true } : name === 'ECPlayerBuilder' ? { getTimeSinceBuilding: () => 2 } : name === 'ECLocomotion' ? { getDestination: () => destination, getLookAhead: () => ahead, getTimeHeld: () => 0.5 } : get(name);
  f.game.getPlayFlags = () => ({ cameraMode: 'war' }); f.game.getFactionManager = () => ({ applyToEnemies: (hero, apply) => { seen = hero; f.entities.forEach(apply); } });
  const state = captureSnapshot(f.game, actor); assert.equal(seen, actor); assert.equal(state.hero, actor.name); assert.equal(state.camera.dead, true); assert.equal(state.camera.mode, 'war'); assert.equal(state.camera.buildingAge, 2); assert.deepEqual(state.camera.heroes, ['pickup', 'hero']); assert.deepEqual(state.camera.enemies, ['hero', 'pickup']);
  destination[0] = 99; ahead[0] = 99; assert.equal(state.camera.destination[0], 8); assert.equal(state.camera.lookAhead[0], 5);
  const next = structuredClone(state); next.tick++; next.camera.dead = false; next.camera.mode = 'explore'; next.camera.destination = next.camera.lookAhead = null;
  assert.deepEqual(applyDelta(state, createDelta(state, next)), next); assert.equal(state.camera.dead, true);
});
test('camera context rejects unknown modes/actors, sparse or duplicate interests and malformed movement without partially applying a delta', () => {
  const base = captureSnapshot(fixture().game);
  for (const extra of [{ mode: 'editor' }, { dead: 1 }, { buildingAge: -1 }, { timeHeld: Infinity }, { heroes: [] }, { heroes: ['missing'] }, { heroes: ['hero', 'hero'] }, { enemies: Array(1) }, { center: [0, NaN, 0] }, { destination: [0, 0, 0] }, { lookAhead: [0, 0, 0] }, { save: true }]) {
    const next = structuredClone(base); Object.assign(next.camera, extra); const before = JSON.stringify(base);
    assert.throws(() => validateSnapshot(next), /Invalid world snapshot/);
    const delta = { version: 2, audioKeep: [], effectsKeep: [], baseTick: base.tick, tick: base.tick + 1, time: base.time, dayTime: base.dayTime, hero: base.hero, music: base.music, audio: base.audio, effects: base.effects, combat: base.combat, torch: base.torch, camera: next.camera, spaces: [] };
    assert.throws(() => applyDelta(base, delta), /Invalid world snapshot/); assert.equal(JSON.stringify(base), before);
  }
});
test('world validation requires unique live identities, selected hero and bounded terrain', () => {
  for (const mutate of [
    state => { state.spaces.push(structuredClone(state.spaces[0])); },
    state => { state.hero = 'missing'; },
    state => { state.spaces[0].extents[0] = 100; },
    state => { state.spaces[0].entities[0].location[1] = Infinity; },
    state => { state.tick = -1; },
    state => { state.version++; },
    state => { state.spaces[0].blocks = Array(LIMITS.blocks + 1).fill(state.spaces[0].blocks[0]); },
    state => { state.spaces[0].entities[0].ecData = { ECHealth: { health: 999 } }; },
    state => { state.spaces[0].entities[0].interactive = 'yes'; }
  ]) {
    const state = captureSnapshot(fixture().game); mutate(state);
    assert.throws(() => validateSnapshot(state), /Invalid world snapshot/);
  }
});
test('received mesh and terrain identifiers are checked against installed local assets before use', () => {
  const state = captureSnapshot(fixture().game);
  const assets = { hasBlock: key => key === 'island', hasMesh: key => key === 'models/hero.dae' };
  assert.equal(validateSnapshot(state, assets), state);
  assert.throws(() => validateSnapshot(state, { ...assets, hasMesh: () => false }), /unknown mesh/);
  assert.throws(() => validateSnapshot(state, { ...assets, hasBlock: () => false }), /unknown terrain/);
  for (const path of ['../secret', 'https://example.com/a', '/absolute', 'models\\hidden', 'models/\0bad']) {
    state.spaces[0].entities[0].mesh.path = path;
    assert.throws(() => validateSnapshot(state), /invalid entity mesh/);
  }
});
test('entities without meshes or health and changing mesh visibility remain valid', () => {
  const { game, entities, mesh } = fixture();
  entities[1].getEC = () => null;
  mesh.node.disabled = true;
  const state = captureSnapshot(game);
  assert.equal(state.spaces[0].entities[0].mesh.visible, false);
  assert.equal(state.spaces[0].entities[1].mesh, null);
  assert.equal(state.spaces[0].entities[1].health, null);
});
test('snapshot owns bounded skin poses and the assigned hero torch transform without advancing simulation', () => {
  const { game, mesh, transform } = fixture();
  let updated = 0;
  mesh.node.skinController = { output: new Float32Array(transform), update() { updated++; } };
  game.gameLighting = { getHeroLightState: hero => { assert.equal(hero, game.getHero()); return { transform, visible: true }; } };
  const state = captureSnapshot(game);
  assert.ok(updated > 0);
  assert.deepEqual(state.spaces[0].entities[0].mesh.skin, Array.from(transform));
  assert.deepEqual(state.torch, { transform: Array.from(transform), visible: true });
  transform.fill(10); mesh.node.skinController.output.fill(5);
  assert.equal(state.torch.transform[0], 1); assert.equal(state.spaces[0].entities[0].mesh.skin[0], 1);
  for (const value of [[], [1], Array(3084).fill(1), Array(12).fill(Infinity)]) {
    state.spaces[0].entities[0].mesh.skin = value;
    assert.throws(() => validateSnapshot(state), /skin matrices/);
  }
  state.spaces[0].entities[0].mesh.skin = null; state.torch.visible = 'yes';
  assert.throws(() => validateSnapshot(state), /hero light/);
});
test('world deltas omit static terrain and asset fields, round-trip exactly and own their state independently', () => {
  const base = captureSnapshot(fixture().game);
  base.spaces[0].blocks = Array.from({ length: 1000 }, (_, index) => ({ ...structuredClone(base.spaces[0].blocks[0]), location: [index, 0, 0] }));
  base.spaces[0].entities[0].mesh.skin = [...base.spaces[0].entities[0].mesh.transform];
  const next = structuredClone(base); next.tick++; next.time += 0.1;
  const hero = next.spaces[0].entities[0]; hero.location[0] += 1; hero.mesh.transform[9] += 1; hero.mesh.skin[9] += 1; hero.health.current--;
  const original = JSON.stringify(base), target = JSON.stringify(next), delta = createDelta(base, next);
  assert.equal(Object.hasOwn(delta.spaces[0], 'blocks'), false);
  assert.deepEqual(Object.keys(delta.spaces[0].entities[0]), ['id', 'location', 'mesh', 'health']);
  assert.deepEqual(Object.keys(delta.spaces[0].entities[0].mesh), ['transform', 'skin']);
  assert.ok(JSON.stringify(delta).length < target.length / 10, 'Static terrain must not dominate every update');
  const result = applyDelta(base, JSON.parse(JSON.stringify(delta)));
  assert.deepEqual(result, next); result.spaces[0].entities[0].location[0] = 99;
  assert.equal(JSON.stringify(base), original); assert.equal(JSON.stringify(next), target);
  delta.spaces[0].entities[0].mesh.transform[9] = 888; assert.equal(JSON.stringify(next), target);
});
test('world deltas preserve ordering, space moves, terrain/metadata changes, new heroes, mesh changes and removals', () => {
  const base = captureSnapshot(fixture().game);
  base.spaces.push({ ...structuredClone(base.spaces[0]), entities: [], blocks: [] });
  const next = structuredClone(base); next.tick++;
  const pickup = next.spaces[0].entities.pop(); pickup.mesh = null; pickup.health = null;
  next.spaces[1].entities.push(pickup); next.spaces[1].extents[0] = -30; next.spaces[1].transform[9]++;
  next.spaces[1].blocks = structuredClone(base.spaces[0].blocks);
  const hero = next.spaces[0].entities[0]; hero.id = next.hero = 'rankedHero'; next.camera.heroes = ['rankedHero']; hero.mesh.path = 'models/newHero.dae';
  next.spaces[0].entities.unshift({ ...structuredClone(hero), id: 'newBuilding' });
  const delta = createDelta(base, next);
  assert.deepEqual(delta.spaces[0].remove, ['hero', 'pickup']);
  assert.deepEqual(delta.spaces[0].order, ['newBuilding', 'rankedHero']);
  assert.deepEqual(applyDelta(base, delta), next);
  const later = structuredClone(next); later.tick++; later.spaces[1].entities[0].mesh = structuredClone(hero.mesh);
  assert.deepEqual(applyDelta(next, createDelta(next, later)), later, 'A mesh can be restored from null');
  later.spaces.push({ ...structuredClone(later.spaces[1]), entities: [] });
  assert.equal(createDelta(next, later), null, 'A changed space count requires a full snapshot');
});
test('world update validation rejects malformed fields even without its base, and base mismatches leave the previous state untouched', () => {
  const base = captureSnapshot(fixture().game), next = structuredClone(base); next.tick++; next.spaces[0].entities[0].location[0]++;
  const good = createDelta(base, next), original = JSON.stringify(base);
  const mismatch = { ...good, baseTick: 10 };
  assert.throws(() => applyDelta(base, mismatch), error => error.code === 'WORLD_BASE_MISMATCH');
  for (const mutate of [
    value => { value.version++; }, value => { value.tick = value.baseTick; }, value => { value.tick = NaN; },
    value => { value.time = -1; }, value => { value.dayTime = 25; }, value => { value.playerId = 'forged'; },
    value => { value.spaces.push(structuredClone(value.spaces[0])); }, value => { value.spaces[0].index = -1; },
    value => { value.spaces[0].grantResources = 999; }, value => { value.spaces[0].entities.push(structuredClone(value.spaces[0].entities[0])); },
    value => { value.spaces[0].entities[0].resources = 999; }, value => { value.spaces[0].entities[0].location = Array(3); },
    value => { value.spaces[0].entities[0].mesh = { transform: Array(12) }; },
    value => { value.spaces[0].entities[0].mesh = { skin: Array(12) }; },
    value => { value.spaces[0].entities[0].mesh = { path: '../unsafe' }; },
    value => { value.spaces[0].entities[0].mesh = { cheat: true }; }, value => { value.spaces[0].entities = Array(1); },
    value => { value.spaces[0].remove = ['pickup', 'pickup']; }, value => { value.spaces[0].remove = ['hero']; },
    value => { value.spaces[0].order = ['hero', 'hero']; }, value => { value.spaces[0].extents = [5, 0, 0, 1, 1, 1]; },
    value => { value.spaces[0].blocks = Array(LIMITS.blocks + 1).fill(base.spaces[0].blocks[0]); }
  ]) {
    const value = structuredClone(good); mutate(value);
    assert.throws(() => validateDelta(value), /Invalid world snapshot/);
    assert.throws(() => applyDelta(base, value), /Invalid world snapshot/);
    assert.equal(JSON.stringify(base), original);
  }
  for (const mutate of [value => { value.hero = 'missing'; }, value => { value.spaces[0].remove = ['unknown']; }, value => { value.spaces[0].index = 1; }, value => { value.spaces[0].order = ['hero', 'unknown']; }, value => { value.spaces[0].entities.push({ id: 'partialNew', interactive: true }); }]) {
    const value = structuredClone(good); mutate(value); assert.throws(() => applyDelta(base, value), /Invalid world snapshot/); assert.equal(JSON.stringify(base), original);
  }
  const assets = { hasMesh: path => path === 'models/hero.dae', hasBlock: () => true };
  const value = structuredClone(good); value.spaces[0].entities[0].mesh = { path: 'models/notInstalled.dae' };
  assert.throws(() => applyDelta(base, value, assets), /unknown mesh/);
});
test('successive wire deltas reconstruct changing worlds exactly, including reordered identities and periodic full baselines', () => {
  let base = captureSnapshot(fixture().game), guest = structuredClone(base);
  for (let tick = base.tick + 1; tick < 80; tick++) {
    const next = structuredClone(base); next.tick = tick; next.time = tick / 30; next.dayTime = (tick / 10) % 24;
    const hero = next.spaces[0].entities.find(entity => entity.id === 'hero'); hero.location[0] += 0.125; hero.mesh.transform[9] += 0.125;
    if (tick % 3 === 0) next.spaces[0].entities.reverse();
    if (tick % 4 === 0) next.spaces[0].blocks[0].location[0]++;
    if (tick % 5 === 0) next.spaces[0].entities.push({ ...structuredClone(hero), id: 'spawn' + tick });
    if (tick % 7 === 0) next.spaces[0].entities = next.spaces[0].entities.filter(entity => entity.id === 'hero');
    const delta = createDelta(base, next);
    guest = tick % 11 === 0 ? JSON.parse(JSON.stringify(next)) : applyDelta(guest, JSON.parse(JSON.stringify(delta)));
    assert.deepEqual(guest, next); base = next;
  }
});
test('combat capture selects only the assigned hero native target and owns bounded presentation data', () => {
  const f = fixture(), actor = f.entities[1], original = actor.getEC;
  let selected = f.entities[0], inRange = false, reads = 0;
  actor.getEC = name => name === 'ECAutoFire' ? { getTargetEntity: () => selected, isWithinDamageRange(location) { reads++; assert.equal(location, f.location); return inRange; } } : original(name);
  f.game.getHero = () => assert.fail('explicit guest capture must not choose the host hero');
  const state = captureSnapshot(f.game, actor);
  assert.equal(state.version, 14); assert.deepEqual(state.combat, { target: 'hero', inDamageRange: false }); assert.equal(reads, 1);
  inRange = true; assert.equal(captureSnapshot(f.game, actor).combat.inDamageRange, true); assert.equal(state.combat.inDamageRange, false);
  for (selected of [actor, f.entities[2], { name: 'missing', shouldBeDestroyed: () => false }, null]) assert.equal(captureSnapshot(f.game, actor).combat, null);
  assert.equal(reads, 2, 'unavailable targets must not query native damage-range methods');
});
test('combat headers reject malformed or unavailable targets and survive owned delta changes and cancellation', () => {
  const base = captureSnapshot(fixture().game), next = structuredClone(base); next.tick++; next.combat = { target: 'pickup', inDamageRange: true };
  const delta = createDelta(base, next), result = applyDelta(base, delta);
  assert.deepEqual(result.combat, next.combat); delta.combat.inDamageRange = false; assert.equal(result.combat.inDamageRange, true);
  const cancelled = structuredClone(result); cancelled.tick++; cancelled.combat = null;
  assert.equal(applyDelta(result, createDelta(result, cancelled)).combat, null);
  for (const combat of [undefined, {}, { target: '', inDamageRange: true }, { target: 'x'.repeat(257), inDamageRange: false }, { target: 'pickup', inDamageRange: 1 }, { target: 'pickup', inDamageRange: true, damage: 100 }]) {
    const full = { ...next, combat }, patch = { ...createDelta(base, next), combat };
    assert.throws(() => validateSnapshot(full), /combat target/); assert.throws(() => validateDelta(patch), /combat target/);
  }
  for (const target of [base.hero, 'missing']) {
    assert.throws(() => validateSnapshot({ ...next, combat: { target, inDamageRange: true } }), /combat target/);
    assert.throws(() => applyDelta(base, { ...createDelta(base, next), combat: { target, inDamageRange: true } }), /combat target/);
  }
  const removed = createDelta(base, next); removed.spaces = [{ index: 0, remove: ['pickup'], entities: [] }];
  assert.throws(() => applyDelta(base, removed), /combat target/);
  assert.throws(() => validateSnapshot({ ...base, version: 5 }), /version/);
});

test('path cursor state captures only the assigned hero final navigation destination and preserves ownership through deltas', () => {
  const f = fixture(), actor = f.entities[1], previous = actor.getEC, destination = [30, 3, 40]; let active = true;
  actor.getEC = name => name === 'ECNav' ? { isOnPath: () => active, getv3Destination: () => { assert.equal(active, true); return destination; } } : previous(name);
  const state = captureSnapshot(f.game, actor); assert.deepEqual(state.camera.pathDestination, destination); assert.equal(state.camera.destination, null);
  destination[0] = 999; assert.equal(state.camera.pathDestination[0], 30); assert.equal(captureSnapshot(f.game).camera.pathDestination, null, 'host hero path must not leak into the assigned guest cursor');
  active = false; const next = captureSnapshot(f.game, actor); next.tick++;
  assert.equal(next.camera.pathDestination, null); assert.deepEqual(applyDelta(state, createDelta(state, next)), next);
});
test('full and delta parsers reject missing, sparse, nonfinite or authority-bearing path cursor fields', () => {
  const base = captureSnapshot(fixture().game);
  for (const value of [undefined, [1, 2], Array(3), [1, NaN, 3], [1, 2, Infinity], { location: [1, 2, 3], speed: 99 }]) {
    const next = structuredClone(base); next.tick++; next.camera.pathDestination = value;
    assert.throws(() => validateSnapshot(next), /Invalid world snapshot/);
    const delta = { version: 2, audioKeep: [], effectsKeep: [], baseTick: base.tick, tick: next.tick, time: next.time, dayTime: next.dayTime, hero: next.hero, music: next.music, audio: next.audio, effects: next.effects, combat: next.combat, torch: next.torch, camera: next.camera, spaces: [] };
    assert.throws(() => validateDelta(delta), /Invalid world snapshot/); assert.equal(base.camera.pathDestination, null);
  }
});

test('host music capture and delta restoration use only the five original soundtrack archetypes', () => {
  const f = fixture(), ast = require('./runtime-ast.cjs');
  for (const name of ['aud_music_theme', 'aud_music_day', 'aud_music_night', 'aud_music_battle', 'aud_music_battle_boss']) {
    assert.ok(ast.assignedObject(name).path, name); f.game.musicString = name; const state = captureSnapshot(f.game); assert.equal(state.music, name);
    const next = structuredClone(state); next.tick++; next.music = null; assert.deepEqual(applyDelta(state, createDelta(state, next)), next);
  }
});
test('music metadata rejects arbitrary paths, objects and missing values in complete snapshots and updates', () => {
  const base = captureSnapshot(fixture().game);
  for (const music of [undefined, '', 'sounds/arbitrary.ogg', 'aud_music_unknown', {}, ['aud_music_day']]) {
    const next = structuredClone(base); next.tick++; next.music = music;
    assert.throws(() => validateSnapshot(next), /music/);
    const delta = { version: 2, audioKeep: [], effectsKeep: [], baseTick: base.tick, tick: next.tick, time: next.time, dayTime: next.dayTime, hero: next.hero, music, audio: next.audio, effects: next.effects, combat: next.combat, torch: next.torch, camera: next.camera, spaces: [] };
    assert.throws(() => applyDelta(base, delta), /music/); assert.equal(base.music, null);
  }
});

test('world audio is captured coherently and carried through full/delta validation without asset or GUI authority', () => {
  const { game } = fixture();
  const audio = { sequence: 1, events: [{ id: 1, op: 'play', name: 'aud_shotgunshot', entity: 'hero', location: [1, 2, 3], fade: 0, time: 0.5, target: null }], loops: [] };
  game.desktopAudio = { capture: () => structuredClone(audio) };
  const before = captureSnapshot(game); audio.events[0].location[0] = 99;
  assert.equal(before.audio.events[0].location[0], 1);
  game.gameClock.getFrameIndex = () => 18;
  const next = captureSnapshot(game), delta = createDelta(before, next);
  assert.deepEqual(applyDelta(before, delta), next); delta.audio.events[0].name = 'aud_music_day';
  assert.throws(() => validateDelta(delta), /Invalid world audio/);
  const missing = structuredClone(next); delete missing.audio; assert.throws(() => validateSnapshot(missing), /Invalid world snapshot/);
  const old = structuredClone(next); old.version = 13; assert.throws(() => validateSnapshot(old), /incompatible version/);
});

test('original visual effects are owned at capture and full/delta headers reject arbitrary effect authority', () => {
  const { game } = fixture(), effects = { sequence: 1, events: [{ id: 1, time: 0.5, name: 'vfx_hit_e_generic1', location: [1, 2, 3], direction: null, entity: 'hero', scale: 1, dilation: 1 }], active: [] };
  game.desktopEffects = { capture: () => structuredClone(effects) }; const before = captureSnapshot(game); effects.events[0].location[0] = 99;
  assert.equal(before.effects.events[0].location[0], 1); game.gameClock.getFrameIndex = () => 18;
  const next = captureSnapshot(game), delta = createDelta(before, next); assert.deepEqual(applyDelta(before, delta), next);
  delta.effects.events[0].name = 'textures/arbitrary.dds'; assert.throws(() => validateDelta(delta), /Invalid world visual effects/);
});

function journalState() {
  const state = captureSnapshot(fixture().game);
  state.audio = { sequence: 3, events: [1, 3].map(id => ({ id, op: 'play', name: 'aud_shotgunshot', entity: 'hero', location: [1, 2, 3], fade: 0, time: 0.5, target: null })), loops: [] };
  state.effects = { sequence: 3, events: [1, 3].map(id => ({ id, time: 0.5, name: 'vfx_hit_e_generic1', location: [1, 2, 3], direction: null, entity: 'hero', scale: 1, dilation: 1 })), active: [] };
  return validateSnapshot(state);
}
test('journal deltas reconstruct sparse retained histories, changed records, expiry and resets without aliasing', () => {
  let base = journalState();
  for (const change of [
    next => {},
    next => { next.audio.events[0].location[0] = 9; next.effects.events[0].scale = 2; },
    next => { next.audio.events.shift(); next.effects.events.shift(); },
    next => { next.audio.events = []; next.effects.events = []; },
    next => { next.audio.sequence = next.effects.sequence = 0; }
  ]) {
    const next = structuredClone(base); next.tick++; change(next);
    const before = JSON.stringify(base), delta = createDelta(base, next);
    assert.deepEqual(delta.audio.events, next.audio.events.filter(event => JSON.stringify(event) !== JSON.stringify(base.audio.events.find(old => old.id === event.id))));
    assert.deepEqual(delta.effects.events, next.effects.events.filter(event => JSON.stringify(event) !== JSON.stringify(base.effects.events.find(old => old.id === event.id))));
    const restored = applyDelta(base, JSON.parse(JSON.stringify(delta)));
    assert.deepEqual(restored, next); assert.equal(JSON.stringify(base), before);
    if (restored.audio.events.length) { restored.audio.events[0].location[0] = 99; assert.notEqual(next.audio.events[0].location[0], 99); assert.notEqual(delta.audio.events[0]?.location[0], 99); }
    base = next;
  }
});
test('journal cache misses request full repair without partially editing the last world', () => {
  for (const field of ['audio', 'effects']) {
    const base = journalState(), next = structuredClone(base); next.tick++;
    const delta = createDelta(base, next); base[field].events.shift(); const before = JSON.stringify(base);
    assert.throws(() => applyDelta(base, delta), { code: 'WORLD_BASE_MISMATCH' });
    assert.equal(JSON.stringify(base), before);
    assert.deepEqual(applyDelta(next, createDelta(next, { ...next, tick: next.tick + 1 })), { ...next, tick: next.tick + 1 });
  }
});
test('delta retention lists reject malformed IDs, overflow, omitted records and obsolete encodings', () => {
  const base = journalState(), next = structuredClone(base); next.tick++;
  for (const field of ['audioKeep', 'effectsKeep']) {
    for (const keep of [undefined, {}, Array(1), ['1'], [NaN], [Infinity], [1.5], [0], [-1], [4], [1, 1], [3, 1], Array.from({ length: 129 }, (_, i) => i + 1)]) {
      const delta = createDelta(base, next); delta[field] = keep;
      assert.throws(() => validateDelta(delta), /Invalid world snapshot/);
    }
    const delta = createDelta(captureSnapshot(fixture().game), next); delta[field] = [];
    assert.throws(() => validateDelta(delta), /not retained/);
  }
  const delta = createDelta(base, next); delta.version = 1; assert.throws(() => validateDelta(delta), /invalid world update/);
});
test('ten-hertz event journal workload preserves exact state while reducing serialized delta bytes', t => {
  let base = journalState(), cached = structuredClone(base), oldBytes = 0, newBytes = 0;
  for (let frame = 1; frame <= 100; frame++) {
    const next = structuredClone(base); next.tick++; next.time += 0.1; next.spaces[0].entities[0].location[0] += 0.1;
    for (const field of ['audio', 'effects']) {
      for (let count = 0; count < 2; count++) {
        const event = structuredClone(base[field].events.at(-1) || journalState()[field].events[0]);
        event.id = ++next[field].sequence; event.time = next.time; next[field].events.push(event);
      }
      next[field].events = next[field].events.filter(event => next.time - event.time <= 2).slice(-128);
    }
    const delta = createDelta(base, next), old = { ...delta, version: 1, audio: next.audio, effects: next.effects };
    delete old.audioKeep; delete old.effectsKeep;
    oldBytes += Buffer.byteLength(JSON.stringify(old)); newBytes += Buffer.byteLength(JSON.stringify(delta));
    cached = applyDelta(cached, JSON.parse(JSON.stringify(delta))); assert.deepEqual(cached, next);
    if (frame % 50 === 0) { const full = JSON.stringify(next); oldBytes += Buffer.byteLength(full); newBytes += Buffer.byteLength(full); cached = JSON.parse(full); }
    base = next;
  }
  t.diagnostic(`Synthetic 10Hz/100-update journals plus two full snapshots: ${oldBytes} -> ${newBytes} JSON bytes (${(100 * (1 - newBytes / oldBytes)).toFixed(1)}% reduction)`);
  assert.ok(newBytes < oldBytes * 0.25);
});

test('journal deltas preserve complete loop and persistent decal state independently of recent history', () => {
  const base = journalState();
  base.audio.loops = [{ id: 2, name: 'aud_amb_fire', entity: null, location: [1, 2, 3], fade: null }];
  base.effects.active = [{ ...base.effects.events[0], id: 2, name: 'vfx_exp_decal' }];
  validateSnapshot(base);
  const next = structuredClone(base); next.tick++; next.time = 3;
  next.audio.events = []; next.effects.events = []; next.audio.loops[0].location[0] = 4;
  next.audio.loops[0].fade = { duration: 2, until: 5 };
  const delta = createDelta(base, next), restored = applyDelta(base, delta);
  assert.deepEqual(restored, next); assert.deepEqual(delta.audio.loops, next.audio.loops); assert.deepEqual(delta.effects.active, next.effects.active);
  delta.effects.active[0].location[0] = 99; assert.equal(restored.effects.active[0].location[0], 1);
});
