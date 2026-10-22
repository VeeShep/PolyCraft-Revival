'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CoopPlayers } = require('../desktop/coop-players.js');
const { CoopData } = require('../desktop/coop-data.js');
const { emptyState } = require('../desktop/saves.cjs');
test('unknown imported weapons and held construction are rejected before touching the solo hero, inventory or save', () => {
  for (const busy of [false, true]) {
    const state = emptyState(), registry = new CoopData(state);
    registry.data.players[0].inventory.weapon = 'wp_h_unknown'; registry.persist();
    const before = JSON.stringify(state);
    let destroyed = false;
    const builder = { isBuilding: () => busy, isThrowing: () => false };
    const hero = { getEC: name => name === 'ECPlayerBuilder' ? builder : { getWeaponDefinition: () => undefined }, setToBeDestroyed: () => { destroyed = true; } };
    const game = { getHero: () => hero, globals: { gamePurchaseManager: {} } }, bridge = { state };
    assert.throws(() => new CoopPlayers(game, bridge), busy ? /Finish placing/ : /Unknown saved hero weapon/);
    assert.equal(destroyed, false); assert.equal(game.desktopPlayers, undefined); assert.equal(bridge.coopEconomy, undefined);
    assert.equal(JSON.stringify(state), before);
  }
});
test('ending co-op refuses to destroy held construction or change ownership when a hero is busy', () => {
  let captured = false;
  const players = { active: new Map([['guest', { hero: {} }]]), capture: () => { captured = true; },
    requireIdle: () => { throw new Error('Finish placing'); } };
  assert.throws(() => CoopPlayers.prototype.close.call(players), /Finish placing/);
  assert.equal(captured, false); assert.equal(players.active.size, 1); assert.equal(players.closed, undefined);
});
