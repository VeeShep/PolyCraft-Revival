'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function lifeAcceptance({ host, guest, hero, port, saveFile, guestFile, click, focus, connection, reloadHost }) {
  const saved = () => JSON.parse(JSON.parse(fs.readFileSync(saveFile)).state.userData.desktopCoop);
  let solo, soloBytes;
  async function join() {
    await focus(0); await host.locator('#connection-method').selectOption('direct');
    if (!await host.locator('#direct-settings').evaluate(node => node.open)) await click(0, '#direct-settings > summary');
    await host.locator('#direct-address').fill('127.0.0.1'); await host.locator('#direct-port').fill(String(port));
    assert.equal(await host.locator('#direct-upnp').isChecked(), false);
    await connection(0, '#host-island', true);
    await host.waitForFunction(() => !!window.polycraft.controls.onlineWorld?.players);
    const started = await host.evaluate(() => window.polycraft.controls.onlineWorld.atBoundary(() => window.polycraft.controls.app.globals.gameCurrentTime));
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
};
