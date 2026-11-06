'use strict';
const assert = require('node:assert/strict');

module.exports = async function campaignVictory({ host, guest, hero, campaign, selectTarget, panelButton }) {
  assert.equal(campaign.campaign, 'campaign_tutorial_01');
  await host.evaluate(() => {
    window.campaignVictoryKills = [];
    window.polycraft.controls.onlineWorld.game.eventManager.subscribe('EnemyKilled', event => {
      window.campaignVictoryKills.push({ victim: event.victim.getName(), aggressor: event.aggressor?.getName(), critical: event.isCritical });
    });
  });
  const deadline = Date.now() + 180000;
  let victory;
  while (Date.now() < deadline) {
    const state = await host.evaluate(region => {
      const world = window.polycraft.controls.onlineWorld, game = world.game, reward = game.desktopCampaignRewards.current();
      if (reward) return { reward };
      const war = game.getHero().getGameSpace().getEntitiesWithEC('ECWarManager')[0].getEC('ECWarManager');
      const wave = war.campaignRegionMap[region].currentAttackWaveManager?.getEC('ECAttackWavesManager');
      const enemy = wave?.spawnedEntityList.find(entity => !entity.shouldBeDestroyed() && entity.getEC('ECHealth').getHealth() > 0);
      return { enemy: enemy?.getName() };
    }, campaign.region);
    if (state.reward) { victory = state.reward; break; }
    if (!state.enemy) { await guest.waitForTimeout(200); continue; }
    const actor = await host.evaluate(({ id, hero }) => window.polycraft.controls.onlineWorld.atBoundary(() => {
      const world = window.polycraft.controls.onlineWorld, game = world.game, enemy = game.getGameEntityByName(id), actor = world.players.active.get(hero).hero, target = Array.from(enemy.getv3Location());
      const position = [3, 5].flatMap(radius => Array.from({ length: 12 }, (_, index) => game.placeOnGround([target[0] + radius * Math.cos(index * Math.PI / 6), target[1], target[2] + radius * Math.sin(index * Math.PI / 6)], 0.5))).find(point => !game.getCollisionInfo(target, point, false, enemy));
      if (!position) return null;
      actor.getEC('ECAutoFire').disable(); actor.getEC('ECLocomotion').clearDestination(); actor.teleport(position);
      actor.getEC('ECInventory').equipWeapon('wp_h_pistol');
      return actor.getName();
    }), { id: state.enemy, hero });
    if (!actor) { await guest.waitForTimeout(200); continue; }
    await selectTarget(state.enemy);
    await guest.waitForTimeout(1200);
    const attempt = await host.evaluate(({ id, actor }) => {
      const world = window.polycraft.controls.onlineWorld, enemy = world.game.getGameEntityByName(id), hero = [...world.players.active.values()].find(entry => entry.hero.getName() === actor).hero;
      return { killed: window.campaignVictoryKills.some(event => event.victim === id && event.aggressor === actor), health: enemy?.getEC('ECHealth')?.getHealth(), ammo: hero.getEC('ECFirearm').getAmmo(), target: hero.getEC('ECAutoFire').getTargetEntity()?.getName() };
    }, { id: state.enemy, actor });
    console.log('Native campaign combat attempt:', { enemy: state.enemy, ...attempt });
  }
  assert.ok(victory, 'The unmodified native campaign must reach its completion reward within the test deadline.');
  assert.equal(victory.campaign, campaign.campaign); assert.equal(victory.score.wasVictory, true);
  const kills = await host.evaluate(() => window.campaignVictoryKills);
  assert.equal(kills.length, 14); assert.equal(new Set(kills.map(event => event.victim)).size, 14);
  assert.ok(kills.every(event => event.critical));
  const owner = await host.evaluate(() => window.polycraft.controls.onlineWorld.players.registry.data.host);
  assert.equal(victory.owner, owner); assert.ok(victory.score.starStatusList.some(row => row.starName === 'killNEnemiesWithHero' && row.achieved));
  await guest.waitForFunction(() => window.polycraft.controls.guestWorld.campaign.result?.score.wasVictory === true);
  assert.deepEqual(await guest.evaluate(() => window.polycraft.controls.guestWorld.campaign.result.score), victory.score);
  await guest.screenshot({ path: 'test-results/session-ui-campaign-victory.png' });
  await panelButton('infoPanelUpgradeButton');
  await guest.waitForFunction(() => !window.polycraft.controls.guestWorld.campaign.result);
  assert.deepEqual(await host.evaluate(() => window.polycraft.controls.onlineWorld.game.desktopCampaignRewards.current()), victory);
  console.log('Native campaign victory:', JSON.stringify({ reward: victory, kills }));
};
