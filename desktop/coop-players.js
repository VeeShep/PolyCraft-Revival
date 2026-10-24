'use strict';
(function (root) {
  const { CoopData } = typeof module !== 'undefined' ? require('./coop-data.js') : root.PolycraftCoopData;
  class CoopPlayers {
    constructor(game, bridge) {
      if (game.desktopPlayers || bridge.coopEconomy || !game.getHero()) throw new Error('This island already has co-op heroes or has no solo hero.');
      this.game = game; this.bridge = bridge; this.registry = new CoopData(bridge.state); this.active = new Map();
      this.pendingRefresh = new Set();
      const soloHero = game.getHero(), globals = game.globals;
      this.requireIdle(soloHero);
      this.weaponDefinition = soloHero.getEC('ECInventory').getWeaponDefinition;
      for (const record of this.registry.data.players) this.checkWeapons(record);
      this.solo = { model: game.playerData, name: soloHero.getName(), archetype: soloHero.getArchetypeName(),
        record: this.captureHero(soloHero), crown: game.amberCrown, owned: globals.gamePurchaseManager.owned,
        items: globals.storeManager.userItems, basket: bridge.basket, onEmptyHanded: globals.gamePurchaseManager.onEmptyHandedCallback };
      if (this.solo.onEmptyHanded) globals.gamePurchaseManager.removeConsumeOnBuildingPlacement();
      game.desktopPlayers = this;
      bridge.coopEconomy = this.registry.data.economy;
      bridge.basket = {};
      globals.storeManager.userItems = bridge.coopEconomy.userItems;
      globals.gamePurchaseManager.owned = Object.fromEntries(Object.entries(bridge.coopEconomy.userItems).filter(([key, item]) => item.amount > 0 && bridge.metadata.store.resources[key]?.type === 'own').map(([key]) => [key, true]));
      game.amberCrown = Boolean(bridge.coopEconomy.userItems['amber-crown']?.amount);
      try {
        this.destroy(soloHero);
        this.add(this.registry.data.host);
        this.registry.persist();
      } catch (error) { this.close(); throw error; }
    }
    checkWeapons(record) {
      for (const name of [record.inventory.weapon, record.inventory.mainWeapon]) {
        if (name !== null && (!name.startsWith('wp_h_') || !this.weaponDefinition(name))) throw new Error('Unknown saved hero weapon: ' + name);
      }
    }
    allowsHeroPvp(entity) {
      return this.game.globals.desktopWorld?.transport.pvp === true && [...this.active.values()].some(entry => entry.hero === entity);
    }
    canDamage(victim, aggressor) {
      if (!victim || victim.shouldBeDestroyed() || aggressor?.shouldBeDestroyed()) return false;
      if (!aggressor || victim === aggressor) return true;
      const host = this.active.get(this.registry.data.host)?.hero;
      if (!host || !victim.isFriendlyWith(aggressor) || !aggressor.isFriendlyWith(host)) return true;
      return this.allowsHeroPvp(victim) && this.allowsHeroPvp(aggressor);
    }
    requireIdle(hero) {
      const builder = hero.getEC('ECPlayerBuilder');
      if (builder.isBuilding() || builder.isThrowing() || this.game.globals.gamePurchaseManager.consumeBuildingInProgress) throw new Error('Finish placing the held building and wait for shop requests before saving, switching heroes or ending co-op.');
    }
    captureHero(hero) {
      const carrier = hero.getEC('ECResourceCarrier');
      // Complete in-flight deliveries before removing their carrier, so they cannot be lost or paid twice.
      if (carrier.hasAnyFlyingResource()) for (const tween of [...carrier.flyingTweens]) tween.complete();
      const health = hero.getEC('ECHealth'), firearm = hero.getEC('ECFirearm'), inventory = hero.getEC('ECInventory');
      return { location: Array.from(hero.getv3Location()), rotation: Number(hero.getRotationY()),
        health: { current: Math.max(0, Math.min(health.getHealth(), health.getMaxHealth())), maximum: health.getMaxHealth() },
        inventory: { weapon: inventory.getHeldWeapon(), mainWeapon: firearm.mainWeaponName || null,
          ammo: firearm.getAmmo(), temporaryAmmo: firearm.temporaryWeaponAmmo || 0, carried: [carrier.getResource(0), carrier.getResource(1)] } };
    }
    restoreHero(hero, record) {
      if (record.location === null) return;
      hero.setRotationY(record.rotation);
      const inventory = hero.getEC('ECInventory'), firearm = hero.getEC('ECFirearm'), saved = record.inventory;
      if (saved.mainWeapon) {
        firearm.setWeapon(saved.mainWeapon);
        inventory.setHeldWeapon(saved.mainWeapon);
        inventory.equippedItems = [saved.mainWeapon];
      }
      if (saved.weapon) {
        firearm.setWeapon(saved.weapon, saved.temporaryAmmo);
        inventory.setHeldWeapon(saved.weapon);
      } else inventory.unequipWeapon();
      firearm.ammo = Math.min(saved.ammo, firearm.getClipSize()); firearm.onAmmoChange();
      const carrier = hero.getEC('ECResourceCarrier');
      for (let index = 0; index < 2; index++) carrier.adjustResource(index, saved.carried[index] - carrier.getResource(index));
      if (record.health) {
        const health = hero.getEC('ECHealth');
        health.health = health.getMaxHealth() * record.health.current / record.health.maximum;
        health.onHealthChange();
        if (record.health.current === 0) hero.getEC('ECPlayerLife').scheduleRespawn(this.game.getHeroRespawnPosition(), 0);
      }
    }
    spawn(record, model, name, archetype) {
      const game = this.game, previous = game.playerData, index = game.randomPlayerIndex;
      let hero;
      try {
        game.playerData = model;
        game.randomPlayerIndex = this.registry.data.players.findIndex(player => player.id === record.id) + 1 || index;
        hero = game.createHero(name, archetype || game.getHeroArchetype(model), record.location);
        this.restoreHero(hero, record);
        return hero;
      } catch (error) { if (hero) this.destroy(hero); throw error; }
      finally { game.playerData = previous; game.randomPlayerIndex = index; }
    }
    destroy(hero) {
      // Projectiles must not retain an owner whose components are about to be destroyed.
      for (const space of this.game.getGameSpaceList()) for (const projectile of space.getEntitiesWithEC('ECProjectile')) if (projectile.getEC('ECProjectile').getOwner() === hero) projectile.setToBeDestroyed();
      for (const queue of [this.game.actionManager.actionList, this.game.actionManager.otherActionList]) for (let index = queue.length - 1; index >= 0; index--) {
        const action = queue[index];
        if (action.actionName === 'ApplyDamageToEntity' && (action.actionArguments.aggressor === hero || action.actionArguments.victim === hero)) queue.splice(index, 1);
      }
      hero.setToBeDestroyed();
      for (const space of this.game.getGameSpaceList()) space.destroyDeadEntities();
    }
    add(id) {
      if (this.closed || this.active.has(id)) throw new Error('This co-op hero is already active or the session ended.');
      const record = this.registry.player(id), model = this.registry.createPlayerData(this.solo.model, id);
      this.checkWeapons(record);
      const hero = this.spawn(record, model, id === this.registry.data.host ? this.solo.name : 'CoopHero_' + id);
      this.active.set(id, { hero, model });
      if (id === this.registry.data.host) { this.game.playerData = model; this.game.setHero(hero); }
      return hero;
    }
    capture() {
      // shortcut: require idle builders until held construction has versioned save/restore support.
      for (const { hero } of this.active.values()) this.requireIdle(hero);
      for (const [id, { hero }] of this.active) Object.assign(this.registry.player(id), this.captureHero(hero));
      this.registry.persist();
    }
    remove(id) {
      if (id === this.registry.data.host) throw new Error('The host hero stays until the session ends.');
      const entry = this.active.get(id);
      if (!entry) return;
      this.requireIdle(entry.hero);
      Object.assign(this.registry.player(id), this.captureHero(entry.hero)); this.registry.persist();
      this.destroy(entry.hero); this.active.delete(id);
    }
    refresh(hero) {
      const entry = [...this.active.entries()].find(([, value]) => value.hero === hero);
      if (!entry) throw new Error('Cannot refresh a hero outside this co-op session.');
      const [id, value] = entry, record = this.registry.player(id);
      const builder = hero.getEC('ECPlayerBuilder');
      // shortcut: defer replacement while holding construction; persist held construction before allowing forced removal.
      if (builder.isBuilding() || builder.isThrowing()) { this.pendingRefresh.add(id); return hero; }
      this.pendingRefresh.delete(id);
      Object.assign(record, this.captureHero(hero));
      this.destroy(hero);
      value.hero = this.spawn(record, value.model, id === this.registry.data.host ? this.solo.name : 'CoopHero_' + id);
      if (id === this.registry.data.host) this.game.setHero(value.hero);
      this.registry.persist();
      return value.hero;
    }
    flushRefreshes() {
      for (const id of [...this.pendingRefresh]) {
        const entry = this.active.get(id);
        if (entry) this.refresh(entry.hero); else this.pendingRefresh.delete(id);
      }
    }
    close() {
      if (this.closed) return;
      for (const { hero } of this.active.values()) this.requireIdle(hero);
      this.capture();
      const game = this.game, globals = game.globals;
      for (const { hero } of this.active.values()) this.destroy(hero);
      this.active.clear();
      delete game.desktopPlayers; delete this.bridge.coopEconomy;
      if (globals.gamePurchaseManager.onEmptyHandedCallback) globals.gamePurchaseManager.removeConsumeOnBuildingPlacement();
      game.playerData = this.solo.model; game.amberCrown = this.solo.crown;
      globals.gamePurchaseManager.owned = this.solo.owned; globals.storeManager.userItems = this.solo.items;
      this.bridge.basket = this.solo.basket;
      if (this.solo.onEmptyHanded) {
        globals.gamePurchaseManager.onEmptyHandedCallback = this.solo.onEmptyHanded;
        game.eventManager.subscribe('EmptyHanded', this.solo.onEmptyHanded);
      }
      game.setHero(this.spawn(this.solo.record, this.solo.model, this.solo.name, this.solo.archetype));
      this.closed = true;
    }
  }
  const api = { CoopPlayers };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftCoopPlayers = api;
})(globalThis);
