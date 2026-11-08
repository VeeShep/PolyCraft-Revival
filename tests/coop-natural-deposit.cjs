'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalDeposit({ host, guest, guests, focusGuest, focus, hero, hostFile, resource = 0 }) {
  assert.ok(resource === 0 || resource === 1);
  const label = resource === 0 ? 'wood' : 'stone';
  await host.waitForFunction(hero => !window.hostWorld.players.active.get(hero).hero.getEC('ECResourceCarrier').hasAnyInboundResource(), hero);
  const destination = await host.evaluate(({ hero, resource }) => {
    const w = window.hostWorld, game = w.game, actor = w.players.active.get(hero).hero;
    const hq = game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false).find(entity => !entity.getEC('ECScaffold'));
    const path = game.getNavManager().getEntityToEntityPath(actor, hq, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
    if (!path) throw new Error('No original route back toward the HQ.');
    window.naturalDepositEvents = []; window.naturalDepositPickups = [];
    const carrier = actor.getEC('ECResourceCarrier'), adjust = carrier.adjustResource;
    carrier.adjustResource = function (type, amount) {
      const before = this.getResource(type), result = adjust.call(this, type, amount), delta = this.getResource(type) - before;
      if (type === resource && delta > 0) window.naturalDepositPickups.push(delta);
      return result;
    };
    const observe = event => { if (event.type === resource) window.naturalDepositEvents.push({ actor: event.entity.getName(), amount: event.amount }); };
    game.eventManager.subscribe('ResourceDeposited', observe);
    window.restoreNaturalDepositObserver = () => { game.eventManager.unsubscribe('ResourceDeposited', observe); carrier.adjustResource = adjust; };
    return { actor: actor.getName(), carried: actor.getEC('ECResourceCarrier').getResource(resource), bank: actor.getEC('ECPlayerData').getResource(resource), route: path.getWaypointList().map(point => Array.from(point)) };
  }, { hero, resource });
  assert.ok(destination.carried >= 10);
  console.log('Natural return toward HQ with gathered ' + label + ':', destination);
  try {
    await focus(); let waypoint = Math.min(1, destination.route.length - 1), emptied = false;
    for (let step = 0; step < 350; step++) {
      emptied = await host.evaluate(({ hero, resource }) => window.hostWorld.players.active.get(hero).hero.getEC('ECResourceCarrier').getResource(resource) === 0, { hero, resource });
      if (emptied) break;
      const next = await guest.evaluate(location => {
        const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix;
        const dx = location[0] - p[0], dz = location[2] - p[2], right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8], largest = Math.max(Math.abs(right), Math.abs(forward));
        return { distance: Math.hypot(dx, dz), keys: [...(Math.abs(right) > largest * 0.4 ? [right > 0 ? 'd' : 'a'] : []), ...(Math.abs(forward) > largest * 0.4 ? [forward > 0 ? 'w' : 's'] : [])] };
      }, destination.route[waypoint]);
      if (next.distance < 0.65 && waypoint < destination.route.length - 1) { waypoint++; continue; }
      for (const key of next.keys) await guest.keyboard.down(key);
      try { await guest.waitForTimeout(100); } finally { for (const key of next.keys) await guest.keyboard.up(key); }
      await guest.waitForTimeout(100);
    }
    assert.equal(emptied, true, 'Original proximity depositing must empty the guest carrier.');
    await host.waitForFunction(hero => { const actor = window.hostWorld.players.active.get(hero).hero; return !actor.getEC('ECResourceCarrier').hasAnyFlyingResource() && window.naturalDepositEvents.some(event => event.actor === actor.getName()); }, hero, { timeout: 10000 });
    const result = await host.evaluate(async ({ hero, resource }) => {
      const w = window.hostWorld, actor = w.players.active.get(hero).hero;
      await window.polycraft.checkpoint(true);
      return { events: window.naturalDepositEvents, pickups: window.naturalDepositPickups, bank: actor.getEC('ECPlayerData').getResource(resource), carried: w.players.captureHero(actor).inventory.carried, scripts: w.game.runScripts };
    }, { hero, resource });
    console.log('Original shared-bank deposit:', JSON.stringify(result));
    assert.equal(result.scripts, true); assert.equal(result.carried[resource], 0);
    assert.equal(result.events.filter(event => event.actor === destination.actor).reduce((sum, event) => sum + event.amount, 0), destination.carried + result.pickups.reduce((sum, amount) => sum + amount, 0));
    assert.equal(result.bank, destination.bank + result.events.reduce((sum, event) => sum + event.amount, 0));
    const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state, coop = JSON.parse(state.userData.desktopCoop);
    assert.equal(coop.economy.resource[resource], result.bank); assert.equal(coop.players.find(player => player.id === hero).inventory.carried[resource], 0); assert.equal(state.cheats.everEnabled, false);
    for (let index = 0; index < guests.length; index++) {
      await focusGuest(index);
      await guests[index].waitForFunction(({ resource, bank }) => window.guestWorld.hud.state?.resources[resource] === bank, { resource, bank: result.bank });
    }
    await focus();
    console.log('Native carried ' + label + ' deposited once, saved in the shared pool and shown by all three guest HUDs.');
  } finally { await host.evaluate(() => window.restoreNaturalDepositObserver()).catch(() => {}); }
};
