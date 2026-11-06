'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalResources({ host, guest, focus, button, hero, hostFile }) {
  await button('guest-idAcceptTaskRewardButtontaskIdcrit_5');
  await guest.waitForFunction(() => window.guestWorld.quests.state?.tasks.some(task => task.task === 'chopATree'));
  const target = await host.evaluate(hero => {
    const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero;
    const trees = game.getGameSpaceList().flatMap(space => space.getEntitiesWithFamilyName('tree')).filter(entity => entity.getEC('ECResourceDispenser')?.getResource() > 0 && entity.getEC('ECInteractable')?.getActive());
    trees.sort((a, b) => a.getDistanceUsingSize(actor.getv3Location()) - b.getDistanceUsingSize(actor.getv3Location()));
    for (const tree of trees) {
      const path = game.getNavManager().getEntityToEntityPath(actor, tree, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
      if (!path) continue;
      window.naturalWoodEvents = []; window.naturalWoodDepletions = [];
      const interact = event => { if (event.resourceDispenser === tree) window.naturalWoodEvents.push({ amount: event.amount, interactor: event.interactor.getName() }); };
      const deplete = event => window.naturalWoodDepletions.push({ hero: event.hero.getName(), type: event.resourceType });
      game.eventManager.subscribe('InteractWithResourceDispenser', interact); game.eventManager.subscribe('ResourceDispsenserDepletedByHero', deplete);
      window.restoreNaturalWoodObservers = () => { game.eventManager.unsubscribe('InteractWithResourceDispenser', interact); game.eventManager.unsubscribe('ResourceDispsenserDepletedByHero', deplete); };
      return { id: tree.getName(), actor: actor.getName(), location: Array.from(tree.getv3Location()), resource: tree.getEC('ECResourceDispenser').getResource(), route: path.getWaypointList().map(point => Array.from(point)),
        approach: tree.getEC('ECInteractable').shouldApproachOnUp(actor), pickupRadius: game.getEntityFactory().getECArchetype('a_r_lumber', 'ECPickup').attractRadius,
        otherCarried: [...world.players.active].filter(([id]) => id !== hero).map(([id, entry]) => ({ id, carried: world.players.captureHero(entry.hero).inventory.carried })) };
    }
    throw new Error('No reachable original tree is available.');
  }, hero);
  console.log('Natural guest wood target:', target);
  try {
    await focus();
    let waypoint = Math.min(1, target.route.length - 1), ready = false;
    for (let step = 0; step < 300; step++) {
      ready = await host.evaluate(({ hero, target }) => { const world = window.hostWorld, actor = world.players.active.get(hero).hero, tree = world.game.getGameEntityByName(target.id); return tree.getDistanceUsingSize(actor.getv3Location()) <= (target.approach ? actor.getRadius() + 0.45 : target.pickupRadius); }, { hero, target });
      if (ready) break;
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
    assert.equal(ready, true, 'The guest must walk into the original interaction/wood-pickup area.');
    await guest.waitForTimeout(1000);
    let clicks = 0;
    for (; clicks < 80; clicks++) {
      if (await host.evaluate(() => window.hostWorld.game.getPlayerData().getTaskFlags().chopATree === true)) break;
      const point = await guest.evaluate(id => {
        const w = window.guestWorld, entry = w.scene.entities.get(id), g = w.controls.app.globals, p = g.camera.worldToScreen(entry.displayLocation || entry.record.location), b = w.movement.canvas.getBoundingClientRect();
        return { x: b.left + p[0] * b.width / g.graphicsDevice.width, y: b.top + p[1] * b.height / g.graphicsDevice.height, sequence: w.lastTargetResult?.sequence || 0 };
      }, target.id);
      await guest.mouse.move(point.x, point.y); await guest.waitForTimeout(150);
      assert.equal(await guest.evaluate(point => window.PolycraftCoopActions.pickTarget(window.guestWorld, { clientX: point.x, clientY: point.y }), point), target.id);
      await guest.mouse.click(point.x, point.y, { delay: 100 });
      await guest.waitForFunction(sequence => window.guestWorld.lastTargetResult?.sequence > sequence, point.sequence, { timeout: 5000 });
      assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Resources gathered.');
    }
    await guest.waitForTimeout(500);
    for (let step = 0; step < 80; step++) {
      const pickup = await host.evaluate(hero => {
        const w = window.hostWorld, actor = w.players.active.get(hero).hero;
        if (actor.getEC('ECResourceCarrier').getResource(0) > 0) return { collected: true };
        const drops = w.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).filter(entity => !entity.shouldBeDestroyed() && entity.getEC('ECPickup').archetype.carriedResource[0] > 0 && entity.getEC('ECPickup').collectorName === undefined);
        drops.sort((a, b) => a.getDistanceUsingSize(actor.getv3Location()) - b.getDistanceUsingSize(actor.getv3Location()));
        return { collected: false, location: drops[0] && Array.from(drops[0].getv3Location()) };
      }, hero);
      if (pickup.collected) break;
      if (!pickup.location) { await guest.waitForTimeout(200); continue; }
      const key = await guest.evaluate(location => {
        const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix;
        const dx = location[0] - p[0], dz = location[2] - p[2], right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8];
        return Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's';
      }, pickup.location);
      await guest.keyboard.down(key);
      try { await guest.waitForTimeout(100); } finally { await guest.keyboard.up(key); }
      await guest.waitForTimeout(100);
    }
    const result = await host.evaluate(async ({ hero, target }) => {
      const w = window.hostWorld, actor = w.players.active.get(hero).hero, tree = w.game.getGameEntityByName(target);
      await window.polycraft.checkpoint(true);
      return { complete: w.game.getPlayerData().getTaskFlags().chopATree, scripts: w.game.runScripts, remaining: tree?.getEC('ECResourceDispenser').getResource() || 0,
        inventory: w.players.captureHero(actor).inventory, events: window.naturalWoodEvents, depletions: window.naturalWoodDepletions,
        otherCarried: [...w.players.active].filter(([id]) => id !== hero).map(([id, entry]) => ({ id, carried: w.players.captureHero(entry.hero).inventory.carried })) };
    }, { hero, target: target.id });
    console.log('Original guest tree depletion:', JSON.stringify({ clicks, result }));
    assert.equal(result.complete, true); assert.equal(result.scripts, true); assert.equal(result.remaining, 0);
    assert.ok(result.events.some(event => event.interactor === target.actor && event.amount > 0));
    assert.ok(result.depletions.some(event => event.hero === target.actor && event.type === 0));
    assert.ok(result.inventory.carried[0] > 0, 'The guest must collect native dropped wood into its own inventory.');
    assert.deepEqual(result.otherCarried, target.otherCarried);
    await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'chopATree');
    const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state, coop = JSON.parse(state.userData.desktopCoop);
    assert.equal(state.cheats.everEnabled, false); assert.equal(JSON.parse(state.userData.taskFlags).chopATree, true);
    assert.deepEqual(coop.players.find(player => player.id === hero).inventory, result.inventory);
    assert.ok(JSON.parse(state.userData.desktopQuests).pending.some(task => task.task === 'chopATree'));
    console.log('Native guest tree depletion, carried wood, shared pending reward and clean history saved.');
  } finally { await host.evaluate(() => window.restoreNaturalWoodObservers()).catch(() => {}); }
};
