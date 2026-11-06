'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalHq({ host, guest, focus, button, hero, hostFile }) {
  const source = await host.evaluate(hero => {
    const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero;
    const entity = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName('hqworkshop'))[0];
    if (!entity) throw new Error('The original HQ workshop is missing.');
    return { id: entity.getName(), location: Array.from(entity.getv3Location()), menu: world.construction.menu(actor, entity, world.controls), amounts: window.polycraft.controls.amounts(),
      existing: game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false).length };
  }, hero);
  console.log('Natural HQ source:', JSON.stringify(source));
  assert.equal(source.existing, 0);
  const product = source.menu.products.find(product => product.archetype === 'a_b_hq');
  assert.ok(product?.valid && product.affordable); assert.deepEqual(product.costs, [0, 0, 0]); assert.equal(product.time, 2);
  await focus();
  for (let step = 0; step < 100; step++) {
    const next = await guest.evaluate(location => {
      const world = window.guestWorld, p = world.scene.entities.get(world.identity.entity).record.location, m = world.controls.app.globals.camera.matrix;
      const dx = location[0] - p[0], dz = location[2] - p[2], right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8];
      return { distance: Math.hypot(dx, dz), key: Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's' };
    }, source.location);
    if (next.distance < 5) break;
    await guest.keyboard.down(next.key);
    try { await guest.waitForTimeout(150); } finally { await guest.keyboard.up(next.key); }
    await guest.waitForTimeout(100);
  }
  await guest.waitForFunction(id => {
    const w = window.guestWorld, entry = w.scene.entities.get(id), point = w.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location);
    const previous = window.hqProjection;
    const stable = previous && Math.hypot(point[0] - previous.point[0], point[1] - previous.point[1]) < 0.5 ? previous.stable + 1 : 0;
    window.hqProjection = { point: Array.from(point), stable };
    return stable >= 3;
  }, source.id, { polling: 100, timeout: 10000 });
  const before = await host.evaluate(() => window.polycraft.controls.amounts());
  const point = await guest.evaluate(id => {
    const world = window.guestWorld, entry = world.scene.entities.get(id), globals = world.controls.app.globals;
    const projected = globals.camera.worldToScreen(entry.displayLocation || entry.record.location), b = world.movement.canvas.getBoundingClientRect();
    const event = { clientX: b.left + projected[0] * b.width / globals.graphicsDevice.width, clientY: b.top + projected[1] * b.height / globals.graphicsDevice.height };
    return { x: event.clientX, y: event.clientY, selected: window.PolycraftCoopActions.pickTarget(world, event) };
  }, source.id);
  console.log('Visible native HQ icon:', point);
  assert.equal(point.selected, source.id, 'The original HQ icon must be selectable at its visible location.');
  await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150);
  assert.equal(await guest.evaluate(point => window.PolycraftCoopActions.pickTarget(window.guestWorld, { clientX: point.x, clientY: point.y }), point), source.id);
  await guest.mouse.click(point.x, point.y, { delay: 100 });
  await guest.waitForFunction(id => window.guestWorld.construction.menu?.source === id, source.id, { timeout: 10000 });
  await button('guest-build-' + source.id + '-' + product.index);
  await guest.waitForFunction(() => window.guestWorld.construction.placement);
  const locations = await host.evaluate(({ hero, source, index }) => {
    const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero, entity = game.getGameEntityByName(source);
    const suggestion = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName('suggestHq'))[0];
    const center = suggestion ? suggestion.getv3Location() : entity.getv3Location(), locations = [];
    for (let x = -10; x <= 10; x += 2) for (let z = -10; z <= 10; z += 2) {
      const location = [center[0] + x, actor.getv3Location()[1], center[2] + z];
      if (world.construction.preview(actor, entity, index, location).preview?.valid) locations.push(location);
    }
    return locations;
  }, { hero, source: source.id, index: product.index });
  const placement = await guest.evaluate(locations => {
    const world = window.guestWorld, globals = world.controls.app.globals, b = world.movement.canvas.getBoundingClientRect();
    return locations.map(location => {
      const point = globals.camera.worldToScreen(location);
      return { location, x: b.left + point[0] * b.width / globals.graphicsDevice.width, y: b.top + point[1] * b.height / globals.graphicsDevice.height };
    }).find(point => point.x > b.left + 60 && point.x < b.right - 60 && point.y > b.top + 60 && point.y < b.bottom - 100);
  }, locations);
  assert.ok(placement, 'The guest needs a visible original-rule HQ footprint.');
  await guest.mouse.move(placement.x, placement.y);
  await guest.waitForFunction(() => { const ui = window.guestWorld.construction; return ui.preview?.valid && ui.matches(ui.preview.location); });
  assert.deepEqual(await host.evaluate(() => window.polycraft.controls.amounts()), before, 'Menu and placement preview spend nothing.');
  await guest.mouse.click(placement.x, placement.y, { delay: 100 });
  await guest.waitForFunction(() => window.guestWorld.construction.lastBuildResult);
  assert.equal(await guest.evaluate(() => window.guestWorld.construction.lastBuildResult.message), 'Building placed and saved.');
  await host.waitForFunction(() => window.hostWorld.game.getPlayerData().getTaskFlags().buildHq === true, null, { timeout: 20000 });
  try {
    await host.waitForFunction(() => window.hostWorld.game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false).some(entity => !entity.getEC('ECScaffold')), null, { timeout: 20000 });
  } catch (error) {
    console.log('Native HQ construction state:', await host.evaluate(() => {
      const game = window.hostWorld.game;
      return game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECScaffold')).map(entity => {
        const scaffold = entity.getEC('ECScaffold'); return { name: entity.getName(), planned: scaffold.getPlannedObject(), complete: scaffold.getBuildCompleteFraction(), started: scaffold.hasStartedBuilding(), waiting: scaffold.isWaitingForClick(), builder: scaffold.getHasBuilder() };
      });
    }));
    throw error;
  }
  const result = await host.evaluate(async () => {
    const world = window.hostWorld, game = world.game;
    await window.polycraft.checkpoint(true);
    return { buildings: game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false).map(entity => entity.getName()),
      scripts: game.runScripts, amounts: window.polycraft.controls.amounts(), pending: world.construction.pending.size };
  });
  console.log('Original guest HQ construction:', JSON.stringify({ placement, result }));
  assert.equal(result.buildings.length, 1); assert.equal(result.pending, 0); assert.equal(result.scripts, true);
  for (const resource of ['amber', 'wood', 'stone']) assert.equal(result.amounts[resource], before[resource]);
  await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'buildHq');
  const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state;
  assert.equal(state.cheats.everEnabled, false); assert.equal(JSON.parse(state.userData.taskFlags).buildHq, true);
  assert.ok(JSON.parse(state.userData.desktopQuests).pending.some(task => task.task === 'buildHq'));
  console.log('First HQ built through original guest menu/preview and native construction; shared reward and clean history saved.');
};
