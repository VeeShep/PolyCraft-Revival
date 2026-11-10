'use strict';
const assert = require('node:assert/strict');

module.exports = async function clickGround(guest, location) {
  const project = ({ location, exact }) => {
    const w = window.guestWorld, g = w.controls.app.globals, hero = w.scene.entities.get(w.identity.entity);
    const position = hero.displayLocation || hero.record.location;
    const b = w.movement.canvas.getBoundingClientRect(), attempts = [];
    for (const fraction of exact ? [1] : [1, .5, .25, .125, .0625]) {
      const target = [position[0] + (location[0] - position[0]) * fraction, position[1], position[2] + (location[2] - position[2]) * fraction];
      const screen = g.camera.worldToScreen(target);
      attempts.push({ target, screen: screen && Array.from(screen) });
      if (!screen) continue;
      const x = screen[0] * b.width / g.graphicsDevice.width, y = screen[1] * b.height / g.graphicsDevice.height;
      if (x > 100 && x < b.width - 300 && y > 100 && y < b.height - 100) {
        const event = { clientX: b.left + x, clientY: b.top + y };
        const picked = window.PolycraftCoopActions.pickTarget(w, event);
        attempts[attempts.length - 1].picked = picked;
        if (!picked) return { point: { x: event.clientX, y: event.clientY, location: target, fraction } };
      }
    }
    const gui = w.game.getIMGui();
    const canTurn = w.movement.available() && !gui.hasCapturedInput() && !['guest-shop', 'guest-pause', 'guest-fullscreen', 'guest-skip-prepare'].some(id => gui.isHot(id));
    return { point: null, canTurn, position: Array.from(position), bounds: { width: b.width, height: b.height }, device: { width: g.graphicsDevice.width, height: g.graphicsDevice.height }, attempts };
  };
  let projection, cameraTurns;
  for (cameraTurns = 0; cameraTurns <= 4; cameraTurns++) {
    // Aim after the existing camera/UI settling delay.
    await guest.waitForTimeout(150);
    await guest.waitForFunction(tolerance => {
      const camera = window.guestWorld.viewCamera.camera, delta = camera.baseAngle - camera.desiredBaseAngle;
      return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < tolerance &&
        ['Position', 'Focus'].every(name => {
          const current = camera['currentV3' + name], desired = camera['desiredV3' + name];
          return Math.hypot(current[0] - desired[0], current[1] - desired[1], current[2] - desired[2]) < .01;
        }) &&
        Math.abs(camera.currentFOV - camera.desiredFOV) < tolerance;
    }, .001, { timeout: 5000 });
    projection = await guest.evaluate(project, { location });
    if (projection.point || !projection.canTurn || cameraTurns === 4) break;
    await guest.keyboard.down('ArrowLeft');
    try { await guest.waitForTimeout(500); } finally { await guest.keyboard.up('ArrowLeft'); }
  }
  let point = projection.point;
  assert.ok(point, 'The walking waypoint must be visible and clear of the original HUD: ' + JSON.stringify(projection));
  let before, aims;
  for (aims = 1; aims <= 3; aims++) {
    await guest.mouse.move(point.x, point.y);
    const read = location => {
      const w = window.guestWorld, cursor = w.construction.cursor(), gui = w.game.getIMGui();
      const available = w.movement.available(), captured = gui.hasCapturedInput(), hot = ['guest-shop', 'guest-pause', 'guest-fullscreen', 'guest-skip-prepare'].filter(id => gui.isHot(id));
      const target = window.PolycraftCoopActions.pickTarget(w, w.pointerEvent), distance = cursor && Math.hypot(cursor[0] - location[0], cursor[2] - location[2]);
      return { sequence: w.movement.sequence, available, captured, hot, target, cursor, distance, tick: w.scene.tick, baseAngle: w.viewCamera?.camera?.baseAngle, desiredBaseAngle: w.viewCamera?.camera?.desiredBaseAngle,
        ready: available && !captured && !hot.length && !target && cursor && distance < 0.1 };
    };
    before = await guest.evaluate(read, point.location);
    if (before.available && before.captured && !before.hot.length && !before.target) {
      await guest.waitForTimeout(50);
      before = await guest.evaluate(read, point.location);
    }
    if (before.ready || !before.available || before.captured || before.hot.length || before.target || !before.cursor || !Number.isFinite(before.distance) || aims === 3) break;
    // The view may still translate after rotation settles; re-aim before sending any action.
    projection = await guest.evaluate(project, { location: point.location, exact: true });
    if (!projection.point) break;
    point = { ...projection.point, fraction: point.fraction };
  }
  assert.ok(before.ready, 'The walking click must hit empty ground at the waypoint with normal input available: ' + JSON.stringify({ projection, cameraTurns, aims, before }));
  await guest.mouse.click(point.x, point.y, { delay: 100 });
  await guest.waitForFunction(sequence => window.guestWorld.movement.sequence > sequence && window.guestWorld.movement.walkRequested, before.sequence, { timeout: 5000 });
  return { point, location: point.location, cameraTurns, aims, sequenceBefore: before.sequence };
};
