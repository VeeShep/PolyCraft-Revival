'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

module.exports = async function naturalResources({ host, guest, focus, button, hero, hostFile, stone = false, combined = false, gatherOnly = false }) {
  const resource = stone ? 1 : 0, task = combined ? 'mineStoneAndLumber' : stone ? 'mineAStone' : 'chopATree';
  if (!gatherOnly && !combined) await button('guest-idAcceptTaskRewardButtontaskIdcrit_' + (stone ? 7 : 5));
  if (!gatherOnly) await guest.waitForFunction(task => window.guestWorld.quests.state?.tasks.some(row => row.task === task), task);
  const target = await host.evaluate(({ hero, resource }) => {
    const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero;
    const trees = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName(resource === 0 ? 'tree' : 'rock')).filter(entity => entity.getEC('ECResourceDispenser')?.getResource() > 0 && entity.getEC('ECInteractable')?.getActive());
    trees.sort((a, b) => a.getDistanceUsingSize(actor.getv3Location()) - b.getDistanceUsingSize(actor.getv3Location()));
    for (const tree of trees) {
      const path = game.getNavManager().getEntityToEntityPath(actor, tree, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
      if (!path) continue;
      window.naturalResourceEvents = []; window.naturalResourceDepletions = [];
      const interact = event => { if (event.resourceDispenser === tree) window.naturalResourceEvents.push({ amount: event.amount, interactor: event.interactor.getName() }); };
      const deplete = event => window.naturalResourceDepletions.push({ hero: event.hero.getName(), type: event.resourceType });
      game.eventManager.subscribe('InteractWithResourceDispenser', interact); game.eventManager.subscribe('ResourceDispsenserDepletedByHero', deplete);
      window.restoreNaturalResourceObservers = () => { game.eventManager.unsubscribe('InteractWithResourceDispenser', interact); game.eventManager.unsubscribe('ResourceDispsenserDepletedByHero', deplete); };
      return { id: tree.getName(), actor: actor.getName(), location: Array.from(tree.getv3Location()), resource: tree.getEC('ECResourceDispenser').getResource(), route: path.getWaypointList().map(point => Array.from(point)),
        minimumCarry: game.getEntityFactory().getECArchetype(resource === 0 ? 'a_b_lumbermill' : 'a_b_stonemill', 'ECBuilding')[resource === 0 ? 'resourceCost' : 'secondaryResourceCost'], approach: tree.getEC('ECInteractable').shouldApproachOnUp(actor), pickupRadius: game.getEntityFactory().getECArchetype(resource === 0 ? 'a_r_lumber' : 'a_r_stone', 'ECPickup').attractRadius,
        otherCarried: [...world.players.active].filter(([id]) => id !== hero).map(([id, entry]) => ({ id, carried: world.players.captureHero(entry.hero).inventory.carried })) };
    }
    throw new Error('No reachable original resource is available.');
  }, { hero, resource });
  console.log('Natural guest ' + task + ' target:', target);
  const targetPoint = () => guest.evaluate(id => {
    const w = window.guestWorld, entry = w.scene.entities.get(id), g = w.controls.app.globals, p = g.camera.worldToScreen(entry.displayLocation || entry.record.location), b = w.movement.canvas.getBoundingClientRect();
    const x = p[0] * b.width / g.graphicsDevice.width, y = p[1] * b.height / g.graphicsDevice.height;
    return { x: b.left + x, y: b.top + y, clear: x > 100 && x < b.width - 300 && y > 100 && y < b.height - 100, sequence: w.lastTargetResult?.sequence || 0 };
  }, target.id);
  try {
    await guest.evaluate(require('./coop-input-trace.cjs'));
    await focus();
    let waypoint = Math.min(1, target.route.length - 1), ready = false;
    for (let step = 0; step < 300; step++) {
      // Non-approach resources still need framing clear of the HUD for an actual canvas click.
      ready = await host.evaluate(({ hero, target }) => { const world = window.hostWorld, actor = world.players.active.get(hero).hero, tree = world.game.getGameEntityByName(target.id); return tree.getDistanceUsingSize(actor.getv3Location()) <= (target.approach ? actor.getRadius() + 0.45 : 8); }, { hero, target });
      if (ready && (await targetPoint()).clear) break;
      ready = false;
      const next = await guest.evaluate(location => {
        const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix;
        const dx = location[0] - p[0], dz = location[2] - p[2], right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8], largest = Math.max(Math.abs(right), Math.abs(forward));
        return { distance: Math.hypot(dx, dz), keys: [...(Math.abs(right) > largest * 0.4 ? [right > 0 ? 'd' : 'a'] : []), ...(Math.abs(forward) > largest * 0.4 ? [forward > 0 ? 'w' : 's'] : [])] };
      }, target.route[waypoint]);
      if (next.distance < 0.65 && waypoint < target.route.length - 1) { waypoint++; continue; }
      for (const key of next.keys) await guest.keyboard.down(key);
      try { await guest.waitForTimeout(100); } finally { for (const key of next.keys) await guest.keyboard.up(key); }
      await guest.waitForTimeout(100);
    }
    assert.ok(ready, 'The guest must bring the resource into view, approaching only when required by its original interaction rule.');
    await guest.waitForTimeout(1000);
    let clicks = 0;
    for (; clicks < 80; clicks++) {
      if (await host.evaluate(id => !(window.hostWorld.game.getGameEntityByName(id)?.getEC('ECResourceDispenser').getResource() > 0), target.id)) break;
      const point = await targetPoint();
      assert.ok(point.clear, 'The resource click must be visibly inside the canvas and clear of the resource HUD.');
      await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150);
      assert.equal(await guest.evaluate(point => window.PolycraftCoopActions.pickTarget(window.guestWorld, { clientX: point.x, clientY: point.y }), point), target.id);
      await guest.mouse.click(point.x, point.y, { delay: 100 });
      try {
        await guest.waitForFunction(sequence => window.guestWorld.lastTargetResult?.sequence > sequence, point.sequence, { timeout: 5000 });
      } catch (error) {
        try {
          console.log('Resource click failure:', JSON.stringify({ clicks, target: target.id, point, guest: await guest.evaluate(() => {
            const w = window.guestWorld;
            return { focused: document.hasFocus(), nativeFocused: w.movement.nativeFocused, available: w.movement.available(), paused: w.controls.paused, resyncing: w.resyncing, closed: w.connection.closed,
              tick: w.scene.tick, targetSequence: w.targetSequence, result: w.lastTargetResult, selectionRequest: w.selectionRequest, captured: w.game.getIMGui().hasCapturedInput(), guiInput: { down: w.guiInput.down, pendingDown: w.guiInput.pendingDown, position: w.guiInput.position },
              description: w.quests.description?.taskId, questPending: w.quests.pending, questOpenRequest: w.quests.openRequest, menu: !!w.construction.menu, placement: !!w.construction.placement, inputTrace: w.resourceInputTrace?.events };
          }), host: await host.evaluate(({ hero, target }) => {
            const w = window.hostWorld, actor = w.players.active.get(hero).hero, entity = w.game.getGameEntityByName(target);
            return { actor: Array.from(actor.getv3Location()), remaining: entity?.getEC('ECResourceDispenser').getResource(), scripts: w.game.runScripts, tick: w.game.gameClock.getFrameIndex() };
          }, { hero, target: target.id }) }));
          await guest.screenshot({ path: path.join(path.dirname(hostFile), '..', 'resource-click-failure.png') });
        } catch (diagnosticError) { console.log('Resource click diagnostics unavailable:', diagnosticError.message); }
        throw error;
      }
      assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Resources gathered.');
    }
    await guest.waitForTimeout(500);
    const pickupTrace = [];
    for (let step = 0; step < 80; step++) {
      const pickup = await host.evaluate(({ hero, minimum, resource }) => {
        const w = window.hostWorld, actor = w.players.active.get(hero).hero;
        if (actor.getEC('ECResourceCarrier').getResource(resource) >= minimum) return { collected: true };
        const drops = w.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).filter(entity => !entity.shouldBeDestroyed() && entity.getEC('ECPickup').archetype.carriedResource[resource] > 0 && entity.getEC('ECPickup').collectorName === undefined);
        drops.sort((a, b) => a.getDistanceUsingSize(actor.getv3Location()) - b.getDistanceUsingSize(actor.getv3Location()));
        return { collected: false, actor: Array.from(actor.getv3Location()), drop: drops[0]?.getName(), location: drops[0] && Array.from(drops[0].getv3Location()) };
      }, { hero, minimum: target.minimumCarry, resource });
      if (pickup.collected) break;
      if (!pickup.location) { await guest.waitForTimeout(200); continue; }
      const view = await guest.evaluate(location => {
        const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix;
        const dx = location[0] - p[0], dz = location[2] - p[2], right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8];
        return { key: Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's', available: w.movement.available(), focused: document.hasFocus(), nativeFocused: w.movement.nativeFocused, paused: w.controls.paused, tick: w.scene.tick };
      }, pickup.location);
      pickupTrace.push({ step, ...pickup, ...view });
      await guest.keyboard.down(view.key);
      try { await guest.waitForTimeout(100); } finally { await guest.keyboard.up(view.key); }
      await guest.waitForTimeout(100);
    }
    console.log('Native pickup walking trace:', JSON.stringify(pickupTrace.filter((_, index) => index < 4 || index >= pickupTrace.length - 12)));
    const result = await host.evaluate(async ({ hero, target, task }) => {
      const w = window.hostWorld, actor = w.players.active.get(hero).hero, tree = w.game.getGameEntityByName(target);
      await window.polycraft.checkpoint(true);
      return { complete: w.game.getPlayerData().getTaskFlags()[task], scripts: w.game.runScripts, remaining: tree?.getEC('ECResourceDispenser').getResource() || 0,
        inventory: w.players.captureHero(actor).inventory, events: window.naturalResourceEvents, depletions: window.naturalResourceDepletions,
        otherCarried: [...w.players.active].filter(([id]) => id !== hero).map(([id, entry]) => ({ id, carried: w.players.captureHero(entry.hero).inventory.carried })) };
    }, { hero, target: target.id, task });
    console.log('Original guest ' + task + ' depletion:', JSON.stringify({ clicks, result }));
    if (result.inventory.carried[resource] < target.minimumCarry) console.log('Native pickup failure state:', JSON.stringify(await host.evaluate(({ hero, resource }) => {
      const w = window.hostWorld, actor = w.players.active.get(hero).hero, carrier = actor.getEC('ECResourceCarrier'), location = actor.getv3Location();
      return { actor: Array.from(location), tick: w.game.gameClock.getFrameIndex(), full: carrier.isFull(resource), inbound: carrier.hasAnyInboundResource(), flying: carrier.hasAnyFlyingResource(),
        drops: w.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).filter(entity => !entity.shouldBeDestroyed() && entity.getEC('ECPickup').archetype.carriedResource[resource] > 0).map(entity => {
          const pickup = entity.getEC('ECPickup'), p = entity.getv3Location();
          let route = null, routeError;
          try { route = w.game.getNavManager().getEntityToEntityPath(actor, entity, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true)?.getWaypointList().map(point => Array.from(point)); }
          catch (error) { routeError = error.message; }
          return { id: entity.getName(), location: Array.from(p), distance2D: Math.hypot(p[0] - location[0], p[2] - location[2]), radius: pickup.archetype.attractRadius,
            collector: pickup.getCollectorName() || null, animatedIn: !!pickup.animatedIn, managed: pickup.isManagedByThisMachine(), flying: !!pickup.flyingTween, route, routeError };
        }) };
    }, { hero, resource })));
    if (!gatherOnly) assert.equal(result.complete === true, !combined || stone);
    assert.equal(result.scripts, true); assert.equal(result.remaining, 0);
    assert.ok(result.events.some(event => event.interactor === target.actor && event.amount > 0));
    assert.ok(result.depletions.some(event => event.hero === target.actor && event.type === resource));
    assert.ok(result.inventory.carried[resource] >= target.minimumCarry, 'The guest must collect native dropped resources into its own inventory.');
    assert.deepEqual(result.otherCarried, target.otherCarried);
    if (!gatherOnly && (!combined || stone)) await guest.waitForFunction(task => window.guestWorld.quests.state?.completed?.task === task, task);
    const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state, coop = JSON.parse(state.userData.desktopCoop);
    assert.equal(state.cheats.everEnabled, false);
    if (!gatherOnly) assert.equal(JSON.parse(state.userData.taskFlags)[task] === true, !combined || stone);
    assert.deepEqual(coop.players.find(player => player.id === hero).inventory, result.inventory);
    if (!gatherOnly) assert.equal(JSON.parse(state.userData.desktopQuests).pending.some(row => row.task === task), !combined || stone);
    console.log('Native guest ' + (gatherOnly ? 'independent resource' : task) + ' depletion, carried resources and clean history saved.');
  } finally {
    await guest.evaluate(() => window.guestWorld?.resourceInputTrace?.restore()).catch(() => {});
    await host.evaluate(() => window.restoreNaturalResourceObservers()).catch(() => {});
  }
};
