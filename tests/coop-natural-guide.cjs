'use strict';
const assert = require('node:assert/strict');
const clickGround = require('./coop-ground-click.cjs');

module.exports = async function naturalGuide({ host, guest, hero, focus }) {
  const setup = await host.evaluate(hero => {
    const w = window.hostWorld, game = w.game, actor = w.players.active.get(hero).hero;
    const guide = game.getNearestGameEntityByFamilyName('mapbannerling', actor.getv3Location());
    if (!guide) throw new Error('The original tunnel guide must exist.');
    const hut = game.getBuildingManager().getBuildingsAtMinLevel('Defendling Hut', 1, false)[0];
    const route = game.getNavManager().getEntityToEntityPath(actor, guide, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
    return { guide: guide.getName(), hut: hut.getName(), complete: !!game.getPlayerData().getTaskFlags().goToCaves, canMove: w.construction.canMove(actor, hut),
      route: route?.getWaypointList().map(point => Array.from(point)),
      others: [...w.players.active].filter(([id]) => id !== hero).map(([id, entry]) => ({ id, location: Array.from(entry.hero.getv3Location()), distance: Math.sqrt(game.globals.mathDevice.v3DistanceSq(entry.hero.getv3Location(), game.getNearestGameEntityByFamilyName('mapbannerling', entry.hero.getv3Location()).getv3Location())) })) };
  }, hero);
  assert.equal(setup.complete, false, 'The proximity quest must not already be complete.');
  assert.equal(setup.canMove, false, 'Original building movement must still be locked.');
  assert.ok(setup.others.every(row => row.distance >= 15), 'Only the walking guest may enter an original guide trigger.');
  assert.ok(setup.route?.length, 'The native navigator must supply a route to the tunnel guide.');
  console.log('Original tunnel journey setup:', JSON.stringify(setup));
  await focus();
  const bounds = await guest.locator('#turbulenz_game_engine_canvas').boundingBox();
  await guest.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .35);
  let waypoint = Math.min(1, setup.route.length - 1), commandedLocation = null, after, previousPosition, stalled = 0;
  for (let step = 0; step < 400; step++) {
    after = await host.evaluate(({ hero, setup, destination }) => {
      const w = window.hostWorld, game = w.game, actor = w.players.active.get(hero).hero, position = actor.getv3Location();
      return { complete: !!game.getPlayerData().getTaskFlags().goToCaves, canMove: w.construction.canMove(actor, game.getGameEntityByName(setup.hut)),
        distance: Math.sqrt(game.globals.mathDevice.v3DistanceSq(position, game.getGameEntityByName(setup.guide).getv3Location())),
        waypointDistance: Math.hypot(position[0] - destination[0], position[2] - destination[2]), position: Array.from(position),
        moving: actor.getEC('ECLocomotion').hasDestination(), nativeDestination: actor.getEC('ECLocomotion').getDestination() && Array.from(actor.getEC('ECLocomotion').getDestination()),
        onPath: actor.getEC('ECNav').isOnPath(),
        others: setup.others.map(row => ({ id: row.id, location: Array.from(w.players.active.get(row.id).hero.getv3Location()) })) };
    }, { hero, setup, destination: setup.route[waypoint] });
    if (after.complete) break;
    stalled = previousPosition && Math.hypot(after.position[0] - previousPosition[0], after.position[2] - previousPosition[2]) < .03 ? stalled + 1 : 0;
    previousPosition = after.position;
    assert.equal(await guest.evaluate(() => !!window.guestWorld.movement.available()), true, 'Normal guest movement and focus must remain available.');
    if (after.waypointDistance < .65 && waypoint < setup.route.length - 1) { waypoint++; commandedLocation = null; continue; }
    if (!commandedLocation || !after.moving || stalled >= 8 || Math.hypot(after.position[0] - commandedLocation[0], after.position[2] - commandedLocation[2]) < .65) {
      const click = await clickGround(guest, setup.route[waypoint]);
      console.log('Normal tunnel waypoint click:', JSON.stringify({ step, waypoint, stalled, before: after, click }));
      commandedLocation = click.location; stalled = 0;
    }
    if (step % 25 === 0) console.log('Normal guest tunnel approach:', JSON.stringify({ step, waypoint, ...after }));
    await guest.waitForTimeout(200);
  }
  assert.equal(after.complete, true, 'Ordinary guest navigation must finish the original proximity script.');
  assert.ok(after.distance < 15, 'The guest must cross the strict native three-dimensional trigger.');
  assert.equal(after.canMove, true, 'The original script must unlock building movement.');
  for (const row of setup.others) {
    const position = after.others.find(other => other.id === row.id).location;
    assert.ok(Math.hypot(position[0] - row.location[0], position[2] - row.location[2]) < .01, 'Other heroes must remain behind.');
  }
  console.log('PASS: normal guest movement reaches the tunnel guide and completes the original shared quest/unlocks movement while other heroes remain behind:', JSON.stringify({ setup, after }));
};
