'use strict';
(function (root) {
  const { totemMenu, upgradeTotem } = typeof module !== 'undefined' ? require('./totems.js') : root.PolycraftTotems;
  const { captureHud } = typeof module !== 'undefined' ? require('./hud.js') : root.PolycraftHud;
  function lifeStatus(life) {
    const phase = life.respawnTime !== undefined ? 'waiting' : life.state === life.states.DYING ? 'dying' : 'normal';
    const remaining = phase === 'waiting' ? Math.max(0, life.getTimeToRespawn()) : phase === 'dying' ? Math.max(0, life.getDeathAnimationDuration() - (life.globals.gameCurrentTime - life.deathTime)) : 0;
    const option = phase === 'waiting' && remaining > 0.200001 ? remaining > life.getRespawnHighCostDelay() ? 'amber' : 'lumber' : null;
    return { phase, remaining, episode: phase === 'normal' ? null : life.deathTime, option, affordable: !!(option && life.canAffordToRevive(option === 'amber' ? 10 : 0, option === 'lumber' ? 50 : 0)) };
  }
  class HostActions {
    constructor(now = () => performance.now()) { this.now = now; this.sequence = 0; this.queue = []; this.tokens = 10; this.tokenTime = now(); }
    receive(value) {
      const placement = ['build', 'preview'].includes(value?.type), upgrade = value?.type === 'upgrade', revive = value?.type === 'revive';
      const buildingUpgrade = value?.type === 'upgradeBuilding', cancelUpgrade = value?.type === 'cancelUpgrade';
      const quest = ['questOpen', 'questReward'].includes(value?.type);
      const held = value?.archetype !== undefined;
      if (!value || Object.keys(value).length !== (upgrade ? 6 : placement ? 5 : revive ? 5 : buildingUpgrade || cancelUpgrade ? 5 : value?.type === 'repair' || quest ? 4 : 3) + (held ? 1 : 0) || !['target', 'demolish', 'build', 'preview', 'upgrade', 'held', 'cancelBuild', 'life', 'revive', 'move', 'repair', 'upgradeBuilding', 'cancelUpgrade', 'questOpen', 'questReward'].includes(value.type) || !Number.isSafeInteger(value.sequence) || value.sequence !== this.sequence + 1 || typeof value.target !== 'string' || !value.target.length || value.target.length > 256) throw new Error('Invalid or repeated target action.');
      if (quest && (typeof value.quest !== 'string' || !/^taskId(?:crit|fill)_\d{1,4}$/.test(value.quest))) throw new Error('Invalid quest request.');
      if ((buildingUpgrade || cancelUpgrade) && (typeof value.next !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(value.next))) throw new Error('Invalid building upgrade.');
      if (cancelUpgrade && (!Number.isSafeInteger(value.episode) || value.episode < 1)) throw new Error('Invalid upgrade episode.');
      if ((value.type === 'repair' || buildingUpgrade) && (!Array.isArray(value.costs) || value.costs.length !== 2 || ![0, 1].every(index => typeof value.costs[index] === 'number' && Number.isFinite(value.costs[index]) && value.costs[index] >= 0 && value.costs[index] <= 2147483647))) throw new Error('Invalid resource quote.');
      if (revive && (typeof value.amber !== 'boolean' || typeof value.episode !== 'number' || !Number.isFinite(value.episode) || Math.abs(value.episode) > 1e9)) throw new Error('Invalid revive choice.');
      if (value.type === 'cancelBuild' && !held || held && (!(placement || value.type === 'cancelBuild') || typeof value.archetype !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(value.archetype))) throw new Error('Invalid held building selection.');
      if (placement && (!Number.isInteger(value.index) || value.index < 0 || value.index >= 32 || !Array.isArray(value.location) || value.location.length !== 3 || ![0, 1, 2].every(index => typeof value.location[index] === 'number' && Number.isFinite(value.location[index]) && Math.abs(value.location[index]) <= 1e6))) throw new Error('Invalid building placement.');
      if (upgrade && (!Number.isInteger(value.index) || value.index < 0 || value.index >= 2 || !Number.isInteger(value.level) || value.level < 0 || value.level >= 5 || typeof value.amber !== 'boolean')) throw new Error('Invalid totem upgrade.');
      const now = this.now();
      this.tokens = Math.min(10, this.tokens + Math.max(0, now - this.tokenTime) * 0.01); this.tokenTime = now;
      if (this.tokens < 1 || this.queue.length >= 4) throw new Error('Too many target actions.');
      this.tokens--; this.sequence = value.sequence; this.queue.push({ ...value, ...(placement ? { location: [...value.location] } : {}), ...(value.type === 'repair' || buildingUpgrade ? { costs: [...value.costs] } : {}) });
    }
    apply(game, hero, players, controls) {
      const action = this.queue.shift();
      if (!action) return null;
      const result = this.execute(game, hero, players, action.target, controls, action.type, action);
      return { type: action.type, sequence: action.sequence, ...(typeof result === 'string' ? { message: result } : result) };
    }
    execute(game, hero, players, id, controls, type = 'target', action) {
      const target = game.getGameEntityByName(id);
      if (!target || target.shouldBeDestroyed() || hero.shouldBeDestroyed()) return 'Target unavailable.';
      const builder = hero.getEC('ECPlayerBuilder');
      const life = hero.getEC('ECPlayerLife'), incapacitated = life && (life.isDead?.() || life.states && life.state !== life.states.NORMAL);
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
        if (type === 'life') return { message: 'Hero life state.', life: status, hud: captureHud(game, hero) };
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
      if (type === 'upgradeBuilding') return game.desktopConstruction?.upgradeBuilding(hero, target, action.next, action.costs) || 'Construction is not ready.';
      if (type === 'cancelUpgrade') return game.desktopConstruction?.cancelUpgrade(hero, target, action.next, action.episode) || 'Construction is not ready.';
      if (type === 'repair') return game.desktopConstruction?.repair(hero, target, action.costs) || 'Construction is not ready.';
      if (type === 'move') return game.desktopConstruction?.move(hero, target) || 'Construction is not ready.';
      if (['build', 'preview'].includes(type)) return game.desktopConstruction?.[type](hero, target, action.index, action.location) || 'Construction is not ready.';
      if (type === 'upgrade') return upgradeTotem(game, hero, players, target, action, controls);
      const totem = type === 'target' ? totemMenu(hero, target, controls) : null;
      if (totem) return { message: 'Choose a hero upgrade. Escape cancels.', totem };
      const construction = type === 'target' ? game.desktopConstruction?.menu(hero, target, controls) : null;
      if (construction && (construction.products.length || construction.move || construction.repair || construction.upgrade)) return { message: 'Choose a building action. Escape cancels.', construction };
      const building = controls?.demolitionInfo(target);
      if (type === 'demolish') {
        if (!building || building.reason) return building?.reason || 'This building cannot be demolished.';
        controls.demolishBuilding(id);
        return { message: 'Building demolished and saved.', save: true };
      }
      if (building) return { message: building.reason || 'Building selected.', building: { id: building.id, name: building.name, reason: building.reason, movable: !!game.desktopConstruction?.canMove(hero, target) } };
      const resource = target.getEC('ECResourceDispenser');
      if (resource) {
        const interaction = target.getEC('ECInteractable');
        if (!interaction?.getActive() || resource.getResource() <= 0) return 'No resources available here.';
        // shortcut: require walking into reach; add original click-to-approach with guest camera/input parity.
        if (target.getDistanceUsingSize(hero.getv3Location()) > hero.getRadius() + 0.5) return 'Move closer to gather.';
        const collision = game.getCollisionInfo(hero.getv3Location(), target.getv3Location(), false, hero);
        if (collision && collision.collidedEntity !== target) return 'The way is blocked.';
        interaction.executeCallbacks(hero);
        return 'Resources gathered.';
      }
      if (target === hero || !target.getEC('ECTarget')?.isValidTarget(hero) || !target.getEC('ECHealth') || target.getEC('ECHealth').getHealth() <= 0) return 'That target cannot be attacked.';
      if (!players.canDamage(target, hero)) return 'Friendly targets are protected.';
      const firearm = hero.getEC('ECFirearm');
      if (!firearm?.hasWeapon() || !firearm.isWithinRange(target.getv3Location())) return 'Target out of weapon range.';
      if (!firearm.getCanFire() || firearm.getAmmo() <= 0) return 'Weapon is reloading.';
      firearm.attemptFire(target);
      game.eventManager.notify('PlayerAttackedTarget', target);
      return 'Attack issued.';
    }
  }
  function pickTarget(world, event) {
    const globals = world.controls.app.globals, canvas = globals.graphicsDevice.canvas || root.document.getElementById('turbulenz_game_engine_canvas');
    const bounds = canvas.getBoundingClientRect(), x = (event.clientX - bounds.left) * globals.graphicsDevice.width / bounds.width, y = (event.clientY - bounds.top) * globals.graphicsDevice.height / bounds.height;
    let nearest = 32 * 32, selected = null;
    for (const { record, displayLocation } of world.scene.entities.values()) {
      if (!record.interactive || !record.mesh?.visible || record.id === world.identity.entity) continue;
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
