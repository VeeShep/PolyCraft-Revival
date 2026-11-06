'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CoopPlayers } = require('../desktop/coop-players.js');
const ast = require('./runtime-ast.cjs');
const update = ast.method('updateEntities'), updateActive = ast.method('updateActiveEntities', { pa: { start() {}, stop() {} } }), updateList = ast.method('updateEntitiesInList');

test('native space updates cover every co-op hero area once, retain offscreen updates and ignore destroyed/foreign heroes', () => {
  const counts = new Map(), areas = [], reuse = [], otherSpace = {};
  const entity = (name, due = true, destroyed = false) => ({ name, isTimeToUpdate: () => due, shouldBeDestroyed: () => destroyed,
    update: visible => { counts.set(name, { count: (counts.get(name)?.count || 0) + 1, visible }); } });
  const host = entity('host-area'), shop = entity('guest-workshop'), npc = entity('guest-npc'), shared = entity('overlap'), waiting = entity('waiting-area'), offscreen = entity('always'), notDue = entity('not-due', false), removed = entity('removed', true, true);
  const players = Object.create(CoopPlayers.prototype);
  const space = { gameManager: { gameCamera: { desiredV3Focus: [0, 0, 0] }, desktopPlayers: players }, globals: { gameCurrentTime: 10 },
    getGameGrid: () => ({}), destroyDeadEntities() {}, updateAllEntities() { assert.fail('Co-op must retain native spatial culling'); },
    updateActiveEntities: updateActive, updateEntitiesInList: updateList, entityAlwaysUpdateList: [shop, shared, offscreen],
    getUpdatingEntitiesNearPosition(point, radius) {
      areas.push({ x: point[0], radius }); reuse.length = 0;
      reuse.push(...(point[0] === 0 ? [host, shared] : point[0] === 80 ? [shop, shared, notDue, removed] : point[0] === 90 ? [shop, npc] : [waiting]));
      return reuse;
    } };
  const hero = (x, owner = space, destroyed = false) => ({ getGameSpace: () => owner, shouldBeDestroyed: () => destroyed, getv3Location: () => [x, 0, 0] });
  players.active = new Map([['host', { hero: hero(0) }], ['one', { hero: hero(80) }], ['two', { hero: hero(90) }], ['waiting', { hero: hero(95) }], ['foreign', { hero: hero(200, otherSpace) }], ['destroyed', { hero: hero(300, space, true) }]]);
  update.call(space);
  for (const name of ['host-area', 'guest-workshop', 'guest-npc', 'overlap', 'waiting-area']) assert.deepEqual(counts.get(name), { count: 1, visible: true }, name);
  assert.deepEqual(counts.get('always'), { count: 1, visible: false });
  assert.equal(counts.has('not-due') || counts.has('removed'), false);
  assert.deepEqual(areas.map(area => area.x), [0, 0, 80, 90, 95]); assert.ok(areas.every(area => area.radius === 30));
});

test('native solo update area and missing-grid fallback remain unchanged', () => {
  let active = 0, all = 0, destroyed = 0;
  const focus = [4, 5, 6], space = { gameManager: { gameCamera: { desiredV3Focus: focus } }, destroyDeadEntities() { destroyed++; }, getGameGrid: () => ({}),
    updateActiveEntities: point => { assert.equal(point, focus); active++; }, updateAllEntities: () => { all++; } };
  update.call(space); space.getGameGrid = () => null; update.call(space);
  assert.equal(active, 1); assert.equal(all, 1); assert.equal(destroyed, 2);
});
