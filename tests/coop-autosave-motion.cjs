'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { installSaveTiming } = require('./save-timing.cjs');

function installMotionFrames() {
  const audit = { frames: [], running: true };
  let previous;
  const frame = time => {
    if (!audit.running) return;
    if (previous !== undefined && audit.frames.length < 8000) audit.frames.push({ time: Date.now(), milliseconds: time - previous });
    previous = time; requestAnimationFrame(frame);
  };
  window.autosaveMotionFrames = audit; requestAnimationFrame(frame);
}
function verifyMotion(result) {
  assert.equal(result.participants, 4);
  const saves = result.timing.records.filter(row => row.phase === 'checkpoint');
  assert.ok(saves.length > 0, 'Observe the unchanged normal autosave timer, without triggering a manual save.');
  assert.ok(result.distance > 4, 'Ordinary guest movement must cover actual ground.');
  assert.ok(result.timing.status.some(row => row.text === 'Saving…'));
  assert.ok(result.timing.status.some(row => row.text.startsWith('Saved locally at')));
  for (const save of saves) assert.ok(result.inputs.some(input => input.startedAt < save.endedAt && input.endedAt > save.startedAt), 'An autosave must overlap an actual held guest movement key.');
  assert.ok(result.timing.frames.length && result.guestFrames.length);
}
module.exports = async function autosaveMotion({ host, guest, hero, focus, directory }) {
  const route = await host.evaluate(hero => {
    const w = window.hostWorld, game = w.game, actor = w.players.active.get(hero).hero;
    const starter = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECCampaignStarter')).find(entity => window.PolycraftCampaign.campaignContext(game, entity, w.controls)?.view.campaign === 'campaign_tutorial_01');
    if (!starter) throw new Error('The original earned banner must supply a safe native navigation route.');
    return game.getNavManager().getEntityToEntityPath(actor, starter, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true).getWaypointList().slice(0, 2).map(point => Array.from(point));
  }, hero);
  assert.equal(route.length, 2); assert.ok(Math.hypot(route[1][0] - route[0][0], route[1][2] - route[0][2]) > 4);
  await focus(); await host.evaluate(installSaveTiming); await guest.evaluate(installMotionFrames);
  const result = { scope: 'Normal 30-second autosave during ordinary focused guest WASD movement; no timer or world edits, no manual Save now call. Frame samples include scheduling and rendering.', route, inputs: [], positions: [], distance: 0 };
  let held, input, target = 1, previous;
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const sample = await host.evaluate(hero => { const w = window.hostWorld; return { time: Date.now(), location: Array.from(w.players.active.get(hero).hero.getv3Location()), tick: w.game.gameClock.getFrameIndex() }; }, hero);
      result.positions.push(sample);
      if (previous) result.distance += Math.hypot(sample.location[0] - previous[0], sample.location[2] - previous[2]);
      previous = sample.location;
      if (Math.hypot(sample.location[0] - route[target][0], sample.location[2] - route[target][2]) < .8) target = 1 - target;
      const key = await guest.evaluate(location => {
        const w = window.guestWorld;
        if (!document.hasFocus() || !w.movement.available()) throw new Error('Moving autosave test lost native guest input availability.');
        const p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix, dx = location[0] - p[0], dz = location[2] - p[2];
        const right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8];
        return Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's';
      }, route[target]);
      if (key !== held) {
        if (held) { input.endedAt = Date.now(); await guest.keyboard.up(held); }
        held = key; input = { key, startedAt: null }; result.inputs.push(input); await guest.keyboard.down(key); input.startedAt = Date.now();
      }
      await guest.waitForTimeout(200);
    }
    if (held) { input.endedAt = Date.now(); await guest.keyboard.up(held); held = null; }
    await host.waitForFunction(() => window.saveTiming.records.some(row => row.phase === 'checkpoint') && window.saveTiming.status.some(row => row.text.startsWith('Saved locally at')));
    await guest.screenshot({ path: path.join(directory, 'guest-moving-autosave.png'), timeout: 5000 });
  } finally {
    if (held) { input.endedAt = Date.now(); await guest.keyboard.up(held).catch(() => {}); }
    result.participants = await host.evaluate(() => window.hostWorld.players.active.size).catch(() => null);
    result.timing = await host.evaluate(() => { const s = window.saveTiming; const data = { records: s.records, frames: s.frames, frameIntervals: s.frameIntervals, status: s.status, simulationGaps: s.simulationGaps }; s.restore(); return data; }).catch(error => ({ unavailable: error.message }));
    result.guestFrames = await guest.evaluate(() => { const audit = window.autosaveMotionFrames; audit.running = false; delete window.autosaveMotionFrames; return audit.frames; }).catch(() => []);
    fs.writeFileSync(path.join(directory, 'moving-autosave-timing.json'), JSON.stringify(result, null, 2));
  }
  verifyMotion(result);
  console.log('PASS: normal autosave overlaps original guest movement with four players:', JSON.stringify({ distance: result.distance, saves: result.timing.records.filter(row => row.phase === 'checkpoint'), maxHostFrame: Math.max(...result.timing.frames), maxGuestFrame: Math.max(...result.guestFrames.map(row => row.milliseconds)), maxSimulationGap: Math.max(...result.timing.simulationGaps) }));
};
module.exports.installMotionFrames = installMotionFrames;
module.exports.verifyMotion = verifyMotion;
