'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

module.exports = async function naturalDefence(context) {
  const { host, guest, hero, focus, hostFile, directory } = context;
  await focus();
  const button = async id => {
    await focus();
    await guest.waitForFunction(id => window.guestWorld.game.getGuiManager().prevDrawGuiMap[id]?.scale > .95, id);
    const point = await guest.evaluate(id => {
      const w = window.guestWorld, a = w.game.getGuiManager().prevDrawGuiMap[id].argumentObject, p = a.v2ScreenLocation || [a.x, a.y], b = w.movement.canvas.getBoundingClientRect(), d = w.controls.app.globals.graphicsDevice;
      return { x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
    }, id);
    await guest.mouse.move(point.x, point.y); await guest.waitForFunction(id => window.guestWorld.game.getIMGui().isHot(id), id);
    await guest.mouse.click(point.x, point.y, { delay: 100 });
  };
  const sample = () => host.evaluate(hero => window.hostWorld.atRewardBoundary(() => {
    const w = window.hostWorld, data = w.players.active.get(hero).hero.getEC('ECPlayerData');
    return { xp: data.getXP(), level: data.getLevel(), points: data.getUpgradePoints(), hostXP: w.game.getPlayerData().getXP(), amber: data.getSoftCurrency(), tick: w.game.gameClock.getFrameIndex(),
      pickups: w.game.getGameSpaceList().flatMap(s => s.getEntitiesWithEC('ECPickup')).map(e => e.getName()) };
  }), hero);
  const observation = await host.evaluate(() => {
    const w = window.hostWorld, ledger = w.game.desktopQuestRewards, award = ledger.award, own = Object.hasOwn(ledger, 'award');
    const trace = window.naturalDefenceAwards = [];
    ledger.award = function (id, hero) {
      const record = this.data.pending.find(row => row.id === id), definition = record && this.manager.taskArchetypes[record.task];
      const result = award.apply(this, arguments);
      if (result) trace.push({ id, task: record.task, xp: definition.xpReward, amber: definition.amberReward, actor: (hero || w.game.getHero()).getName(), explicitHero: !!hero });
      return result;
    };
    window.restoreNaturalDefenceAwards = () => { if (own) ledger.award = award; else delete ledger.award; delete window.naturalDefenceAwards; delete window.restoreNaturalDefenceAwards; };
    return true;
  });
  assert.equal(observation, true);
  let campaign, outcome, campaignAuditInstalled = false;
  try {
    if (context.campaignOnly) { await host.evaluate(require('./coop-campaign-audit.cjs')); campaignAuditInstalled = true; }
    const tasks = context.campaignOnly ? [['startCampaign', { campaignStart: true }], ['winCampaign', { campaignFinish: true }]] : context.gatlingOnly ? [['buildGatling', { gatling: true }], ['speedUpGatling', { speedup: true, gatling: true }]] : context.gateOnly ? [['buildGate', { gate: true }]] : context.barricadeOnly ? [['buildBarricade', { barricade: true }]] : context.moveOutpost ? [['moveBuilding', { move: true }]] : context.speedupOnly ? [] : context.outpostOnly ? [['buildOutpost', { outpost: true }]] : [['buildDefenceFactory', { defenceFactory: true }], ['buildDefendlingHut', { worker: 'war' }], ['goToCaves', null], ['buildOutpost', { outpost: true }]];
    if (context.speedupOutpost) tasks.push(['speedUpOutpost', { speedup: true }]);
    for (const [task, options] of tasks) {
      await guest.waitForFunction(task => window.guestWorld.quests.state?.tasks.some(row => row.task === task), task);
      const initial = await sample();
      const campaignTask = options?.campaignStart || options?.campaignFinish;
      if (options?.campaignStart) campaign = await require('./coop-natural-campaign.cjs')({ ...context, button });
      else if (options?.campaignFinish) outcome = await require('./coop-natural-campaign.cjs')({ ...context, button, campaign, finish: true });
      else if (options?.move) await require('./coop-natural-move.cjs')({ ...context, button });
      else if (options?.speedup) await require('./coop-natural-speedup.cjs')({ ...context, button, ...options });
      else if (options) await require('./coop-natural-building.cjs')({ ...context, button, ...options });
      else await require('./coop-natural-guide.cjs')(context);
      const before = await sample();
      if (!campaignTask) assert.equal(before.xp, initial.xp);
      if (campaignTask) await guest.waitForFunction(task => window.guestWorld.quests.state?.visible && window.guestWorld.quests.state.completed?.task === task, task);
      const reward = await guest.evaluate(() => window.guestWorld.quests.state.completed);
      assert.equal(reward.task, task);
      const expected = await host.evaluate(task => window.hostWorld.game.getTaskManager().taskArchetypes[task], task);
      assert.equal(expected.xpReward, task === 'winCampaign' ? 300 : 20); assert.equal(expected.amberReward, 1);
      await button('guest-idAcceptTaskRewardButton' + reward.id);
      await guest.waitForFunction(id => window.guestWorld.quests.state?.completed?.id !== id, reward.id);
      const drops = await host.evaluate(({ old, campaignTask, reward }) => {
        if (campaignTask) return window.nativeCampaignAudit.quests.find(row => row.id === reward).drops.map(row => row.id);
        return window.hostWorld.game.getGameSpaceList().flatMap(s => s.getEntitiesWithEC('ECPickup')).filter(e => {
        const p = e.getEC('ECPickup');
        return !old.includes(e.getName()) && !e.shouldBeDestroyed() && (p.xp > 0 || p.archetype.softCurrency > 0);
      }).map(e => e.getName());
      }, { old: before.pickups, campaignTask: !!campaignTask, reward: reward.id });
      const bounds = await guest.locator('#turbulenz_game_engine_canvas').boundingBox();
      await guest.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .35);
      for (let step = 0; step < 80; step++) {
        const state = await host.evaluate(({ hero, drops, xp, amber, campaignTask, reward }) => {
          const w = window.hostWorld, actor = w.players.active.get(hero).hero, data = actor.getEC('ECPlayerData'), position = actor.getv3Location();
          const pending = window.PolycraftCoopPlayers.CoopPlayers.hasPendingRewards(w.game, actor);
          const given = campaignTask && window.nativeCampaignAudit.quests.find(row => row.id === reward)?.drops;
          if ((campaignTask ? given?.length && given.every(row => row.grants.length === 1) : data.getXP() === xp && data.getSoftCurrency() === amber) && !pending) return { done: true };
          const pickup = drops.map(id => w.game.getGameEntityByName(id)).find(e => e && !e.shouldBeDestroyed() && !e.getEC('ECPickup').getCollectorName());
          return pickup ? { location: Array.from(pickup.getv3Location()), distance: Math.hypot(position[0] - pickup.getv3Location()[0], position[2] - pickup.getv3Location()[2]) } : { waiting: true };
        }, { hero, drops, xp: before.xp + expected.xpReward, amber: before.amber + expected.amberReward, campaignTask: !!campaignTask, reward: reward.id });
        if (state.done) break;
        if (state.waiting) { await guest.waitForTimeout(100); continue; }
        assert.ok(state.distance < 10, 'The original scattered quest reward must be nearby.');
        const keys = await guest.evaluate(location => {
          const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix, dx = location[0] - p[0], dz = location[2] - p[2];
          const right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8], size = Math.max(Math.abs(right), Math.abs(forward));
          return [...(Math.abs(right) > size * .4 ? [right > 0 ? 'd' : 'a'] : []), ...(Math.abs(forward) > size * .4 ? [forward > 0 ? 'w' : 's'] : [])];
        }, state.location);
        try { await guest.waitForFunction(() => window.guestWorld.movement.available() && !window.guestWorld.game.getIMGui().hasCapturedInput(), null, { timeout: 5000 }); }
        catch (error) {
          console.log('Natural reward input diagnostics:', JSON.stringify(await guest.evaluate(() => {
            const w = window.guestWorld;
            return { focused: document.hasFocus(), active: document.activeElement?.id, nativeFocused: w.movement.nativeFocused, available: !!w.movement.available(), captured: w.game.getIMGui().hasCapturedInput(), localMenu: w.localMenu(), paused: w.controls.paused,
              life: w.lifeState, construction: { menu: w.construction.menu, placement: w.construction.placement }, selected: w.selectedBuilding, quest: w.quests.state, hud: w.hud.state };
          })));
          await guest.screenshot({ path: path.join(directory, 'guest-natural-defence-input-failure.png') }); throw error;
        }
        const held = [];
        try { for (const key of keys) { await guest.keyboard.down(key); held.push(key); } await guest.waitForTimeout(100); }
        finally { for (const key of held) await guest.keyboard.up(key); }
        await guest.waitForTimeout(100);
      }
      const after = await sample();
      if (campaignTask) {
        const audit = await host.evaluate(id => window.nativeCampaignAudit.quests.find(row => row.id === id), reward.id);
        assert.equal(audit.drops.reduce((sum, row) => sum + row.xp, 0), expected.xpReward); assert.equal(audit.drops.reduce((sum, row) => sum + row.amber, 0), expected.amberReward);
        for (const drop of audit.drops) { assert.equal(drop.grants.length, 1); const grant = drop.grants[0]; assert.equal(grant.player, hero); assert.equal(grant.after.xp - grant.before.xp, drop.xp); assert.equal(grant.after.amber - grant.before.amber, drop.amber); }
        assert.ok(after.xp >= before.xp + expected.xpReward);
      } else { assert.equal(after.xp, before.xp + expected.xpReward); assert.equal(after.hostXP, before.hostXP); assert.equal(after.amber, before.amber + expected.amberReward); }
      assert.ok(after.tick > before.tick);
      await guest.waitForFunction(({ xp, campaignTask }) => { const hud = window.guestWorld.hud; return (campaignTask ? hud.state?.xp >= xp : hud.state?.xp === xp) && Math.abs(hud.data.getVisibleXP() - hud.state.xp) < .01; }, { xp: after.xp, campaignTask: !!campaignTask });
      await host.evaluate(() => window.polycraft.checkpoint(true));
      const state = JSON.parse(fs.readFileSync(hostFile)).state, party = JSON.parse(state.userData.desktopCoop);
      if (campaignTask) assert.ok(party.players.find(p => p.id === hero).progress.xp >= after.xp); else assert.equal(party.players.find(p => p.id === hero).progress.xp, after.xp); assert.equal(state.cheats.everEnabled, false);
      assert.ok(!JSON.parse(state.userData.desktopQuests).pending.some(task => task.task === reward.task));
      await guest.screenshot({ path: path.join(directory, 'guest-natural-' + task + '.png') });
      console.log('PASS: original guest ' + task + ' construction and native quest reward earn' + expected.xpReward + 'XP/1Amber without progression assignments:', JSON.stringify({ initial, before, after, reward, drops }));
    }
    if (!context.campaignOnly) {
      await host.waitForFunction(() => window.hostWorld.game.getBuildingManager().getBuildingsAtMinLevel('Defendling Hut', 1, false).some(hut => {
        const worker = hut.getEC('ECWildlingHouse')?.getWildling(); return worker && !worker.shouldBeDestroyed();
      }), null, { timeout: 15000 });
      console.log('PASS: the original completed Defendling Hut spawned its native worker.');
    }
    if (context.campaignOnly) { const audit = await host.evaluate(() => window.nativeCampaignAudit); assert.deepEqual(audit.errors, []); assert.equal(audit.overflow, false); assert.equal(audit.claims.length, 1); const kills = audit.kills.filter(row => row.critical); assert.ok(kills.length > 0 && kills.length <= 14); assert.equal(new Set(kills.map(row => row.victim)).size, kills.length); assert.equal(audit.waves.length, 1); const wave = audit.waves[0]; assert.equal(wave.spawned.length, 14); assert.equal(wave.completed, true); assert.equal(wave.remaining, 0); assert.equal(wave.nextWave, wave.waveCount); return outcome; }
  } finally {
    if (campaignAuditInstalled) {
      const audit = await host.evaluate(() => { const audit = window.nativeCampaignAudit; window.restoreNativeCampaignAudit?.(); return audit; }).catch(error => ({ unavailable: error.message }));
      console.log('Natural campaign pickup/event audit:', JSON.stringify(audit));
      try { fs.writeFileSync(path.join(directory, 'natural-campaign-audit.json'), JSON.stringify(audit, null, 2)); } catch (error) { console.log('Campaign audit file unavailable:', error.message); }
      await guest.screenshot({ path: path.join(directory, 'guest-natural-campaign-final.png'), timeout: 5000 }).catch(() => {});
    }
    const awards = await host.evaluate(() => { const trace = window.naturalDefenceAwards; window.restoreNaturalDefenceAwards?.(); return trace; }).catch(error => ({ unavailable: error.message }));
    console.log('Original natural progression reward audit:', JSON.stringify(awards));
  }
};
