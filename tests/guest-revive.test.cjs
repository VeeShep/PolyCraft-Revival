'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostActions } = require('../desktop/coop-actions.js');
const { GuestWorld } = require('../desktop/guest-world.js');
const original = require('./runtime-ast.cjs').component('ECPlayerLife', { H: { LUMBER: 0 } });
function host() {
  const funds = { amber: 30, lumber: 100 }, data = { getResource: () => funds.lumber, getSoftCurrency: () => funds.amber,
    adjustResource: (_type, amount) => { funds.lumber += amount; }, adjustSoftCurrency: amount => { funds.amber += amount; } };
  const life = Object.assign(Object.create(original), { state: original.states.RESPAWNING, respawnTime: 130, deathTime: 99, archetype: { respawnHighCostDelay: 10 },
    globals: { gameCurrentTime: 100, mathDevice: { v3Copy: value => [...value] } }, getEntityEC: () => data, getv3Location: () => [3, 0, 4] });
  const actor = { shouldBeDestroyed: () => false, getEC: name => name === 'ECPlayerLife' ? life : {} };
  const game = { getGameEntityByName: id => id === 'owned' ? actor : { shouldBeDestroyed: () => false }, isScriptLocked: () => false };
  const actions = new HostActions();
  return { funds, life, actor, game, actions, run: (type, details = {}, id = 'owned') => actions.execute(game, actor, {}, id, null, type, details) };
}
test('revive intents use fixed original prices and the current actor/death, never guest-supplied costs or destinations', () => {
  const f = host(), result = f.run('life'); assert.equal(result.life.option, 'amber'); assert.equal(result.life.episode, 99);
  for (const value of [{ type: 'revive', sequence: 1, target: 'owned', amber: true, episode: 99, cost: 0 }, { type: 'revive', sequence: 1, target: 'owned', amber: true }, { type: 'revive', sequence: 1, target: 'owned', amber: 1, episode: 99 }, { type: 'revive', sequence: 1, target: 'owned', amber: true, episode: NaN }]) assert.throws(() => f.actions.receive(value), /Invalid/);
  assert.match(f.run('revive', { amber: true, episode: 99 }, 'other'), /own hero/); assert.equal(f.funds.amber, 30);
  assert.match(f.run('revive', { amber: true, episode: 98 }), /changed/); assert.equal(f.funds.amber, 30);
  f.actions.receive({ type: 'revive', sequence: 1, target: 'owned', amber: true, episode: 99 });
  const paid = f.actions.apply(f.game, f.actor, {}); assert.equal(paid.save, true); assert.equal(paid.life.option, null);
  assert.equal(f.funds.amber, 20); assert.deepEqual(Array.from(f.life.respawnLocation), [3, 0, 4]);
  assert.match(f.run('revive', { amber: false, episode: 99 }), /unavailable/); assert.equal(f.funds.lumber, 100);
  assert.equal(f.life.payToRevive(10, 0, true), false); assert.equal(f.funds.amber, 20);
});
test('threshold changes, shared spending, normal life, dying phase and script locks refuse stale charges; lumber retains its original destination', () => {
  const f = host(); f.life.globals.gameCurrentTime = 125; f.life.respawnLocation = [1, 0, 2];
  assert.equal(f.run('life').life.option, 'lumber'); assert.match(f.run('revive', { amber: true, episode: 99 }), /changed/);
  f.funds.lumber = 49; assert.equal(f.run('life').life.affordable, false); assert.match(f.run('revive', { amber: false, episode: 99 }), /unavailable/);
  f.funds.lumber = 100; f.game.isScriptLocked = () => true; assert.match(f.run('revive', { amber: false, episode: 99 }), /changed/);
  f.game.isScriptLocked = () => false; assert.equal(f.run('revive', { amber: false, episode: 99 }).save, true);
  assert.equal(f.funds.lumber, 50); assert.deepEqual(f.life.respawnLocation, [1, 0, 2]);
  delete f.life.respawnTime; f.life.state = f.life.states.NORMAL; assert.equal(f.run('life').life.option, null); assert.match(f.run('revive', { amber: false, episode: 99 }), /unavailable/);
  f.life.state = f.life.states.DYING; f.life.deathAnimationDuration = 1; f.life.deathTime = 124.5;
  assert.equal(f.run('life').life.phase, 'dying'); assert.equal(f.run('life').life.option, null);
});
function guest() {
  const sent = [], drawn = [], messages = [], removed = []; let sequence = 0, clicked = false;
  const world = Object.assign(Object.create(GuestWorld.prototype), { lastLifeQuery: -Infinity, targetSequence: 0, identity: { entity: 'owned' }, scene: { snapshot: {} }, controls: { paused: false, guiTypes: { BUTTON_NORMAL: 1 }, app: { globals: { guiRenderer: { getv2RenderLocation: () => [0, 0] } } } },
    movement: { nativeFocused: true }, cancelLocalMenu() {}, sendTarget(type, target) { sent.push({ type, target }); return ++sequence; },
    connection: { send: async (_kind, value) => sent.push(value) },
    game: { getGuiManager: () => ({ addGameMessage: (...value) => messages.push(value), removeGameMessage: id => removed.push(id) }), getIMGui: () => ({ doButton: value => { drawn.push(value); return clicked; } }) } });
  return { world, sent, drawn, messages, removed, click: value => { clicked = value; } };
}
test('guest countdown and original revive artwork send one pending choice with the expected episode, and stale or malformed state cannot buy', () => {
  const f = guest(); f.world.updateLife(); assert.equal(f.sent[0].type, 'life');
  f.world.receiveLife({ type: 'life', sequence: f.world.lifeRequest, life: { phase: 'waiting', remaining: 20, episode: 99, option: 'amber', affordable: true } });
  f.world.updateLife(); assert.equal(f.drawn[0].guiArchetype, 'respawnButtonAmber'); assert.equal(f.drawn[0].text2, '10'); assert.match(f.messages[0][2], /Revive in/);
  f.click(true); f.world.targetSequence = 1; f.world.updateLife(); f.world.updateLife();
  assert.equal(f.sent.filter(value => value.type === 'revive').length, 1); assert.equal(f.sent.at(-1).episode, 99); assert.equal(f.sent.at(-1).amber, true);
  f.world.receiveLife({ type: 'revive', sequence: f.world.reviveRequest, life: { phase: 'normal', remaining: 0, episode: null, option: null, affordable: false } });
  assert.equal(f.world.reviveRequest, null); assert.deepEqual(f.removed, ['guest-revive']);
  const before = f.sent.length; f.world.receiveLife({ type: 'life', sequence: 999, life: { phase: 'waiting', remaining: 10, episode: 99, option: 'lumber', affordable: true } }); assert.equal(f.world.lifeState.phase, 'normal'); assert.equal(f.sent.length, before);
  f.world.lifeRequest = 777; f.world.receiveLife({ type: 'revive', sequence: 777, life: { phase: 'waiting', remaining: 10, episode: 99, option: 'lumber', affordable: true } }); assert.equal(f.world.lifeState.phase, 'normal'); f.world.lifeRequest = null;
  for (const invalid of [{ phase: 'normal', remaining: 0, episode: null, option: 'amber', affordable: true }, { phase: 'waiting', remaining: NaN, episode: 99, option: null, affordable: false }, { phase: 'waiting', remaining: 20, episode: 99, option: 'amber', affordable: true, price: 0 }]) assert.throws(() => f.world.receiveLife({ type: 'life', sequence: 1, life: invalid }), /Invalid hero/);
  f.world.lifeState = { phase: 'waiting', remaining: 20, episode: 99, option: 'amber', affordable: true }; f.world.lifeReceivedAt = performance.now() - 3000;
  const buttons = f.drawn.length; f.world.updateLife(); assert.equal(f.drawn.length, buttons, 'Expired status cannot offer a stale purchase');
  f.world.reviveRequest = 888; f.world.receiveLife({ type: 'revive', sequence: 888, message: 'Choice changed.' }); assert.equal(f.world.lifeState.option, null); assert.equal(f.world.lifeState.affordable, false);
  f.world.controls.paused = true; const queries = f.sent.length; f.world.updateLife(); assert.equal(f.sent.length, queries);
});
