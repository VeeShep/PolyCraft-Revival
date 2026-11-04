'use strict';
(function (root) {
  const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  const name = value => typeof value === 'string' && /^[a-zA-Z][\w-]{0,99}$/.test(value);
  function validateCampaign(value, controls, game) {
    if (!keys(value, ['source', 'region', 'campaign', 'battles', 'enemies']) || typeof value.source !== 'string' || !value.source.length || value.source.length > 256 || !name(value.region) || !name(value.campaign) || !Object.hasOwn(controls.campaignMethods?.archetypes || {}, value.campaign) || !Number.isSafeInteger(value.battles) || value.battles < 1 || value.battles > 1000 || !Array.isArray(value.enemies) || value.enemies.length > 64) throw new Error('Invalid campaign preview.');
    const known = game.getEntityFactory().getArchetypeList(), seen = new Set();
    for (const row of value.enemies) {
      if (!keys(row, ['archetype', 'count']) || !name(row.archetype) || !known.includes(row.archetype) || seen.has(row.archetype) || !Number.isSafeInteger(row.count) || row.count < 0 || row.count > 2147483647) throw new Error('Invalid campaign enemies.');
      seen.add(row.archetype);
    }
    return value;
  }
  function campaignContext(game, source, controls) {
    const starter = source.getEC('ECCampaignStarter');
    if (!starter || !controls?.campaignMethods?.enabled() || !source.getEC('ECInteractable')?.getActive() || !starter.isCampaignRegionEnabled() || game.getActiveGameState().name !== 'GamestatePlaying' || game.getPlayState()?.playStateName !== 'PlayStateNormal' || !game.getGameEntitiesByFamilyName('outpost').some(entity => !entity.shouldBeDestroyed())) return null;
    // Campaign state is island-wide; resolve the same owner as the original host screen.
    const owner = game.getHero().getGameSpace()?.getEntitiesWithEC('ECWarManager')[0], war = owner?.getEC('ECWarManager'), region = starter.getCampaignRegionName();
    if (!war || war.getActiveCampaignRegionName() !== null || war.campaignRegionMap?.[region]?.campaignStarterEntity !== source) return null;
    const view = validateCampaign({ source: source.name, region, campaign: war.getCampaignArchetypeName(region), battles: war.getNumberOfBattlesInCampaign(region), enemies: Object.entries(war.getNextBattleArchetypeQuantities(region)).map(([archetype, count]) => ({ archetype, count })) }, controls, game);
    return { owner, view };
  }
  const amount = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
  function validateCampaignResult(value, controls) {
    if (value === null) return value;
    if (!keys(value, ['id', 'campaign', 'score']) || !Number.isSafeInteger(value.id) || value.id < 1 || !name(value.campaign) || !Object.hasOwn(controls.campaignMethods?.archetypes || {}, value.campaign)) throw new Error('Invalid campaign result.');
    const score = value.score, criteria = controls.campaignMethods.archetypes[value.campaign].starCriteriaList;
    if (!keys(score, ['wasVictory', 'resourceBonusList', 'xpBonus', 'starStatusList', 'grade']) || typeof score.wasVictory !== 'boolean' || !Array.isArray(score.resourceBonusList) || score.resourceBonusList.length !== 2 || !Array.from(score.resourceBonusList).every(amount) || !amount(score.xpBonus) || !Array.isArray(score.starStatusList) || score.starStatusList.length < 1 || score.starStatusList.length > 16 || score.starStatusList.length !== criteria.length || !Number.isSafeInteger(score.grade) || score.grade < 0 || score.grade > criteria.length) throw new Error('Invalid campaign score.');
    for (const [index, row] of Array.from(score.starStatusList).entries()) {
      if (!keys(row, ['starName', 'displayText', 'achieved', 'value']) || row.starName !== criteria[index].name || !Object.hasOwn(controls.infoPanels.starGuiArchetypeMap, row.starName) || typeof row.achieved !== 'boolean' || ![row.displayText, row.value].every(text => typeof text === 'string' && text.length <= 256)) throw new Error('Invalid campaign star.');
    }
    if (score.grade !== (score.wasVictory ? score.starStatusList.filter(row => row.achieved).length : 0) || !score.wasVictory && (score.xpBonus || score.resourceBonusList.some(Boolean))) throw new Error('Invalid campaign rewards.');
    return value;
  }
  class HostCampaignResults {
    constructor(game, controls) { this.game = game; this.controls = controls; this.sequence = 0; this.manager = game.getScoreInfo?.(); this.stars = this.manager?.campaignStarStatusList; this.latest = null; }
    update() {
      if (this.closed) return;
      const manager = this.game.getScoreInfo?.(), stars = manager?.campaignStarStatusList;
      if (manager !== this.manager) { this.manager = manager; this.stars = stars; this.latest = null; return; }
      if (!manager || stars === this.stars) return;
      this.stars = stars;
      if (manager.campaignActive || !Array.isArray(stars) || !stars.length) return;
      try {
        // Native scoring retains the exact original criteria list, even after the banner is replaced.
        const campaign = Object.entries(this.controls.campaignMethods.archetypes).find(([, definition]) => definition.starCriteriaList === manager.campaignStarCriteriaList)?.[0];
        const { wasVictory, resourceBonusList, xpBonus, starStatusList, grade } = manager.getCampaignScoreInfo();
        const result = validateCampaignResult({ id: this.sequence + 1, campaign, score: { wasVictory, resourceBonusList, xpBonus, starStatusList, grade } }, this.controls);
        this.latest = structuredClone(result); this.sequence++;
      } catch (error) { console.error('Campaign result could not be displayed.', error.message); }
    }
    close() { this.closed = true; this.latest = this.manager = this.stars = null; }
  }
  function preparationState(game) {
    if (!game.getPlayFlags?.()?.displaySkipPrepareButton || game.getActiveGameState().name !== 'GamestatePlaying') return null;
    const state = game.getPlayState();
    return state?.playStateName === 'PlayStatePrepareForBattle' ? state : null;
  }
  class GuestCampaign {
    constructor(world) { this.world = world; this.dismissedResult = 0; }
    receive(value, selected) {
      if (Object.hasOwn(value, 'campaign')) {
        if (value.type !== 'target') throw new Error('Invalid campaign result.');
        validateCampaign(value.campaign, this.world.controls, this.world.game);
        if (selected) {
          this.cancel(false); this.world.cancelLocalMenu(); this.menu = structuredClone(value.campaign);
          this.world.game.gameSoundManager.playInternal('aud_sting_prepare_battle', null, null);
          this.world.movement.flush();
        }
      } else if (selected) this.cancel(false);
      if (value.type === 'skipPrepare' && value.sequence === this.prepareRequest) { this.prepareRequest = null; this.world.lastLifeQuery = -Infinity; }
      if (['campaignStart', 'campaignClose'].includes(value.type) && value.sequence === this.pending) { this.pending = null; this.world.lastLifeQuery = -Infinity; }
    }
    receiveResult(value) {
      validateCampaignResult(value, this.world.controls);
      if (value === null) { this.result = this.pendingResult = null; return; }
      if (value.id <= this.dismissedResult || value.id <= (this.result?.id || 0) || value.id <= (this.pendingResult?.id || 0)) return;
      this.pendingResult = structuredClone(value);
    }
    dismissResult() { if (this.result) this.dismissedResult = Math.max(this.dismissedResult, this.result.id); this.result = null; this.world.movement.flush(); }
    close() { this.cancel(false); this.result = this.pendingResult = null; }
    send(type, menu) {
      const world = this.world, sequence = ++world.targetSequence;
      world.connection.send('action', { type, sequence, target: menu.source, campaign: menu.campaign }).catch(error => { if (!world.connection.closed) world.connection.fail(error); });
      return sequence;
    }
    cancel(notify = true) {
      const menu = this.menu; this.menu = null;
      if (menu && notify && !this.world.closed && !this.world.resyncing && !this.world.connection.closed && this.world.connection.state === 'connected') this.pending = this.send('campaignClose', menu);
    }
    drawPreparation() {
      const world = this.world, preparation = world.hud.state?.preparation;
      if (!preparation || world.closed || world.connection.closed || world.connection.state !== 'connected' || this.prepareRequest || !world.identity || world.resyncing || world.controls.paused || !world.movement.nativeFocused || world.lifeState?.phase !== 'normal' || world.localMenu() || performance.now() - world.hud.receivedAt > 2000) return;
      const globals = world.controls.app.globals;
      if (world.game.getIMGui().doButton({ id: 'guest-skip-prepare', text: undefined, v2ScreenLocation: globals.guiRenderer.getv2RenderLocation(85, 174, 'topLeft'), buttonType: world.controls.guiTypes.BUTTON_IN_GAME, guiArchetype: 'skipPrepare' })) {
        this.prepareRequest = ++world.targetSequence;
        world.connection.send('action', { type: 'skipPrepare', sequence: this.prepareRequest, target: world.identity.entity, episode: preparation.episode }).catch(error => { if (!world.connection.closed) world.connection.fail(error); });
      }
    }
    update() {
      const world = this.world;
      if (world.closed || world.connection.closed || world.connection.state !== 'connected' || world.controls.paused || !world.movement.nativeFocused || world.resyncing) return false;
      if (!this.result && this.pendingResult && !this.menu && !world.pauseMenu && !world.selectedBuilding && !world.demolition && !world.construction?.menu && !world.construction?.placement && !world.totem?.menu && !world.quests?.description) {
        this.result = this.pendingResult; this.pendingResult = null; world.cancelLocalMenu(); world.movement.flush();
      }
      const result = this.result, menu = this.menu;
      if (!result && !menu) return false;
      if (!result && !world.scene.entities.has(menu.source)) { this.cancel(); return false; }
      const gui = world.game.getIMGui(), input = Object.assign(Object.create(gui), { doButton: options => gui.doButton({ ...options, id: 'guest-campaign-' + options.id }) });
      const game = Object.assign(Object.create(world.game), { getIMGui: () => input });
      gui.doBackground();
      const globals = world.controls.app.globals;
      world.game.getGuiManager().addDrawGui('bgPattern', { v2ScreenLocation: globals.guiRenderer.getv2RenderLocation(0, 0) }, 'guest-campaign-background');
      if (result) {
        if (world.controls.infoPanels.doCampaignEndBookend(game, globals, world.controls.campaignMethods.archetypes[result.campaign], result.score)) this.dismissResult();
      } else {
        const war = { getCampaignArchetypeName: () => menu.campaign, getNumberOfBattlesInCampaign: () => menu.battles, getNextBattleArchetypeQuantities: () => Object.fromEntries(menu.enemies.map(row => [row.archetype, row.count])) };
        const choice = world.controls.infoPanels.doCampaignStartBookend(game, globals, { getEC: () => war }, menu.region);
        if (choice === 'confirm') { this.menu = null; this.pending = this.send('campaignStart', menu); }
        else if (choice === 'close') this.cancel();
      }
      return true;
    }
  }
  const api = { HostCampaignResults, validateCampaignResult, preparationState, validateCampaign, campaignContext, GuestCampaign };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftCampaign = api;
})(globalThis);
