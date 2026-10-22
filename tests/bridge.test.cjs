'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalBridge } = require('../desktop/bridge.js');
const { emptyState } = require('../desktop/saves.cjs');
const metadata = { store: require('../storeitems.json').data, badges: require('../badges.json').data, leaderboards: require('../leaderboards.json').data, notifications: require('../gamenotifications.json').data };
function bridge(state = emptyState()) { return new LocalBridge(state, structuredClone(metadata), error => { throw error; }); }
test('co-op shop claims and consumption use only the co-op pool while solo ownership survives unchanged', () => {
  const local = bridge(); local.state.cheats.enabled = true;
  local.state.userItems = { amber: { amount: 50 }, 'amber-crown': { amount: 1 } };
  const before = JSON.stringify(local.state.userItems);
  local.coopEconomy = { userItems: {} };
  local.basket = { amberpack500Chunk: { amount: 1 } }; local.claim();
  assert.equal(local.service('store.useritems').data.userItems.amber.amount, 500);
  local.service('store.useritems-consume', { data: { key: 'amber', consume: 30 } });
  assert.equal(local.coopEconomy.userItems.amber.amount, 470);
  assert.equal(local.service('store.useritems').data.userItems['amber-crown'], undefined);
  assert.equal(JSON.stringify(local.state.userItems), before);
  delete local.coopEconomy;
  assert.equal(local.service('store.useritems').data.userItems.amber.amount, 50);
});
test('free packs repeat, owned items stay unique, inventory consumption cannot replay', () => {
  const local = bridge();
  local.state.cheats.enabled = true;
  local.basket = { amberpack500Chunk: { amount: 1 } }; local.claim();
  local.basket = { amberpack500Chunk: { amount: 1 } }; local.claim();
  assert.equal(local.state.userItems.amber.amount, 1000);
  local.basket = { amberCrown: { amount: 1 } }; local.claim();
  local.basket = { amberCrown: { amount: 1 } }; local.claim();
  assert.equal(local.state.userItems['amber-crown'].amount, 1);
  assert.equal(local.service('store.useritems-consume', { data: { key: 'amber', consume: 1000 } }).data.consumed, 1000);
  assert.throws(() => local.service('store.useritems-consume', { data: { key: 'amber', consume: 1000 } }), /Invalid/);
  const reopened = bridge(structuredClone(local.state));
  assert.equal(reopened.service('store.useritems').data.userItems.amber.amount, 0);
  assert.equal(reopened.state.userItems['amber-crown'].amount, 1);
});
test('invalid basket rejects the entire reward and ownership cannot be consumed', () => {
  const local = bridge();
  local.state.cheats.enabled = true;
  local.basket = { amberpack500Chunk: { amount: 1 }, missing: { amount: 1 } };
  assert.throws(() => local.claim(), /Invalid/);
  assert.deepEqual(local.state.userItems, {});
  local.state.userItems['amber-crown'] = { amount: 1 };
  assert.throws(() => local.service('store.useritems-consume', { data: { key: 'amber-crown', consume: 1 } }), /Invalid/);
});
test('bridge responses match the engine protocol and store prices are zero', async () => {
  const local = bridge();
  const response = new Promise(resolve => local.gameBridge.setListener('bridgeservices.response', value => resolve(JSON.parse(value))));
  assert.equal(JSON.parse(local.receive('bridgeservices.userdata.get', JSON.stringify({ key: 4, data: { url: '/get/missing' } }))).fullyProcessed, true);
  assert.deepEqual(await response, { key: 4, data: { status: 404 } });
  const basket = new Promise(resolve => local.gameBridge.setListener('basket.site.update', value => resolve(JSON.parse(value))));
  local.receive('basket.game.update.v2', JSON.stringify({ basketItems: { amberpack500Chunk: { amount: 1 } }, token: 'a' }));
  const result = await basket;
  assert.equal(result.total, 0);
  assert.equal(result.items.amberpack500Chunk.price, 0);
  assert.equal(result.token, 'a');
});

test('free premium claims are locked by default and when cheat mode is disabled', () => {
  const local = bridge(); local.basket = { amberpack500Chunk: { amount: 1 } };
  assert.throws(() => local.claim(), /Enable cheats/); assert.deepEqual(local.state.userItems, {});
  local.state.cheats.enabled = true; local.claim(); assert.equal(local.state.userItems.amber.amount, 500);
  const reopened = bridge(structuredClone(local.state));
  reopened.basket = { amberpack500Chunk: { amount: 1 } }; reopened.state.cheats.enabled = false;
  assert.throws(() => reopened.claim(), /Enable cheats/); assert.equal(reopened.state.userItems.amber.amount, 500);
});
