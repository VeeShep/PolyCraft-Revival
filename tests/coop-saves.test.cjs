'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Saves } = require('../desktop/saves.cjs');
const { CoopData, KEY } = require('../desktop/coop-data.js');
const Beta2Saves = require('../reference/beta-2-save-reader/saves.cjs').Saves;
function fixture(t, io = fs) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-coop-saves-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, saves: new Saves(path.join(parent, 'saves'), io) };
}
test('only co-op slots enter format 3, preserving exact original bytes and rejecting the real Beta 2 reader', t => {
  const { saves } = fixture(t), slot = saves.create('Co-op host'), solo = saves.create('Solo');
  const file = saves.file(slot.id), original = fs.readFileSync(file);
  const coop = new CoopData(slot.state); const guest = coop.addPlayer('Friend'); guest.progress.xp = 300; coop.persist();
  coop.data.players[0].progress.xp = 2147483647; coop.data.economy.softCurrency = 2147483647; coop.persist();
  const migrated = saves.save(slot.id, slot.state);
  assert.equal(migrated.version, 3); assert.equal(saves.load(solo.id).version, 2);
  assert.deepEqual(fs.readFileSync(file + '.pre-v3'), original);
  assert.equal(migrated.state.cheats.everEnabled, false);
  const old = new Beta2Saves(saves.directory);
  assert.throws(() => old.load(slot.id), /Unsupported/); assert.throws(() => old.save(slot.id, slot.state), /Unsupported/);
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak')).version, 3, 'Missing-primary recovery also refuses old applications');
  saves.save(slot.id, migrated.state); assert.deepEqual(fs.readFileSync(file + '.pre-v3'), original);
  assert.equal(JSON.parse(saves.load(slot.id).state.userData[KEY]).players[1].progress.xp, 300);
  saves.remove(slot.id); assert.equal(fs.existsSync(file + '.pre-v3'), false); assert.equal(saves.load(solo.id).version, 2);
});
test('co-op progress and cheat history survive rename, corruption recovery, export/import and fresh readers', t => {
  const { saves, parent } = fixture(t), slot = saves.create('Friends');
  const coop = new CoopData(slot.state), guest = coop.addPlayer('Friend');
  guest.progress.xp = 400; guest.progress.desktopUpgradePoints = 0; coop.data.economy.softCurrency = 25; coop.persist();
  const saved = saves.save(slot.id, slot.state); saves.rename(slot.id, 'Renamed');
  assert.equal(saved.state.cheats.everEnabled, true, 'Explicit saved co-op cheat effects also mark permanent history');
  fs.writeFileSync(saves.file(slot.id), '{broken');
  const recovered = saves.load(slot.id); assert.equal(recovered.recovered, true); assert.equal(recovered.version, 3);
  assert.equal(JSON.parse(recovered.state.userData[KEY]).players[1].progress.xp, 400);
  const exported = path.join(parent, 'friends.json'); saves.export(slot.id, exported);
  const imported = saves.import(exported), fresh = new Saves(saves.directory).load(imported.id);
  assert.equal(fresh.version, 3); assert.equal(fresh.state.cheats.everEnabled, true);
  assert.deepEqual(JSON.parse(fresh.state.userData[KEY]), coop.data);
  assert.notEqual(imported.id, slot.id);
});
test('failed co-op migration preserves the old primary and untouched pre-v3 backup and can retry', t => {
  let fail = false;
  const io = { ...fs, renameSync(source, destination) { if (fail && destination.endsWith('.json')) throw new Error('disk refused'); return fs.renameSync(source, destination); } };
  const { saves } = fixture(t, io), slot = saves.create('Migration');
  const file = saves.file(slot.id), original = fs.readFileSync(file);
  new CoopData(slot.state).persist(); fail = true;
  assert.throws(() => saves.save(slot.id, slot.state), /disk refused/);
  assert.deepEqual(fs.readFileSync(file), original); assert.deepEqual(fs.readFileSync(file + '.pre-v3'), original);
  assert.equal(saves.load(slot.id).version, 2);
  fail = false; assert.equal(saves.save(slot.id, slot.state).version, 3);
  assert.deepEqual(fs.readFileSync(file + '.pre-v3'), original);
});
test('unknown co-op formats do not fall back to an older backup or overwrite a newer island', t => {
  const { saves } = fixture(t), slot = saves.create('Future'); new CoopData(slot.state).persist(); saves.save(slot.id, slot.state);
  const file = saves.file(slot.id), future = JSON.parse(fs.readFileSync(file));
  const coop = JSON.parse(future.state.userData[KEY]); coop.version++; future.state.userData[KEY] = JSON.stringify(coop);
  const bytes = JSON.stringify(future); fs.writeFileSync(file, bytes);
  assert.throws(() => saves.load(slot.id), error => error.code === 'UNSUPPORTED_SAVE');
  assert.throws(() => saves.save(slot.id, slot.state), /newer PolyCraft/);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});
test('version 3 remains version 3 even if its prior checkpoint predates co-op data', t => {
  const { saves, parent } = fixture(t), slot = saves.create('Host'); new CoopData(slot.state).persist(); saves.save(slot.id, slot.state);
  const file = saves.file(slot.id); fs.unlinkSync(file);
  assert.throws(() => new Beta2Saves(saves.directory).load(slot.id), /Unsupported/, 'Older apps also reject recovery when the newer primary is missing');
  const recovered = saves.load(slot.id); assert.equal(recovered.version, 3); assert.equal(Object.hasOwn(recovered.state.userData, KEY), false);
  const exported = path.join(parent, 'recovered.json'); saves.export(slot.id, exported);
  assert.equal(JSON.parse(fs.readFileSync(exported)).version, 3); assert.equal(saves.import(exported).version, 3);
  assert.equal(saves.save(slot.id, recovered.state).version, 3);
});
test('a Beta 1 slot can enter co-op directly while preserving both original backups and unknown cheat history', t => {
  const { saves } = fixture(t), slot = saves.create('Legacy host'), file = saves.file(slot.id);
  const legacy = JSON.parse(fs.readFileSync(file)); legacy.version = 1; delete legacy.state.cheats.everEnabled;
  const original = JSON.stringify(legacy, null, 2) + '\n'; fs.writeFileSync(file, original);
  const loaded = saves.load(slot.id); assert.equal(loaded.state.cheats.everEnabled, null);
  new CoopData(loaded.state).persist();
  const migrated = saves.save(slot.id, loaded.state);
  assert.equal(migrated.version, 3); assert.equal(migrated.state.cheats.everEnabled, null);
  assert.equal(fs.readFileSync(file + '.pre-v2', 'utf8'), original); assert.equal(fs.readFileSync(file + '.pre-v3', 'utf8'), original);
  assert.throws(() => new Beta2Saves(saves.directory).load(slot.id), /Unsupported/);
});
