'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { captureSnapshot, validateSnapshot, LIMITS } = require('../desktop/world-state.js');
function fixture() {
  const location = new Float32Array([2, 3, 4]), scale = new Float32Array([1, 1, 1]);
  const transform = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 3, 4]);
  const mesh = { node: { disabled: false }, getMeshPath: () => 'models/hero.dae', getm43Transform: () => transform };
  const entity = (id, destroyed = false) => ({ name: id, shouldLevelSave: false, shouldPlayerSave: false,
    shouldBeDestroyed: () => destroyed, getEC: name => name === 'ECMesh' ? mesh : { getHealth: () => 31, getMaxHealth: () => 50 },
    getv3Location: () => location, getV3Scale: () => scale, getRotationY: () => 0
  });
  const entities = [entity('hero'), entity('pickup'), entity('removed', true)];
  const block = { getArchetypeName: () => 'island', getv3Location: () => location, getV3Scale: () => scale, getRotationY: () => 0 };
  const space = { calculateExtents: () => [-20, -20, -20, 20, 20, 20], getM43FullTransform: () => transform, getBlockList: () => [block], getEntityList: () => entities };
  const game = { gameClock: { getFrameIndex: () => 17 }, globals: { gameCurrentTime: 0.5 }, getGameDayTime: () => 12,
    getHero: () => entities[0], getGameSpaceList: () => [space] };
  return { game, entities, location, scale, transform, mesh };
}
test('replication captures unsaved heroes and transient objects, excludes destroyed entities and owns every vector', () => {
  const { game, location, scale, transform } = fixture();
  const snapshot = captureSnapshot(game);
  assert.deepEqual(snapshot.spaces[0].entities.map(entity => entity.id), ['hero', 'pickup']);
  assert.deepEqual(snapshot.spaces[0].entities[0].health, { current: 31, maximum: 50 });
  assert.equal(snapshot.tick, 17);
  assert.equal(snapshot.time, 0.5);
  const before = JSON.stringify(snapshot);
  location.fill(100); scale.fill(100); transform.fill(100);
  assert.equal(JSON.stringify(snapshot), before, 'Later simulation cannot mutate queued network state');
  assert.deepEqual(JSON.parse(before), snapshot, 'Transfer is plain JSON without typed-array objects');
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
    state => { state.spaces[0].entities[0].ecData = { ECHealth: { health: 999 } }; }
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
