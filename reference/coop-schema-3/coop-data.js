'use strict';
(function (root) {
  const KEY = 'desktopCoop';
  const VERSION = 3;
  const UPGRADES = ['movementSpeed', 'carrySpeed', 'shotgunDamage', 'reloadSpeed', 'maxHealth', 'explosionDamage', 'carryCapacity', 'chopEffectiveness'];
  const STATS = ['playerScore', 'totalCampaignsWon', 'totalWallsBuilt', 'totalTreesChopped', 'totalRocksDestroyed', 'totalEnemiesKilled', 'totalTimePlayed', 'softCurrencyFound'];
  const PERSONAL = ['progress', 'heroUpgrades', 'gameStats', 'numberOfGamesPlayed', 'shareData'];
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
  const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
  const vector = (value, size) => Array.isArray(value) && value.length === size && Array.from(value).every(finite);
  const keys = (value, expected) => plain(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
  function requireValue(condition, message) { if (!condition) throw new Error('Invalid co-op data: ' + message); }
  function playerName(value) {
    requireValue(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80, 'use a hero name from 1 to 80 characters.');
    return value.trim();
  }
  function validateConstruction(value) {
    if (value === null) return value;
    const reference = name => name === null || (typeof name === 'string' && name.length > 0 && name.length <= 256 && !name.includes('\0'));
    requireValue(keys(value, ['archetype', 'quantity', 'instant', 'infinite', 'isNew', 'cannotCancel', 'payWhenPlacing', 'parent', 'moveFrom', 'lastPlaced']) && typeof value.archetype === 'string' && /^[a-zA-Z][\w-]{0,99}$/.test(value.archetype) && integer(value.quantity) && value.quantity > 0, 'invalid held construction.');
    requireValue(['instant', 'infinite', 'isNew', 'cannotCancel', 'payWhenPlacing'].every(key => typeof value[key] === 'boolean') && reference(value.parent) && reference(value.moveFrom) && (value.lastPlaced === null || vector(value.lastPlaced, 3)), 'invalid held construction flags or references.');
    requireValue(value.moveFrom === null || (value.quantity === 1 && !value.infinite && !value.payWhenPlacing && !value.isNew), 'invalid moved construction.');
    return value;
  }
  function newPlayer(name) {
    return { id: crypto.randomUUID(), name: playerName(name), progress: { xp: 0 }, heroUpgrades: {},
      gameStats: Object.fromEntries(STATS.map(key => [key, 0])), numberOfGamesPlayed: { count: 0 }, shareData: {},
      location: null, rotation: 0, health: null, construction: null, inventory: { weapon: null, mainWeapon: null, ammo: 0, temporaryAmmo: 0, carried: [0, 0] } };
  }
  function createCoop(name = 'Host') {
    const host = newPlayer(name);
    return { version: VERSION, host: host.id, players: [host], economy: { resource: [0, 0], softCurrency: 0, consumedSoftCurrency: 0, userItems: {}, pendingPlacements: false } };
  }
  function validateCoop(value) {
    if (plain(value) && Number.isInteger(value.version) && value.version > VERSION) {
      const error = new Error('This co-op island needs a newer PolyCraft version.'); error.code = 'UNSUPPORTED_SAVE'; throw error;
    }
    requireValue(keys(value, ['version', 'host', 'players', 'economy']) && [1, 2, VERSION].includes(value.version), 'unsupported structure or version.');
    requireValue(Array.isArray(value.players) && value.players.length >= 1 && value.players.length <= 4, 'an island has one host and at most three guest heroes.');
    const ids = new Set(), moves = new Set();
    for (const player of value.players) {
      requireValue(keys(player, ['id', 'name', ...PERSONAL, 'location', ...(value.version >= 2 ? ['rotation'] : []), ...(value.version >= 3 ? ['construction'] : []), 'health', 'inventory']) && typeof player.id === 'string' && UUID.test(player.id) && !ids.has(player.id), 'invalid or repeated hero identity.');
      ids.add(player.id); playerName(player.name);
      requireValue(plain(player.progress) && Object.keys(player.progress).every(key => ['xp', 'desktopUpgradePoints'].includes(key)) && integer(player.progress.xp) && (player.progress.desktopUpgradePoints === undefined || (Number.isSafeInteger(player.progress.desktopUpgradePoints) && Math.abs(player.progress.desktopUpgradePoints) <= 2147483647)), 'invalid hero progression.');
      requireValue(plain(player.heroUpgrades) && Object.entries(player.heroUpgrades).every(([key, level]) => [...UPGRADES, 'total'].includes(key) && integer(level) && level <= (key === 'total' ? 40 : 5)), 'invalid totem upgrades.');
      const total = UPGRADES.reduce((sum, key) => sum + (player.heroUpgrades[key] || 0), 0);
      requireValue((player.heroUpgrades.total || 0) === total, 'totem total differs from purchased upgrades.');
      requireValue(keys(player.gameStats, STATS) && Object.entries(player.gameStats).every(([key, score]) => key === 'totalTimePlayed' ? finite(score) && score >= 0 : integer(score)), 'invalid hero statistics.');
      requireValue(keys(player.numberOfGamesPlayed, ['count']) && integer(player.numberOfGamesPlayed.count), 'invalid play count.');
      requireValue(plain(player.shareData) && Object.entries(player.shareData).every(([key, time]) => ['twitter', 'facebook'].includes(key) && typeof time === 'number' && Number.isFinite(time) && time >= 0 && time <= Number.MAX_SAFE_INTEGER), 'invalid share history.');
      requireValue(player.location === null || vector(player.location, 3), 'invalid hero position.');
      if (value.version >= 2) requireValue(finite(player.rotation), 'invalid hero rotation.');
      requireValue(player.health === null || (keys(player.health, ['current', 'maximum']) && finite(player.health.current) && finite(player.health.maximum) && player.health.current >= 0 && player.health.maximum > 0 && player.health.current <= player.health.maximum), 'invalid hero health.');
      if (value.version >= 3) {
        const held = validateConstruction(player.construction);
        requireValue(!held || player.location !== null, 'held construction needs a saved hero location.');
        if (held?.moveFrom) { requireValue(!moves.has(held.moveFrom), 'two heroes cannot move the same building.'); moves.add(held.moveFrom); }
      }
      const inventory = player.inventory;
      const weapon = name => name === null || (typeof name === 'string' && /^[a-zA-Z][\w-]{0,99}$/.test(name));
      requireValue(keys(inventory, ['weapon', 'ammo', 'carried', ...(value.version >= 2 ? ['mainWeapon', 'temporaryAmmo'] : [])]) && weapon(inventory.weapon) && integer(inventory.ammo) && Array.isArray(inventory.carried) && inventory.carried.length === 2 && Array.from(inventory.carried).every(integer), 'invalid hero inventory.');
      if (value.version >= 2) requireValue(weapon(inventory.mainWeapon) && integer(inventory.temporaryAmmo), 'invalid temporary weapon state.');
    }
    requireValue(ids.has(value.host) && value.players[0].id === value.host, 'the first saved hero must be the host.');
    const economy = value.economy;
    requireValue(keys(economy, ['resource', 'softCurrency', 'consumedSoftCurrency', 'userItems', ...(value.version >= 3 ? ['pendingPlacements'] : [])]) && Array.isArray(economy.resource) && economy.resource.length === 2 && Array.from(economy.resource).every(integer) && integer(economy.softCurrency) && integer(economy.consumedSoftCurrency) && plain(economy.userItems), 'invalid shared economy.');
    if (value.version >= 3) requireValue(typeof economy.pendingPlacements === 'boolean', 'invalid pending building queue.');
    requireValue(Object.entries(economy.userItems).every(([key, item]) => ['amber', 'amber-crown', 'amber-well', 'amber-well-owned', 'mana-pack-standard'].includes(key) && keys(item, ['amount']) && integer(item.amount)), 'invalid co-op premium inventory.');
    return value;
  }
  class CoopData {
    constructor(state) {
      this.state = state;
      this.data = Object.hasOwn(state.userData, KEY) ? validateCoop(JSON.parse(state.userData[KEY])) : createCoop();
      if (this.data.version === 1) {
        for (const player of this.data.players) {
          player.rotation = 0;
          player.inventory.mainWeapon = player.inventory.weapon;
          player.inventory.temporaryAmmo = 0;
        }
        this.data.version = 2;
      }
      if (this.data.version === 2) {
        for (const player of this.data.players) player.construction = null;
        this.data.economy.pendingPlacements = false;
        this.data.version = VERSION;
      }
    }
    persist() { this.state.userData[KEY] = JSON.stringify(validateCoop(this.data)); }
    addPlayer(name) {
      if (this.data.players.length >= 4) throw new Error('This island already has four saved co-op heroes.');
      const player = newPlayer(name); this.data.players.push(player); this.persist(); return player;
    }
    player(id) {
      const player = this.data.players.find(player => player.id === id);
      if (!player) throw new Error('This hero does not belong to the host island.');
      return player;
    }
    createPlayerData(solo, id) {
      const player = this.player(id), economy = this.data.economy;
      const model = Object.create(Object.getPrototypeOf(solo));
      model.init(solo.globals);
      model.coopPlayerId = id;
      for (const key of PERSONAL) model[key] = player[key];
      for (const key of ['resource', 'softCurrency', 'consumedSoftCurrency']) Object.defineProperty(model, key, { configurable: true, enumerable: true, get: () => economy[key], set: value => { economy[key] = value; } });
      model.resourceCap = solo.resourceCap;
      for (const key of ['scriptFlags', 'taskFlags', 'settings']) model[key] = solo[key];
      model.hasLoadedGameStats = true;
      model.saveData = (key, value) => {
        if (PERSONAL.includes(key)) player[key] = value;
        else if (['resource', 'softCurrency', 'consumedSoftCurrency'].includes(key)) economy[key] = value;
        else if (['scriptFlags', 'taskFlags', 'settings'].includes(key)) { solo.saveData(key, value); return; }
        else throw new Error('Unsupported co-op player data: ' + key);
        this.persist();
      };
      model.loadData = (key, success) => {
        if (![...PERSONAL, 'resource', 'softCurrency', 'consumedSoftCurrency', 'scriptFlags', 'taskFlags', 'settings'].includes(key)) throw new Error('Unsupported co-op player data: ' + key);
        success?.(structuredClone(model[key]));
      };
      return model;
    }
  }
  const api = { KEY, VERSION, createCoop, validateCoop, validateConstruction, CoopData };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftCoopData = api;
})(globalThis);
