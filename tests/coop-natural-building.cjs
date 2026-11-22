'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalBuilding({ host, guest, guests, focusGuest, focus, button, hero, hostFile, directory, nativeFocus, lumbermill = false, stonemill = false, worker = null, defenceFactory = false, outpost = false, barricade = false }) {
  assert.ok(worker === null || worker === 'lumber' || worker === 'stone' || worker === 'war');
  assert.ok(Number(lumbermill) + Number(stonemill) + Number(worker !== null) + Number(defenceFactory) + Number(outpost) + Number(barricade) <= 1);
  const definition = barricade ? { family: 'barricadeworkshop', type: 'Barricade', archetype: 'a_d_barricade', task: 'buildBarricade', costs: [25, 0, 0] } : outpost ? { family: 'outpostworkshop', type: 'Outpost', archetype: 'a_b_outpost', task: 'buildOutpost', costs: [100, 0, 0] } : worker === 'war' ? { family: 'defendlinghutworkshop', type: 'Defendling Hut', archetype: 'a_b_wildlinghouse_war', task: 'buildDefendlingHut', costs: [10, 0, 0] } : defenceFactory ? { family: 'defencefactoryworkshop', type: 'Defence Factory', archetype: 'a_b_defencefactory', task: 'buildDefenceFactory', costs: [10, 0, 0] } : worker ? { family: worker === 'lumber' ? 'lumberlinghutworkshop' : 'stonelinghutworkshop', type: worker === 'lumber' ? 'Lumberling Hut' : 'Stoneling Hut', archetype: 'a_b_wildlinghouse_' + worker, task: worker === 'lumber' ? 'buildLumberlingHut' : 'buildStonelingHut', costs: worker === 'lumber' ? [10, 0, 0] : [0, 10, 0] } : stonemill ? { family: 'stonemillworkshop', type: 'Stonemill', archetype: 'a_b_stonemill', task: 'buildStonemill', costs: [0, 10, 0] } : lumbermill ? { family: 'lumbermillworkshop', type: 'Lumbermill', archetype: 'a_b_lumbermill', task: 'buildLumbermill', costs: [10, 0, 0] } :
    { family: 'hqworkshop', type: 'HQ', archetype: 'a_b_hq', task: 'buildHq', costs: [0, 0, 0] };
  if (!outpost) await host.waitForFunction(family => window.hostWorld.game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName(family)).some(entity => entity.getEC('ECSelectable')?.permanentValid === true), definition.family, { timeout: 10000 });
  const source = await host.evaluate(({ hero, definition }) => {
    const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero;
    const entity = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName(definition.family))[0];
    if (!entity) throw new Error('The original ' + definition.type + ' workshop is missing.');
    return { id: entity.getName(), location: Array.from(entity.getv3Location()), menu: definition.type === 'Outpost' ? null : world.construction.menu(actor, entity, world.controls), amounts: window.polycraft.controls.amounts(),
      route: definition.type === 'Outpost' ? game.getNavManager().getEntityToEntityPath(actor, entity, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true)?.getWaypointList().map(point => Array.from(point)) : null,
      existing: game.getBuildingManager().getBuildingsAtMinLevel(definition.type, 1, false).length };
  }, { hero, definition });
  console.log('Natural ' + definition.type + ' source:', JSON.stringify(source));
  assert.equal(source.existing, 0);
  if (outpost) assert.ok(source.route?.length, 'The native navigator must supply the return route from the tunnels.');
  const approach = async destination => {
    await focus();
    let waypoint = Math.min(1, (destination.route?.length || 1) - 1), nearby = false;
    for (let step = 0; step < (outpost ? 400 : 100); step++) {
      const next = await guest.evaluate(({ location, destination }) => {
        const world = window.guestWorld, p = world.scene.entities.get(world.identity.entity).record.location, m = world.controls.app.globals.camera.matrix;
        const dx = destination[0] - p[0], dz = destination[2] - p[2], right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8];
        return { distance: Math.hypot(location[0] - p[0], location[2] - p[2]), waypointDistance: Math.hypot(dx, dz), key: Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's' };
      }, { location: destination.location, destination: destination.route?.[waypoint] || destination.location });
      if (next.distance < 5) { nearby = true; break; }
      if (destination.route && next.waypointDistance < .65 && waypoint < destination.route.length - 1) { waypoint++; continue; }
      if (outpost && step % 25 === 0) console.log('Normal guest building approach:', JSON.stringify({ target: destination.id, step, waypoint, ...next }));
      await guest.keyboard.down(next.key);
      try { await guest.waitForTimeout(150); } finally { await guest.keyboard.up(next.key); }
      await guest.waitForTimeout(100);
    }
    assert.ok(nearby, 'Ordinary guest movement must reach the original workshop or placement marker.');
  };
  await approach(source);
  if (outpost) {
    // Native dispenser eligibility updates locally; approach before querying its menu.
    await host.waitForFunction(id => window.hostWorld.game.getGameEntityByName(id).getEC('ECSelectable').permanentValid === true, source.id, { timeout: 10000 });
    source.menu = await host.evaluate(({ hero, id }) => { const w = window.hostWorld; return w.construction.menu(w.players.active.get(hero).hero, w.game.getGameEntityByName(id), w.controls); }, { hero, id: source.id });
  }
  const product = source.menu.products.find(product => product.archetype === definition.archetype);
  assert.ok(product?.valid && product.affordable); assert.deepEqual(product.costs, definition.costs); assert.equal(product.time, barricade ? 5 : outpost ? 1800 : 2);
  if (barricade) assert.equal(product.repeat, true);
  await guest.waitForFunction(id => {
    const w = window.guestWorld, entry = w.scene.entities.get(id), point = w.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location);
    const previous = window.hqProjection;
    const stable = previous?.id === id && Math.hypot(point[0] - previous.point[0], point[1] - previous.point[1]) < 0.5 ? previous.stable + 1 : 0;
    window.hqProjection = { id, point: Array.from(point), stable };
    return stable >= 3;
  }, source.id, { polling: 100, timeout: 10000 });
  const before = barricade ? await host.evaluate(require('./coop-building-ledger.cjs')) : await host.evaluate(() => {
    const game = window.hostWorld.game;
    window.nativeBuildingIncome = { wood: 0, stone: 0, amber: 0 };
    const deposit = event => { window.nativeBuildingIncome[event.type === 0 ? 'wood' : 'stone'] += event.amount; };
    const amber = amount => { window.nativeBuildingIncome.amber += amount; };
    game.eventManager.subscribe('ResourceDeposited', deposit); game.eventManager.subscribe('SoftCurrencyFound', amber);
    window.restoreNativeBuildingIncome = () => { game.eventManager.unsubscribe('ResourceDeposited', deposit); game.eventManager.unsubscribe('SoftCurrencyFound', amber); };
    return window.polycraft.controls.amounts();
  });
  let inputObserved = false;
  try {
    if (barricade) { await guest.evaluate(require('./coop-input-trace.cjs')); inputObserved = true; }
    const point = await guest.evaluate(id => {
      const world = window.guestWorld, entry = world.scene.entities.get(id), globals = world.controls.app.globals;
      const projected = globals.camera.worldToScreen(entry.displayLocation || entry.record.location), b = world.movement.canvas.getBoundingClientRect();
      const event = { clientX: b.left + projected[0] * b.width / globals.graphicsDevice.width, clientY: b.top + projected[1] * b.height / globals.graphicsDevice.height };
      return { x: event.clientX, y: event.clientY, selected: window.PolycraftCoopActions.pickTarget(world, event) };
    }, source.id);
    console.log('Visible native ' + definition.type + ' icon:', point);
    assert.equal(point.selected, source.id, 'The original building icon must be selectable at its visible location.');
    await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150);
    assert.equal(await guest.evaluate(point => window.PolycraftCoopActions.pickTarget(window.guestWorld, { clientX: point.x, clientY: point.y }), point), source.id);
    await guest.mouse.click(point.x, point.y, { delay: 100 });
    await guest.waitForFunction(id => window.guestWorld.construction.menu?.source === id, source.id, { timeout: 10000 });
    await button('guest-build-' + source.id + '-' + product.index);
    await guest.waitForFunction(() => window.guestWorld.construction.placement);
    let marker = null;
    if (outpost) {
      marker = await host.evaluate(hero => {
        const w = window.hostWorld, game = w.game, actor = w.players.active.get(hero).hero;
        const entity = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName('suggestOutpost'))[0];
        if (!entity) throw new Error('The authored Outpost placement marker must exist.');
        const route = game.getNavManager().getEntityToEntityPath(actor, entity, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
        return { id: entity.getName(), location: Array.from(entity.getv3Location()), route: route?.getWaypointList().map(point => Array.from(point)) };
      }, hero);
      assert.ok(marker.route?.length, 'The native navigator must supply a route outside the village exclusion zone.');
      console.log('Authored Outpost placement journey:', JSON.stringify(marker));
      await approach(marker);
    }
    const locations = await host.evaluate(({ hero, source, index, paid, marker, barricade }) => {
      const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero, entity = game.getGameEntityByName(source);
      const suggestion = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName(paid ? 'hq' : 'suggestHq'))[0];
      const center = marker || (barricade ? entity.getv3Location() : suggestion ? suggestion.getv3Location() : entity.getv3Location()), locations = [];
      for (let x = -10; x <= 10; x += 2) for (let z = -10; z <= 10; z += 2) {
        const location = [center[0] + x, actor.getv3Location()[1], center[2] + z];
        if (world.construction.preview(actor, entity, index, location).preview?.valid) locations.push(location);
      }
      return locations;
    }, { hero, source: source.id, index: product.index, paid: lumbermill || stonemill || worker !== null || defenceFactory || outpost || barricade, marker: marker?.location, barricade });
    const placement = await guest.evaluate(locations => {
      const world = window.guestWorld, globals = world.controls.app.globals, b = world.movement.canvas.getBoundingClientRect();
      return locations.map(location => {
        const point = globals.camera.worldToScreen(location);
        return { location, x: b.left + point[0] * b.width / globals.graphicsDevice.width, y: b.top + point[1] * b.height / globals.graphicsDevice.height };
      }).find(point => point.x > b.left + 60 && point.x < b.right - 60 && point.y > b.top + 60 && point.y < b.bottom - 100);
    }, locations);
    console.log('Native building placement candidates:', JSON.stringify({ type: definition.type, count: locations.length, sample: locations.slice(0, 3), placement }));
    assert.ok(placement, 'The guest needs a visible original-rule building footprint.');
    await guest.mouse.move(placement.x, placement.y);
    await guest.waitForFunction(() => { const ui = window.guestWorld.construction; return ui.preview?.valid && ui.matches(ui.preview.location); });
    const preview = await host.evaluate(() => ({ amounts: window.polycraft.controls.amounts(), income: { ...window.nativeBuildingIncome }, resourceEvents: window.nativeBuildingResourceEvents }));
    console.log('Native credits during building menu/preview:', JSON.stringify(preview.income));
    if (barricade) assert.equal(preview.resourceEvents.some(row => row.amount < 0), false, 'The infinite blueprint must not charge before placement.');
    assert.deepEqual(preview.amounts, { ...before, wood: before.wood + preview.income.wood, stone: before.stone + preview.income.stone, amber: before.amber + preview.income.amber }, 'Menu and placement preview spend nothing; native deposits/pickups remain credited.');
    await guest.waitForFunction(() => !window.guestWorld.game.getIMGui().hasCapturedInput());
    await guest.mouse.down();
    try { await guest.waitForFunction(() => { const w = window.guestWorld, ui = w.construction; return ui.click && !w.game.getIMGui().hasCapturedInput() && ui.preview?.valid && ui.matches(ui.preview.location); }); }
    finally { await guest.mouse.up(); }
    await guest.waitForFunction(() => window.guestWorld.construction.lastBuildResult);
    assert.equal(await guest.evaluate(() => window.guestWorld.construction.lastBuildResult.message), 'Building placed and saved.');
    if (barricade) { await button('guest-build-cancel'); await guest.waitForFunction(() => !window.guestWorld.construction.placement); }
    await host.waitForFunction(task => window.hostWorld.game.getPlayerData().getTaskFlags()[task] === true, definition.task, { timeout: 20000 });
    if (outpost) {
      await host.waitForFunction(amber => window.polycraft.controls.amounts().amber >= amber + 80, before.amber, { timeout: 10000 });
    } else try {
      await host.waitForFunction(type => window.hostWorld.game.getBuildingManager().getBuildingsAtMinLevel(type, 1, false).some(entity => !entity.getEC('ECScaffold')), definition.type, { timeout: 20000 });
    } catch (error) {
      console.log('Native construction state:', await host.evaluate(() => {
        const game = window.hostWorld.game;
        return game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECScaffold')).map(entity => {
          const scaffold = entity.getEC('ECScaffold'); return { name: entity.getName(), planned: scaffold.getPlannedObject(), complete: scaffold.getBuildCompleteFraction(), started: scaffold.hasStartedBuilding(), waiting: scaffold.isWaitingForClick(), builder: scaffold.getHasBuilder() };
        });
      }));
      throw error;
    }
    const result = await host.evaluate(async ({ type, hero, outpost }) => {
      const world = window.hostWorld, game = world.game;
      await window.polycraft.checkpoint(true);
      return { buildings: game.getBuildingManager().getBuildingsAtMinLevel(type, 1, outpost).map(entity => entity.getName()),
        scaffolds: game.getBuildingManager().getBuildingsAtMinLevel(type, 1, outpost).flatMap(entity => {
          const scaffold = entity.getEC('ECScaffold');
          return scaffold ? [{ id: entity.getName(), planned: scaffold.getPlannedObject(), time: scaffold.buildTime, remaining: scaffold.getBuildTimeRemaining(), cost: scaffold.getCostToInstantlyBuild(), affordable: scaffold.canEntityAffordInstantBuild(world.players.active.get(hero).hero), menu: world.construction.menu(world.players.active.get(hero).hero, entity, world.controls) }] : [];
        }),
        scripts: game.runScripts, amounts: window.polycraft.controls.amounts(), pending: world.construction.pending.size, income: { ...window.nativeBuildingIncome }, resourceEvents: window.nativeBuildingResourceEvents };
    }, { type: definition.type, hero, outpost });
    console.log('Original guest ' + definition.type + ' construction:', JSON.stringify({ placement, result }));
    assert.equal(result.buildings.length, 1); assert.equal(result.pending, 0); assert.equal(result.scripts, true);
    if (barricade) {
      const bank = [before.wood, before.stone], entries = result.resourceEvents;
      assert.ok(Array.isArray(entries) && entries.length > 0);
      for (const row of entries) {
        assert.ok(!row.error && !row.overflow && (row.type === 0 || row.type === 1));
        assert.ok([row.amount, row.before, row.after, row.cap].every(Number.isFinite));
        assert.equal(row.before, bank[row.type]);
        assert.equal(row.after, row.amount ? Math.round(Math.max(0, Math.min(row.before + row.amount, row.cap))) : row.before);
        bank[row.type] = row.after;
      }
      assert.deepEqual(entries.filter(row => row.amount < 0).map(row => [row.type, row.amount]), [[0, -25]]);
      assert.equal(entries.filter(row => row.type === 0 && row.amount === 200).length, 1);
      assert.deepEqual([result.amounts.wood, result.amounts.stone], bank);
      assert.equal(result.amounts.amber, before.amber);
    } else for (const [resource, cost] of [['wood', product.costs[0]], ['stone', product.costs[1]], ['amber', product.costs[2]]]) assert.equal(result.amounts[resource], before[resource] + result.income[resource] - cost + (outpost ? resource === 'wood' ? 250 : resource === 'amber' ? 80 : 0 : 0));
    if (outpost) {
      assert.equal(result.scaffolds.length, 1); assert.equal(result.scaffolds[0].planned, definition.archetype);
      assert.equal(result.scaffolds[0].time, 1800); assert.ok(result.scaffolds[0].remaining > 1700);
      assert.equal(result.scaffolds[0].affordable, true);
      console.log('Original Outpost placement grants250wood/80Amber before its unchanged30minute build finishes; guest speedup menu observation:', JSON.stringify(result.scaffolds));
    } else assert.equal(result.scaffolds.length, 0);
    await guest.waitForFunction(task => window.guestWorld.quests.state?.completed?.task === task, definition.task);
    const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state;
    assert.equal(state.cheats.everEnabled, false); assert.equal(JSON.parse(state.userData.taskFlags)[definition.task], true);
    assert.ok(JSON.parse(state.userData.desktopQuests).pending.some(task => task.task === definition.task));
    if (lumbermill || stonemill || worker || defenceFactory || outpost || barricade) {
      for (let index = 0; index < guests.length; index++) {
        await focusGuest(index);
        await guests[index].waitForFunction(amounts => window.guestWorld.hud.state?.resources[0] === amounts.wood && window.guestWorld.hud.state?.resources[1] === amounts.stone, result.amounts);
      }
      await focus();
    }
    console.log('First ' + definition.type + ' built through original guest menu/preview and native construction; native cost, shared reward and clean history saved.');
    if (barricade && directory) await guest.screenshot({ path: require('node:path').join(directory, 'guest-barricade-built.png'), timeout: 5000 }).catch(error => console.log('Barricade screenshot unavailable:', error.message));
  } catch (error) {
    if (barricade) {
      if (nativeFocus) console.log('Native Barricade focus trace:', JSON.stringify(await nativeFocus().catch(e => ({ unavailable: String(e?.message ?? e) }))));
      console.log('Host Barricade failure diagnostics:', JSON.stringify(await host.evaluate(() => ({ amounts: window.polycraft.controls.amounts(), resourceEvents: window.nativeBuildingResourceEvents, pending: window.hostWorld.construction.pending.size, errors: window.workerConnectionErrors })).catch(e => ({ unavailable: String(e?.message ?? e) }))));
      console.log('Guest Barricade failure diagnostics:', JSON.stringify(await guest.evaluate(async () => {
        const w = window.guestWorld, ui = w.construction;
        return { focused: document.hasFocus(), nativeWindowFocused: await window.desktop.windowFocused(), nativeFocused: w.movement.nativeFocused, available: w.movement.available(), captured: w.game.getIMGui().hasCapturedInput(), placement: ui.placement, pending: ui.pending, preview: ui.preview, result: ui.lastBuildResult, inputTrace: w.resourceInputTrace?.events, closed: w.connection.closed };
      }).catch(e => ({ unavailable: String(e?.message ?? e) }))));
      if (directory) await guest.screenshot({ path: require('node:path').join(directory, 'guest-barricade-failure.png'), timeout: 5000 }).catch(() => {});
    }
    throw error;
  } finally {
    await host.evaluate(() => window.restoreNativeBuildingIncome()).catch(() => {});
    if (inputObserved) await guest.evaluate(() => window.guestWorld?.resourceInputTrace?.restore()).catch(() => {});
  }
};
