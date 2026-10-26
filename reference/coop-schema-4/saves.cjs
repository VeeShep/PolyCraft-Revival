'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { KEY: COOP_KEY, validateCoop } = require('./coop-data.js');

const SAVE_VERSION = 6;
// Co-op schemas 1/2/3/4 use envelopes 3/4/5/6; ordinary solo saves remain format 2.
const versionForState = state => Object.hasOwn(state.userData, COOP_KEY) ? JSON.parse(state.userData[COOP_KEY]).version + 2 : 2;
const MAX_BYTES = 32 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function checkJSON(value, depth = 0) {
  if (depth > 100) throw new Error('Save is nested too deeply.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid number in save.');
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe key in save.');
      checkJSON(value[key], depth + 1);
    }
  }
}
function validateState(state) {
  if (!plain(state) || !plain(state.userData) || !plain(state.userItems) || !plain(state.badges) || !plain(state.cheats)) {
    throw new Error('This file is not a complete PolyCraft Offline save.');
  }
  checkJSON(state);
  for (const [key, value] of Object.entries(state.userData)) {
    if (!/^[\w-]{1,100}$/.test(key) || typeof value !== 'string') throw new Error('Invalid game data.');
    const data = JSON.parse(value);
    checkJSON(data);
    if (key === COOP_KEY) validateCoop(data);
    if (['softCurrency', 'consumedSoftCurrency'].includes(key) && (!Number.isSafeInteger(data) || data < 0)) throw new Error('Invalid currency.');
    if (key === 'resource' && (!Array.isArray(data) || data.length !== 2 || data.some(n => !Number.isSafeInteger(n) || n < 0))) throw new Error('Invalid resources.');
    if (['heroUpgrades', 'progress', 'gameStats', 'settings', 'shareData', 'numberOfGamesPlayed', 'scriptFlags', 'taskFlags'].includes(key) && !plain(data)) throw new Error('Invalid player data: ' + key);
    if (key === 'progress' && (!Number.isSafeInteger(data.xp) || data.xp < 0 || data.xp > 2147483647 || (data.desktopUpgradePoints !== undefined && (!Number.isSafeInteger(data.desktopUpgradePoints) || Math.abs(data.desktopUpgradePoints) > 2147483647)))) throw new Error('Invalid hero progression.');
    if (key === 'AdventureIncGameState') {
      const vector = (v, size) => Array.isArray(v) && v.length === size && v.every(Number.isFinite);
      if (!plain(data) || data.saveVersionNumber !== '1.0' || !Array.isArray(data.gameSpaceList) || !data.gameSpaceList.length) throw new Error('Invalid island data or unsupported island version.');
      for (const space of data.gameSpaceList) {
        if (!plain(space) || !vector(space.extents, 6) || !vector(space.m43Transform, 12) || !Array.isArray(space.entityList)) throw new Error('Invalid island space.');
        for (const entity of space.entityList) {
          if (!plain(entity) || typeof entity.name !== 'string' || !vector(entity.v3Location, 3) || !vector(entity.v3Scale, 3) || !Number.isFinite(entity.yRotation) || !plain(entity.ecData) || !(typeof entity.archetypeName === 'string' || plain(entity.customArchetype))) throw new Error('Invalid island entity.');
        }
      }
    }
  }
  for (const [key, item] of Object.entries(state.userItems)) {
    if (!['amber', 'amber-crown', 'amber-well', 'amber-well-owned', 'mana-pack-standard'].includes(key) || !plain(item) || !Number.isSafeInteger(item.amount) || item.amount < 0) throw new Error('Invalid inventory.');
  }
  for (const [key, value] of Object.entries(state.cheats)) {
    if (key === 'everEnabled') {
      if (value !== null && typeof value !== 'boolean') throw new Error('Invalid cheat settings.');
    } else if (!['enabled', 'invincible', 'instantBuild'].includes(key) || typeof value !== 'boolean') throw new Error('Invalid cheat settings.');
  }
  return state;
}
function validate(save) {
  if (!plain(save) || save.format !== 'polycraft-offline' || ![1, 2, 3, 4, 5, SAVE_VERSION].includes(save.version)) {
    const error = new Error('Unsupported save format or version.');
    if (plain(save) && save.format === 'polycraft-offline' && Number.isInteger(save.version) && save.version > SAVE_VERSION) error.code = 'UNSUPPORTED_SAVE';
    throw error;
  }
  validName(save.name);
  if (typeof save.updatedAt !== 'string' || !Number.isFinite(Date.parse(save.updatedAt))) throw new Error('Invalid save date.');
  validateState(save.state);
  if (save.version >= 2 && !Object.hasOwn(save.state.cheats, 'everEnabled')) throw new Error('Missing cheat history.');
  if (save.version < versionForState(save.state) && Object.hasOwn(save.state.userData, COOP_KEY)) {
    const error = new Error('Co-op data requires a newer save envelope.'); error.code = 'UNSUPPORTED_SAVE'; throw error;
  }
  if (save.version === 1) save.state.cheats.everEnabled = null;
  save.state = withHistory(save.state);
  return save;
}
function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Use a save name between 1 and 80 characters.');
  return name.trim();
}
function withHistory(state, previous) {
  validateState(state);
  const copy = structuredClone(state);
  const cheats = copy.cheats;
  const coop = copy.userData[COOP_KEY] ? JSON.parse(copy.userData[COOP_KEY]) : null;
  const editedPoints = Object.hasOwn(JSON.parse(copy.userData.progress || '{}'), 'desktopUpgradePoints') || !!coop?.players.some(player => Object.hasOwn(player.progress, 'desktopUpgradePoints'));
  cheats.everEnabled = editedPoints || cheats.enabled || cheats.invincible || cheats.instantBuild || cheats.everEnabled === true || previous === true
    ? true : cheats.everEnabled === false && previous !== null ? false : null;
  return copy;
}
function emptyState() {
  return { userData: {}, userItems: {}, badges: {}, cheats: { enabled: false, invincible: false, instantBuild: false, everEnabled: false } };
}
class Saves {
  constructor(directory, io = fs) {
    this.directory = directory;
    this.io = io;
    io.mkdirSync(directory, { recursive: true });
  }
  file(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid save slot.');
    return path.join(this.directory, id + '.json');
  }
  read(file) {
    if (this.io.statSync(file).size > MAX_BYTES) throw new Error('Save exceeds 32 MB.');
    return validate(JSON.parse(this.io.readFileSync(file, 'utf8')));
  }
  load(id) {
    const file = this.file(id);
    let save;
    try { save = this.read(file); }
    catch (primaryError) {
      if (primaryError.code === 'UNSUPPORTED_SAVE') throw primaryError;
      try { return { id, ...this.read(file + '.bak'), recovered: true }; }
      catch (backupError) {
        if (backupError.code === 'UNSUPPORTED_SAVE') throw backupError;
        throw new Error('Unable to load this slot or its recovery backup: ' + primaryError.message);
      }
    }
    // A failed primary replacement may already have committed known use to recovery.
    try { save.state = withHistory(save.state, this.read(file + '.bak').state.cheats.everEnabled); }
    catch (error) { if (error.code === 'UNSUPPORTED_SAVE') throw error; }
    return { id, ...save, recovered: false };
  }
  list() {
    const ids = new Set(this.io.readdirSync(this.directory).filter(f => /^[a-f0-9-]{36}\.json(?:\.bak)?$/.test(f)).map(f => f.slice(0, 36)));
    return [...ids].map(id => {
      try { const { name, updatedAt, recovered, state } = this.load(id); return { id, name, updatedAt, recovered, everEnabled: state.cheats.everEnabled }; }
      catch (error) { return { id, name: 'Unreadable save', error: error.message }; }
    }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  atomic(file, contents, exclusive = false) {
    const temporary = file + '.tmp';
    let descriptor;
    try {
      descriptor = this.io.openSync(temporary, 'w', 0o600);
      this.io.writeFileSync(descriptor, contents, 'utf8');
      this.io.fsyncSync(descriptor);
      this.io.closeSync(descriptor);
      descriptor = undefined;
      if (exclusive) {
        try { this.io.linkSync(temporary, file); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      } else this.io.renameSync(temporary, file);
    } finally {
      if (descriptor !== undefined) this.io.closeSync(descriptor);
      if (this.io.existsSync(temporary)) this.io.unlinkSync(temporary);
    }
  }
  save(id, state, name) {
    const file = this.file(id);
    const previous = this.load(id);
    const next = { format: 'polycraft-offline', version: Math.max(previous.version, versionForState(state)), name: validName(name ?? previous.name), updatedAt: new Date().toISOString(), state: withHistory(state, previous.state.cheats.everEnabled) };
    const contents = JSON.stringify(next);
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Save exceeds 32 MB.');
    if (previous.version === 1) this.atomic(file + '.pre-v2', this.io.readFileSync(file + (previous.recovered ? '.bak' : '')), true);
    if (previous.version < 3 && next.version === 3) this.atomic(file + '.pre-v3', this.io.readFileSync(file + (previous.recovered ? '.bak' : '')), true);
    const oldCoop = previous.state.userData[COOP_KEY], newCoop = next.state.userData[COOP_KEY];
    if (next.version === 4 && (previous.version < 4 || (oldCoop && newCoop && JSON.parse(oldCoop).version === 1 && JSON.parse(newCoop).version === 2))) this.atomic(file + '.pre-v4', this.io.readFileSync(file + (previous.recovered ? '.bak' : '')), true);
    if (next.version >= 5 && (previous.version < 5 || (oldCoop && newCoop && JSON.parse(oldCoop).version < 3 && JSON.parse(newCoop).version >= 3))) this.atomic(file + '.pre-v5', this.io.readFileSync(file + (previous.recovered ? '.bak' : '')), true);
    if (next.version === 6 && (previous.version < 6 || (oldCoop && newCoop && JSON.parse(oldCoop).version < 4 && JSON.parse(newCoop).version === 4))) this.atomic(file + '.pre-v6', this.io.readFileSync(file + (previous.recovered ? '.bak' : '')), true);
    // Carry history into recovery so rolling back a checkpoint cannot erase known cheat use.
    const backupState = withHistory(previous.state, next.state.cheats.everEnabled);
    this.atomic(file + '.bak', JSON.stringify({ format: previous.format, version: next.version, name: previous.name, updatedAt: previous.updatedAt, state: backupState }));
    this.atomic(file, contents);
    return this.load(id);
  }
  create(name, state = emptyState(), minimumVersion = 2) {
    if (![2, 3, 4, 5, 6].includes(minimumVersion)) throw new Error('Unsupported save format or version.');
    const id = randomUUID();
    const save = { format: 'polycraft-offline', version: Math.max(minimumVersion, versionForState(state)), name: validName(name), updatedAt: new Date().toISOString(), state: withHistory(state) };
    const contents = JSON.stringify(save);
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Save exceeds 32 MB.');
    this.atomic(this.file(id), contents);
    return this.load(id);
  }
  rename(id, name) { return this.save(id, this.load(id).state, name); }
  remove(id) {
    const file = this.file(id);
    for (const suffix of ['', '.bak', '.pre-v2', '.pre-v3', '.pre-v4', '.pre-v5', '.pre-v6', '.tmp', '.bak.tmp', '.pre-v2.tmp', '.pre-v3.tmp', '.pre-v4.tmp', '.pre-v5.tmp', '.pre-v6.tmp']) if (this.io.existsSync(file + suffix)) this.io.unlinkSync(file + suffix);
  }
  import(file) {
    const save = this.read(file);
    const imported = this.create(save.name, save.state, Math.max(2, save.version));
    try {
      if (save.version === 1) this.atomic(this.file(imported.id) + '.pre-v2', this.io.readFileSync(file), true);
      if (Object.hasOwn(save.state.userData, COOP_KEY) && JSON.parse(save.state.userData[COOP_KEY]).version < 3) this.atomic(this.file(imported.id) + '.pre-v5', this.io.readFileSync(file), true);
      if (Object.hasOwn(save.state.userData, COOP_KEY) && JSON.parse(save.state.userData[COOP_KEY]).version < 4) this.atomic(this.file(imported.id) + '.pre-v6', this.io.readFileSync(file), true);
    } catch (error) { this.remove(imported.id); throw error; }
    return imported;
  }
  export(id, file) {
    if (path.resolve(file).startsWith(path.resolve(this.directory) + path.sep)) throw new Error('Choose a backup location outside the managed saves folder.');
    const { format, name, updatedAt, state, version: previousVersion } = this.load(id);
    const version = Math.max(2, previousVersion, versionForState(state));
    this.atomic(file, JSON.stringify({ format, version, name, updatedAt, state }, null, 2));
  }
}
module.exports = { Saves, validateState, emptyState };
