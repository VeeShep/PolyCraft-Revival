'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CoopPlayers } = require('../desktop/coop-players.js');
const update = require('./runtime-ast.cjs').scriptCommand('WaitUntilDistanceBetweenHeroAndFamilyNameLessThan');

function fixture(coop, guest = {}) {
  const actor = ({ position = [10, 0, 0], health = 50, destroyed = false, phase = 0, waiting = false }) => ({
    getv3Location: () => position, shouldBeDestroyed: () => destroyed,
    getEC: name => name === 'ECHealth' ? { getHealth: () => health } : name === 'ECPlayerLife' ? { state: phase, states: { NORMAL: 0 }, respawnTime: waiting ? 10 : undefined } : null
  });
  const host = actor({}), player = actor(guest), marker = { getv3Location: () => [0, 0, 0] };
  const globals = { mathDevice: { v3DistanceSq: (a, b) => a.reduce((sum, n, i) => sum + (n - b[i]) ** 2, 0) } };
  const game = globals.gameManager = { globals, getHero: () => host, getNearestGameEntityByFamilyName: name => name === 'bridge' ? marker : null };
  if (coop) game.desktopPlayers = Object.assign(Object.create(CoopPlayers.prototype), { game, active: new Map([['host', { hero: host }], ['guest', { hero: player }]]) });
  return { game, command: { state: { familyName: 'bridge', distance: 2 }, scope: { globals } }, run() { return update.call(this.command); } };
}
test('the actual native family-proximity command accepts a live guest while the host stays behind', () => {
  const f = fixture(true, { position: [1, 0, 0] });
  assert.equal(f.run(), true);
  delete f.game.desktopPlayers;
  assert.equal(f.run(), false, 'Ending co-op restores original host-only proximity semantics');
});
test('co-op scripted proximity rejects destroyed, dead, dying, waiting and respawning heroes', () => {
  for (const invalid of [{ destroyed: true }, { health: 0 }, { phase: 1 }, { phase: 2 }, { waiting: true }]) {
    assert.equal(fixture(true, { position: [1, 0, 0], ...invalid }).run(), false);
  }
});
test('solo and co-op preserve strict native three-dimensional distance and missing-marker behavior', () => {
  for (const coop of [false, true]) {
    const f = fixture(coop, { position: [10, 0, 0] });
    for (const [position, expected] of [[[1.99, 0, 0], true], [[2, 0, 0], false], [[0, 2, 0], false], [[0, 1.99, 0], true], [[3, 0, 0], false]]) {
      f.game.getHero().getv3Location = () => position;
      assert.equal(f.run(), expected);
    }
    f.command.state.familyName = 'missing'; assert.equal(f.run(), false);
  }
});
