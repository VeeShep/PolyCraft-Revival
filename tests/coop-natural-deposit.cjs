'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const clickGround = require('./coop-ground-click.cjs');

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
    const trace = [];
    await focus(); let waypoint = Math.min(1, destination.route.length - 1), commandedLocation = null, emptied = false, walkingError;
    for (let step = 0; step < 350; step++) {
      emptied = await host.evaluate(({ hero, resource }) => window.hostWorld.players.active.get(hero).hero.getEC('ECResourceCarrier').getResource(resource) === 0, { hero, resource });
      if (emptied) break;
      const next = await guest.evaluate(location => {
        const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix;
        const dx = location[0] - p[0], dz = location[2] - p[2];
        return { position: [...p], waypointLocation: [...location], cameraAxes: [m[0], m[2], m[6], m[8]], distance: Math.hypot(dx, dz), focused: document.hasFocus(), nativeFocused: w.movement.nativeFocused, available: w.movement.available(), paused: w.controls.paused, tick: w.scene.tick, movementSequence: w.movement.sequence, navigation: w.scene.snapshot.camera };
      }, destination.route[waypoint]);
      trace.push({ step, waypoint, ...next });
      if (next.distance < 0.65 && waypoint < destination.route.length - 1) { waypoint++; commandedLocation = null; continue; }
      if (!commandedLocation || Math.hypot(next.position[0] - commandedLocation[0], next.position[2] - commandedLocation[2]) < 0.65) {
        try { trace[trace.length - 1].click = await clickGround(guest, destination.route[waypoint]); }
        catch (error) { walkingError = error; break; }
        commandedLocation = trace[trace.length - 1].click.location;
      }
      await guest.waitForTimeout(200);
    }
    console.log('Native deposit walking trace:', JSON.stringify(trace));
    if (!emptied) {
      try {
        console.log('Native deposit failure state:', JSON.stringify(await host.evaluate(({ hero, resource }) => {
          const w = window.hostWorld, actor = w.players.active.get(hero).hero, carrier = actor.getEC('ECResourceCarrier');
          return { actor: Array.from(actor.getv3Location()), carried: carrier.getResource(resource), inbound: carrier.hasAnyInboundResource(), flying: carrier.hasAnyFlyingResource(), tick: w.game.gameClock.getFrameIndex(), events: window.naturalDepositEvents,
            destinations: w.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECResourceDestination')).map(entity => ({ id: entity.getName(), location: Array.from(entity.getv3Location()), distance: entity.getDistanceUsingSize(actor.getv3Location()), eligible: entity.getEC('ECResourceDestination').canDepositResource(resource) })) };
        }, { hero, resource })));
        await guest.screenshot({ path: path.join(path.dirname(hostFile), '..', 'resource-deposit-failure.png'), timeout: 5000 });
      } catch (error) { console.log('Native deposit diagnostics unavailable:', String(error?.message ?? error)); }
    }
    if (walkingError) throw walkingError;
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
