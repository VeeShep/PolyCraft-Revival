'use strict';
const assert = require('node:assert/strict');

module.exports = async function campaignAcceptance({ host, guest, hero, join, end, nativeButton, selectTarget, click, saved, reloadHost }) {
  await join();
  const campaign = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
    const world = window.polycraft.controls.onlineWorld, game = world.game, owner = game.getHero().getGameSpace().getEntitiesWithEC('ECWarManager')[0], war = owner.getEC('ECWarManager');
    const [region, record] = Object.entries(war.campaignRegionMap).find(([, record]) => record.campaignStarterEntity && !record.campaignStarterEntity.shouldBeDestroyed());
    const source = record.campaignStarterEntity;
    window.SetGameplayFeatureFlag({ globals: game.globals, script: { add: command => command.update() } }, 'campaignsEnabled', true);
    game.enableCampaignRegion(region);
    game.enableAttacks();
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
  await host.waitForFunction(region => {
    const game = window.polycraft.controls.onlineWorld.game, war = game.getHero().getGameSpace().getEntitiesWithEC('ECWarManager')[0].getEC('ECWarManager');
    return war.campaignRegionMap[region].currentAttackWaveManager?.getEC('ECAttackWavesManager').spawnedEntityList.some(entity => !entity.shouldBeDestroyed());
  }, campaign.region, { timeout: 15000 });
  async function observeMovement() {
    const before = await host.evaluate(region => window.polycraft.controls.onlineWorld.atBoundary(() => {
      const game = window.polycraft.controls.onlineWorld.game, war = game.getHero().getGameSpace().getEntitiesWithEC('ECWarManager')[0].getEC('ECWarManager');
      const entity = war.campaignRegionMap[region].currentAttackWaveManager.getEC('ECAttackWavesManager').spawnedEntityList.find(entity => !entity.shouldBeDestroyed());
      return { id: entity.getName(), archetype: entity.getArchetypeName(), location: Array.from(entity.getv3Location()), tick: game.gameClock.getFrameIndex() };
    }), campaign.region);
    await host.waitForFunction(before => {
      const game = window.polycraft.controls.onlineWorld.game, entity = game.getGameEntityByName(before.id);
      return entity && !entity.shouldBeDestroyed() && Math.hypot(entity.getv3Location()[0] - before.location[0], entity.getv3Location()[2] - before.location[2]) > 0.2;
    }, before, { timeout: 15000 });
    await guest.waitForFunction(before => {
      const scene = window.polycraft.controls.guestWorld.scene, record = scene.entities.get(before.id)?.record;
      return record && scene.tick > before.tick && Math.hypot(record.location[0] - before.location[0], record.location[2] - before.location[2]) > 0.2;
    }, before);
    return before;
  }
  const guestPauseEnemy = await observeMovement();
  assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.pauseMenu), true);
  await nativeButton('guest-resume', 'buttonStart');
  await guest.waitForFunction(() => !window.polycraft.controls.guestWorld.pauseMenu);
  await click(0, '#multiplayer'); await host.locator('#multiplayer-dialog[open]').waitFor();
  const hostMenuEnemy = await observeMovement();
  assert.equal(await host.locator('#multiplayer-dialog').evaluate(node => node.open), true);
  await click(0, '#close-multiplayer');
  const combat = await host.evaluate(({ id, hero }) => window.polycraft.controls.onlineWorld.atBoundary(() => {
    const world = window.polycraft.controls.onlineWorld, game = world.game, victim = game.getGameEntityByName(id), actor = world.players.active.get(hero).hero;
    if (!victim || victim.shouldBeDestroyed() || victim.getEC('ECHealth').getHealth() <= 0) throw new Error('Need the live native wave enemy for combat.');
    const target = Array.from(victim.getv3Location());
    const location = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([x, z]) => game.placeOnGround([target[0] + x, target[1], target[2] + z], 0.5)).find(point => !game.getCollisionInfo(target, point, false, victim));
    if (!location) throw new Error('Need an unobstructed temporary hero position near the wave enemy.');
    actor.getEC('ECAutoFire').disable(); actor.getEC('ECLocomotion').clearDestination(); actor.teleport(location);
    actor.getEC('ECInventory').equipWeapon('wp_h_pistol');
    const factory = game.getProjectileFactory(), create = factory.createProjectile;
    window.campaignCombatAcceptance = { projectiles: [], impacts: [], kills: [] };
    factory.createProjectile = function (...args) {
      const projectile = create.apply(this, args);
      if (args[0] === actor) {
        window.campaignCombatAcceptance.projectiles.push(projectile.getName());
        const component = projectile.getEC('ECProjectile'), impact = component.onImpact;
        component.onImpact = function (entity, point) { window.campaignCombatAcceptance.impacts.push({ target: entity?.getName(), healthBefore: entity?.getEC('ECHealth')?.getHealth() }); return impact.call(this, entity, point); };
      }
      return projectile;
    };
    window.restoreCampaignCombatObserver = () => { factory.createProjectile = create; };
    game.eventManager.subscribe('EnemyKilled', event => window.campaignCombatAcceptance.kills.push({ victim: event.victim.getName(), aggressor: event.aggressor?.getName(), critical: event.isCritical }));
    window.campaignCombatPickupNames = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).map(entity => entity.getName());
    return { id, actor: actor.getName(), health: victim.getEC('ECHealth').getHealth(), tick: game.gameClock.getFrameIndex(), xp: actor.getEC('ECPlayerData').getXP(), hostXP: game.getHero().getEC('ECPlayerData').getXP(), killXP: victim.getEC('ECAgent').getXP() };
  }), { id: hostMenuEnemy.id, hero });
  await selectTarget(combat.id);
  await host.waitForFunction(({ id, actor }) => window.campaignCombatAcceptance.kills.some(event => event.victim === id && event.aggressor === actor && event.critical), combat, { timeout: 15000 });
  await guest.waitForFunction(({ id, health, tick }) => { const scene = window.polycraft.controls.guestWorld.scene, record = scene.entities.get(id)?.record; return scene.tick > tick && (!record || record.health?.current < health); }, combat);
  const trace = await host.evaluate(() => { window.restoreCampaignCombatObserver(); return window.campaignCombatAcceptance; });
  assert.ok(trace.projectiles.length > 0); assert.ok(trace.impacts.some(impact => impact.target === combat.id && impact.healthBefore === combat.health));
  assert.equal(trace.kills.filter(event => event.victim === combat.id && event.aggressor === combat.actor).length, 1);
  console.log('Original wave combat:', { before: combat, trace });
  await guest.screenshot({ path: 'test-results/session-ui-campaign-combat.png' });
  assert.equal(combat.killXP, 5, 'This original level-one thief drops five XP.');
  const drops = await host.evaluate(() => window.polycraft.controls.onlineWorld.game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).filter(entity => !window.campaignCombatPickupNames.includes(entity.getName()) && entity.getEC('ECPickup').archetype.xp > 0).map(entity => entity.getName()));
  for (const name of drops) {
    await host.waitForFunction(name => { const entity = window.polycraft.controls.onlineWorld.game.getGameEntityByName(name); return !entity || entity.shouldBeDestroyed() || entity.getEC('ECPickup').animatedIn; }, name);
    await host.evaluate(({ hero, name }) => window.polycraft.controls.onlineWorld.atBoundary(() => {
      const world = window.polycraft.controls.onlineWorld, drop = world.game.getGameEntityByName(name);
      if (!drop || drop.shouldBeDestroyed() || drop.getEC('ECPickup').hasBeenPickedUp()) return;
      const entity = world.players.active.get(hero).hero;
      entity.getEC('ECLocomotion').clearDestination(); entity.teleport(Array.from(drop.getv3Location()));
    }), { hero, name });
    await host.waitForFunction(name => { const entity = window.polycraft.controls.onlineWorld.game.getGameEntityByName(name); return !entity || entity.shouldBeDestroyed() || entity.getEC('ECPickup').hasBeenPickedUp(); }, name);
  }
  await host.waitForFunction(({ hero, xp, hostXP, killXP }) => { const world = window.polycraft.controls.onlineWorld; return world.players.active.get(hero).hero.getEC('ECPlayerData').getXP() === xp + killXP && world.game.getHero().getEC('ECPlayerData').getXP() === hostXP; }, { ...combat, hero });
  await guest.waitForFunction(xp => { const hud = window.polycraft.controls.guestWorld.hud; return hud.state?.xp === xp && Math.abs(hud.data.getVisibleXP() - xp) < 0.01; }, combat.xp + combat.killXP);
  await host.evaluate(() => window.polycraft.checkpoint(true));
  assert.equal(saved().players.find(player => player.id === hero).progress.xp, combat.xp + combat.killXP);
  assert.equal(saved().players.find(player => player.id === saved().host).progress.xp, combat.hostXP);
  await guest.screenshot({ path: 'test-results/session-ui-kill-xp.png' });
  console.log('Original guest campaign:', { ...campaign, events: await host.evaluate(() => window.campaignAcceptanceEvents), guestPauseEnemy, hostMenuEnemy });
  await end();
  await reloadHost(); await click(0, '#multiplayer'); await join();
  const reloadedXP = await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => { const world = window.polycraft.controls.onlineWorld; return { guest: world.players.active.get(hero).hero.getEC('ECPlayerData').getXP(), host: world.game.getHero().getEC('ECPlayerData').getXP() }; }), hero);
  assert.deepEqual(reloadedXP, { guest: combat.xp + combat.killXP, host: combat.hostXP });
  await guest.waitForFunction(xp => window.polycraft.controls.guestWorld.hud.state?.xp === xp, reloadedXP.guest);
  console.log('Native kill XP collection/reload:', { before: { guest: combat.xp, host: combat.hostXP }, killXP: combat.killXP, after: reloadedXP, drops });
  await end();
  console.log('PASS: original guest campaign controls/countdown, native wave AI through online menus, real guest projectile impact/kill and state replication; native kill XP pickups credit only the collecting guest and survive disk checkpoint/host reload/rejoin with host XP and guest solo bytes unchanged.');
};
