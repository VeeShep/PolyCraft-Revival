'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');

module.exports = async function xpBatch({ host, guest, hero, hostFile }) {
  // This is staged native reward delivery, not ordinary XP acquisition or guest input.
  const baseline = await host.evaluate(id => window.hostWorld.atBoundary(() => {
    const world = window.hostWorld, players = world.players, game = world.game, entry = players.active.get(id), actor = entry.hero;
    const xp = entry.model.getXP(), level = actor.getEC('ECPlayerData').getLevel(), firstXP = window.polycraft.controls.xpTable[level + 1] - xp;
    if (!Number.isSafeInteger(firstXP) || firstXP <= 0) throw new Error('The temporary hero needs another original rank available.');
    const mark = window.nativeXPBatch = { start: { tick: game.gameClock.getFrameIndex(), xp, level, actor: actor.getName(), otherXP: [...players.active].filter(([key]) => key !== id).map(([key, row]) => [key, row.model.getXP()]) }, grants: [], destruction: null };
    const manager = game.actionManager, grant = manager.actionFunctionMap.GivePickup, own = Object.hasOwn(players, 'destroy'), destroy = players.destroy;
    const drops = ['a_r_xp500', 'a_r_xp20'].map((type, index) => game.getEntityFactory().createActiveEntityInstance('Temporary XP batch ' + index, type, actor.getv3Location()));
    drops[0].getEC('ECPickup').setXP(firstXP);
    mark.ids = drops.map(node => node.getName()); mark.amounts = drops.map(node => node.getEC('ECPickup').xp);
    manager.actionFunctionMap.GivePickup = function (args) {
      if (!mark.ids.includes(args.pickup?.getName())) return grant.call(this, args);
      const before = entry.model.getXP(), result = grant.call(this, args);
      mark.grants.push({ id: args.pickup.getName(), before, after: entry.model.getXP(), actorAlive: !actor.shouldBeDestroyed(), simulating: world.simulating });
      return result;
    };
    players.destroy = function (entity) {
      if (entity === actor) mark.destruction = { tick: game.gameClock.getFrameIndex(), simulating: world.simulating, grants: mark.grants.length, xp: entry.model.getXP() };
      return destroy.call(this, entity);
    };
    window.restoreNativeXPBatch = () => { manager.actionFunctionMap.GivePickup = grant; if (own) players.destroy = destroy; else delete players.destroy; delete window.restoreNativeXPBatch; };
    for (const node of drops) {
      const pickup = node.getEC('ECPickup'); pickup.storeCollector(actor); pickup.givePickupIfCollector(); node.setToBeDestroyed();
    }
    return { ...mark.start, ids: mark.ids, amounts: mark.amounts };
  }), hero);
  try {
    await host.waitForFunction(() => window.nativeXPBatch.destruction, null, { timeout: 10000 });
    const result = await host.evaluate(id => {
      const w = window.hostWorld, entry = w.players.active.get(id), actor = entry.hero;
      return { mark: window.nativeXPBatch, actor: actor.getName(), xp: entry.model.getXP(), level: actor.getEC('ECPlayerData').getLevel(),
        otherXP: [...w.players.active].filter(([key]) => key !== id).map(([key, row]) => [key, row.model.getXP()]) };
    }, hero);
    const expected = baseline.xp + baseline.amounts.reduce((sum, amount) => sum + amount, 0);
    assert.equal(result.mark.grants.length, 2); assert.deepEqual(result.mark.grants.map(row => row.id), baseline.ids);
    let xp = baseline.xp;
    for (const [index, row] of result.mark.grants.entries()) {
      assert.equal(row.before, xp); xp += baseline.amounts[index]; assert.equal(row.after, xp);
      assert.equal(row.actorAlive, true); assert.equal(row.simulating, true);
    }
    assert.equal(result.mark.destruction.grants, 2); assert.equal(result.mark.destruction.simulating, false);
    assert.equal(result.mark.destruction.xp, expected); assert.equal(result.xp, expected);
    assert.notEqual(result.actor, baseline.actor); assert.ok(result.level > baseline.level); assert.deepEqual(result.otherXP, baseline.otherXP);
    await guest.waitForFunction(({ id, actor, xp }) => window.guestWorld.identity.playerId === id && window.guestWorld.identity.entity === actor && window.guestWorld.hud.state?.xp === xp,
      { id: hero, actor: result.actor, xp: expected }, { timeout: 10000 });
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const party = JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop);
    assert.equal(party.players.find(row => row.id === hero).progress.xp, expected);
    console.log('PASS: staged original XP-only pickup batch finishes both grants before one hero replacement, reaches the assigned guest HUD and saves:', JSON.stringify(result));
  } finally { await host.evaluate(() => window.restoreNativeXPBatch?.()).catch(() => {}); }
};
