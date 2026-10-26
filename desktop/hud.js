'use strict';
(function (root) {
  const { validateQuestView } = typeof module !== 'undefined' ? require('./quests.js') : root.PolycraftQuests;
  function captureHud(game, hero) {
    const data = hero.getEC('ECPlayerData'), flags = game.getPlayFlags();
    return { resources: [data.getResource(0), data.getResource(1)], caps: [data.getResourceCap(0), data.getResourceCap(1)], amber: data.getSoftCurrency(), xp: data.getXP(), points: data.getUpgradePoints(), quests: game.desktopQuestRewards?.snapshot() || null,
      flags: { resources: !!flags.displayResource, amber: !!flags.displaySoftCurrency, rank: !!flags.displayRank } };
  }
  const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2147483647;
  class GuestHud {
    constructor(world) { this.world = world; }
    receive(value, expected) {
      if (!Object.hasOwn(value, 'hud')) return;
      const hud = value.hud;
      if (value.type !== 'life' || !Object.hasOwn(value, 'life') || !keys(hud, ['resources', 'caps', 'amber', 'xp', 'points', 'flags', 'quests']) || ![hud.resources, hud.caps].every(values => Array.isArray(values) && values.length === 2 && [0, 1].every(index => amount(values[index]))) || !amount(hud.amber) || !Number.isSafeInteger(hud.xp) || !amount(hud.xp) || !Number.isSafeInteger(hud.points) || hud.points < 0 || hud.points > 2147483647 + this.world.controls.xpTable.length || !keys(hud.flags, ['resources', 'amber', 'rank']) || !Object.values(hud.flags).every(flag => typeof flag === 'boolean')) throw new Error('Invalid guest HUD state.');
      validateQuestView(hud.quests, hud.quests ? this.world.game.getTaskManager() : null);
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
    }
    draw() {
      if (!this.state || this.world.resyncing) return;
      const scores = this.world.game.getGuiScores(), hero = { getEC: () => this.data }, flags = this.state.flags;
      if (flags.resources) { scores.drawResourceBar(hero, 0); scores.drawResourceBar(hero, 1); }
      if (flags.amber) scores.drawSoftCurrency(hero);
      if (flags.rank) scores.drawRanking(hero);
    }
  }
  const api = { captureHud, GuestHud };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftHud = api;
})(globalThis);
