'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { LocalBridge } = require('../desktop/bridge.js');
const { Saves, emptyState } = require('../desktop/saves.cjs');
const metadata = { badges: require('../badges.json').data };
function gameBadges(local) {
  function Manager() {}
  Manager.prototype = require('./runtime-ast.cjs').prototypeWith('awardBadge');
  const manager = new Manager(); const events = []; const requests = [];
  const invoke = (key, current, callback) => { requests.push(key); callback(local.service('badge.add', { data: { badge_key: key, ...(current === null ? {} : { current }) } }).data); };
  manager.badgeManager = {
    listBadges: callback => callback(local.service('badge.meta').data),
    listUserBadges: callback => callback(local.service('badge.read').data),
    awardUserBadge: (key, callback) => invoke(key, null, callback),
    updateUserBadgeProgress: (key, current, callback) => invoke(key, current, callback)
  };
  Object.assign(manager, { badgeAwardStatusMap: {}, progressBadgeTotalsMap: {}, progressBadgeCurrentScoresMap: {}, progressBadgePendingScoresMap: {}, numberOfBadgeRequests: 0 });
  manager.globals = { gameManager: { saveBadges: true, getEventManager: () => ({ notify: (name, data) => events.push({ name, ...data }) }) } };
  manager.init(manager.badgeManager);
  return { manager, events, requests };
}
test('the original badge manager restores awarded and partial achievements without awarding them again', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-badges-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const saves = new Saves(directory); const slot = saves.create('Achievements');
  const state = emptyState(); state.badges = { 'hero-level-5': 5, 'win-a-campaign': 1, '100-trees-chopped': 26 };
  saves.save(slot.id, state);
  const local = new LocalBridge(saves.load(slot.id).state, metadata, error => { throw error; });
  const { manager, events, requests } = gameBadges(local);
  assert.equal(manager.isAwarded('hero-level-5'), true);
  assert.equal(manager.isAwarded('win-a-campaign'), true);
  assert.equal(manager.progressBadgeCurrentScoresMap['100-trees-chopped'], 26);
  manager.awardBadge('win-a-campaign');
  manager.updateBadgeProgress('hero-level-5', 10);
  manager.updateBadgeProgress('100-trees-chopped', 26);
  assert.deepEqual(requests, []); assert.deepEqual(events, []);
  manager.updateBadgeProgress('100-trees-chopped', 100);
  assert.equal(events.filter(e => e.name === 'badgeAwarded').length, 1);
  manager.setAwarded('100-trees-chopped');
  assert.equal(events.filter(e => e.name === 'badgeAwarded').length, 1, 'Duplicate callbacks cannot replay the award');
  saves.save(slot.id, local.state);
  const restored = gameBadges(new LocalBridge(saves.load(slot.id).state, metadata, () => {}));
  assert.equal(restored.manager.isAwarded('100-trees-chopped'), true);
  assert.deepEqual(restored.events, []);
});
