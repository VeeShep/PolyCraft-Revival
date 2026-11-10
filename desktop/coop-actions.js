'use strict';
(function (root) {
  const { totemMenu, upgradeTotem } = typeof module !== 'undefined' ? require('./totems.js') : root.PolycraftTotems;
  const { captureHud } = typeof module !== 'undefined' ? require('./hud.js') : root.PolycraftHud;
  const { campaignContext, preparationState } = typeof module !== 'undefined' ? require('./campaign.js') : root.PolycraftCampaign;
  const { craftMenu, craftOffer } = typeof module !== 'undefined' ? require('./crafting.js') : root.PolycraftCrafting;
  function lifeStatus(life) {
    const phase = life.respawnTime !== undefined ? 'waiting' : life.state === life.states.DYING ? 'dying' : 'normal';
    const remaining = phase === 'waiting' ? Math.max(0, life.getTimeToRespawn()) : phase === 'dying' ? Math.max(0, life.getDeathAnimationDuration() - (life.globals.gameCurrentTime - life.deathTime)) : 0;
    const option = phase === 'waiting' && remaining > 0.200001 ? remaining > life.getRespawnHighCostDelay() ? 'amber' : 'lumber' : null;
    return { phase, remaining, episode: phase === 'normal' ? null : life.deathTime, option, affordable: !!(option && life.canAffordToRevive(option === 'amber' ? 10 : 0, option === 'lumber' ? 50 : 0)) };
  }
  class HostActions {
    constructor(now = () => performance.now()) { this.now = now; this.sequence = 0; this.queue = []; this.tokens = 10; this.tokenTime = now(); this.pressTokens = 10; this.pressTokenTime = this.tokenTime; this.prepareEpisodes = new WeakMap(); this.prepareSequence = 0; this.cameraTokens = 2; this.cameraTokenTime = this.tokenTime; }
    receive(value) {
      const placement = ['build', 'preview'].includes(value?.type), upgrade = value?.type === 'upgrade', revive = value?.type === 'revive';
      const buildingUpgrade = value?.type === 'upgradeBuilding', cancelUpgrade = value?.type === 'cancelUpgrade';
      const quest = ['questOpen', 'questReward'].includes(value?.type), campaign = ['campaignStart', 'campaignClose'].includes(value?.type);
      const crafting = value?.type === 'craftResource', speedup = value?.type === 'speedup';
      const held = value?.archetype !== undefined, targeted = value?.type === 'target';
      if (!value || Object.keys(value).length !== (upgrade ? 6 : placement ? 5 : revive ? 5 : buildingUpgrade || cancelUpgrade || crafting || speedup ? 5 : value?.type === 'repair' || quest || campaign || value?.type === 'skipPrepare' ? 4 : 3) + (held ? 1 : 0) + (targeted ? 1 : 0) || !['target', 'demolish', 'build', 'preview', 'upgrade', 'held', 'cancelBuild', 'life', 'revive', 'move', 'repair', 'upgradeBuilding', 'cancelUpgrade', 'questOpen', 'questReward', 'campaignStart', 'campaignClose', 'skipPrepare', 'rotateCamera', 'pauseGame', 'enterFullscreen', 'craftMenu', 'craftResource', 'speedup'].includes(value.type) || !Number.isSafeInteger(value.sequence) || value.sequence !== this.sequence + 1 || typeof value.target !== 'string' || !value.target.length || value.target.length > 256) throw new Error('Invalid or repeated target action.');
      if (speedup && (typeof value.planned !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(value.planned) || !Number.isSafeInteger(value.cost) || value.cost < 1 || value.cost > 2147483647)) throw new Error('Invalid scaffold speedup quote.');
      if (crafting && (!Number.isInteger(value.index) || value.index < 0 || value.index >= 6 || !Number.isSafeInteger(value.quote) || value.quote < 1 || value.quote >= value.sequence)) throw new Error('Invalid crafting choice.');
      if (campaign && (typeof value.campaign !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(value.campaign))) throw new Error('Invalid campaign request.');
      if (quest && (typeof value.quest !== 'string' || !/^taskId(?:crit|fill)_\d{1,4}$/.test(value.quest))) throw new Error('Invalid quest request.');
      if ((buildingUpgrade || cancelUpgrade) && (typeof value.next !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(value.next))) throw new Error('Invalid building upgrade.');
      if ((cancelUpgrade || value.type === 'skipPrepare') && (!Number.isSafeInteger(value.episode) || value.episode < 1)) throw new Error('Invalid action episode.');
      if (targeted && !['press', 'update', 'clear', 'release'].includes(value.phase)) throw new Error('Invalid target phase.');
      if ((value.type === 'repair' || buildingUpgrade) && (!Array.isArray(value.costs) || value.costs.length !== 2 || ![0, 1].every(index => typeof value.costs[index] === 'number' && Number.isFinite(value.costs[index]) && value.costs[index] >= 0 && value.costs[index] <= 2147483647))) throw new Error('Invalid resource quote.');
      if (revive && (typeof value.amber !== 'boolean' || typeof value.episode !== 'number' || !Number.isFinite(value.episode) || Math.abs(value.episode) > 1e9)) throw new Error('Invalid revive choice.');
      if (value.type === 'cancelBuild' && !held || held && (!(placement || value.type === 'cancelBuild') || typeof value.archetype !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(value.archetype))) throw new Error('Invalid held building selection.');
      if (placement && (!Number.isInteger(value.index) || value.index < 0 || value.index >= 32 || !Array.isArray(value.location) || value.location.length !== 3 || ![0, 1, 2].every(index => typeof value.location[index] === 'number' && Number.isFinite(value.location[index]) && Math.abs(value.location[index]) <= 1e6))) throw new Error('Invalid building placement.');
      if (upgrade && (!Number.isInteger(value.index) || value.index < 0 || value.index >= 2 || !Number.isInteger(value.level) || value.level < 0 || value.level >= 5 || typeof value.amber !== 'boolean')) throw new Error('Invalid totem upgrade.');
      const now = this.now();
      this.tokens = Math.min(10, this.tokens + Math.max(0, now - this.tokenTime) * 0.01); this.tokenTime = now;
      if (this.queue.length >= 4) throw new Error('Too many target actions.');
      // Camera notices must not consume construction and status-query capacity.
      if (value.type === 'rotateCamera') {
        this.cameraTokens = Math.min(2, this.cameraTokens + Math.max(0, now - this.cameraTokenTime) * 0.002); this.cameraTokenTime = now;
        if (this.cameraTokens < 1) throw new Error('Too many camera actions.');
        this.cameraTokens--;
      } else if (targeted && value.phase !== 'release') {
        this.pressTokens = Math.min(10, this.pressTokens + Math.max(0, now - this.pressTokenTime) * 0.01); this.pressTokenTime = now;
        if (this.pressTokens < 1) throw new Error('Too many target presses.');
        this.pressTokens--;
      } else { if (this.tokens < 1) throw new Error('Too many target actions.'); this.tokens--; }
      this.sequence = value.sequence; this.queue.push({ ...value, ...(placement ? { location: [...value.location] } : {}), ...(value.type === 'repair' || buildingUpgrade ? { costs: [...value.costs] } : {}) });
    }
    endFacing(hero) {
      if (this.facingTarget === undefined) return;
      this.facingTarget = undefined;
      this.facingMethods?.endTargetedRanged.call({ getHeroEntity: () => hero });
    }
    updateFacing(game, hero, players) {
      if (this.facingTarget === undefined) return;
      const target = game.getGameEntityByName(this.facingTarget), life = hero.getEC('ECPlayerLife'), builder = hero.getEC('ECPlayerBuilder');
      if (!target || !Number.isFinite(this.targetStarted) || this.now() - this.targetStarted > 600 || target.shouldBeDestroyed() || hero.shouldBeDestroyed() || game.isScriptLocked() || hero.getEC('ECHealth').getHealth() <= 0 ||
          life && (life.isDead?.() || life.states && life.state !== life.states.NORMAL) || builder.isBuilding() || builder.isThrowing() ||
          !target.getEC('ECTarget')?.isValidTarget(hero) || !target.getEC('ECHealth') || target.getEC('ECHealth').getHealth() <= 0 || !players.canDamage(target, hero)) { this.endFacing(hero); return; }
      this.facingMethods?.updateTargetedRanged.call({ getHeroEntity: () => hero, getTargetEntity: () => target });
    }
    stop(hero) { this.prepareEpisodes = new WeakMap(); this.campaignOffer = this.craftQuote = null; this.endFacing(hero); this.targetMode = null; this.targetStarted = undefined; hero.getEC('ECAutoFire')?.disable(); }
    updateCombat(game, hero, players) {
      const automatic = hero.getEC('ECAutoFire'), target = automatic?.getTargetEntity();
      if (!target) return;
      const life = hero.getEC('ECPlayerLife'), builder = hero.getEC('ECPlayerBuilder');
      if (hero.shouldBeDestroyed() || target.shouldBeDestroyed() || game.isScriptLocked() ||
          hero.getEC('ECHealth').getHealth() <= 0 || life && (life.isDead?.() || life.states && life.state !== life.states.NORMAL) ||
          builder.isBuilding() || builder.isThrowing() || !target.getEC('ECTarget')?.isValidTarget(hero) ||
          !target.getEC('ECHealth') || target.getEC('ECHealth').getHealth() <= 0 || !players.canDamage(target, hero)) automatic.disable();
    }
    apply(game, hero, players, controls) {
      this.updateCombat(game, hero, players);
      const action = this.queue.shift();
      if (!action) { this.updateFacing(game, hero, players); return null; }
      let result;
      try { result = this.execute(game, hero, players, action.target, controls, action.type, action); }
      finally {
        if (action.type === 'target' && action.phase === 'release') { this.targetStarted = undefined; this.endFacing(hero); }
        else this.updateFacing(game, hero, players);
      }
      return { type: action.type, sequence: action.sequence, ...(typeof result === 'string' ? { message: result } : result) };
    }
    preparationView(game) {
      const state = preparationState(game);
      if (!state) return null;
      if (!this.prepareEpisodes.has(state)) this.prepareEpisodes.set(state, ++this.prepareSequence);
      return { episode: this.prepareEpisodes.get(state) };
    }
    execute(game, hero, players, id, controls, type = 'target', action) {
      if (type === 'target' && action?.phase === 'press') { this.endFacing(hero); this.targetMode = null; this.targetStarted = this.now(); }
      if (type === 'target' && action?.phase === 'clear') { this.endFacing(hero); this.targetMode = null; this.targetStarted = undefined; return 'Target cleared.'; }
      if (type === 'target' && action?.phase === 'update' && (!Number.isFinite(this.targetStarted) || this.now() - this.targetStarted > 600)) return 'Target gesture expired.';
      const target = game.getGameEntityByName(id);
      if (!target || target.shouldBeDestroyed() || hero.shouldBeDestroyed()) return 'Target unavailable.';
      const builder = hero.getEC('ECPlayerBuilder');
      const life = hero.getEC('ECPlayerLife'), incapacitated = life && (life.isDead?.() || life.states && life.state !== life.states.NORMAL);
      if (type === 'craftMenu' || type === 'craftResource') {
        if (target !== hero || game.isScriptLocked() || !controls?.shopMethods) return 'Crafting is not available.';
        let message = 'Craft Resources.', save = false;
        if (type === 'craftResource') {
          const quote = this.craftQuote;
          this.craftQuote = null;
          const before = quote?.hero === hero && quote.menu.quote === action.quote && craftOffer(quote.menu, action.index, controls);
          const current = craftOffer(craftMenu(hero, action.sequence), action.index, controls);
          if (!before || !current || before.amount !== current.amount || before.cost !== current.cost) message = 'That crafting offer changed. Choose again.';
          else if (hero.getEC('ECPlayerData').getSoftCurrency() < current.cost) message = 'Not enough Amber.';
          else {
            controls.shopMethods.fillFraction.call(Object.assign(Object.create(controls.shopMethods), { globals: game.globals, gameManager: { getHero: () => hero } }), current.resource, current.fraction);
            message = 'Resources crafted and saved.'; save = true;
          }
        }
        const menu = craftMenu(hero, action.sequence);
        this.craftQuote = { hero, menu };
        return { message, ...(save ? { save: true } : {}), craft: menu };
      }
      if (type === 'pauseGame' || type === 'enterFullscreen') {
        if (target !== hero) return 'Only your own interface actions can be recorded.';
        game.eventManager.notify(type === 'pauseGame' ? 'PauseGame' : 'GoFullScreen', {});
        return { message: 'Interface event recorded.' };
      }
      if (type === 'rotateCamera') {
        if (target !== hero || incapacitated || game.isScriptLocked() || hero.getEC('ECHealth').getHealth() <= 0) return 'Camera interaction is not available.';
        game.eventManager.notify('RotateCamera', {});
        return { message: 'Camera rotation recorded.' };
      }
      if (type === 'skipPrepare') {
        const preparation = preparationState(game), episode = preparation && this.prepareEpisodes.get(preparation);
        if (target !== hero || incapacitated || game.isScriptLocked() || hero.getEC('ECHealth').getHealth() <= 0 || !episode || episode !== action.episode) return 'Preparation changed or is unavailable. Wait for a refresh.';
        this.prepareEpisodes.delete(preparation);
        game.getActiveGameState().setPlayState('PlayStateBattle');
        return { message: 'Battle started and saved.', save: true };
      }
      if (type === 'questOpen' || type === 'questReward') {
        const quests = game.desktopQuestRewards;
        if (!quests || target !== hero || incapacitated || game.isScriptLocked() || hero.getEC('ECHealth').getHealth() <= 0) return 'Quest interaction is not available.';
        const view = quests.snapshot();
        if (!view.visible) return 'Quests are not available yet.';
        if (type === 'questOpen') {
          if (!view.tasks.some(row => row.id === action.quest)) return 'That quest changed. Wait for a refresh.';
          game.eventManager.notify('taskDescriptionOpened', {});
          return { message: 'Quest description opened.', save: true };
        }
        if (view.completed?.id !== action.quest || !quests.award(action.quest, hero)) return 'That reward was already accepted or changed.';
        return { message: 'Quest reward dropped and saved.', save: true, quests: quests.snapshot() };
      }
      if (type === 'life' || type === 'revive') {
        if (target !== hero || !life) return 'Only your own hero can be revived.';
        const status = lifeStatus(life);
        if (type === 'life') {
          const result = game.desktopCampaignResults?.latest;
          return { message: 'Hero life state.', life: status, hud: captureHud(game, hero, status.phase === 'normal' && game.getPlayFlags().displaySkipPrepareButton && hero.getEC('ECHealth').getHealth() > 0 && !game.isScriptLocked() ? this.preparationView(game) : null, result && result.id > (this.resultFloor || 0) ? result : null) };
        }
        if (game.isScriptLocked() || !status.option || action.episode !== status.episode || action.amber !== (status.option === 'amber') || !status.affordable) return 'Revive choice changed or resources are unavailable. Wait for a refresh.';
        if (!life.payToRevive(action.amber ? 10 : 0, action.amber ? 0 : 50, action.amber)) return 'Revival is already in progress or unavailable.';
        return { message: 'Revive purchased and saved.', save: true, life: lifeStatus(life) };
      }
      if (['held', 'cancelBuild'].includes(type) || target === hero && ['build', 'preview'].includes(type)) {
        if (target !== hero) return 'Only your own held building can be controlled.';
        if (type === 'held') return { message: 'Held building state.', held: game.desktopConstruction?.heldStatus(hero) || null };
        if (incapacitated || game.isScriptLocked() || hero.getEC('ECHealth').getHealth() <= 0 || builder.isThrowing()) return 'Finish the current action first.';
        if (!builder.isBuilding() || action?.archetype !== builder.getHeldObjectName()) return 'The held building changed. Wait for a fresh selection.';
        if (type === 'cancelBuild') return game.desktopConstruction?.cancelHeld(hero) || 'Construction is not ready.';
        if (action.index !== 0) return 'Invalid held building selection.';
        return game.desktopConstruction?.[type === 'preview' ? 'heldPreview' : 'placeHeld'](hero, action.location) || 'Construction is not ready.';
      }
      if (action?.archetype !== undefined) return 'Only your own held building can be controlled.';
      if (incapacitated || game.isScriptLocked() || hero.getEC('ECHealth').getHealth() <= 0 || builder.isBuilding() || builder.isThrowing()) return 'Finish the current action first.';
      let rangedTarget = false;
      if (type === 'target' && action?.phase) {
        const methods = controls?.movementMethods;
        if (methods) {
          const mode = methods.targetType.call({ getHeroEntity: () => hero }, target), previous = this.targetMode;
          this.targetMode = action.phase === 'release' ? null : mode;
          rangedTarget = mode === methods.rangedType;
          if (rangedTarget) { this.facingTarget = id; this.facingMethods = methods.gesture; }
          else this.endFacing(hero);
          if (rangedTarget && previous === mode || !rangedTarget && action.phase !== 'release') return 'Target selected.';
        } else if (action.phase !== 'release') return 'Target selection unavailable.';
      }
      if (type === 'upgradeBuilding') return game.desktopConstruction?.upgradeBuilding(hero, target, action.next, action.costs) || 'Construction is not ready.';
      if (type === 'cancelUpgrade') return game.desktopConstruction?.cancelUpgrade(hero, target, action.next, action.episode) || 'Construction is not ready.';
      if (type === 'speedup') return game.desktopConstruction?.speedup(hero, target, action.planned, action.cost) || 'Construction is not ready.';
      if (type === 'repair') return game.desktopConstruction?.repair(hero, target, action.costs) || 'Construction is not ready.';
      if (type === 'move') return game.desktopConstruction?.move(hero, target) || 'Construction is not ready.';
      if (['build', 'preview'].includes(type)) return game.desktopConstruction?.[type](hero, target, action.index, action.location) || 'Construction is not ready.';
      if (type === 'upgrade') return upgradeTotem(game, hero, players, target, action, controls);
      if (type === 'campaignStart' || type === 'campaignClose') {
        const offer = this.campaignOffer;
        this.campaignOffer = null;
        if (!offer || offer.entity !== target || offer.source !== id || offer.campaign !== action.campaign) return 'That campaign preview changed. Select the banner again.';
        if (type === 'campaignClose') { game.eventManager.notify('CampaignPrepareScreenExited'); return { message: 'Campaign preview closed.', save: true }; }
        const current = campaignContext(game, target, controls);
        if (!current || current.view.campaign !== offer.campaign || current.view.region !== offer.region) return 'That campaign changed or another player already started it.';
        const panel = controls.campaignMethods.create(game, game.globals);
        panel.warManager = current.owner; panel.setCampaignRegionName(current.view.region);
        panel.confirmCampaign(() => game.eventManager.notify('CampaignPrepareScreenExited'));
        return { message: 'Campaign started and saved.', save: true };
      }
      if (type === 'target' && !rangedTarget && target.getEC('ECCampaignStarter')) {
        const current = campaignContext(game, target, controls);
        this.campaignOffer = current ? { source: id, region: current.view.region, campaign: current.view.campaign, entity: target } : null;
        return current ? { message: 'Choose whether to begin this campaign.', campaign: current.view } : 'This campaign is not available right now.';
      }
      const totem = type === 'target' && !rangedTarget ? totemMenu(hero, target, controls) : null;
      if (totem) return { message: 'Choose a hero upgrade. Escape cancels.', totem };
      const construction = type === 'target' && !rangedTarget ? game.desktopConstruction?.menu(hero, target, controls) : null;
      if (construction && (construction.products.length || construction.move || construction.repair || construction.upgrade || construction.speedup)) return { message: 'Choose a building action. Escape cancels.', construction };
      const building = rangedTarget ? null : controls?.demolitionInfo(target);
      if (type === 'demolish') {
        if (!building || building.reason) return building?.reason || 'This building cannot be demolished.';
        controls.demolishBuilding(id);
        return { message: 'Building demolished and saved.', save: true };
      }
      if (building) return { message: building.reason || 'Building selected.', building: { id: building.id, name: building.name, reason: building.reason, movable: !!game.desktopConstruction?.canMove(hero, target) } };
      const resource = rangedTarget ? null : target.getEC('ECResourceDispenser');
      if (resource) {
        const interaction = target.getEC('ECInteractable');
        if (!interaction?.getActive() || resource.getResource() <= 0) return 'No resources available here.';
        if (interaction.shouldApproachOnUp(hero)) {
          // shortcut: movement-required resources need manual approach until native destination commands are exposed.
          if (target.getDistanceUsingSize(hero.getv3Location()) > hero.getRadius() + 0.5) return 'Move closer to gather.';
          const collision = game.getCollisionInfo(hero.getv3Location(), target.getv3Location(), false, hero);
          if (collision && collision.collidedEntity !== target) return 'The way is blocked.';
        }
        interaction.executeCallbacks(hero);
        return 'Resources gathered.';
      }
      const worker = !rangedTarget && type === 'target' && target.getEC('ECWildlingAgent');
      if (worker) {
        const selectable = target.getEC('ECSelectable'), interaction = target.getEC('ECInteractable'), trigger = hero.getEC('ECSmartSelectableTrigger');
        // Host-local smartValid/getValid cannot authorize a different hero's click.
        if (!hero.isFriendlyWith(target) || target.isDead() || !selectable || selectable.permanentValid === false || !game.getPlayFlags().validSelectTypes[selectable.archetype.selectType] || !interaction?.getActive() || !trigger) return 'Worker interaction is unavailable.';
        const origin = hero.getv3Location(), location = target.getv3Location();
        const radius = trigger.archetype.worldRadius * selectable.archetype.smartRadiusFactor + (selectable.triggererList?.includes(hero) ? 1 : 0);
        if (Math.hypot(location[0] - origin[0], location[2] - origin[2]) >= radius || origin[1] - 0.5 > location[1]) return 'Move closer to the worker.';
        interaction.executeCallbacks(hero);
        return { message: 'Worker acknowledged and saved.', save: true };
      }
      if (target === hero || !target.getEC('ECTarget')?.isValidTarget(hero) || !target.getEC('ECHealth') || target.getEC('ECHealth').getHealth() <= 0) return 'That target cannot be attacked.';
      if (!players.canDamage(target, hero)) return 'Friendly targets are protected.';
      const firearm = hero.getEC('ECFirearm'), automatic = hero.getEC('ECAutoFire');
      if (!firearm?.hasWeapon() || !(automatic ? automatic.isWithinFiringRange(target.getv3Location()) : firearm.isWithinRange(target.getv3Location()))) return 'Target out of weapon range.';
      const ready = firearm.getCanFire() && firearm.getAmmo() > 0;
      if (ready) {
        try { firearm.attemptFire(target); }
        finally { firearm.clearOverloadProjectile(); }
      }
      automatic?.setTargetEntity(target);
      if (ready || automatic) game.eventManager.notify('PlayerAttackedTarget', target);
      return ready ? 'Attack issued.' : automatic ? 'Target selected. Weapon is reloading.' : 'Weapon is reloading.';
    }
  }
  function pickTarget(world, event) {
    const globals = world.controls.app.globals, canvas = globals.graphicsDevice.canvas || root.document.getElementById('turbulenz_game_engine_canvas');
    const bounds = canvas.getBoundingClientRect(), x = (event.clientX - bounds.left) * globals.graphicsDevice.width / bounds.width, y = (event.clientY - bounds.top) * globals.graphicsDevice.height / bounds.height;
    let nearest = 32 * 32, selected = null;
    for (const { record, displayLocation } of world.scene.entities.values()) {
      if (!record.interactive || !record.mesh?.visible || record.id === world.identity.entity) continue;
      const factory = world.game?.getEntityFactory?.();
      if (factory?.getECArchetype(record.archetype, 'ECWildlingAgent')) {
        const actor = world.scene.entities.get(world.identity.entity), definition = factory.getECArchetype(record.archetype, 'ECSelectable');
        const trigger = actor && factory.getECArchetype(actor.record.archetype, 'ECSmartSelectableTrigger');
        if (!trigger || !definition?.smart || world.scene.snapshot.camera.mode !== 'explore' || world.hud?.state?.preparation || world.hud?.state?.island.prepare !== null) continue;
        const origin = actor.displayLocation || actor.record.location, location = displayLocation || record.location;
        const radius = trigger.worldRadius * definition.smartRadiusFactor + (world.resourceHighlights?.get(record.id)?.smartValid ? 1 : 0);
        if (Math.hypot(location[0] - origin[0], location[2] - origin[2]) >= radius || origin[1] - 0.5 > location[1]) continue;
      }
      const point = globals.camera.worldToScreen(displayLocation || record.location);
      if (!point) continue;
      const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (distance < nearest) { nearest = distance; selected = record.id; }
    }
    return selected;
  }
  const api = { HostActions, pickTarget };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftCoopActions = api;
})(globalThis);
