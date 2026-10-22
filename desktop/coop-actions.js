'use strict';
(function (root) {
  class HostActions {
    constructor(now = () => performance.now()) { this.now = now; this.sequence = 0; this.queue = []; this.tokens = 10; this.tokenTime = now(); }
    receive(value) {
      if (!value || Object.keys(value).length !== 3 || value.type !== 'target' || !Number.isSafeInteger(value.sequence) || value.sequence !== this.sequence + 1 || typeof value.target !== 'string' || !value.target.length || value.target.length > 256) throw new Error('Invalid or repeated target action.');
      const now = this.now();
      this.tokens = Math.min(10, this.tokens + Math.max(0, now - this.tokenTime) * 0.01); this.tokenTime = now;
      if (this.tokens < 1 || this.queue.length >= 4) throw new Error('Too many target actions.');
      this.tokens--; this.sequence = value.sequence; this.queue.push({ ...value });
    }
    apply(game, hero, players) {
      const action = this.queue.shift();
      if (!action) return null;
      const message = this.execute(game, hero, players, action.target);
      return { type: 'target', sequence: action.sequence, message };
    }
    execute(game, hero, players, id) {
      const target = game.getGameEntityByName(id);
      if (!target || target.shouldBeDestroyed() || hero.shouldBeDestroyed()) return 'Target unavailable.';
      const builder = hero.getEC('ECPlayerBuilder');
      if (game.isScriptLocked() || hero.getEC('ECHealth').getHealth() <= 0 || builder.isBuilding() || builder.isThrowing()) return 'Finish the current action first.';
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
    const factory = world.game.getEntityFactory();
    for (const { record } of world.scene.entities.values()) {
      if (!record.archetype || !record.mesh?.visible || record.id === world.identity.entity) continue;
      if (!factory.getECArchetype(record.archetype, 'ECResourceDispenser') && !factory.getECArchetype(record.archetype, 'ECTarget')) continue;
      const point = globals.camera.worldToScreen(record.location);
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
