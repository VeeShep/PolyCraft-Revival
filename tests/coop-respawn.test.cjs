'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const life = require('./runtime-ast.cjs').component('ECPlayerLife');
test('all heroes simulate their death/respawn while only the local host owns cheat and revive controls', () => {
  for (const mode of ['solo', 'host', 'guest']) {
    const events = [], entity = {}, actor = Object.assign(Object.create(life), {
      entity, state: life.states.DYING, _super() {}, gameManager: { desktopPlayers: mode === 'solo' ? null : {}, getHero: () => mode === 'guest' ? {} : entity },
      updateDeathAnimation: () => events.push('death'), updateScheduleRespawn: () => events.push('respawn'), updateCheats: () => events.push('cheats'),
      getTimeToRespawn: () => 10, displayRespawnCountdown: () => events.push('countdown'), displayRespawnOption: () => events.push('revive')
    });
    actor.update(); assert.deepEqual(events, mode === 'guest' ? ['death', 'respawn'] : ['death', 'respawn', 'cheats', 'countdown', 'revive']);
  }
});
test('environmental and cheat deaths log without an attacker and retain known attacker names', () => {
  const metrics = [], actor = { globals: { metricsManager: { sendGameMetric: name => metrics.push(name) } } };
  for (const attacker of [undefined, null, { archetypeName: 'bandit' }]) life.sendLoseLifeMetrics.call(actor, attacker);
  assert.deepEqual(metrics, ['heroDeath_unknown', 'heroDeath_unknown', 'heroDeath_bandit']);
});
test('the original scheduled respawn resets only its actor health/physics/location and completes once', () => {
  const events = [], health = { resetHealth: () => events.push('health'), setInvulnerable: value => events.push(['invulnerable', value]), setDisableHealthBar: value => events.push(['bar', value]), setInvulnerableDuration: value => events.push(['duration', value]) };
  const locomotion = { reset: () => events.push('locomotion'), setActive: value => events.push(['active', value]) };
  const entity = { getEC: name => ({ ECLocomotion: locomotion, ECPhysicsSphere: { reset: () => events.push('physics') } })[name], setv3Location: value => events.push(['position', value]) };
  const actor = Object.assign(Object.create(life), { entity, state: life.states.NORMAL, archetype: { respawnInvulnerableTime: 5 },
    globals: { gameCurrentTime: 10, mathDevice: { v3Copy: value => [...value], v3Build: (...value) => value, v3Add: (a, b) => a.map((value, i) => value + b[i]) } },
    getEntityEC: name => name === 'ECHealth' ? health : locomotion, setToDraw: value => events.push(['draw', value]), playSpawnSound: () => events.push('spawn') });
  actor.scheduleRespawn([1, 0, 3], 2); actor.state = life.states.RESPAWNING; actor.globals.gameCurrentTime = 12;
  actor.updateScheduleRespawn(); assert.equal(actor.state, life.states.NORMAL); assert.equal(actor.respawnTime, undefined);
  assert.equal(events.filter(value => value === 'health').length, 1); assert.ok(events.some(value => Array.isArray(value) && value[0] === 'position' && value[1].join() === '1,2,3'));
  actor.updateScheduleRespawn(); assert.equal(events.filter(value => value === 'spawn').length, 1);
});

test('lethal damage without an attacker completes the original health/death path without faction or metric crashes', () => {
  const healthRuntime = require('./runtime-ast.cjs').component('ECHealth'), metrics = [], events = [];
  const player = { loseLife: attacker => { assert.equal(attacker, undefined); events.push('death'); } };
  const actor = Object.assign(Object.create(healthRuntime), {
    health: 5, archetype: {}, invunTime: 0,
    entity: { archetypeName: 'hero', getEC: name => name === 'ECPlayerLife' ? player : null, hasEC: () => false, shudder() {} },
    gameManager: { getFactionManager: () => ({ getHeroFactionName: () => 'hero' }), getScoreInfo: () => ({}), eventManager: { notify() { throw new Error('No hero kill credit for environmental damage'); } } },
    globals: { metricsManager: { sendGameMetric: value => metrics.push(value) } },
    canOnlyBeDamagedByHero: () => false, isImmuneToIndirectHits: () => false, getInvulnerable: () => false, setInvulnerableDuration() {}, onHealthChange() {},
    getMaxHealth: () => 5, isDeathEnabled: () => true, isFading: () => false, evaluateShouldDraw() {}
  });
  actor.takeDamage(10); assert.equal(actor.health, 0); assert.deepEqual(events, ['death']);
  actor.sendEnemyDeathMetric(); assert.deepEqual(metrics, ['enemyDeath_hero']);
});
test('legacy kill cheat triggers one death even when takeDamage already starts respawning, and ignores an already dying hero', () => {
  for (const damageKills of [true, false]) {
    let deaths = 0;
    const actor = Object.assign(Object.create(life), { state: life.states.NORMAL, entity: {}, globals: { cheats: { kill: true } },
      loseLife(attacker) { assert.equal(attacker, this.entity); deaths++; this.state = this.states.DYING; },
      getEntityEC() { return { takeDamage: (_amount, _indirect, attacker) => { assert.equal(attacker, actor.entity); if (damageKills) actor.loseLife(attacker); } }; } });
    actor.updateCheats(); assert.equal(deaths, 1); assert.equal(actor.globals.cheats.kill, false);
    actor.globals.cheats.kill = true; actor.updateCheats(); assert.equal(deaths, 1);
  }
});
