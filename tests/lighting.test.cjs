'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs');
const { captureSnapshot } = require('../desktop/world-state.js');
const { GuestWorld } = require('../desktop/guest-world.js');
const native = ast.prototypeWith('getHeroLightState');
const identity = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
function fixture() {
  let writes = 0, reads = 0;
  const node = { transform: identity(), disabled: false, getLocalTransform() { return this.transform; }, setLocalTransform(value) { writes++; this.transform = new Float32Array(value); }, setDisabled(value) { this.disabled = value; } };
  const math = { v3Build: (...values) => values, v3RotateY: ast.method('v3RotateY'), v3Add: (a, b) => a.map((v, i) => v + b[i]), v3Length: a => Math.hypot(...a), m43Copy: a => new Float32Array(a), m43SetPos: (a, b) => a.set(b, 9), m43Pos: a => Array.from(a.slice(9)), v3DistanceSq: (a, b) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) };
  const space = { getv3Location: () => [0, 0, 0], calculateExtents: () => [-100, -100, -100, 100, 100, 100], getM43FullTransform: identity, getBlockList: () => [], getEntityList: () => heroes };
  const hero = (name, location, rotation) => ({ name, night: true, location, rotation, shouldBeDestroyed: () => false, getv3Location() { return this.location; }, getV3Scale: () => [1, 1, 1], getRotationY() { return this.rotation; }, getGameSpace: () => space, getEC(name) { return name === 'ECHeroTorch' ? { getNight: () => this.night } : null; } });
  const heroes = [hero('host', [10, 0, 20], 0), hero('guest', [50, 2, 60], Math.PI / 2)];
  const game = { gameClock: { getFrameIndex: () => 1 }, globals: { gameCurrentTime: 1 }, getPlayFlags: () => ({}), getGameDayTime: () => 0, getGameSpaceList: () => [space], getHero: () => { reads++; return heroes[0]; }, applyToHeroEntities: apply => heroes.forEach(apply), getFactionManager: () => ({ applyToEnemies() {} }), getFirstEntityWithEC() { throw new Error('The first torch must not choose the viewing hero'); } };
  const lighting = Object.assign(Object.create(native), { useMultipleLights: true, globals: { mathDevice: math, gameManager: game }, heroLightNode: node, heroLight: { radius: 5, halfExtents: [1, 1, 1] }, v3HeroLightCurrent: [0.25, 0.25, 0.25] }); game.gameLighting = lighting;
  return { game, heroes, lighting, node, writes: () => writes, reads: () => reads };
}
test('coherent snapshots use the assigned hero and original rotated torch offset without moving the host light or advancing torch state', () => {
  const f = fixture(), source = Array.from(f.node.transform), state = captureSnapshot(f.game, f.heroes[1]);
  assert.equal(f.reads(), 0); assert.equal(f.writes(), 0); assert.deepEqual(Array.from(f.node.transform), source);
  assert.equal(state.torch.visible, true); assert.ok(Math.abs(state.torch.transform[9] - 50) < 1e-5); assert.equal(state.torch.transform[10], 3.5); assert.ok(Math.abs(state.torch.transform[11] - 60.3) < 1e-5);
  f.heroes[1].location[0] = 99; assert.equal(state.torch.transform[9], 50);
  const host = captureSnapshot(f.game); assert.equal(f.reads(), 1); assert.ok(Math.abs(host.torch.transform[9] - 10.3) < 1e-5);
});
test('native host lighting uses its selected hero, original movement threshold and light extents without borrowing another torch', () => {
  const f = fixture(); f.lighting.updateHeroLightPosition();
  assert.equal(f.writes(), 1); assert.equal(f.node.disabled, false); assert.deepEqual(f.lighting.heroLight.halfExtents, [7, 7, 7]);
  f.heroes[0].location[0] += 0.01; f.lighting.updateHeroLightPosition(); assert.equal(f.writes(), 1);
  f.heroes[0].location[0] += 0.1; f.lighting.updateHeroLightPosition(); assert.equal(f.writes(), 2);
  f.heroes[0].night = false; f.lighting.updateHeroLightPosition(); assert.equal(f.node.disabled, true); assert.equal(f.heroes[1].night, true);
});
test('native torch state handles daylight, missing components, disabled lighting and the original darkness cutoff', () => {
  const f = fixture(); f.heroes[1].night = false; assert.equal(f.lighting.getHeroLightState(f.heroes[1]), null);
  assert.equal(f.lighting.getHeroLightState(null), null); assert.equal(f.lighting.getHeroLightState({ getEC: () => null }), null);
  f.heroes[1].night = true; f.lighting.v3HeroLightCurrent = [0, 0, 0]; assert.equal(f.lighting.getHeroLightState(f.heroes[1]).visible, false);
  f.lighting.v3HeroLightCurrent = [1 / 256, 0, 0]; assert.equal(f.lighting.getHeroLightState(f.heroes[1]).visible, true);
  f.lighting.useMultipleLights = false; assert.equal(f.lighting.getHeroLightState(f.heroes[1]), null);
  f.lighting.useMultipleLights = true; f.lighting.heroLightNode = null; assert.equal(f.lighting.getHeroLightState(f.heroes[1]), null);
});
test('guest lighting applies only the received interpolated torch, updates radius bounds and disables missing or dark states', () => {
  const f = fixture(), state = { transform: identity(), visible: true }; state.transform[9] = 42;
  const world = { game: { gameLighting: f.lighting }, scene: { torch: state } }, before = Array.from(state.transform);
  GuestWorld.prototype.updateTorch.call(world); assert.equal(f.node.transform[9], 42); assert.equal(f.node.disabled, false); assert.deepEqual(f.lighting.heroLight.halfExtents, [7, 7, 7]);
  state.visible = false; GuestWorld.prototype.updateTorch.call(world); assert.equal(f.node.disabled, true);
  world.scene.torch = null; GuestWorld.prototype.updateTorch.call(world); assert.equal(f.node.disabled, true);
  assert.deepEqual(Array.from(state.transform), before); assert.equal(f.reads(), 0);
  f.lighting.heroLightNode = null; GuestWorld.prototype.updateTorch.call(world);
});
