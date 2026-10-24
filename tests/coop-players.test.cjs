'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CoopPlayers } = require('../desktop/coop-players.js');
const { CoopData } = require('../desktop/coop-data.js');
const { emptyState } = require('../desktop/saves.cjs');
test('hero replacement removes only its owned in-flight projectiles before destroying owner components', () => {
  const calls = [], hero = { setToBeDestroyed: () => calls.push('hero') }, other = {};
  const projectile = owner => ({ getEC: () => ({ getOwner: () => owner }), setToBeDestroyed: () => calls.push('projectile') });
  const damage = (aggressor, victim) => ({ actionName: 'ApplyDamageToEntity', actionArguments: { aggressor, victim } });
  const retained = damage(other, other), effect = { actionName: 'SpecialEffect', actionArguments: {} };
  const actionManager = { actionList: [damage(hero, other), retained, effect], otherActionList: [damage(other, hero)] };
  CoopPlayers.prototype.destroy.call({ game: { actionManager, getGameSpaceList: () => [{ getEntitiesWithEC: () => [projectile(hero), projectile(other)], destroyDeadEntities: () => calls.push('destroy') }] } }, hero);
  assert.deepEqual(calls, ['projectile', 'hero', 'destroy']);
  assert.deepEqual(actionManager.actionList, [retained, effect]); assert.deepEqual(actionManager.otherActionList, []);
});
test('fixed session PvP allows registered hero-versus-hero damage only, preserving enemies, self-damage and environment behavior', () => {
  const entity = faction => ({ faction, shouldBeDestroyed: () => false, isFriendlyWith(other) { return faction === other.faction; } });
  const host = entity('players'), guest = entity('players'), worker = entity('players'), building = entity('players');
  const enemy = entity('enemies'), otherEnemy = entity('enemies');
  for (const pvp of [false, true]) {
    const players = Object.create(CoopPlayers.prototype);
    players.game = { globals: { desktopWorld: { transport: { pvp } } } };
    players.registry = { data: { host: 'host' } }; players.active = new Map([['host', { hero: host }], ['guest', { hero: guest }]]);
    assert.equal(players.canDamage(host, guest), pvp); assert.equal(players.canDamage(guest, host), pvp);
    for (const target of [worker, building]) { assert.equal(players.canDamage(target, host), false); assert.equal(players.canDamage(host, target), false); }
    assert.equal(players.canDamage(enemy, host), true); assert.equal(players.canDamage(host, enemy), true);
    assert.equal(players.canDamage(otherEnemy, enemy), true, 'Enemy-versus-enemy rules remain original');
    assert.equal(players.canDamage(host, host), true); assert.equal(players.canDamage(host, null), true);
    assert.equal(players.canDamage(host, { shouldBeDestroyed: () => true }), false);
  }
});
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

test('co-op capture preflights every hero before snapshots or persistence, protecting held purchases and in-flight construction', () => {
  for (const blocked of ['held', 'throwing', 'purchase', null]) {
    let snapshots = 0, writes = 0;
    const players = Object.create(CoopPlayers.prototype);
    players.game = { globals: { gamePurchaseManager: { consumeBuildingInProgress: blocked === 'purchase' } } };
    const hero = busy => ({ getEC: () => ({ isBuilding: () => busy && blocked === 'held', isThrowing: () => busy && blocked === 'throwing' }) });
    players.active = new Map([['host', { hero: hero(false) }], ['guest', { hero: hero(true) }]]);
    const records = new Map([['host', { location: [1, 2, 3] }], ['guest', { location: [4, 5, 6] }]]);
    players.registry = { player: id => records.get(id), persist: () => { writes++; } };
    players.captureHero = () => { snapshots++; return { location: [9, 9, 9] }; };
    const before = JSON.stringify([...records]);
    if (blocked) {
      assert.throws(() => players.capture(), /Finish placing/);
      assert.equal(snapshots, 0, 'Even an earlier idle hero must not be captured before every builder is safe');
      assert.equal(writes, 0); assert.equal(JSON.stringify([...records]), before);
    } else {
      players.capture(); assert.equal(snapshots, 2); assert.equal(writes, 1);
      assert.deepEqual(records.get('guest').location, [9, 9, 9]);
    }
  }
});
