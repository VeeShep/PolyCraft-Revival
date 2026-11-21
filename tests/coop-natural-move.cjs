'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
module.exports = async function naturalMove({ host, guest, hero, focus, button, hostFile, directory }) {
  const setup = await host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, actor = w.players.active.get(hero).hero;
    const outposts = w.game.getBuildingManager().getBuildingsAtMinLevel('Outpost', 1, false);
    if (outposts.length !== 1 || outposts[0].getEC('ECScaffold')) throw new Error('One completed original Outpost is required.');
    const entity = outposts[0];
    return { id: entity.getName(), location: Array.from(entity.getv3Location()), health: entity.getEC('ECHealth')?.getHealth(), xp: actor.getEC('ECPlayerData').getXP(), amber: actor.getEC('ECPlayerData').getSoftCurrency(), canMove: w.construction.canMove(actor, entity) };
  }), hero);
  try {
    assert.equal(setup.xp, 330); assert.ok(Number.isFinite(setup.health) && setup.health > 0); assert.equal(setup.canMove, true);
    await focus();
    await guest.waitForFunction(id => !!window.guestWorld.scene.entities.get(id), setup.id);
    const point = await guest.evaluate(id => {
      const w = window.guestWorld, g = w.controls.app.globals, e = w.scene.entities.get(id), p = g.camera.worldToScreen(e.displayLocation || e.record.location), b = w.movement.canvas.getBoundingClientRect();
      const event = { clientX: b.left + p[0] * b.width / g.graphicsDevice.width, clientY: b.top + p[1] * b.height / g.graphicsDevice.height };
      return { x: event.clientX, y: event.clientY, selected: window.PolycraftCoopActions.pickTarget(w, event) };
    }, setup.id);
    assert.equal(point.selected, setup.id);
    await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150);
    await guest.waitForFunction(() => !window.guestWorld.game.getIMGui().hasCapturedInput());
    await guest.mouse.click(point.x, point.y, { delay: 100 });
    await guest.waitForFunction(id => window.guestWorld.construction.menu?.source === id && window.guestWorld.construction.menu.move || window.guestWorld.selectedBuilding?.id === id && window.guestWorld.selectedBuilding.movable, setup.id);
    await button('guest-move-' + setup.id);
    await guest.waitForFunction(() => window.guestWorld.construction.placement?.held);
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult?.message), 'Building picked up and saved. Choose a placement.');
    const picked = JSON.parse(JSON.parse(fs.readFileSync(hostFile)).state.userData.desktopCoop);
    assert.equal(picked.players.find(row => row.id === hero).construction.moveFrom, setup.id);
    const locations = await host.evaluate(({ hero, original }) => {
      const w = window.hostWorld, actor = w.players.active.get(hero).hero, result = [];
      for (let x = -8; x <= 8; x += 2) for (let z = -8; z <= 8; z += 2) {
        if (Math.hypot(x, z) < 4) continue;
        const location = [original[0] + x, actor.getv3Location()[1], original[2] + z];
        if (w.construction.heldPreview(actor, location).preview?.valid) result.push(location);
      }
      return result;
    }, { hero, original: setup.location });
    const placement = await guest.evaluate(locations => {
      const w = window.guestWorld, g = w.controls.app.globals, b = w.movement.canvas.getBoundingClientRect();
      return locations.map(location => { const p = g.camera.worldToScreen(location); return { location, x: b.left + p[0] * b.width / g.graphicsDevice.width, y: b.top + p[1] * b.height / g.graphicsDevice.height }; }).find(p => p.x > b.left + 60 && p.x < b.right - 60 && p.y > b.top + 60 && p.y < b.bottom - 100);
    }, locations);
    assert.ok(placement, 'The moved Outpost needs a visible native-valid footprint.');
    await guest.mouse.move(placement.x, placement.y);
    await guest.waitForFunction(location => { const ui = window.guestWorld.construction; return ui.preview?.valid && ui.matches(location); }, placement.location);
    await guest.waitForFunction(() => !window.guestWorld.game.getIMGui().hasCapturedInput());
    await guest.mouse.down();
    try { await guest.waitForFunction(() => { const ui = window.guestWorld.construction; return ui.click && ui.preview?.valid && !window.guestWorld.game.getIMGui().hasCapturedInput(); }); }
    finally { await guest.mouse.up(); }
    await guest.waitForFunction(() => window.guestWorld.construction.lastBuildResult?.message === 'Held building placed and saved.');
    await host.waitForFunction(() => window.hostWorld.game.getBuildingManager().getBuildingsAtMinLevel('Outpost', 1, false).some(e => !e.getEC('ECScaffold')));
    await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'moveBuilding');
    const after = await host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
      const w = window.hostWorld, actor = w.players.active.get(hero).hero;
      return { xp: actor.getEC('ECPlayerData').getXP(), amber: actor.getEC('ECPlayerData').getSoftCurrency(), buildings: w.game.getBuildingManager().getBuildingsAtMinLevel('Outpost', 1, false).map(e => ({ id: e.getName(), location: Array.from(e.getv3Location()), health: e.getEC('ECHealth')?.getHealth() })) };
    }), hero);
    assert.equal(after.xp, setup.xp); assert.equal(after.amber, setup.amber); assert.equal(after.buildings.length, 1); assert.equal(after.buildings[0].health, setup.health);
    assert.ok(Math.hypot(after.buildings[0].location[0] - setup.location[0], after.buildings[0].location[2] - setup.location[2]) >= 3);
    const saved = JSON.parse(fs.readFileSync(hostFile)).state, world = JSON.parse(saved.userData.AdventureIncGameState);
    assert.equal(saved.cheats.everEnabled, false); assert.equal(JSON.parse(saved.userData.desktopCoop).players.find(row => row.id === hero).construction, null);
    const buildings = world.gameSpaceList.flatMap(s => s.entityList).filter(e => e.archetypeName === 'a_b_outpost'); assert.equal(buildings.length, 1); assert.equal(buildings[0].name, after.buildings[0].id); assert.deepEqual(buildings[0].v3Location, after.buildings[0].location);
    console.log('PASS: guest moves the completed Outpost through native pickup/preview/placement, keeps health and Amber, saves its released claim and unlocks the original moveBuilding quest:', JSON.stringify({ setup, placement, after }));
  } catch (error) {
    console.log('Guest move failure diagnostics:', JSON.stringify(await guest.evaluate(async () => {
      const w = window.guestWorld;
      return { focused: document.hasFocus(), nativeWindowFocused: await window.desktop.windowFocused(), nativeFocused: w.movement.nativeFocused, available: w.movement.available(), captured: w.game.getIMGui().hasCapturedInput(), menu: w.construction.menu, placement: w.construction.placement, selectionRequest: w.selectionRequest, lastResult: w.lastTargetResult, input: w.guiInput, connection: { state: w.connection.state, closed: w.connection.closed } };
    }).catch(e => ({ unavailable: e.message }))));
    console.log('Host move failure diagnostics:', JSON.stringify(await host.evaluate(({ hero, id }) => window.hostWorld.atRewardBoundary(() => {
      const w = window.hostWorld, actor = w.players.active.get(hero)?.hero, entity = w.game.getGameEntityByName(id);
      return { actorPresent: !!actor, sourcePresent: !!entity, canMove: actor && entity && w.construction.canMove(actor, entity), menu: actor && entity && w.construction.menu(actor, entity, w.controls), errors: window.workerConnectionErrors };
    }), { hero, id: setup.id }).catch(e => ({ unavailable: e.message }))));
    if (directory) await guest.screenshot({ path: require('node:path').join(directory, 'guest-outpost-move-failure.png'), timeout: 5000 }).catch(() => {});
    throw error;
  }

};
