'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

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
    if (!['enabled', 'invincible', 'instantBuild'].includes(key) || typeof value !== 'boolean') throw new Error('Invalid cheat settings.');
  }
  return state;
}
function validate(save) {
  if (!plain(save) || save.format !== 'polycraft-offline' || save.version !== 1) throw new Error('Unsupported save format or version.');
  validName(save.name);
  if (typeof save.updatedAt !== 'string' || !Number.isFinite(Date.parse(save.updatedAt))) throw new Error('Invalid save date.');
  validateState(save.state);
  return save;
}
function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Use a save name between 1 and 80 characters.');
  return name.trim();
}
function emptyState() {
  return { userData: {}, userItems: {}, badges: {}, cheats: { enabled: false, invincible: false, instantBuild: false } };
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
    try { return { id, ...this.read(file), recovered: false }; }
    catch (primaryError) {
      try { return { id, ...this.read(file + '.bak'), recovered: true }; }
      catch { throw new Error('Unable to load this slot or its recovery backup: ' + primaryError.message); }
    }
  }
  list() {
    const ids = new Set(this.io.readdirSync(this.directory).filter(f => /^[a-f0-9-]{36}\.json(?:\.bak)?$/.test(f)).map(f => f.slice(0, 36)));
    return [...ids].map(id => {
      try { const { name, updatedAt, recovered } = this.load(id); return { id, name, updatedAt, recovered }; }
      catch (error) { return { id, name: 'Unreadable save', error: error.message }; }
    }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  atomic(file, contents) {
    const temporary = file + '.tmp';
    let descriptor;
    try {
      descriptor = this.io.openSync(temporary, 'w', 0o600);
      this.io.writeFileSync(descriptor, contents, 'utf8');
      this.io.fsyncSync(descriptor);
      this.io.closeSync(descriptor);
      descriptor = undefined;
      this.io.renameSync(temporary, file);
    } finally {
      if (descriptor !== undefined) this.io.closeSync(descriptor);
      if (this.io.existsSync(temporary)) this.io.unlinkSync(temporary);
    }
  }
  save(id, state, name) {
    const file = this.file(id);
    const previous = this.load(id);
    const next = { format: 'polycraft-offline', version: 1, name: validName(name ?? previous.name), updatedAt: new Date().toISOString(), state: validateState(state) };
    const contents = JSON.stringify(next);
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Save exceeds 32 MB.');
    // Keep the last valid checkpoint even when the primary file needed recovery.
    this.atomic(file + '.bak', JSON.stringify({ format: previous.format, version: previous.version, name: previous.name, updatedAt: previous.updatedAt, state: previous.state }));
    this.atomic(file, contents);
    return this.load(id);
  }
  create(name, state = emptyState()) {
    const id = randomUUID();
    const save = { format: 'polycraft-offline', version: 1, name: validName(name), updatedAt: new Date().toISOString(), state: validateState(state) };
    const contents = JSON.stringify(save);
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Save exceeds 32 MB.');
    this.atomic(this.file(id), contents);
    return this.load(id);
  }
  rename(id, name) { return this.save(id, this.load(id).state, name); }
  remove(id) {
    const file = this.file(id);
    for (const suffix of ['', '.bak', '.tmp', '.bak.tmp']) if (this.io.existsSync(file + suffix)) this.io.unlinkSync(file + suffix);
  }
  import(file) { const save = this.read(file); return this.create(save.name, save.state); }
  export(id, file) {
    if (path.resolve(file).startsWith(path.resolve(this.directory) + path.sep)) throw new Error('Choose a backup location outside the managed saves folder.');
    const { format, version, name, updatedAt, state } = this.load(id);
    this.atomic(file, JSON.stringify({ format, version, name, updatedAt, state }, null, 2));
  }
}
module.exports = { Saves, validateState, emptyState };
