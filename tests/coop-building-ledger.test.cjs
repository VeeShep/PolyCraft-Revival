'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const observe = require('./coop-building-ledger.cjs');
let prototype;
function fixture() {
  prototype ||= require('./runtime-ast.cjs').prototypeWith('saveResource');
  const data = Object.assign(Object.create(prototype), { resource: [393, 133], resourceCap: [500, 500], softCurrency: 82, globals: { cheats: { grindless: false } }, saveResource() {} });
  const root = { hostWorld: { game: { getPlayerData: () => data } }, polycraft: { controls: { amounts: () => ({ wood: data.getResource(0), stone: data.getResource(1), amber: 82 }) } } };
  return { data, root };
}
test('building resource observation uses original per-operation caps and retains worker income without editing native balances', () => {
  const { data, root } = fixture(), original = data.adjustResource;
  assert.deepEqual(observe(root), { wood: 393, stone: 133, amber: 82 });
  data.adjustResource(0, -25); data.adjustResource(0, 200); data.adjustResource(0, 1); data.adjustResource(1, 1);
  assert.deepEqual(data.resource, [500, 134]); assert.deepEqual(root.nativeBuildingIncome, { wood: 107, stone: 1, amber: 0 });
  assert.deepEqual(root.nativeBuildingResourceEvents.map(row => [row.type, row.amount, row.before, row.after, row.cap]), [[0, -25, 393, 368, 500], [0, 200, 368, 500, 500], [0, 1, 500, 500, 500], [1, 1, 133, 134, 500]]);
  root.restoreNativeBuildingIncome(); assert.equal(data.adjustResource, original); assert.equal(Object.hasOwn(data, 'adjustResource'), false);
  assert.equal(root.nativeBuildingResourceEvents, undefined); assert.equal(root.nativeBuildingIncome, undefined); assert.equal(root.restoreNativeBuildingIncome, undefined);
});
test('building resource observation forwards receiver, arguments, return values and original exceptions despite read errors', () => {
  const { data, root } = fixture(), calls = [], token = {}, failure = new Error('Native save failed');
  const native = data.adjustResource;
  data.adjustResource = function (...args) { calls.push([this, ...args]); native.apply(this, args); return token; };
  const original = data.adjustResource; observe(root);
  const other = Object.assign(Object.create(data), { resource: [0, 0] }), extra = {};
  assert.equal(data.adjustResource.call(other, 0, 7, extra), token); assert.deepEqual(calls, [[other, 0, 7, extra]]); assert.equal(other.resource[0], 7); assert.equal(data.resource[0], 393);
  data.getResourceCap = () => { throw new Error('Observer read failed'); }; data.saveResource = () => { throw failure; };
  assert.throws(() => data.adjustResource(0, 1), error => error === failure); assert.equal(calls.length, 2); assert.match(root.nativeBuildingResourceEvents.at(-1).error, /Observer read failed/);
  root.restoreNativeBuildingIncome(); assert.equal(data.adjustResource, original); assert.equal(Object.hasOwn(data, 'adjustResource'), true);
});
test('building resource observation refuses duplication, bounds evidence and leaves later hooks and globals intact', () => {
  const { data, root } = fixture(); observe(root); const installed = data.adjustResource, restore = root.restoreNativeBuildingIncome;
  assert.throws(() => observe(root), /already active/); assert.equal(data.adjustResource, installed);
  for (let i = 0; i < 1100; i++) data.adjustResource(0, 1);
  assert.equal(root.nativeBuildingResourceEvents.length, 1025); assert.deepEqual(root.nativeBuildingResourceEvents.at(-1), { overflow: true });
  const later = function (...args) { return installed.apply(this, args); }, events = [], income = {}, nextRestore = () => {};
  data.adjustResource = later; root.nativeBuildingResourceEvents = events; root.nativeBuildingIncome = income; root.restoreNativeBuildingIncome = nextRestore;
  restore(); assert.equal(data.adjustResource, later); assert.equal(root.nativeBuildingResourceEvents, events); assert.equal(root.nativeBuildingIncome, income); assert.equal(root.restoreNativeBuildingIncome, nextRestore);
});
test('building resource observation serializes into the renderer without Node closures', () => {
  const { data, root } = fixture(); vm.runInNewContext('(' + observe.toString() + ')()', { window: root });
  data.adjustResource(0, -25); data.adjustResource(0, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(root.nativeBuildingIncome)), { wood: 107, stone: 0, amber: 0 });
  assert.doesNotThrow(() => JSON.stringify(root.nativeBuildingResourceEvents)); root.restoreNativeBuildingIncome();
});
test('building resource observation covers every active hero model sharing the bank and restores each hook', () => {
  const { data, root } = fixture(), bank = data.resource;
  const models = [data, ...[1, 2, 3].map(() => Object.assign(Object.create(prototype), { ...data, resource: bank }))];
  const originals = models.map(model => model.adjustResource);
  root.hostWorld.players = { active: new Map(models.map((model, i) => ['player-' + i, { model }])) };
  observe(root);
  models[1].adjustResource(0, -25); models[0].adjustResource(0, 200); models[2].adjustResource(1, 1); models[3].adjustResource(0, 1);
  assert.deepEqual(root.nativeBuildingResourceEvents.map(row => [row.type, row.amount]), [[0, -25], [0, 200], [1, 1], [0, 1]]);
  assert.deepEqual(root.nativeBuildingIncome, { wood: 107, stone: 1, amber: 0 });
  root.restoreNativeBuildingIncome();
  for (let i = 0; i < models.length; i++) { assert.equal(models[i].adjustResource, originals[i]); assert.equal(Object.hasOwn(models[i], 'adjustResource'), false); }
});
