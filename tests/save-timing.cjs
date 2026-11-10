'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
function installSaveTiming() {
  const controls = window.polycraft.controls, game = controls.manager(), records = [], frames = [], status = [], restores = [];
  let running = true, previous, previousTick, unchangedSince;
  const simulationGaps = [];
  const observe = (object, key) => {
    const original = object[key], own = Object.hasOwn(object, key);
    object[key] = function (...args) {
      const start = performance.now(), done = () => records.push({ phase: key, milliseconds: performance.now() - start });
      try {
        const value = original.apply(this, args);
        if (value && typeof value.then === 'function') value.then(done, done); else done();
        return value;
      } catch (error) { done(); throw error; }
    };
    restores.push(() => { if (own) object[key] = original; else delete object[key]; });
  };
  observe(controls, 'checkpoint'); observe(controls, 'writeCheckpoint'); observe(game, 'saveLevel');
  if (game.desktopPlayers) observe(game.desktopPlayers, 'capture');
  const element = document.getElementById('status'), observer = new MutationObserver(() => status.push({ time: performance.now(), text: element.textContent }));
  observer.observe(element, { childList: true, subtree: true, characterData: true });
  const frame = time => {
    if (!running) return;
    if (previous !== undefined) frames.push(time - previous);
    const tick = game.gameClock?.getFrameIndex();
    if (tick !== previousTick) { if (unchangedSince !== undefined) simulationGaps.push(time - unchangedSince); unchangedSince = time; previousTick = tick; }
    previous = time; requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.saveTiming = { records, frames, status, simulationGaps, restore() { running = false; observer.disconnect(); restores.reverse().forEach(restore => restore()); delete window.saveTiming; } };
}
module.exports = async function saveTiming({ page, directory, activeHost = false }) {
  for (const online of activeHost ? [true] : [false, true]) {
    if (online && !activeHost) await page.evaluate(async () => {
      const controls = window.polycraft.controls;
      window.saveTimingSession = new window.PolycraftMultiplayer.HostSession({ pvp: false });
      window.saveTimingWorld = await window.PolycraftOnlineWorld.startHostingWorld(controls, window.saveTimingSession);
      await window.saveTimingWorld.enablePlayers(window.polycraft.bridge);
    });
    await page.evaluate(installSaveTiming);
    try {
      await page.waitForTimeout(500);
      const baseline = await page.evaluate(() => window.saveTiming.frames.splice(0));
      const samples = [];
      for (let index = 0; index < 3; index++) {
        await page.evaluate(() => { window.saveTiming.records.length = window.saveTiming.frames.length = window.saveTiming.status.length = window.saveTiming.simulationGaps.length = 0; });
        await page.locator('#save-now').click();
        await page.waitForFunction(() => window.saveTiming.status.some(row => row.text.startsWith('Saved locally at')));
        await page.waitForTimeout(200);
        const sample = await page.evaluate(() => ({ records: window.saveTiming.records, frames: window.saveTiming.frames, status: window.saveTiming.status, simulationGaps: window.saveTiming.simulationGaps }));
        assert.ok(sample.records.some(row => row.phase === 'saveLevel'));
        const start = sample.status.find(row => row.text === 'Saving…'), end = sample.status.find(row => row.text.startsWith('Saved locally at'));
        assert.ok(start && end); sample.totalMilliseconds = end.time - start.time; samples.push(sample);
      }
      const participants = await page.evaluate(() => window.polycraft.controls.onlineWorld?.players?.active.size || 1);
      const result = { online, participants, scope: 'Three original Save now clicks; nested capture spans must not be added together; simulation gaps are sampled at rendered frames.', baselineFrames: baseline, samples };
      fs.writeFileSync(path.join(directory, online ? 'online-save-timing.json' : 'solo-save-timing.json'), JSON.stringify(result, null, 2) + '\n');
      console.log('Save timing:', JSON.stringify({ online, samples: samples.map(sample => ({ total: sample.totalMilliseconds, maxFrame: Math.max(...sample.frames), maxSimulationGap: Math.max(...sample.simulationGaps), records: sample.records })) }));
    } finally { await page.evaluate(() => window.saveTiming?.restore()); }
  }
  if (!activeHost) await page.evaluate(() => window.saveTimingWorld.close());
};
module.exports.installSaveTiming = installSaveTiming;
