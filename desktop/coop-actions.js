'use strict';
(function (root) {
  const { totemMenu, upgradeTotem } = typeof module !== 'undefined' ? require('./totems.js') : root.PolycraftTotems;
  class HostActions {
    constructor(now = () => performance.now()) { this.now = now; this.sequence = 0; this.queue = []; this.tokens = 10; this.tokenTime = now(); }
    receive(value) {
      const placement = ['build', 'preview'].includes(value?.type), upgrade = value?.type === 'upgrade';
      const held = value?.archetype !== undefined;
      if (!value || Object.keys(value).length !== (upgrade ? 6 : placement ? 5 : 3) + (held ? 1 : 0) || !['target', 'demolish', 'build', 'preview', 'upgrade', 'held', 'cancelBuild'].includes(value.type) || !Number.isSafeInteger(value.sequence) || value.sequence !== this.sequence + 1 || typeof value.target !== 'string' || !value.target.length || value.target.length > 256) throw new Error('Invalid or repeated target action.');
      if (value.type === 'cancelBuild' && !held || held && (!(placement || value.type === 'cancelBuild') || typeof value.archetype !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(value.archetype))) throw new Error('Invalid held building selection.');
      if (placement && (!Number.isInteger(value.index) || value.index < 0 || value.index >= 32 || !Array.isArray(value.location) || value.location.length !== 3 || ![0, 1, 2].every(index => typeof value.location[index] === 'number' && Number.isFinite(value.location[index]) && Math.abs(value.location[index]) <= 1e6))) throw new Error('Invalid building placement.');
      if (upgrade && (!Number.isInteger(value.index) || value.index < 0 || value.index >= 2 || !Number.isInteger(value.level) || value.level < 0 || value.level >= 5 || typeof value.amber !== 'boolean')) throw new Error('Invalid totem upgrade.');
      const now = this.now();
      this.tokens = Math.min(10, this.tokens + Math.max(0, now - this.tokenTime) * 0.01); this.tokenTime = now;
      if (this.tokens < 1 || this.queue.length >= 4) throw new Error('Too many target actions.');
      this.tokens--; this.sequence = value.sequence; this.queue.push({ ...value, ...(placement ? { location: [...value.location] } : {}) });
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
      if (['build', 'preview'].includes(type)) return game.desktopConstruction?.[type](hero, target, action.index, action.location) || 'Construction is not ready.';
      if (type === 'upgrade') return upgradeTotem(game, hero, players, target, action, controls);
      const totem = type === 'target' ? totemMenu(hero, target, controls) : null;
      if (totem) return { message: 'Choose a hero upgrade. Escape cancels.', totem };
      const construction = type === 'target' ? game.desktopConstruction?.menu(hero, target) : null;
      if (construction?.products.length) return { message: 'Choose a building. Escape cancels.', construction };
      const building = controls?.demolitionInfo(target);
      if (type === 'demolish') {
        if (!building || building.reason) return building?.reason || 'This building cannot be demolished.';
        controls.demolishBuilding(id);
        return { message: 'Building demolished and saved.', save: true };
      }
      if (building) return { message: building.reason || 'Building selected.', building: { id: building.id, name: building.name, reason: building.reason } };
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
