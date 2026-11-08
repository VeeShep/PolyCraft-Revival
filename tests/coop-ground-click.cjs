'use strict';
const assert = require('node:assert/strict');

module.exports = async function clickGround(guest, location) {
  const projection = await guest.evaluate(location => {
    const w = window.guestWorld, g = w.controls.app.globals, hero = w.scene.entities.get(w.identity.entity);
    const position = hero.displayLocation || hero.record.location;
    const b = w.movement.canvas.getBoundingClientRect(), attempts = [];
    for (const fraction of [1, .5, .25, .125, .0625]) {
      const target = [position[0] + (location[0] - position[0]) * fraction, position[1], position[2] + (location[2] - position[2]) * fraction];
      const screen = g.camera.worldToScreen(target);
      attempts.push({ target, screen: screen && Array.from(screen) });
      if (!screen) continue;
      const x = screen[0] * b.width / g.graphicsDevice.width, y = screen[1] * b.height / g.graphicsDevice.height;
      if (x > 100 && x < b.width - 300 && y > 100 && y < b.height - 100) return { point: { x: b.left + x, y: b.top + y, location: target, fraction } };
    }
    return { point: null, position: Array.from(position), bounds: { width: b.width, height: b.height }, device: { width: g.graphicsDevice.width, height: g.graphicsDevice.height }, attempts };
  }, location);
  const point = projection.point;
  assert.ok(point, 'The walking waypoint must be visible and clear of the original HUD: ' + JSON.stringify(projection));
  await guest.mouse.move(point.x, point.y);
  await guest.waitForTimeout(150);
  const before = await guest.evaluate(location => {
    const w = window.guestWorld, cursor = w.construction.cursor(), gui = w.game.getIMGui();
    return { sequence: w.movement.sequence, ready: w.movement.available() && !gui.hasCapturedInput() && !['guest-shop', 'guest-pause', 'guest-fullscreen', 'guest-skip-prepare'].some(id => gui.isHot(id)) &&
      !window.PolycraftCoopActions.pickTarget(w, w.pointerEvent) && cursor && Math.hypot(cursor[0] - location[0], cursor[2] - location[2]) < 0.1 };
  }, point.location);
  assert.ok(before.ready, 'The walking click must hit empty ground at the waypoint with normal input available.');
  await guest.mouse.click(point.x, point.y, { delay: 100 });
  await guest.waitForFunction(sequence => window.guestWorld.movement.sequence > sequence && window.guestWorld.movement.walkRequested, before.sequence, { timeout: 5000 });
  return { point, location: point.location, sequenceBefore: before.sequence };
};
