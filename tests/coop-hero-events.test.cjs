'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('./runtime-ast.cjs');
test('guest EmptyHanded events cannot consume host premium inventory; original host and solo placement callbacks remain', () => {
  const host = {}, guest = {}; let callback, removed = 0, claimed = 0;
  const game = { desktopPlayers: {}, getHero: () => host, eventManager: { subscribe: (name, value) => { assert.equal(name, 'EmptyHanded'); callback = value; } } };
  const purchase = { globals: { gameManager: game }, removeConsumeOnBuildingPlacement: () => { removed++; }, createPlaceableBuildings: () => { claimed++; } };
  runtime.method('requestConsumeOnBuildingPlacement').call(purchase);
  callback({ entity: guest }); assert.equal(removed + claimed, 0);
  callback(); assert.equal(removed + claimed, 0);
  callback({ entity: host }); assert.equal(removed, 1); assert.equal(claimed, 1);
  delete game.desktopPlayers; callback(); assert.equal(removed, 2); assert.equal(claimed, 2);
});
test('interface tween hook advances only the original drawing clock, preserving solo draw order', () => {
  const calls = [], L = { drawUpdate: (...args) => calls.push(args) };
  runtime.method('updateInterfaceTweens', { L }).call({ globals: { gameCurrentTime: 2, appCurrentTime: 3 } });
  assert.deepEqual(calls, [[2000, 3000]]);
  const order = [], game = { globals: { simpleFontRenderer: { render: () => order.push('font') } }, imgui: { draw2D: () => order.push('imgui') },
    activeGameState: { draw2D: () => order.push('state') }, updateInterfaceTweens: () => order.push('tweens'), getGuiManager: () => ({ completeDraw: () => order.push('gui') }), gameController: { draw2D: () => order.push('controller') } };
  runtime.prototypeWith('updateInterfaceTweens').draw2D.call(game);
  assert.deepEqual(order, ['imgui', 'state', 'tweens', 'gui', 'controller', 'font']);
});
test('original ally-skipping projectile collision honors hero PvP and still passes protected friends, with solo behavior retained', () => {
  const update = runtime.component('ECProjectile').update;
  for (const [cooperative, permitted] of [[true, false], [true, true], [false, false], [false, true]]) {
    let impacts = 0;
    const victim = { getEC: () => ({ takesFullDamageFromFriendlyFire: () => permitted }) }, owner = { isFriendlyWith: () => true };
    const game = { getCollisionInfo: () => ({ collidedEntity: victim, v3Location: [0, 0, 1] }) };
    if (cooperative) game.desktopPlayers = { canDamage: (target, source) => { assert.equal(target, victim); assert.equal(source, owner); return permitted; } };
    const projectile = { globals: { gameCurrentTime: 0, mathDevice: { v3AddScalarMul: () => [0, 0, 1], v3DistanceSq: () => 0 } },
      gameManager: game, ignoresAllies: true, maxImpacts: 1, scratchpad: {}, fireTime: 0,
      getOwner: () => owner, isManagedByThisMachine: () => true, getTimeSinceLastUpdate: () => 1 / 60, _super() {},
      getv3Location: () => [0, 0, 0], applyRotation() {}, onImpact: () => { impacts++; }, getEntityEC: () => null,
      entity: { setv3Location() {}, getAge: () => 0 } };
    update.call(projectile); assert.equal(impacts, Number(permitted));
  }
});
test('combat protection rejects health damage and area-hit side effects before original callbacks execute', () => {
  const hero = {}, victim = {};
  const manager = { desktopPlayers: { canDamage: (target, source) => { assert.equal(target, victim); assert.equal(source, hero); return false; } } };
  const health = runtime.component('ECHealth');
  assert.doesNotThrow(() => health.takeDamage.call({ entity: victim, gameManager: manager }, 5, false, hero, true, true));
  assert.doesNotThrow(() => runtime.method('applyToEntity').call({ damage: 5, gameManager: manager }, victim, hero));
  const context = { entity: victim, gameManager: { desktopPlayers: { allowsHeroPvp: () => true } }, archetype: { takesFullDamageFromFriendlyFire: false } };
  assert.equal(health.takesFullDamageFromFriendlyFire.call(context), true);
  delete context.gameManager.desktopPlayers;
  assert.equal(health.takesFullDamageFromFriendlyFire.call(context), false);
});
test('original hero creation supplies a numeric rotation before the first simulation tick', () => {
  let rotation;
  const hero = { getEC: name => name === 'ECHero' ? { setHeroColour() {}, setHeroNumber() {} } : { setFaction() {} } };
  const game = { globals: { mathDevice: {} }, getFreeHeroIndex: () => 1,
    getEntityFactory: () => ({ createActiveEntityInstance(name, archetype, location, angle) { rotation = angle; return hero; } }),
    getFactionManager: () => ({ getHeroFactionName: () => 'heroes' }) };
  assert.equal(runtime.method('createHero').call(game, 'Guest', 'hero', [0, 0, 0]), hero);
  assert.equal(typeof rotation, 'number'); assert.equal(rotation, 1);
});
test('native damage applies guest-owned enemy and enabled hero hits while protecting allied workers and buildings from damage and stun', () => {
  const { CoopPlayers } = require('../desktop/coop-players.js'), damageMethods = runtime.prototypeWith('applyToEntity'), healthMethods = runtime.component('ECHealth');
  for (const pvp of [false, true]) {
    const players = Object.create(CoopPlayers.prototype), game = { globals: { desktopWorld: { transport: { pvp } } }, desktopPlayers: players,
      getFactionManager: () => ({ areFriendly: (a, b) => a.faction === b.faction }) };
    players.game = game; players.registry = { data: { host: 'host' } };
    function entity(faction, agent = false) {
      const state = { hp: 50, calls: 0, stun: 0 }, actor = { faction, shouldBeDestroyed: () => false, isManagedByThisMachine: () => true, hasEC: () => false,
        isFriendlyWith: other => faction === other.faction, getv3Location: () => [0, 0, 0], state };
      const health = { getInvulnerable: () => false, isRooted: () => false,
        takeDamage(amount, critical, aggressor) { assert.equal(aggressor, guest); assert.equal(critical, true); state.hp -= amount; state.calls++; },
        takesFullDamageFromFriendlyFire: () => healthMethods.takesFullDamageFromFriendlyFire.call({ entity: actor, gameManager: game, archetype: { takesFullDamageFromFriendlyFire: false } }) };
      actor.getEC = name => name === 'ECHealth' ? health : name === 'ECAgent' && agent ? { setStunned: time => { state.stun = time; } } : null;
      return actor;
    }
    const host = entity('players'), guest = entity('players'), enemy = entity('enemies', true), worker = entity('players', true), building = entity('players');
    players.active = new Map([['host', { hero: host }], ['guest', { hero: guest }]]);
    const damage = Object.assign(Object.create(damageMethods), { damage: 40, friendlyFire: 0, stunDuration: 0.5, gameManager: game, globals: { gameTimeStep: 1 / 60, mathDevice: {} } });
    for (const target of [host, enemy, worker, building]) damage.applyToEntity(target, guest);
    assert.equal(enemy.state.hp, 10); assert.equal(enemy.state.calls, 1); assert.equal(enemy.state.stun, 0.5);
    assert.equal(host.state.hp, pvp ? 10 : 50); assert.equal(host.state.calls, pvp ? 1 : 0);
    for (const target of [worker, building]) assert.deepEqual(target.state, { hp: 50, calls: 0, stun: 0 });
  }
});
test('original preload loads both torch and daytime hands before any guest scene can need them', () => {
  const loaded = new Set(), requests = [];
  const globals = { simpleSceneLoader: { isLoadingMesh: name => loaded.has(name), load: name => { loaded.add(name); requests.push(name); } } };
  const preload = runtime.staticMethod('ECHeroTorch', 'preload', { Xa: { create: () => ({}) } });
  preload(globals); preload(globals);
  assert.deepEqual(requests, ['characters/models/hero_torchhand.dae', 'characters/models/hero_lefthand.dae']);
});
test('co-op kill, gathering and currency statistics belong to the hero who performed the action, while solo global events still work', () => {
  const ec = runtime.component('ECPlayerData'), entity = {}, other = {}, calls = [];
  const context = { entity, gameManager: { desktopPlayers: {} }, autoSaveGameStats() {},
    playerData: { addKill: () => calls.push('kill'), addTreeChopped: () => calls.push('tree'), addRockDestroyed: () => calls.push('rock'), addSoftCurrencyFound: amount => calls.push(amount) } };
  const kill = { aggressor: other, victim: { getEC: () => true } };
  ec.addKill.call(context, kill); ec.addSoftCurrencyFound.call(context, 1);
  assert.deepEqual(calls, []);
  ec.addKill.call(context, { ...kill, aggressor: entity }); ec.addSoftCurrencyFound.call(context, 2, true);
  const gather = runtime.method('addResourceDispsenserDepletedByHero', { H: { LUMBER: 0 } });
  gather.call(context, { hero: other, resourceType: 0 }); gather.call(context, { hero: entity, resourceType: 0 });
  assert.deepEqual(calls, ['kill', 2, 'tree']);
  delete context.gameManager.desktopPlayers;
  ec.addKill.call(context, kill); ec.addSoftCurrencyFound.call(context, 3); gather.call(context, { resourceType: 1 });
  assert.deepEqual(calls, ['kill', 2, 'tree', 'kill', 3, 'rock']);
});
test('level-up refresh receives the earning hero and plays its effect on that hero', () => {
  const ec = runtime.component('ECPlayerData'), hero = { getName: () => 'Guest' }, calls = [];
  let xp = 0;
  const context = { entity: hero, gameManager: { getGuiManager: () => ({ addXpBubble() {}, addGameMessage() {} }), refreshHeroEntity: target => calls.push(target), getGameSoundManager: () => ({ play() {} }) },
    globals: { appCurrentTime: 1 }, getv3Location: () => [0, 0, 0], getVisibleXP: () => xp,
    getLevel: () => xp > 0 ? 1 : 0, playerData: { addXP: amount => { xp += amount; } }, saveProgress() {}, onLevelUp() {}, autoSaveProgress() {} };
  ec.adjustXP.call(context, 5); assert.equal(calls[0], hero);
  hero.playEffect = name => calls.push(name); context.sendLevelUpMetric = context.sendLevelUpEvent = () => {};
  ec.onLevelUp.call(context); assert.equal(calls[1], 'sfx_hero_level_up');
});
