'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');

module.exports = async function naturalSpeedup({ host, guest, hero, focus, button, hostFile, directory }) {
  const setup = await host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, game = w.game, actor = w.players.active.get(hero).hero;
    const entity = game.getBuildingManager().getBuildingsAtMinLevel('Outpost', 1, true).find(e => e.getEC('ECScaffold'));
    if (!entity) throw new Error('An unfinished original Outpost must exist.');
    const scaffold = entity.getEC('ECScaffold'), original = scaffold.instantlyBuild, own = Object.hasOwn(scaffold, 'instantlyBuild');
    const trace = window.naturalSpeedupPayments = [];
    scaffold.instantlyBuild = function (actor) {
      const data = actor.getEC('ECPlayerData'), cost = this.getCostToInstantlyBuild(), before = data.getSoftCurrency();
      const result = original.apply(this, arguments);
      trace.push({ actor: actor.getName(), cost, before, after: data.getSoftCurrency(), complete: this.getBuildCompleteFraction() });
      return result;
    };
    window.restoreNaturalSpeedup = () => { if (own) scaffold.instantlyBuild = original; else delete scaffold.instantlyBuild; delete window.naturalSpeedupPayments; delete window.restoreNaturalSpeedup; };
    const data = actor.getEC('ECPlayerData');
    return { id: entity.getName(), actor: actor.getName(), xp: data.getXP(), hostXP: game.getPlayerData().getXP(), amber: data.getSoftCurrency(), cost: scaffold.getCostToInstantlyBuild(), affordable: scaffold.canEntityAffordInstantBuild(actor), complete: scaffold.getBuildCompleteFraction() };
  }), hero);
  try {
    assert.equal(setup.xp, 310); assert.equal(setup.affordable, true); assert.ok(setup.complete < 1);
    await focus();
    await guest.waitForFunction(id => {
      const w = window.guestWorld, e = w.scene.entities.get(id), p = e && w.controls.app.globals.camera.worldToScreen(e.displayLocation || e.record.location);
      if (!p) return false;
      const old = window.speedupProjection, stable = old?.id === id && Math.hypot(p[0] - old.point[0], p[1] - old.point[1]) < .5 ? old.stable + 1 : 0;
      window.speedupProjection = { id, point: Array.from(p), stable }; return stable >= 3;
    }, setup.id, { polling: 100, timeout: 10000 });
    const point = await guest.evaluate(id => {
      const w = window.guestWorld, e = w.scene.entities.get(id), g = w.controls.app.globals, p = g.camera.worldToScreen(e.displayLocation || e.record.location), b = w.movement.canvas.getBoundingClientRect();
      const event = { clientX: b.left + p[0] * b.width / g.graphicsDevice.width, clientY: b.top + p[1] * b.height / g.graphicsDevice.height };
      return { x: event.clientX, y: event.clientY, selected: window.PolycraftCoopActions.pickTarget(w, event) };
    }, setup.id);
    assert.equal(point.selected, setup.id, 'The original scaffold must be selectable at its visible location.');
    await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150);
    await guest.waitForFunction(({ id, point }) => window.guestWorld.movement.available() && !window.guestWorld.game.getIMGui().hasCapturedInput() && window.PolycraftCoopActions.pickTarget(window.guestWorld, { clientX: point.x, clientY: point.y }) === id, { id: setup.id, point });
    await guest.mouse.click(point.x, point.y, { delay: 100 });
    await guest.waitForFunction(id => window.guestWorld.construction.menu?.source === id && window.guestWorld.construction.menu?.speedup?.affordable, setup.id);
    const quote = await guest.evaluate(() => window.guestWorld.construction.menu.speedup);
    assert.equal(quote.cost, setup.cost); assert.equal(quote.planned, 'a_b_outpost');
    await button('guest-speedup-' + setup.id);
    await guest.waitForFunction(() => window.guestWorld.lastTargetResult?.type === 'speedup');
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Building sped up and saved.');
    const disk = JSON.parse(fs.readFileSync(hostFile)).state, saved = JSON.parse(disk.userData.desktopCoop);
    assert.equal(saved.economy.softCurrency, setup.amber - setup.cost, 'The acknowledgement must follow the real Amber debit on disk.');
    assert.equal(disk.cheats.everEnabled, false);
    const buildings = JSON.parse(disk.userData.AdventureIncGameState).gameSpaceList.flatMap(s => s.entityList);
    assert.equal(buildings.filter(e => e.archetypeName === 'a_b_outpost').length, 1, 'The acknowledged save must contain the completed Outpost.');
    assert.equal(buildings.some(e => e.name === setup.id), false);
    await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'speedUpOutpost');
    const after = await host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
      const w = window.hostWorld, data = w.players.active.get(hero).hero.getEC('ECPlayerData');
      return { xp: data.getXP(), hostXP: w.game.getPlayerData().getXP(), amber: data.getSoftCurrency(), payments: window.naturalSpeedupPayments };
    }), hero);
    assert.equal(after.xp, setup.xp); assert.equal(after.hostXP, setup.hostXP); assert.equal(after.amber, setup.amber - setup.cost);
    assert.deepEqual(after.payments, [{ actor: setup.actor, cost: setup.cost, before: setup.amber, after: setup.amber - setup.cost, complete: 1 }]);
    console.log('PASS: original guest scaffold speedup pays native Amber once, completes the Outpost, saves before acknowledgement and unlocks its original quest:', JSON.stringify({ setup, quote, after }));
  } catch (error) {
    console.log('Guest speedup failure diagnostics:', JSON.stringify(await guest.evaluate(() => {
      const w = window.guestWorld, gui = w.game.getIMGui();
      return { nativeFocused: w.movement.nativeFocused, available: w.movement.available(), menu: w.construction.menu, menuAge: performance.now() - w.construction.menuUpdated, request: w.speedupRequest, selectionRequest: w.selectionRequest, lastResult: w.lastTargetResult, captured: gui.hasCapturedInput(), input: w.guiInput, connection: { state: w.connection.state, closed: w.connection.closed } };
    }).catch(e => ({ unavailable: e.message }))));
    console.log('Host speedup failure diagnostics:', JSON.stringify(await host.evaluate(({ id, hero }) => window.hostWorld.atRewardBoundary(() => {
      const w = window.hostWorld, entity = w.game.getGameEntityByName(id), actor = w.players.active.get(hero)?.hero;
      return { payments: window.naturalSpeedupPayments, actorPresent: !!actor, menu: entity && actor && w.game.desktopConstruction.menu(actor, entity), errors: window.workerConnectionErrors };
    }), { id: setup.id, hero }).catch(e => ({ unavailable: e.message }))));
    if (directory) await guest.screenshot({ path: require('node:path').join(directory, 'guest-speedup-failure.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally { await host.evaluate(() => window.restoreNaturalSpeedup?.()).catch(() => {}); }
};
