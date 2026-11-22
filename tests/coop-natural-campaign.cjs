'use strict';
const assert = require('node:assert/strict'), path = require('node:path');

module.exports = async function naturalCampaign({ host, guest, hero, focus, focusHost, directory, finish = false, campaign }) {
  const keysTo = location => guest.evaluate(location => {
    const w = window.guestWorld, p = w.scene.entities.get(w.identity.entity).record.location, m = w.controls.app.globals.camera.matrix;
    const dx = location[0] - p[0], dz = location[2] - p[2], right = dx * m[0] + dz * m[2], forward = -dx * m[6] - dz * m[8];
    return Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's';
  }, location);
  const walkStep = async location => { const key = await keysTo(location); await guest.keyboard.down(key); try { await guest.waitForTimeout(150); } finally { await guest.keyboard.up(key); } await guest.waitForTimeout(100); };
  const select = async id => {
    await focus();
    const point = await guest.evaluate(id => {
      const w = window.guestWorld, entry = w.scene.entities.get(id), g = w.controls.app.globals, b = w.movement.canvas.getBoundingClientRect();
      if (!entry || !w.movement.available() || w.game.getIMGui().hasCapturedInput()) return null;
      const p = g.camera.worldToScreen(entry.displayLocation || entry.record.location);
      if (!p) return null;
      const x = b.left + p[0] * b.width / g.graphicsDevice.width, y = b.top + p[1] * b.height / g.graphicsDevice.height;
      if (x < b.left + 100 || x > b.right - 200 || y < b.top + 100 || y > b.bottom - 100) return null;
      return { x, y, target: window.PolycraftCoopActions.pickTarget(w, { clientX: x, clientY: y }) };
    }, id);
    if (!point || point.target !== id) return false;
    await guest.mouse.move(point.x, point.y);
    if (!await guest.evaluate(({ x, y, id }) => window.guestWorld.movement.available() && !window.guestWorld.game.getIMGui().hasCapturedInput() && window.PolycraftCoopActions.pickTarget(window.guestWorld, { clientX: x, clientY: y }) === id, { ...point, id })) return false;
    await guest.mouse.click(point.x, point.y); return true;
  };
  const panel = async (page, focused, isGuest, art) => {
    await focused(); await page.locator('#turbulenz_game_engine_canvas').focus();
    const argument = { isGuest, art };
    await page.waitForFunction(({ isGuest, art }) => {
      const game = isGuest ? window.guestWorld.game : window.hostWorld.game;
      return Object.entries(game.getGuiManager().prevDrawGuiMap).some(([id, row]) => (!isGuest || id.startsWith('guest-campaign-')) && row.archetypeName === art && row.scale > .95);
    }, argument);
    const read = () => page.evaluate(({ isGuest, art }) => {
      const game = isGuest ? window.guestWorld.game : window.hostWorld.game, controls = window.polycraft.controls;
      const [id, row] = Object.entries(game.getGuiManager().prevDrawGuiMap).find(([id, row]) => (!isGuest || id.startsWith('guest-campaign-')) && row.archetypeName === art && row.scale > .95);
      const p = row.argumentObject.v2ScreenLocation || [row.argumentObject.x, row.argumentObject.y], b = document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect(), d = controls.app.globals.graphicsDevice;
      return { id, x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
    }, argument);
    let point = await read(), stable = 0;
    for (let step = 0; step < 30 && stable < 3; step++) { await page.waitForTimeout(100); const next = await read(); stable = Math.hypot(next.x - point.x, next.y - point.y) < .5 ? stable + 1 : 0; point = next; }
    assert.equal(stable, 3, 'The native campaign button must finish its animation.');
    await page.mouse.move(point.x, point.y); await page.waitForFunction(({ isGuest, id }) => (isGuest ? window.guestWorld.game : window.hostWorld.game).getIMGui().isHot(id), { isGuest, id: point.id });
    await page.mouse.click(point.x, point.y, { delay: 100 });
  };
  if (!finish) {
    campaign = await host.evaluate(hero => {
      const w = window.hostWorld, game = w.game, actor = w.players.active.get(hero).hero;
      const candidates = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECCampaignStarter')).map(entity => ({ entity, context: window.PolycraftCampaign.campaignContext(game, entity, w.controls) })).filter(row => row.context?.view.campaign === 'campaign_tutorial_01');
      candidates.sort((a, b) => a.entity.getDistanceUsingSize(actor.getv3Location()) - b.entity.getDistanceUsingSize(actor.getv3Location()));
      const candidate = candidates[0]; if (!candidate) throw new Error('The earned original tutorial campaign banner is not eligible.');
      const route = game.getNavManager().getEntityToEntityPath(actor, candidate.entity, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
      return { ...candidate.context.view, location: Array.from(candidate.entity.getv3Location()), route: route?.getWaypointList().map(point => Array.from(point)) };
    }, hero);
    assert.ok(campaign.route?.length, 'The native navigator must supply the campaign route.');
    console.log('Earned native campaign route:', JSON.stringify(campaign)); await focus();
    let waypoint = Math.min(1, campaign.route.length - 1), reached = false;
    for (let step = 0; step < 400; step++) {
      const position = await host.evaluate(hero => Array.from(window.hostWorld.players.active.get(hero).hero.getv3Location()), hero);
      if (Math.hypot(position[0] - campaign.location[0], position[2] - campaign.location[2]) < 4) { reached = true; break; }
      if (step % 25 === 0) console.log('Natural banner approach:', JSON.stringify({ step, waypoint, position }));
      const next = campaign.route[waypoint]; if (Math.hypot(position[0] - next[0], position[2] - next[2]) < .65 && waypoint < campaign.route.length - 1) { waypoint++; continue; }
      await walkStep(next);
    }
    assert.equal(reached, true, 'Ordinary movement must reach the original banner.');
    const open = async () => { assert.equal(await select(campaign.source), true, 'The original banner must be selectable.'); await guest.waitForFunction(source => window.guestWorld.campaign.menu?.source === source, campaign.source); };
    await open(); const tick = await host.evaluate(() => window.hostWorld.game.gameClock.getFrameIndex());
    await host.waitForFunction(tick => window.hostWorld.game.gameClock.getFrameIndex() > tick + 15, tick);
    await guest.screenshot({ path: path.join(directory, 'guest-natural-campaign-preview.png'), timeout: 5000 });
    await panel(guest, focus, true, 'infoPanelCloseButton'); await guest.waitForFunction(() => window.guestWorld.lastTargetResult?.type === 'campaignClose');
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Campaign preview closed.');
    assert.equal(await host.evaluate(() => window.nativeCampaignAudit.events.filter(row => row.event === 'CampaignStarted').length), 0);
    assert.equal(await host.evaluate(() => !!window.hostWorld.game.getPlayerData().getTaskFlags().startCampaign), false);
    await open(); await panel(guest, focus, true, 'infoPanelUpgradeButton');
    await guest.waitForFunction(() => window.guestWorld.lastTargetResult?.type === 'campaignStart');
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Campaign started and saved.');
    assert.equal(await host.evaluate(() => window.nativeCampaignAudit.events.filter(row => row.event === 'CampaignStarted').length), 1);
  }
  if (finish) {
    const outcome = campaign.outcome;
    assert.ok(outcome?.score.wasVictory, 'A real victory must precede the host score claim.');
    await host.waitForFunction(() => window.hostWorld.game.activeGameState.name === 'GamestateCampaignScore');
    await panel(host, focusHost, false, 'infoPanelUpgradeButton');
    await host.waitForFunction(() => !window.hostWorld.game.desktopCampaignRewards.current() && window.hostWorld.game.activeGameState.name === 'GamestatePlaying');
    const claims = await host.evaluate(() => window.nativeCampaignAudit.claims); assert.equal(claims.length, 1); assert.deepEqual(claims[0].score, outcome.score);
    assert.equal(claims[0].after.xp - claims[0].before.xp, outcome.score.xpBonus);
    assert.deepEqual(claims[0].after.resource, claims[0].before.resource.map((amount, index) => Math.round(Math.max(0, Math.min(amount + outcome.score.resourceBonusList[index], claims[0].before.cap[index])))));
    const followingCampaign = await host.evaluate(region => window.hostWorld.game.getHero().getGameSpace().getEntitiesWithEC('ECWarManager')[0].getEC('ECWarManager').getCampaignArchetypeName(region), campaign.region);
    await focus(); return { ...outcome, region: campaign.region, followingCampaign };
  }
  assert.equal(campaign.campaign, 'campaign_tutorial_01');
  const deadline = Date.now() + 240000; let outcome, loggedAt = 0;
  while (Date.now() < deadline) {
    const state = await host.evaluate(({ hero, region }) => {
      const w = window.hostWorld, game = w.game, reward = game.desktopCampaignRewards.current();
      if (reward) return { reward };
      const actor = w.players.active.get(hero).hero, war = game.getHero().getGameSpace().getEntitiesWithEC('ECWarManager')[0].getEC('ECWarManager'), wave = war.campaignRegionMap[region].currentAttackWaveManager?.getEC('ECAttackWavesManager');
      window.observeNativeCampaignWave(wave);
      const enemies = (wave?.spawnedEntityList || []).filter(entity => !entity.shouldBeDestroyed() && entity.getEC('ECHealth').getHealth() > 0);
      enemies.sort((a, b) => a.getDistanceUsingSize(actor.getv3Location()) - b.getDistanceUsingSize(actor.getv3Location())); const enemy = enemies[0];
      const route = enemy && actor.getEC('ECHealth').getHealth() > 0 && game.getNavManager().getEntityToEntityPath(actor, enemy, actor.getEC('ECFaction').getFactionName(), actor.getEC('ECNav').getMaxNavigableHeight(), true);
      return { enemy: enemy?.getName(), waypoint: route?.getWaypointList()[Math.min(1, route.getWaypointList().length - 1)] && Array.from(route.getWaypointList()[Math.min(1, route.getWaypointList().length - 1)]), health: actor.getEC('ECHealth').getHealth() };
    }, { hero, region: campaign.region });
    if (state.reward) { outcome = state.reward; break; }
    if (Date.now() - loggedAt > 5000) { console.log('Natural campaign combat:', JSON.stringify(state)); loggedAt = Date.now(); }
    if (!await guest.evaluate(() => window.guestWorld.movement.available())) { await guest.waitForTimeout(200); continue; }
    if (state.enemy && await select(state.enemy)) await guest.waitForTimeout(1000);
    else if (state.waypoint && state.health > 0) await walkStep(state.waypoint);
    else await guest.waitForTimeout(200);
  }
  assert.ok(outcome, 'The original campaign must reach an independently recorded outcome.');
  console.log('Natural authored campaign outcome:', JSON.stringify(outcome)); assert.equal(outcome.campaign, campaign.campaign); assert.equal(outcome.score.wasVictory, true, 'Natural gameplay must actually win; a score-screen exit alone is insufficient.');
  await guest.waitForFunction(() => window.guestWorld.campaign.result?.score.wasVictory === true);
  await guest.screenshot({ path: path.join(directory, 'guest-natural-campaign-victory.png'), timeout: 5000 });
  await panel(guest, focus, true, 'infoPanelUpgradeButton'); await guest.waitForFunction(() => !window.guestWorld.campaign.result);
  assert.equal(await host.evaluate(() => window.nativeCampaignAudit.claims.length), 0);
  assert.equal(await host.evaluate(() => window.nativeCampaignAudit.events.filter(row => row.event === 'CampaignScoreScreenExited').length), 0);
  return { ...campaign, outcome };
};
