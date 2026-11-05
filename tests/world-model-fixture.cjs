'use strict';
module.exports = `(function () {
  function a() {} function b() {} function c() { this.time = 0; }
  a.prototype = {
    saveLevel: function () { var state = d.Serialize.serializePlayerSave(this); d.SaveLoad.saveLevelToUserData('AdventureIncGameState', state, this.store); },
    getGameSpaceList: function () { return this.spaces; }, serializeGameSpaces: function () {}, deserializeGameSpaces: function () {}
  };
  a.create = function () { var instance = new a(); instance.gameClock = c.create(); return instance; };
  b.prototype = {
    getEntityList: function () { return this.entities; }, getBlockList: function () { return []; },
    getExtents: function () { return [0, 0, 0, 10, 10, 10]; }, addEntities: function (list) { this.entities.push(...list); }
  };
  b.create = function (name) { var instance = new b(); instance.name = name; instance.entities = []; return instance; };
  c.prototype = {
    tick: function () { if (!this.stopped) this.time += 1; }, pause: function () { this.stopped = true; }, resume: function () { this.stopped = false; },
    getCurrentTime: function () { return this.time; }, getTimeStep: function () { return 1; }
  };
  c.create = function () { return new c(); };
  var d = {
    createEmptyLevel: function () { return { gameSpaceList: [] }; },
    Parse: { parseLevelData: function (data) { return data; }, parseGameSpaceData: function (data) { return data; }, deserializeGameSpaceList: function (list) { return list; } },
    Serialize: {
      serializePlayerSave: function (game) { return d.Serialize.serializeLevel(game); },
      serializeLevel: function (game) { return { gameSpaceList: game.getGameSpaceList().map(space => d.Serialize.serializeGameSpace(space)) }; },
      serializeGameSpace: function (space) { return { entityList: space.getEntityList().map(entity => d.Serialize.serializeEntity(entity)) }; },
      serializeEntity: function (entity) { return { name: entity.name, v3Location: entity.location }; }
    },
    SaveLoad: {
      saveLevelToUserData: function (key, data, store) { store[key] = JSON.stringify(data, d.SaveLoad.typedArrayReplacer); },
      loadLevelFromUserData: function (key, store) { return JSON.parse(store[key]); },
      typedArrayReplacer: function (key, value) { return value instanceof Float32Array ? Array.from(value) : value; }
    }
  };
  function start() { var game = a.create(); this.protoGame = this.globals.gameManager = game; return game; }
  function shadow(d) { return d; }
  var app = { globals: {} }, game = start.call(app), space = b.create('GameSpace');
  space.addEntities([{ name: 'hero', location: new Float32Array([1, 2, 3]) }]); game.spaces = [space]; game.store = {};
  game.gameClock.tick(); game.gameClock.pause(); game.gameClock.tick(); game.gameClock.resume(); game.gameClock.tick(); game.saveLevel();
  globalThis.result = { saved: game.store, loaded: d.SaveLoad.loadLevelFromUserData('AdventureIncGameState', game.store), time: game.gameClock.getCurrentTime(), shadow: shadow('unchanged'), asset: 'assets/d.dds', publicKey: { d: 'preserved' }, manager: app.globals.gameManager === game };
})();`;
