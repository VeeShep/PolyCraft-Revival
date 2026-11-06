'use strict';
const assert = require('node:assert/strict');

module.exports = async function campaignAcceptance({ host, guest, hero, join, end, nativeButton, selectTarget }) {
  await join();
  const campaign = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
    const world = window.polycraft.controls.onlineWorld, game = world.game, owner = game.getHero().getGameSpace().getEntitiesWithEC('ECWarManager')[0], war = owner.getEC('ECWarManager');
    const [region, record] = Object.entries(war.campaignRegionMap).find(([, record]) => record.campaignStarterEntity && !record.campaignStarterEntity.shouldBeDestroyed());
    const source = record.campaignStarterEntity;
    window.SetGameplayFeatureFlag({ globals: game.globals, script: { add: command => command.update() } }, 'campaignsEnabled', true);
    game.enableCampaignRegion(region);
    if (!game.getGameEntitiesByFamilyName('outpost').some(entity => !entity.shouldBeDestroyed())) {
      const location = Array.from(source.getv3Location()); location[0] += 6;
      const outpost = game.getEntityFactory().createInactiveEntityInstance('TemporaryCampaignOutpost', 'a_b_outpost', game.placeOnGround(location, 0.5), 0);
      outpost.getEC('ECFaction').setFaction(game.getFactionManager().getHeroFactionName()); outpost.activate();
    }
    const entity = world.players.active.get(hero).hero, location = Array.from(source.getv3Location()); location[0] += 3;
    entity.getEC('ECLocomotion').clearDestination(); entity.teleport(game.placeOnGround(location, 0.5));
    window.campaignAcceptanceEvents = { started: 0, closed: 0, invaded: 0 };
    for (const [event, key] of [['CampaignStarted', 'started'], ['CampaignPrepareScreenExited', 'closed'], ['InvasionStarted', 'invaded']]) game.eventManager.subscribe(event, () => window.campaignAcceptanceEvents[key]++);
    return { source: source.getName(), region, campaign: war.getCampaignArchetypeName(region), before: window.polycraft.controls.amounts() };
  }), hero);
  async function open() {
    await selectTarget(campaign.source);
    await guest.waitForFunction(source => window.polycraft.controls.guestWorld.campaign.menu?.source === source, campaign.source);
    assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.campaign.menu.campaign), campaign.campaign);
  }
  async function panelButton(art) {
    await guest.waitForFunction(art => Object.entries(window.polycraft.controls.guestWorld.game.getGuiManager().prevDrawGuiMap).some(([id, row]) => id.startsWith('guest-campaign-') && row.archetypeName === art), art);
    const id = await guest.evaluate(art => Object.entries(window.polycraft.controls.guestWorld.game.getGuiManager().prevDrawGuiMap).find(([id, row]) => id.startsWith('guest-campaign-') && row.archetypeName === art)[0], art);
    await nativeButton(id, art);
  }
  await open();
  const menuTick = await host.evaluate(() => window.polycraft.controls.onlineWorld.game.gameClock.getFrameIndex());
  await host.waitForFunction(tick => window.polycraft.controls.onlineWorld.game.gameClock.getFrameIndex() > tick + 15, menuTick);
  await guest.screenshot({ path: 'test-results/session-ui-campaign-preview.png' });
  await panelButton('infoPanelCloseButton');
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'campaignClose');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'Campaign preview closed.');
  assert.deepEqual(await host.evaluate(() => window.campaignAcceptanceEvents), { started: 0, closed: 1, invaded: 0 });
  assert.deepEqual(await host.evaluate(() => window.polycraft.controls.amounts()), campaign.before);
  await open(); await panelButton('infoPanelUpgradeButton');
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'campaignStart');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'Campaign started and saved.');
  assert.deepEqual(await host.evaluate(() => window.campaignAcceptanceEvents), { started: 1, closed: 2, invaded: 0 });
  assert.equal(await host.evaluate(() => window.polycraft.controls.onlineWorld.game.getPlayState().playStateName), 'PlayStatePrepareForBattle');
  await guest.evaluate(campaign => { const world = window.polycraft.controls.guestWorld; world.lastTargetResult = null; world.campaign.send('campaignStart', campaign); }, campaign);
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'campaignStart');
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'That campaign preview changed. Select the banner again.');
  await nativeButton('guest-pause', 'pause');
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.pauseMenu);
  await host.waitForFunction(() => window.polycraft.controls.onlineWorld.game.getPlayState().playStateName === 'PlayStateBattle', null, { timeout: 15000 });
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.pauseMenu), true);
  assert.deepEqual(await host.evaluate(() => window.campaignAcceptanceEvents), { started: 1, closed: 2, invaded: 1 });
  await guest.screenshot({ path: 'test-results/session-ui-campaign-pause.png' });
  await nativeButton('guest-resume', 'buttonStart');
  console.log('Original guest campaign:', { ...campaign, events: await host.evaluate(() => window.campaignAcceptanceEvents) });
  await end();
  console.log('PASS: original guest campaign preview/cancel/confirm controls and native preparation-to-battle transition; duplicate start refused, guest Pause menu stays open while host countdown advances and guest solo bytes remain unchanged.');
};
