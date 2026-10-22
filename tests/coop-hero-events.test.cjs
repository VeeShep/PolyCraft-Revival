'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('./runtime-ast.cjs');
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
