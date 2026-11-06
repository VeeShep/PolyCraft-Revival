'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function restorationAcceptance({ host, guest, hero, port, saveFile, guestFile, click, focus, connection, reloadHost }) {
  const saved = () => JSON.parse(JSON.parse(fs.readFileSync(saveFile)).state.userData.desktopCoop);
  let solo, soloBytes;
  async function nativeButton(id, art, screenshot) {
    await focus(1);
    await guest.waitForFunction(({ id, art }) => { const world = window.polycraft.controls.guestWorld, row = world.game.getGuiManager().prevDrawGuiMap[id]; return world.movement.nativeFocused && row?.scale > 0.95 && row.archetypeName === art; }, { id, art });
    const readPoint = () => guest.evaluate(id => {
      const world = window.polycraft.controls.guestWorld, args = world.game.getGuiManager().prevDrawGuiMap[id].argumentObject, position = args.v2ScreenLocation || [args.x, args.y], bounds = world.movement.canvas.getBoundingClientRect(), device = world.controls.app.globals.graphicsDevice;
      const x = bounds.left + position[0] * bounds.width / device.width, y = bounds.top + position[1] * bounds.height / device.height;
      if (x <= bounds.left || x >= bounds.right || y <= bounds.top || y >= bounds.bottom) throw new Error('Restoration button is outside the visible canvas.');
      return { x, y };
    }, id);
    let point = await readPoint(), settled = 0;
    const deadline = Date.now() + 5000;
    while (settled < 3 && Date.now() < deadline) {
      await guest.waitForTimeout(100);
      const next = await readPoint();
      settled = Math.hypot(next.x - point.x, next.y - point.y) < 0.5 ? settled + 1 : 0;
      point = next;
    }
    assert.equal(settled, 3, 'Native restoration button must settle before a coordinate click.');
    if (screenshot) await guest.screenshot({ path: screenshot });
    await guest.mouse.move(point.x, point.y); await guest.waitForFunction(id => window.polycraft.controls.guestWorld.game.getIMGui().isHot(id), id);
    await guest.mouse.click(point.x, point.y, { delay: 100 });
  }
  async function join() {
    await focus(0); await host.locator('#connection-method').selectOption('direct');
    if (!await host.locator('#direct-settings').evaluate(node => node.open)) await click(0, '#direct-settings > summary');
    await host.locator('#direct-address').fill('127.0.0.1'); await host.locator('#direct-port').fill(String(port));
    assert.equal(await host.locator('#direct-upnp').isChecked(), false);
    await connection(0, '#host-island', true);
    await host.waitForFunction(() => !!window.polycraft.controls.onlineWorld?.players);
    const started = await host.evaluate(() => window.polycraft.controls.onlineWorld.atBoundary(() => window.polycraft.controls.app.globals.gameCurrentTime));
    await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
      const world = window.polycraft.controls.onlineWorld, held = world.players.registry.player(hero).construction;
      if (held?.moveFrom) {
        const source = world.game.getGameEntityByName(held.moveFrom);
        if (world.players.active.has(hero) || !source || !world.construction.claimed(source) || world.construction.canMove(world.game.getHero(), source)) throw new Error('An offline held move must reserve its original building before the guest joins.');
      }
    }), hero);
    await host.locator('#guest-hero').selectOption(hero); await click(0, '#create-invitation');
    await host.waitForFunction(() => document.getElementById('connection-outgoing').value.startsWith('polycraft-direct1.'));
    const invitation = await host.locator('#connection-outgoing').inputValue();
    await focus(1); await guest.locator('#join-invitation').fill(invitation);
    await guest.evaluate(() => window.polycraft.checkpoint());
    solo = await guest.evaluate(() => JSON.stringify(window.polycraft.bridge.state)); soloBytes = fs.readFileSync(guestFile);
    await connection(1, '#join-island', true);
    await guest.waitForFunction(() => !!window.polycraft.controls.guestWorld?.identity && !!window.polycraft.controls.guestWorld.scene.snapshot, null, { timeout: 30000 });
    assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.identity.playerId), hero);
    await click(0, '#close-multiplayer'); await click(1, '#close-multiplayer');
    return started;
  }
  async function end() {
    await click(0, '#multiplayer'); await click(0, '#end-session');
    await host.waitForFunction(() => !window.polycraft.controls.onlineWorld);
    await guest.waitForFunction(() => !window.polycraft.controls.guestWorld && window.polycraft.controls.ready());
    assert.equal(await guest.evaluate(() => JSON.stringify(window.polycraft.bridge.state)), solo); assert.deepEqual(fs.readFileSync(guestFile), soloBytes);
    await click(1, '#multiplayer');
  }
  await join();
  await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
    const controls = window.polycraft.controls, world = controls.onlineWorld, entity = world.players.active.get(hero).hero, life = entity.getEC('ECPlayerLife');
    controls.setAmounts(20, controls.amounts().wood, controls.amounts().stone);
    // Stage a long waiting episode so real menu/reload work cannot exhaust its timer.
    const health = entity.getEC('ECHealth'); health.addHealth(-health.getHealth());
    life.respawnLocation = Array.from(entity.getv3Location()); life.beginRespawn();
    life.scheduleRespawn(Array.from(entity.getv3Location()), 45); life.state = life.states.RESPAWNING;
  }), hero);
  await guest.waitForFunction(() => { const world = window.polycraft.controls.guestWorld; return world.lifeState?.phase === 'waiting' && world.lifeState.option === 'amber' && world.lifeState.affordable; });
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.movement.available()), false);
  await host.evaluate(() => window.polycraft.checkpoint(true));
  assert.equal(saved().players.find(player => player.id === hero).life.phase, 'waiting');
  await end();
  const offline = saved(), record = offline.players.find(player => player.id === hero);
  assert.equal(record.life.phase, 'waiting'); assert.ok(record.life.remaining > 10 && record.life.remaining <= 45); assert.equal(record.health.current, 0);
  assert.equal(offline.economy.softCurrency, 20);
  await reloadHost();
  assert.deepEqual(saved().players.find(player => player.id === hero).life, record.life);
  await click(0, '#multiplayer'); const activeSince = await join();
  await guest.waitForFunction(() => { const world = window.polycraft.controls.guestWorld; return world.lifeState?.phase === 'waiting' && world.lifeState.option === 'amber' && world.lifeState.affordable; });
  const sample = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
    const world = window.polycraft.controls.onlineWorld;
    return { life: world.players.captureLife(world.players.active.get(hero).hero), now: world.game.globals.gameCurrentTime };
  }), hero);
  const restored = sample.life, elapsed = sample.now - activeSince;
  assert.equal(restored.phase, 'waiting'); assert.deepEqual(restored.location, record.life.location);
  assert.equal(restored.lives, record.life.lives); assert.equal(restored.infiniteLives, record.life.infiniteLives);
  assert.ok(restored.remaining > 0 && restored.remaining <= record.life.remaining && restored.remaining >= record.life.remaining - elapsed - 0.25, 'Rejoin must preserve the saved wait within the elapsed host simulation time.');
  console.log('Native waiting timer:', { saved: record.life.remaining, restored: restored.remaining, hostElapsed: elapsed });
  const episode = await guest.evaluate(() => window.polycraft.controls.guestWorld.lifeState.episode);
  await focus(1);
  await guest.waitForFunction(() => { const world = window.polycraft.controls.guestWorld, row = world.game.getGuiManager().prevDrawGuiMap['guest-revive']; return world.movement.nativeFocused && row?.scale > 0.95 && row.archetypeName === 'respawnButtonAmber'; });
  await guest.waitForFunction(() => { const row = window.polycraft.controls.guestWorld.game.getGuiManager().prevDrawGuiMap['guest-revive-message']; return row?.scale > 0.95 && row.archetypeName === 'gameMessage' && row.argumentObject.text1 === 'You have been knocked out' && /^Revive in: \d+ s$/.test(row.argumentObject.text2); });
  await guest.screenshot({ path: 'test-results/session-ui-waiting-revive.png' });
  const point = await guest.evaluate(() => {
    const world = window.polycraft.controls.guestWorld, args = world.game.getGuiManager().prevDrawGuiMap['guest-revive'].argumentObject, bounds = world.movement.canvas.getBoundingClientRect(), device = world.controls.app.globals.graphicsDevice;
    return { x: bounds.left + args.v2ScreenLocation[0] * bounds.width / device.width, y: bounds.top + args.v2ScreenLocation[1] * bounds.height / device.height };
  });
  await guest.mouse.move(point.x, point.y); await guest.waitForFunction(() => window.polycraft.controls.guestWorld.game.getIMGui().isHot('guest-revive'));
  await guest.mouse.click(point.x, point.y, { delay: 100 });
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'revive');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'Revive purchased and saved.');
  assert.equal(saved().economy.softCurrency, 10, 'The paid acknowledgement must follow actual disk persistence.');
  await guest.waitForFunction(() => { const world = window.polycraft.controls.guestWorld; return world.lifeState?.phase === 'normal' && world.movement.available(); });
  await guest.evaluate(episode => {
    const world = window.polycraft.controls.guestWorld; world.lastTargetResult = null;
    world.connection.send('action', { type: 'revive', sequence: ++world.targetSequence, target: world.identity.entity, amber: true, episode });
  }, episode);
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'revive');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'Revive choice changed or resources are unavailable. Wait for a refresh.');
  await host.evaluate(() => window.polycraft.checkpoint(true));
  const revived = saved(), recovered = revived.players.find(player => player.id === hero);
  assert.equal(recovered.life.phase, 'normal'); assert.ok(recovered.health.current > 0);
  assert.equal(recovered.progress.xp, record.progress.xp); assert.equal(revived.economy.softCurrency, 10);
  await guest.screenshot({ path: 'test-results/session-ui-revived.png' });
  await end();
  console.log('PASS: staged waiting guest survives real host save/reload/rejoin, original paid revive charges 10 Amber before acknowledgement, native recovery restores input and duplicate episode cannot charge again; guest solo bytes unchanged.');
  await join();
  const prepaid = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
    const controls = window.polycraft.controls, game = controls.manager(), factory = game.getEntityFactory(), faction = game.getFactionManager().getHeroFactionName();
    const builder = controls.onlineWorld.players.active.get(hero).hero.getEC('ECPlayerBuilder');
    let hq = game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false)[0];
    if (!hq) {
      const position = Array.from(game.getHero().getv3Location()); position[2] += 6;
      hq = factory.createInactiveEntityInstance('TemporaryRestoreHQ', 'a_b_hq', game.placeOnGround(position, 0.5), 0);
      hq.getEC('ECFaction').setFaction(faction); hq.activate();
    }
    if (!controls.amounts().woodCap) {
      const position = Array.from(hq.getv3Location()); position[0] += 6;
      const storage = factory.createInactiveEntityInstance('TemporaryRestoreStorage', 'a_b_lumberstorage', game.placeOnGround(position, 0.5), 0);
      storage.getEC('ECBuilding').setBuildingParentEntity(hq); storage.getEC('ECFaction').setFaction(faction); storage.activate();
    }
    if (!controls.amounts().stoneCap) {
      const position = Array.from(hq.getv3Location()); position[2] += 6;
      const storage = factory.createInactiveEntityInstance('TemporaryRestoreStoneStorage', 'a_b_stonestorage', game.placeOnGround(position, 0.5), 0);
      storage.getEC('ECBuilding').setBuildingParentEntity(hq); storage.getEC('ECFaction').setFaction(faction); storage.activate();
    }
    const archetype = 'a_d_wall', costs = [builder.getBuildingResourceCost(archetype), builder.getBuildingSecondaryResourceCost(archetype), builder.getBuildingSoftCurrencyCost(archetype)];
    if (!costs.every(value => Number.isSafeInteger(value) && value >= 0) || !costs.some(value => value > 0)) throw new Error('Need the original nonzero wall price.');
    const before = controls.setAmounts(Math.max(100, costs[2] * 2), costs[0] * 2, costs[1] * 2);
    if (before.wood < costs[0] || before.stone < costs[1] || costs[0] && before.wood + costs[0] > before.woodCap || costs[1] && before.stone + costs[1] > before.stoneCap) throw new Error('Temporary storage must cover the cost and leave observable refund headroom.');
    builder.placeInHand(archetype, 1, false, false, hq, true); builder.payCost();
    return { archetype, costs, expectedParent: hq.getName(), before, paid: controls.amounts(), held: controls.onlineWorld.players.captureConstruction(controls.onlineWorld.players.active.get(hero).hero) };
  }), hero);
  assert.equal(prepaid.held.parent, prepaid.expectedParent); assert.equal(prepaid.held.archetype, prepaid.archetype); assert.equal(prepaid.held.quantity, 1);
  for (const [index, key] of ['wood', 'stone', 'amber'].entries()) assert.equal(prepaid.paid[key], prepaid.before[key] - prepaid.costs[index]);
  await guest.waitForFunction(archetype => { const held = window.polycraft.controls.guestWorld.construction.placement; return held?.held && held.product.archetype === archetype; }, prepaid.archetype);
  await end();
  const heldSave = saved();
  assert.deepEqual(heldSave.players.find(player => player.id === hero).construction, prepaid.held);
  assert.deepEqual(heldSave.economy.resource, [prepaid.paid.wood, prepaid.paid.stone]); assert.equal(heldSave.economy.softCurrency, prepaid.paid.amber);
  await reloadHost(); await click(0, '#multiplayer'); await join();
  const heldAfterReload = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => window.polycraft.controls.onlineWorld.players.captureConstruction(window.polycraft.controls.onlineWorld.players.active.get(hero).hero)), hero);
  assert.deepEqual(heldAfterReload, prepaid.held);
  await guest.waitForFunction(archetype => { const held = window.polycraft.controls.guestWorld.construction.placement; return held?.held && held.cancelable && held.product.archetype === archetype; }, prepaid.archetype);
  await nativeButton('guest-build-cancel', 'buttonWide', 'test-results/session-ui-restored-held.png');
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'cancelBuild');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'Held building cancelled and saved.');
  assert.deepEqual(saved().economy.resource, [prepaid.before.wood, prepaid.before.stone]); assert.equal(saved().economy.softCurrency, prepaid.before.amber);
  assert.equal(saved().players.find(player => player.id === hero).construction, null);
  await guest.evaluate(archetype => { const world = window.polycraft.controls.guestWorld; world.lastTargetResult = null; world.sendTarget('cancelBuild', world.identity.entity, archetype); }, prepaid.archetype);
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'cancelBuild');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'The held building changed. Wait for a fresh selection.');
  await host.evaluate(() => window.polycraft.checkpoint(true));
  assert.deepEqual(saved().economy.resource, [prepaid.before.wood, prepaid.before.stone]); assert.equal(saved().economy.softCurrency, prepaid.before.amber);
  console.log('Native held cost/refund:', { archetype: prepaid.archetype, parent: prepaid.held.parent, expectedParent: prepaid.expectedParent, costs: prepaid.costs, before: [prepaid.before.wood, prepaid.before.stone, prepaid.before.amber], paid: [prepaid.paid.wood, prepaid.paid.stone, prepaid.paid.amber], afterRepeat: [...saved().economy.resource, saved().economy.softCurrency] });
  await end();
  console.log('PASS: native prepaid held wall and HQ reference survive host reload/rejoin; original cancel UI refunds its real cost once, clears held state on disk and repeat cancellation cannot refund again; guest solo bytes unchanged.');
  await join();
  const moving = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
    const world = window.polycraft.controls.onlineWorld, game = world.game, entity = world.players.active.get(hero).hero;
    const hq = game.getBuildingManager().getBuildingsAtMinLevel('HQ', 1, false)[0];
    const site = game.getTraversableLocationListInRadius(hq.getv3Location(), 12).find(point => game.globals.mathDevice.v3Distance2DSq(point, hq.getv3Location()) >= 64);
    if (!site) throw new Error('Need a traversable temporary storage site.');
    window.SetGameplayFeatureFlag({ globals: game.globals, script: { add: command => command.update() } }, 'buildingMovementEnabled', true);
    const source = game.getEntityFactory().createInactiveEntityInstance('TemporaryMoveStorage', 'a_b_lumberstorage', game.placeOnGround(site, 0.5), 0);
    source.getEC('ECBuilding').setBuildingParentEntity(hq); source.getEC('ECFaction').setFaction(game.getFactionManager().getHeroFactionName()); source.activate();
    if (!game.desktopConstruction.canMove(entity, source) || !game.desktopConstruction.canMove(game.getHero(), source)) throw new Error('Temporary player-built storage must pass native move eligibility.');
    const location = Array.from(source.getv3Location()); location[0] += 3;
    entity.getEC('ECLocomotion').clearDestination(); entity.teleport(location, game.globals.mathDevice.v3Sub(location, entity.getv3Location()));
    return { id: source.getName(), parent: source.getEC('ECBuilding').getBuildingParentEntity().getName(), location: Array.from(source.getv3Location()), health: source.getEC('ECHealth').getHealth(), amounts: window.polycraft.controls.amounts() };
  }), hero);
  await focus(1);
  await guest.locator('#turbulenz_game_engine_canvas').focus();
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.movement.available());
  await guest.waitForFunction(id => {
    const world = window.polycraft.controls.guestWorld, record = world.scene.entities.get(id)?.record;
    if (!record) return false;
    const point = world.controls.app.globals.camera.worldToScreen(record.location), bounds = world.movement.canvas.getBoundingClientRect(), device = world.controls.app.globals.graphicsDevice;
    if (!point) return false;
    const x = point[0] * bounds.width / device.width, y = point[1] * bounds.height / device.height;
    return x > 20 && x < bounds.width - 20 && y > 20 && y < bounds.height - 20 && window.PolycraftCoopActions.pickTarget(world, { clientX: bounds.left + x, clientY: bounds.top + y }) === id;
  }, moving.id);
  const sourcePoint = await guest.evaluate(id => { const world = window.polycraft.controls.guestWorld, point = world.controls.app.globals.camera.worldToScreen(world.scene.entities.get(id).record.location), bounds = world.movement.canvas.getBoundingClientRect(), device = world.controls.app.globals.graphicsDevice; return { x: bounds.left + point[0] * bounds.width / device.width, y: bounds.top + point[1] * bounds.height / device.height }; }, moving.id);
  await guest.mouse.move(sourcePoint.x, sourcePoint.y); await guest.waitForTimeout(150);
  const currentPoint = await guest.evaluate(id => { const world = window.polycraft.controls.guestWorld, point = world.controls.app.globals.camera.worldToScreen(world.scene.entities.get(id).record.location), bounds = world.movement.canvas.getBoundingClientRect(), device = world.controls.app.globals.graphicsDevice; return { x: bounds.left + point[0] * bounds.width / device.width, y: bounds.top + point[1] * bounds.height / device.height }; }, moving.id);
  await guest.mouse.click(currentPoint.x, currentPoint.y, { delay: 100 });
  await guest.evaluate(() => {
    const construction = window.polycraft.controls.guestWorld.construction, receive = construction.receive;
    // Placement previews can replace lastTargetResult before the test polls it.
    construction.moveAcceptanceResults = [];
    construction.receive = function (value, selected) { if (value.type === 'move') this.moveAcceptanceResults.push(structuredClone(value)); return receive.call(this, value, selected); };
  });
  await nativeButton('guest-move-' + moving.id, 'move');
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.construction.moveAcceptanceResults.length);
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.construction.moveAcceptanceResults[0].message), 'Building picked up and saved. Choose a placement.');
  const movingHeld = saved().players.find(player => player.id === hero).construction;
  assert.equal(movingHeld.moveFrom, moving.id); assert.equal(movingHeld.parent, moving.parent); assert.equal(movingHeld.quantity, 1);
  assert.equal(await host.evaluate(id => { const world = window.polycraft.controls.onlineWorld; return world.construction.claimed(world.game.getGameEntityByName(id)); }, moving.id), true);
  await end(); await reloadHost(); await click(0, '#multiplayer'); await join();
  const restoredMove = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => { const world = window.polycraft.controls.onlineWorld, entity = world.players.active.get(hero).hero; return { held: world.players.captureConstruction(entity), source: entity.getEC('ECPlayerBuilder').getMoveFromEntity()?.getName() }; }), hero);
  assert.deepEqual(restoredMove.held, movingHeld); assert.equal(restoredMove.source, moving.id);
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.construction.placement?.held);
  await guest.evaluate(() => { window.polycraft.controls.guestWorld.lastTargetResult = null; });
  await nativeButton('guest-build-cancel', 'buttonWide', 'test-results/session-ui-restored-move.png');
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'cancelBuild');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'Held building cancelled and saved.');
  const unchanged = await host.evaluate(id => window.polycraft.controls.onlineWorld.atBoundary(() => { const world = window.polycraft.controls.onlineWorld, source = world.game.getGameEntityByName(id); return { location: Array.from(source.getv3Location()), health: source.getEC('ECHealth').getHealth(), amounts: window.polycraft.controls.amounts(), claimed: world.construction.claimed(source), moveEligible: world.construction.canMove(world.game.getHero(), source) }; }), moving.id);
  assert.deepEqual(unchanged.location, moving.location); assert.equal(unchanged.health, moving.health); assert.deepEqual(unchanged.amounts, moving.amounts); assert.equal(unchanged.claimed, false);
  console.log('Restored move cancellation:', { id: moving.id, parent: moving.parent, ...unchanged });
  assert.equal(saved().players.find(player => player.id === hero).construction, null);
  assert.deepEqual(saved().economy.resource, [moving.amounts.wood, moving.amounts.stone]); assert.equal(saved().economy.softCurrency, moving.amounts.amber);
  await end();
  console.log('PASS: original storage Move/Cancel UI and source/HQ references survive real host reload/rejoin; offline/live claim protection, unchanged source location/health/capacity/economy and guest solo bytes verified.');
};
