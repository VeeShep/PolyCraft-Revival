'use strict';
const assert = require('node:assert/strict');

module.exports = async function saveInFlight({ host, hero }) {
  await host.evaluate(id => {
    const world = window.hostWorld, actor = world.players.active.get(id).hero, carrier = actor.getEC('ECResourceCarrier');
    const mark = window.nativeFlightSave = { clicked: null, boundary: null, saving: false, saved: false, cancelled: false };
    const sample = () => ({ tick: world.game.gameClock.getFrameIndex(), flying: carrier.hasAnyFlyingResource(), count: carrier.numFlyingResourceBlocks, entries: carrier.flyingTweens.length });
    const button = document.getElementById('save-now'), status = document.getElementById('status');
    const clicked = () => { mark.clicked = sample(); };
    button.addEventListener('click', clicked, true);
    const observer = new MutationObserver(() => {
      if (!mark.clicked) return;
      if (status.textContent === 'Saving…') mark.saving = true;
      if (mark.saving && status.textContent.startsWith('Saved locally at ')) mark.saved = true;
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    const own = Object.hasOwn(world.players, 'captureHero'), original = world.players.captureHero;
    world.players.captureHero = function (entity) {
      const before = entity === actor && mark.clicked && !mark.boundary ? sample() : null;
      const result = original.call(this, entity);
      if (before) mark.boundary = { before, after: sample() };
      return result;
    };
    window.cancelNativeFlightSave = () => {
      mark.cancelled = true; observer.disconnect(); button.removeEventListener('click', clicked, true);
      if (own) world.players.captureHero = original; else delete world.players.captureHero;
      delete window.cancelNativeFlightSave;
    };
  }, hero);
  try {
    await host.waitForFunction(id => window.nativeFlightSave.cancelled || window.hostWorld.players.active.get(id).hero.getEC('ECResourceCarrier').hasAnyFlyingResource(), hero, { timeout: 180000 });
    assert.equal(await host.evaluate(() => window.nativeFlightSave.cancelled), false, 'Flight observation was cancelled.');
    await host.locator('#save-now').click();
    await host.waitForFunction(() => window.nativeFlightSave.saved || document.getElementById('error-dialog').open, null, { timeout: 15000 });
    const result = await host.evaluate(() => window.nativeFlightSave);
    assert.equal(result.saved, true, 'The actual Save Now action must finish successfully.');
    assert.equal(result.clicked?.flying, true, 'Save Now must be clicked while the transfer is active.');
    assert.equal(result.boundary?.before.flying, true, 'The coherent save boundary must still contain the active transfer.');
    assert.ok(result.boundary.before.count > 0 && result.boundary.before.entries > 0);
    assert.equal(result.boundary.after.flying, false);
    assert.equal(result.boundary.after.count, 0); assert.equal(result.boundary.after.entries, 0);
    console.log('PASS: actual Save Now settles the native active transfer at its coherent capture boundary:', JSON.stringify(result));
    return result;
  } finally { await host.evaluate(() => window.cancelNativeFlightSave?.()).catch(() => {}); }
};
