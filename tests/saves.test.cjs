'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Saves, emptyState, validateState } = require('../desktop/saves.cjs');
function setup(t, io) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-saves-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new Saves(directory, io);
}
test('independent slots, rename and delete preserve other islands', t => {
  const saves = setup(t);
  const first = saves.create('First');
  const second = saves.create('Second');
  first.state.userData.softCurrency = '123';
  saves.save(first.id, first.state);
  assert.deepEqual(saves.load(second.id).state, emptyState());
  assert.equal(saves.load(first.id).state.userData.softCurrency, '123');
  saves.rename(first.id, 'Renamed');
  assert.equal(saves.load(first.id).name, 'Renamed');
  saves.remove(first.id);
  assert.deepEqual(saves.list().map(s => s.id), [second.id]);
});
test('export/import carries all state to a new slot and survives a fresh store instance', t => {
  const saves = setup(t);
  const slot = saves.create('Original');
  slot.state.userData = { resource: '[20,30]', softCurrency: '500', AdventureIncGameState: JSON.stringify({ saveVersionNumber: '1.0', gameSpaceList: [{ extents: [0,0,0,100,100,100], m43Transform: [1,0,0,0,1,0,0,0,1,0,0,0], entityList: [{ name: 'hero', archetypeName: 'hero', v3Location: [0,0,0], v3Scale: [1,1,1], yRotation: 0, ecData: {} }] }] }) };
  slot.state.userItems['amber-crown'] = { amount: 1 };
  slot.state.badges['early-adopter'] = 1;
  slot.state.cheats.invincible = true;
  slot.state = saves.save(slot.id, slot.state).state;
  const destination = path.join(path.dirname(saves.directory), path.basename(saves.directory) + '-export.json');
  t.after(() => fs.rmSync(destination, { force: true }));
  saves.export(slot.id, destination);
  const imported = saves.import(destination);
  assert.notEqual(imported.id, slot.id);
  assert.deepEqual(imported.state, slot.state);
  assert.deepEqual(new Saves(saves.directory).load(imported.id).state, slot.state);
});
test('corruption and a missing primary recover the previous valid checkpoint', t => {
  const saves = setup(t);
  const slot = saves.create('Recovery');
  slot.state.userData.softCurrency = '20';
  saves.save(slot.id, slot.state);
  fs.writeFileSync(saves.file(slot.id), '{broken');
  assert.equal(saves.load(slot.id).recovered, true);
  assert.deepEqual(saves.load(slot.id).state, emptyState());
  fs.writeFileSync(saves.file(slot.id), '{"damaged":true}');
  assert.equal(saves.load(slot.id).recovered, true);
  saves.save(slot.id, saves.load(slot.id).state);
  assert.equal(saves.load(slot.id).recovered, false);
  fs.unlinkSync(saves.file(slot.id));
  assert.equal(saves.list()[0].recovered, true);
  assert.equal(saves.load(slot.id).recovered, true);
});
test('failed atomic replacement leaves the committed save and recovery usable', t => {
  let fail = false;
  const io = { ...fs, renameSync(from, to) { if (fail && to.endsWith('.json')) throw new Error('disk full'); fs.renameSync(from, to); } };
  const saves = setup(t, io);
  const slot = saves.create('Safe');
  const next = emptyState(); next.userData.softCurrency = '99';
  fail = true;
  assert.throws(() => saves.save(slot.id, next), /disk full/);
  assert.deepEqual(saves.load(slot.id).state, emptyState());
  assert.deepEqual(saves.read(saves.file(slot.id) + '.bak').state, emptyState());
  assert.equal(fs.existsSync(saves.file(slot.id) + '.tmp'), false);
});
test('interrupted temporary files are ignored', t => {
  const saves = setup(t);
  const slot = saves.create('Stable');
  fs.writeFileSync(saves.file(slot.id) + '.tmp', '{partial');
  assert.equal(saves.list().length, 1);
  assert.deepEqual(saves.load(slot.id).state, emptyState());
});
test('reject malformed imports, unsafe keys, invalid currencies and unsupported versions', t => {
  const saves = setup(t);
  const slot = saves.create('Valid');
  const state = emptyState(); state.userData.softCurrency = '-1';
  assert.throws(() => validateState(state), /currency/);
  assert.throws(() => validateState(JSON.parse('{"userData":{},"userItems":{},"badges":{},"cheats":{},"__proto__":{}}')), /Unsafe/);
  assert.throws(() => saves.load('../outside'), /Invalid save slot/);
  assert.throws(() => saves.create(' '), /save name/);
  const file = saves.file(slot.id) + '.invalid';
  fs.writeFileSync(file, JSON.stringify({ ...slot, version: 99 }));
  assert.throws(() => saves.import(file), /Unsupported/);
  fs.writeFileSync(file, '{');
  assert.throws(() => saves.import(file), SyntaxError);
  assert.equal(saves.list().length, 1);
});

test('hero progression and editable points survive saves and reject malformed imports', t => {
  const saves = setup(t);
  const slot = saves.create('Hero progression');
  slot.state.userData.progress = JSON.stringify({ xp: 19581, desktopUpgradePoints: -3 });
  saves.save(slot.id, slot.state);
  assert.deepEqual(JSON.parse(saves.load(slot.id).state.userData.progress), { xp: 19581, desktopUpgradePoints: -3 });
  for (const progress of [{ xp: -1 }, { xp: 2147483648 }, { xp: 10, desktopUpgradePoints: 1.5 }, { xp: 10, desktopUpgradePoints: 'many' }]) {
    slot.state.userData.progress = JSON.stringify(progress);
    assert.throws(() => saves.save(slot.id, slot.state), /hero progression/);
  }
});

function legacySlot(saves, cheats = {}, userData = {}, recovered = false) {
  const slot = saves.create('Legacy');
  const state = emptyState();
  delete state.cheats.everEnabled;
  Object.assign(state.cheats, cheats);
  state.userData = userData;
  const raw = JSON.stringify({ format: slot.format, version: 1, name: slot.name, updatedAt: slot.updatedAt, state }, null, 2) + '\n';
  fs.writeFileSync(saves.file(slot.id) + (recovered ? '.bak' : ''), raw);
  if (recovered) fs.unlinkSync(saves.file(slot.id));
  return { id: slot.id, raw };
}
test('new saves start clean; enabling cheats alone is sticky through recovery, rename and import/export', t => {
  const saves = setup(t);
  const slot = saves.create('Clean');
  assert.equal(slot.version, 2);
  assert.equal(saves.list()[0].everEnabled, false);
  slot.state.cheats.enabled = true;
  assert.equal(saves.save(slot.id, slot.state).state.cheats.everEnabled, true);
  slot.state.cheats.enabled = false;
  slot.state.cheats.everEnabled = false;
  assert.equal(saves.save(slot.id, slot.state).state.cheats.everEnabled, true);
  assert.equal(slot.state.cheats.everEnabled, false, 'persistence must not mutate caller state');
  fs.writeFileSync(saves.file(slot.id), '{corrupt');
  assert.equal(saves.load(slot.id).state.cheats.everEnabled, true);
  saves.rename(slot.id, 'Renamed');
  // Export outside the managed directory, as real users must.
  const destination = path.join(path.dirname(saves.directory), path.basename(saves.directory) + '-history.json');
  t.after(() => fs.rmSync(destination, { force: true }));
  saves.export(slot.id, destination);
  assert.equal(saves.import(destination).state.cheats.everEnabled, true);
  assert.equal(saves.list().every(s => s.everEnabled === true), true);
});
test('legacy history uses known effects and otherwise stays unknown without wealth or level heuristics', t => {
  const saves = setup(t);
  for (const cheats of [{ enabled: true }, { invincible: true }, { instantBuild: true }]) {
    const slot = legacySlot(saves, cheats);
    assert.equal(saves.load(slot.id).state.cheats.everEnabled, true);
  }
  const editedPoints = legacySlot(saves, {}, { progress: '{"xp":0,"desktopUpgradePoints":0}' });
  assert.equal(saves.load(editedPoints.id).state.cheats.everEnabled, true);
  const unknown = legacySlot(saves, {}, { softCurrency: '9999999', progress: '{"xp":2147483647}' });
  const loaded = saves.load(unknown.id);
  assert.equal(loaded.state.cheats.everEnabled, null);
  loaded.state.cheats.everEnabled = false;
  assert.equal(saves.save(unknown.id, loaded.state).state.cheats.everEnabled, null);
});
test('migration preserves exact original bytes once and both current files reject the real Beta 1 reader', t => {
  const saves = setup(t);
  const old = legacySlot(saves);
  const file = saves.file(old.id);
  assert.equal(fs.existsSync(file + '.pre-v2'), false, 'reading does not migrate');
  const state = saves.load(old.id).state;
  saves.save(old.id, state);
  assert.equal(fs.readFileSync(file + '.pre-v2', 'utf8'), old.raw);
  saves.save(old.id, state);
  assert.equal(fs.readFileSync(file + '.pre-v2', 'utf8'), old.raw);
  const Beta1Saves = require('../reference/beta-1/desktop/saves.cjs').Saves;
  const oldApp = new Beta1Saves(saves.directory);
  assert.throws(() => oldApp.load(old.id), /Unsupported/);
  assert.throws(() => oldApp.save(old.id, state), /Unsupported/);
  assert.equal(saves.load(old.id).version, 2);
  saves.remove(old.id);
  assert.equal(fs.existsSync(file + '.pre-v2'), false);
});
test('legacy recovery and import keep untouched original backups', t => {
  const saves = setup(t);
  const old = legacySlot(saves, { enabled: true }, {}, true);
  const loaded = saves.load(old.id);
  assert.equal(loaded.recovered, true);
  saves.save(old.id, loaded.state);
  assert.equal(fs.readFileSync(saves.file(old.id) + '.pre-v2', 'utf8'), old.raw);
  assert.equal(saves.load(old.id).state.cheats.everEnabled, true);
  const source = saves.file(old.id) + '.legacy';
  fs.writeFileSync(source, old.raw);
  const imported = saves.import(source);
  assert.equal(imported.version, 2);
  assert.equal(fs.readFileSync(saves.file(imported.id) + '.pre-v2', 'utf8'), old.raw);
  assert.equal(fs.readFileSync(source, 'utf8'), old.raw);
});
test('failed migration keeps original primary and untouched backup; retry succeeds', t => {
  let fail = false;
  const io = { ...fs, renameSync(from, to) { if (fail && to.endsWith('.json')) throw new Error('disk full'); fs.renameSync(from, to); } };
  const saves = setup(t, io);
  const old = legacySlot(saves);
  const file = saves.file(old.id);
  fail = true;
  assert.throws(() => saves.save(old.id, saves.load(old.id).state), /disk full/);
  assert.equal(fs.readFileSync(file, 'utf8'), old.raw);
  assert.equal(fs.readFileSync(file + '.pre-v2', 'utf8'), old.raw);
  fail = false;
  saves.save(old.id, saves.load(old.id).state);
  assert.equal(saves.load(old.id).version, 2);
});
test('future save formats never fall back and overwrite a newer island', t => {
  const saves = setup(t);
  const slot = saves.create('Future');
  saves.save(slot.id, slot.state);
  const file = saves.file(slot.id);
  const future = JSON.stringify({ ...slot, version: 99 });
  fs.writeFileSync(file, future);
  assert.throws(() => saves.load(slot.id), /Unsupported/);
  assert.throws(() => saves.save(slot.id, slot.state), /Unsupported/);
  assert.equal(fs.readFileSync(file, 'utf8'), future);
  assert.match(saves.list()[0].error, /Unsupported/);
  fs.writeFileSync(file, JSON.stringify(slot));
  fs.writeFileSync(file + '.bak', future);
  assert.throws(() => saves.load(slot.id), /Unsupported/);
  fs.unlinkSync(file);
  assert.throws(() => saves.load(slot.id), /Unsupported/);
});
test('version 2 requires valid explicit cheat history; missing incoming history cannot manufacture a clean save', t => {
  const saves = setup(t);
  for (const value of ['false', 0, {}, []]) {
    const state = emptyState(); state.cheats.everEnabled = value;
    assert.throws(() => saves.create('Bad history', state), /cheat settings/);
  }
  const edited = emptyState(); edited.userData.progress = '{"xp":0,"desktopUpgradePoints":0}';
  assert.equal(saves.create('Known edit', edited).state.cheats.everEnabled, true);
  const state = emptyState(); delete state.cheats.everEnabled;
  const slot = saves.create('Untracked', state);
  assert.equal(slot.state.cheats.everEnabled, null);
  fs.writeFileSync(saves.file(slot.id), JSON.stringify({ ...slot, state }));
  assert.throws(() => saves.load(slot.id), /Missing cheat history/);
});

test('known history committed to recovery survives a failed primary write and retry', t => {
  let fail = false;
  const io = { ...fs, renameSync(from, to) { if (fail && to.endsWith('.json')) throw new Error('disk full'); fs.renameSync(from, to); } };
  const saves = setup(t, io);
  const slot = saves.create('History safety');
  slot.state.cheats.enabled = true;
  fail = true;
  assert.throws(() => saves.save(slot.id, slot.state), /disk full/);
  const loaded = saves.load(slot.id);
  assert.equal(loaded.recovered, false);
  assert.equal(loaded.state.cheats.enabled, false, 'keep committed primary gameplay/settings');
  assert.equal(loaded.state.cheats.everEnabled, true, 'preserve known use committed to backup');
  fail = false;
  assert.equal(saves.save(slot.id, emptyState()).state.cheats.everEnabled, true);
});
