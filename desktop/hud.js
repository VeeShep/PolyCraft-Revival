'use strict';
(function (root) {
  const { validateQuestView } = typeof module !== 'undefined' ? require('./quests.js') : root.PolycraftQuests;
  function captureIslandHud(game, hero, flags) {
    let hq = null, prepare = null, invasion = null, upcoming = null;
    if (flags.displayHQHealth) {
      const faction = hero.getEC('ECFaction')?.getFactionName();
      const health = faction && game.getFactionManager().getFactionByName(faction)?.getHQ()?.getEC('ECHealth');
      if (health) hq = { current: health.getHealth(), maximum: health.getMaxHealth(), changedAgo: Math.max(0, health.getTimeSinceHealthChange()) };
    }
    if (flags.displayWarCompassPrepare || flags.displayWarCompassInvasion || flags.displayNextInvasionDescription) {
      const war = hero.getGameSpace()?.getEntitiesWithEC('ECWarManager')[0]?.getEC('ECWarManager');
      if (war) {
        if (flags.displayWarCompassPrepare) prepare = Math.max(0, game.getGuiScores().prepareTimeRemaining);
        const region = war.getActiveCampaignRegionName();
        if (flags.displayWarCompassInvasion) invasion = { killed: war.getCurrentBattleKilledEnemyCount(region), total: war.getNextBattleEnemyCount(region) };
        if (flags.displayNextInvasionDescription) upcoming = Object.entries(war.getNextBattleArchetypeQuantities(region)).map(([archetype, count]) => ({ archetype, count }));
      }
    }
    return { hq, prepare, invasion, upcoming };
  }
  function captureHud(game, hero) {
    const data = hero.getEC('ECPlayerData'), flags = game.getPlayFlags();
    return { resources: [data.getResource(0), data.getResource(1)], caps: [data.getResourceCap(0), data.getResourceCap(1)], amber: data.getSoftCurrency(), xp: data.getXP(), points: data.getUpgradePoints(), quests: game.desktopQuestRewards?.snapshot() || null, island: captureIslandHud(game, hero, flags),
      flags: { resources: !!flags.displayResource, amber: !!flags.displaySoftCurrency, rank: !!flags.displayRank } };
  }
  const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2147483647;
  function validateIslandHud(value, game) {
    if (!keys(value, ['hq', 'prepare', 'invasion', 'upcoming']) || value.hq !== null && (!keys(value.hq, ['current', 'maximum', 'changedAgo']) || !Number.isFinite(value.hq.current) || Math.abs(value.hq.current) > 1e9 || !amount(value.hq.maximum) || !amount(value.hq.changedAgo)) || value.prepare !== null && !amount(value.prepare) || value.invasion !== null && (!keys(value.invasion, ['killed', 'total']) || ![value.invasion.killed, value.invasion.total].every(count => Number.isSafeInteger(count) && amount(count)))) throw new Error('Invalid island HUD state.');
    if (value.upcoming !== null) {
      if (!Array.isArray(value.upcoming) || value.upcoming.length > 64) throw new Error('Invalid upcoming invasion.');
      const known = game.getEntityFactory().getArchetypeList(), seen = new Set();
      for (const row of value.upcoming) {
        if (!keys(row, ['archetype', 'count']) || typeof row.archetype !== 'string' || row.archetype.length > 100 || !known.includes(row.archetype) || seen.has(row.archetype) || !Number.isSafeInteger(row.count) || !amount(row.count)) throw new Error('Invalid upcoming invasion.');
        seen.add(row.archetype);
      }
    }
  }
  class GuestHud {
    constructor(world) { this.world = world; }
    receive(value, expected) {
      if (!Object.hasOwn(value, 'hud')) return;
      const hud = value.hud;
      if (value.type !== 'life' || !Object.hasOwn(value, 'life') || !keys(hud, ['resources', 'caps', 'amber', 'xp', 'points', 'flags', 'quests', 'island']) || ![hud.resources, hud.caps].every(values => Array.isArray(values) && values.length === 2 && [0, 1].every(index => amount(values[index]))) || !amount(hud.amber) || !Number.isSafeInteger(hud.xp) || !amount(hud.xp) || !Number.isSafeInteger(hud.points) || hud.points < 0 || hud.points > 2147483647 + this.world.controls.xpTable.length || !keys(hud.flags, ['resources', 'amber', 'rank']) || !Object.values(hud.flags).every(flag => typeof flag === 'boolean')) throw new Error('Invalid guest HUD state.');
      validateQuestView(hud.quests, hud.quests ? this.world.game.getTaskManager() : null);
      validateIslandHud(hud.island, this.world.game);
      if (value.sequence !== expected) return;
      this.world.quests?.receiveView(hud.quests);
      const globals = this.world.controls.app.globals, now = globals.appCurrentTime;
      if (!this.data) {
        // Original number animations, with getters bound only to host-supplied presentation data.
        this.data = Object.assign(Object.create(this.world.controls.playerDataMethods), { globals,
          getResource: index => this.state.resources[index], getResourceCap: index => this.state.caps[index], getSoftCurrency: () => this.state.amber, getXP: () => this.state.xp, getUpgradePoints: () => this.state.points,
          resourceStartPoint: [...hud.resources], resourceTime: [now - 1e9, now - 1e9], xpStartPoint: hud.xp, xpTime: now - 1e9, softCurrencyStartPoint: hud.amber, softCurrencyTime: now - 1e9 });
      } else {
        for (let index = 0; index < 2; index++) if (hud.resources[index] !== this.state.resources[index] || hud.caps[index] !== this.state.caps[index]) {
          this.data.resourceStartPoint[index] = this.data.getVisibleResource(index); this.data.resourceTime[index] = now;
        }
        if (hud.xp !== this.state.xp) {
          // Original XP animation assumes increases; a host correction must not take hours to count down.
          this.data.xpStartPoint = hud.xp < this.state.xp ? hud.xp : this.data.getVisibleXP(); this.data.xpTime = hud.xp < this.state.xp ? now - 1e9 : now;
        }
        if (hud.amber !== this.state.amber) { this.data.softCurrencyStartPoint = this.data.getVisibleSoftCurrency(); this.data.softCurrencyTime = now; }
      }
      this.state = structuredClone(hud);
      this.receivedAt = performance.now();
    }
    draw() {
      if (!this.state || this.world.resyncing) return;
      const scores = this.world.game.getGuiScores(), hero = { getEC: () => this.data }, flags = this.state.flags;
      if (flags.resources) { scores.drawResourceBar(hero, 0); scores.drawResourceBar(hero, 1); }
      if (flags.amber) scores.drawSoftCurrency(hero);
      if (flags.rank) scores.drawRanking(hero);
      this.drawIsland(scores);
    }
    drawIsland(scores) {
      const world = this.world, island = this.state.island, elapsed = Math.max(0, (performance.now() - this.receivedAt) / 1000);
      if (island.hq) {
        const health = { getHealth: () => island.hq.current, getMaxHealth: () => island.hq.maximum, getTimeSinceHealthChange: () => island.hq.changedAgo + elapsed };
        // Bind the original HQ renderer to received health, never the guest's suspended solo faction.
        const game = { getGuiManager: () => world.game.getGuiManager(), getFactionManager: () => ({ getFactionByName: () => ({ getHQ: () => ({ getEC: () => health }) }) }) };
        const view = Object.assign(Object.create(scores), { globals: Object.assign(Object.create(scores.globals), { gameManager: game }) });
        view.drawHQHealth({ getEC: () => ({ getFactionName: () => 'shared' }) });
      }
      if (island.prepare !== null) scores.drawWarCompassPrepare(Math.max(0, island.prepare - elapsed));
      if (island.invasion) scores.drawWarCompassInvasion(island.invasion.killed, island.invasion.total);
      if (island.upcoming) {
        const war = { getActiveCampaignRegionName: () => 'shared', getNextBattleArchetypeQuantities: () => Object.fromEntries(island.upcoming.map(row => [row.archetype, row.count])) };
        scores.drawNextInvasionDescription({ getGameSpace: () => ({ getEntitiesWithEC: () => [{ getEC: () => war }] }) }, [225, -100]);
      }
    }
  }
  const api = { captureHud, GuestHud };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftHud = api;
})(globalThis);
