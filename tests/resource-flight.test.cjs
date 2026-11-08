'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs'), { CoopPlayers } = require('../desktop/coop-players.js');

function fixture() {
  const tweens = ast.visualEffectMethods([]).tweens, active = [], bank = [0, 0], deposits = [];
  tweens.add = tween => active.push(tween);
  tweens.remove = tween => { const index = active.indexOf(tween); if (index >= 0) active.splice(index, 1); };
  tweens.getAll = () => active;
  const math = { clamp: (n, low, high) => Math.max(low, Math.min(high, n)), saturate: n => Math.max(0, Math.min(1, n)),
    lerp: (a, b, n) => a + (b - a) * n, v3Copy: v => Array.from(v), v3Neg: v => v.map(n => -n), v3Build: (...v) => v,
    v3BuildZero: () => [0, 0, 0], v3Add: (a, b) => a.map((n, i) => n + b[i]), v3Lerp: (a, b, n) => a.map((v, i) => v + (b[i] - v) * n) };
  const globals = { mathDevice: math, gameCurrentTime: 0, appCurrentTime: 0, metricsManager: { sendGameMetric() {} } };
  tweens.globals = globals;
  const native = ast.resourceCarrierMethods(tweens);
  const data = { adjustResource: (resource, amount) => { bank[resource] += amount; } };
  let carrier;
  const actor = { getv3Location: () => [0, 0, 0], getRotationY: () => 0, playSound() {}, getEC: name => ({ ECHero: {}, ECResourceCarrier: carrier, ECPlayerData: data,
    ECHealth: { getHealth: () => 50, getMaxHealth: () => 50 }, ECFirearm: { mainWeaponName: null, getAmmo: () => 0 }, ECInventory: { getHeldWeapon: () => null } })[name] };
  const game = { getHero: () => actor, getFactionManager: () => ({ areFriendly: () => true }), getGuiManager: () => ({ addResourceBubble() {} }), eventManager: { notify: (name, event) => deposits.push({ name, resource: event.type, amount: event.amount }) } };
  globals.gameManager = game;
  const destination = Object.assign(Object.create(ast.component('ECResourceDestination')), { gameManager: game, globals, getv3Location: () => [1, 0, 0], canDepositResource: () => true });
  const depot = { getEC: () => destination, getv3Location: () => [1, 0, 0], playSound() {} };
  carrier = Object.assign(Object.create(native), { globals, gameManager: game, entity: actor, resource: [0, 0], inboundResource: [0, 0], maxResource: [100, 100], addedMaxBlocks: 0,
    archetype: { resourcesPerBlock: [10, 10] }, resourcesPerBlock: [10, 10], heldResourceEntityList: [[], []], flyingTweens: [], numFlyingResourceBlocks: 0,
    getEntityEC: actor.getEC, playSound() {}, setToUpdate() {}, adjustResourceEntities() {}, _super() {} });
  const blocks = [];
  const fly = (resource, amount, count = 1) => {
    carrier.resource[resource] = amount;
    carrier.heldResourceEntityList[resource] = Array.from({ length: count }, () => {
      const block = { getv3Location: () => [0, 0, 0], setv3Location() {}, removeECFromCustomEntity() {}, setToBeDestroyed() { this.destroyed = true; },
        getEC: name => name === 'ECAttach' ? { clearParent() {}, clearTransform() {} } : { getBaseLocalOffset: () => [0, 0, 0], addRotationX() {}, addRotationY() {}, setLocalOffset() {} } };
      blocks.push(block); return block;
    });
    carrier.flyToResourceDepot(depot);
  };
  const finishNaturally = () => {
    for (const tween of [...active]) { assert.equal(tween.update(10000, 10000), false); tweens.remove(tween); }
  };
  const players = Object.assign(Object.create(CoopPlayers.prototype), { captureConstruction: () => null, captureLife: () => null });
  return { carrier, actor, active, bank, deposits, blocks, fly, finishNaturally, capture: () => players.captureHero(actor) };
}

test('native resource flights retire their actual tween after normal completion, including visual-only blocks', () => {
  const f = fixture(); f.fly(0, 20, 2); f.fly(1, 10);
  assert.equal(f.carrier.flyingTweens.length, 3); assert.equal(f.carrier.numFlyingResourceBlocks, 3);
  f.finishNaturally();
  assert.deepEqual(f.bank, [20, 10]); assert.equal(f.deposits.length, 2);
  assert.equal(f.carrier.flyingTweens.length, 0); assert.equal(f.carrier.numFlyingResourceBlocks, 0);
  assert.equal(f.active.length, 0); assert.equal(f.blocks.every(block => block.destroyed), true);
});
test('co-op capture during a later flight cannot repay an earlier naturally completed delivery', () => {
  const f = fixture(); f.fly(0, 10); f.finishNaturally(); f.fly(0, 5);
  assert.deepEqual(f.bank, [10, 0]);
  assert.deepEqual(f.capture().inventory.carried, [0, 0]);
  assert.deepEqual(f.bank, [15, 0]); assert.equal(f.deposits.length, 2);
  assert.equal(f.carrier.numFlyingResourceBlocks, 0); assert.equal(f.carrier.flyingTweens.length, 0); assert.equal(f.active.length, 0);
  f.capture(); f.carrier.onToBeDestroyed(); assert.deepEqual(f.bank, [15, 0]);
});
test('native carrier destruction settles only current flights after previous deliveries, once per resource', () => {
  const f = fixture(); f.fly(1, 7); f.finishNaturally(); f.fly(0, 20, 2); f.fly(1, 3);
  f.carrier.onToBeDestroyed();
  assert.deepEqual(f.bank, [20, 10]); assert.equal(f.deposits.length, 3);
  assert.equal(f.carrier.flyingTweens.length, 0); assert.equal(f.carrier.numFlyingResourceBlocks, 0); assert.equal(f.active.length, 0);
  f.carrier.onToBeDestroyed(); f.capture(); assert.deepEqual(f.bank, [20, 10]);
});
