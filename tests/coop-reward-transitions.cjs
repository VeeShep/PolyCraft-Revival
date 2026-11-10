'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');

async function stageSolo(host) {
  await host.waitForFunction(() => {
    const game = window.polycraft.controls.manager();
    return game.getPlayerData().getXP() >= game.getTaskManager().taskArchetypes.buildStonelingHut.xpReward && !window.PolycraftCoopPlayers.CoopPlayers.hasPendingRewards(game, game.getHero());
  }, null, { timeout: 10000 });
  await host.evaluate(() => {
    const c = window.polycraft.controls, game = c.manager(), actor = game.getHero(), model = game.playerData;
    const first = c.xpTable[actor.getEC('ECPlayerData').getLevel() + 1] - model.getXP();
    if (!(first > 0)) throw new Error('The disposable solo hero needs another rank.');
    const drops = ['a_r_xp500', 'a_r_xp20'].map(type => game.getEntityFactory().createActiveEntityInstance('Temporary solo transition', type, actor.getv3Location()));
    drops[0].getEC('ECPickup').setXP(first);
    const mark = window.soloRewardTransition = { before: model.getXP(), expected: model.getXP() + first + 20, grants: [] }, grant = game.actionManager.actionFunctionMap.GivePickup;
    game.actionManager.actionFunctionMap.GivePickup = function (args) {
      const result = grant.call(this, args);
      if (drops.includes(args.pickup)) mark.grants.push({ xp: model.getXP(), alive: !actor.shouldBeDestroyed() });
      return result;
    };
    window.restoreSoloRewardObserver = () => { game.actionManager.actionFunctionMap.GivePickup = grant; delete window.restoreSoloRewardObserver; };
    for (const [index, node] of drops.entries()) {
      const pickup = node.getEC('ECPickup'); pickup.storeCollector(actor);
      if (index === 0) { pickup.givePickupIfCollector(); node.setToBeDestroyed(); } else pickup.beginFly();
    }
  });
}
async function checkSolo(host) {
  try {
    const result = await host.evaluate(() => ({ mark: window.soloRewardTransition, capturedXP: window.hostWorld.players.solo.model.getXP() }));
    assert.equal(result.capturedXP, result.mark.expected); assert.equal(result.mark.grants.length, 2); assert.ok(result.mark.grants.every(row => row.alive));
    console.log('PASS: initial hosting waits for both original solo XP grants before rebinding:', JSON.stringify(result));
  } finally { await host.evaluate(() => window.restoreSoloRewardObserver?.()); }
}
async function stageReward(host, id, amber) {
  return host.evaluate(({ id, amber }) => window.hostWorld.atBoundary(() => {
    const w = window.hostWorld; id ||= w.players.registry.data.host;
    const actor = w.players.active.get(id).hero, data = actor.getEC('ECPlayerData');
    const types = amber ? ['a_r_xp20', 'a_r_amber'] : ['a_r_xp20'];
    const before = { id, xp: data.getXP(), amber: data.getSoftCurrency(), actor: actor.getName(), tick: w.game.gameClock.getFrameIndex() };
    let currency = 0;
    for (const type of types) {
      const node = w.game.getEntityFactory().createActiveEntityInstance('Temporary transition reward', type, actor.getv3Location()), pickup = node.getEC('ECPickup');
      currency += pickup.archetype.softCurrency || 0; pickup.storeCollector(actor); pickup.beginFly();
    }
    return { ...before, expectedXP: before.xp + 20, expectedAmber: before.amber + currency * (w.game.amberCrown ? 2 : 1), pending: window.PolycraftCoopPlayers.CoopPlayers.hasPendingRewards(w.game, actor) };
  }), { id, amber });
}
async function guestDeparture({ host, guest, hero, reconnect, hostFile }) {
  await host.evaluate(id => {
    const w = window.hostWorld, own = Object.hasOwn(w, 'atRewardBoundary'), original = w.atRewardBoundary;
    window.guestRewardRelease = null;
    w.atRewardBoundary = function (read, selected) {
      if (selected === id) window.guestRewardRelease = { pending: this.pendingRewards(id), actor: this.players.active.get(id)?.hero.getName() };
      return original.call(this, read, selected);
    };
    window.restoreGuestRewardRelease = () => { if (own) w.atRewardBoundary = original; else delete w.atRewardBoundary; delete window.restoreGuestRewardRelease; };
  }, hero);
  try {
    const before = await stageReward(host, hero, false); assert.equal(before.pending, true);
    await guest.evaluate(() => window.connection.close('Temporary pending XP departure.'));
    await guest.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld, null, { timeout: 15000 });
    await host.waitForFunction(id => !window.hostWorld.players.active.has(id) && !window.hostWorld.guestSlots.has(id), hero, { timeout: 15000 });
    const saved = await host.evaluate(id => ({ mark: window.guestRewardRelease, xp: window.hostWorld.players.registry.player(id).progress.xp }), hero);
    assert.equal(saved.mark.pending, true, 'The release must encounter an actual pending non-resource reward.'); assert.equal(saved.xp, before.expectedXP);
    await reconnect();
    await guest.waitForFunction(xp => window.guestWorld.hud.state?.xp === xp, before.expectedXP, { timeout: 10000 });
    await host.evaluate(() => window.polycraft.checkpoint(true));
    assert.equal(JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop).players.find(row => row.id === hero).progress.xp, before.expectedXP);
    console.log('PASS: real guest departure waits for pending native XP and rejoins its exact saved progress:', JSON.stringify({ before, saved }));
  } finally { await host.evaluate(() => window.restoreGuestRewardRelease?.()); }
}
async function holdFinalSave(host) {
  await host.evaluate(() => {
    const c = window.polycraft.controls, own = Object.hasOwn(c, 'checkpoint'), original = c.checkpoint;
    let cancelled = false;
    window.finalCloseResult = null; window.failedFinalCapture = null; window.rejectFinalCapture = null; window.resolveFinalCapture = null;
    c.checkpoint = async function (bridge) {
      if (!window.hostWorld.finalUpdate) return original.call(this, bridge);
      const state = await original.call(this, bridge);
      if (cancelled) throw new Error('Temporary final-save observer cancelled.');
      window.failedFinalCapture = state;
      await new Promise((resolve, reject) => { window.resolveFinalCapture = resolve; window.rejectFinalCapture = () => reject(new Error('Temporary final-save acknowledgement failure.')); });
      return state;
    };
    window.restoreFinalCheckpoint = () => { cancelled = true; window.rejectFinalCapture?.(); if (own) c.checkpoint = original; else delete c.checkpoint; delete window.restoreFinalCheckpoint; };
    window.hostWorld.close().then(() => { window.finalCloseResult = 'success'; }, error => { window.finalCloseResult = error.message; });
  });
  await host.waitForFunction(() => window.rejectFinalCapture && window.hostWorld.finalUpdate, null, { timeout: 15000 });
}
async function departWhileFrozen(host, guest, hero) {
  const frozen = await host.evaluate(id => ({ tick: window.hostWorld.game.gameClock.getFrameIndex(), record: JSON.parse(window.failedFinalCapture.userData.desktopCoop).players.find(row => row.id === id) }), hero);
  assert.equal(frozen.record.id, hero);
  await guest.evaluate(() => window.connection.close('Temporary guest departure during final save.'));
  await guest.waitForFunction(() => window.connection.closed && !window.polycraft.controls.guestWorld, null, { timeout: 15000 });
  await host.waitForFunction(id => !window.hostWorld.players.active.has(id) && !window.hostWorld.guestSlots.has(id) && ![...window.hostWorld.peerPlayers.values()].some(row => row.id === id), hero, { timeout: 10000 });
  const after = await host.evaluate(id => ({ tick: window.hostWorld.game.gameClock.getFrameIndex(), frozen: Boolean(window.hostWorld.finalUpdate), record: window.hostWorld.players.registry.player(id) }), hero);
  assert.equal(after.frozen, true); assert.equal(after.tick, frozen.tick); assert.deepEqual(after.record, frozen.record);
  console.log('PASS: actual guest departure during held final acknowledgement preserves its complete frozen hero record:', JSON.stringify({ tick: after.tick, hero, xp: after.record.progress.xp }));
}
async function finalSaveRecovery({ host, guests, focusGuest, hostFile, departure = false, hero, reconnect }) {
  await focusGuest(0);
  const before = await stageReward(host, null, true); assert.equal(before.pending, true);
  try {
    await holdFinalSave(host);
    const diskBefore = fs.readFileSync(hostFile);
    const frozen = await host.evaluate(id => ({ tick: window.hostWorld.game.gameClock.getFrameIndex(), actor: window.hostWorld.players.active.get(id).hero.getName(), party: JSON.parse(window.failedFinalCapture.userData.desktopCoop) }), before.id);
    assert.equal(frozen.party.players.find(row => row.id === before.id).progress.xp, before.expectedXP); assert.equal(frozen.party.economy.softCurrency, before.expectedAmber);
    await host.waitForTimeout(1250);
    assert.equal(await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex()), frozen.tick);
    if (departure) await departWhileFrozen(host, guests[0], hero);
    await host.evaluate(() => window.rejectFinalCapture());
    await host.waitForFunction(() => window.finalCloseResult && !window.hostWorld.closing && !window.hostWorld.finalUpdate, null, { timeout: 10000 });
    const recovered = await host.evaluate(id => ({ error: window.finalCloseResult, actor: window.hostWorld.players.active.get(id).hero.getName(), streams: window.hostWorld.streams.size, xp: window.hostWorld.players.active.get(id).model.getXP() }), before.id);
    assert.match(recovered.error, /Temporary final-save acknowledgement failure/); assert.equal(recovered.actor, frozen.actor); assert.equal(recovered.xp, before.expectedXP); assert.equal(recovered.streams, guests.length - Number(departure));
    assert.deepEqual(fs.readFileSync(hostFile), diskBefore, 'Rejected final acknowledgement must not overwrite the existing disk checkpoint.');
    for (const [index, guest] of guests.entries()) {
      if (departure && index === 0) continue;
      await focusGuest(index);
      await guest.waitForFunction(({ tick, amber }) => window.guestWorld.scene.tick > tick && !window.connection.closed && window.guestWorld.hud.state?.amber === amber && !window.guestWorld.lifeRequest,
        { tick: frozen.tick, amber: before.expectedAmber }, { timeout: 15000 });
    }
    if (departure) {
      await host.waitForFunction(() => window.workerConnectionErrors.length > 0, null, { timeout: 10000 });
      const diagnostics = await host.evaluate(() => window.workerConnectionErrors.splice(0));
      assert.deepEqual(diagnostics, ['Temporary final-save acknowledgement failure.'], 'Only the deliberately rejected shared save may be reported by departure.');
      await reconnect();
      await guests[0].waitForFunction(xp => window.guestWorld.hud.state?.xp === xp, frozen.party.players.find(row => row.id === hero).progress.xp, { timeout: 10000 });
      assert.equal(await host.evaluate(() => window.hostWorld.players.active.size), 4);
      console.log('PASS: rejected shared final save reports exactly its injected error; other guests recover and the departed hero rejoins.');
    }
    await focusGuest(0);
    console.log('PASS: native final save waits for XP/Amber, freezes through acknowledgement, and failure preserves actors/disk and resumes every guest stream:', JSON.stringify({ before, tick: frozen.tick, recovered }));
  } finally {
    await host.evaluate(() => { window.rejectFinalCapture?.(); window.restoreFinalCheckpoint?.(); });
  }
  await host.evaluate(() => window.polycraft.checkpoint(true));
  const finalReward = await stageReward(host, null, true);
  if (departure) {
    try {
      await holdFinalSave(host);
      const previousDisk = fs.readFileSync(hostFile);
      const captured = await host.evaluate(() => JSON.parse(window.failedFinalCapture.userData.desktopCoop));
      await departWhileFrozen(host, guests[0], hero);
      assert.deepEqual(fs.readFileSync(hostFile), previousDisk);
      await host.evaluate(() => window.resolveFinalCapture());
      await host.waitForFunction(() => window.finalCloseResult === 'success' && window.hostWorld.closed && !window.hostWorld.closing, null, { timeout: 15000 });
      assert.deepEqual(JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop), captured);
      console.log('PASS: successful held final save retains the departing hero and every other party record exactly on disk.');
    } finally { await host.evaluate(() => { window.rejectFinalCapture?.(); window.restoreFinalCheckpoint?.(); }); }
  }
  return finalReward;
}
function checkFinalDisk(hostFile, expected) {
  const state = JSON.parse(fs.readFileSync(hostFile)).state, party = JSON.parse(state.userData.desktopCoop);
  assert.equal(party.players.find(row => row.id === expected.id).progress.xp, expected.expectedXP); assert.equal(party.economy.softCurrency, expected.expectedAmber);
  console.log('PASS: successful host shutdown captures pending XP/Amber before durable save:', JSON.stringify(expected));
}
module.exports = { stageSolo, checkSolo, guestDeparture, finalSaveRecovery, checkFinalDisk };
