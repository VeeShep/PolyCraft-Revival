'use strict';
(function (root) {
  class HostConstruction {
    constructor(game) {
      if (game.desktopConstruction) throw new Error('Construction is already managed.');
      this.game = game; this.pending = new Set(); this.manager = game.getBuildingManager();
      this.original = { remaining: this.manager.getRemainingBuildingsBeforeCap, scaffolds: this.manager.getNumScaffoldsForCap };
      this.manager.getRemainingBuildingsBeforeCap = (type, parent) => {
        const local = parent?.getEC('ECPlacedBuildingTracker')?.getLocalBuildingCap(type);
        const reserved = [...this.pending].filter(item => !item.move && item.definition.buildingType === type && (!local || item.parent === parent)).length;
        return Math.max(0, this.original.remaining.call(this.manager, type, parent) - reserved);
      };
      this.manager.getNumScaffoldsForCap = type => (this.original.scaffolds.call(this.manager, type) || 0) + [...this.pending].filter(item => item.definition.obeysScaffoldCap && item.definition.scaffoldType === type).length;
      game.desktopConstruction = this;
    }
    owns(builder) { return !!this.game.desktopPlayers && [...this.game.desktopPlayers.active.values()].some(entry => entry.hero === builder.entity); }
    canPlace(builder) {
      if (!this.owns(builder)) return true;
      if (this.failure) return false;
      if (builder.getMoveFromEntity()) return true;
      const definition = this.game.getEntityFactory().getECArchetype(builder.getHeldObjectName(), 'ECBuilding');
      if (!definition) return false;
      return this.manager.canCreateBuilding(definition.buildingType, builder.spBuildingParentEntity?.get(), definition.prerequisites, definition.obeysScaffoldCap, definition.scaffoldType);
    }
    reserve(builder, archetype) {
      if (!this.owns(builder)) return null;
      const item = { builder, definition: this.game.getEntityFactory().getECArchetype(archetype, 'ECBuilding'), parent: builder.spBuildingParentEntity?.get(), move: !!builder.getMoveFromEntity() };
      item.done = new Promise(resolve => { item.resolve = resolve; });
      this.pending.add(item); return item;
    }
    complete(item, place) {
      if (!item) return place();
      this.pending.delete(item);
      try { return place(); }
      catch (error) { this.failure = error; throw error; }
      finally { item.resolve(); }
    }
    async settle() {
      let timer;
      try {
        await Promise.race([Promise.all([...this.pending].map(item => item.done)), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Construction has not finished. Wait before saving or closing.')), 5000); })]);
        if (this.failure) throw this.failure;
      } finally { clearTimeout(timer); }
    }
    build(hero, source, index, location) {
      const dispenser = source.getEC('ECDispenser'), builder = hero.getEC('ECPlayerBuilder');
      const owner = source.getEC('ECAttach')?.getBaseEntity() || source;
      if (!dispenser || dispenser.archetype.destroySelfOnDispense || dispenser.getQuantityPerPurchase(index) !== 1 || owner.shouldBeDestroyed?.() || owner.getEC('ECHealth')?.getHealth() <= 0 || !owner.isFriendlyWith(hero)) return 'This is not an available building dispenser.';
      const product = dispenser.getProductInfo(index);
      if (!product) return 'That building is not available here.';
      dispenser.evaluateProductInfo();
      if (!dispenser.getValid(index)) return 'Building prerequisites or capacity are not met.';
      if (!dispenser.canAfford(hero, index)) return 'Not enough resources.';
      const costs = [dispenser.getResourceCost(index), dispenser.getSecondaryResourceCost(index), dispenser.getSoftCurrencyCost(index)];
      const data = hero.getEC('ECPlayerData');
      let paid = false, accepted = false;
      try {
        builder.placeInHand(product.dispensedArchetypeName, 1, false, false, dispenser.buildingParentEntity, true);
        const position = builder.getv3BuildLocation(location);
        if (!builder.heldEntity || !this.canPlace(builder) || !builder.canBuildAtPosition(position)) return 'That building cannot be placed here.';
        dispenser.payForDispensedEntity(hero, index); paid = true;
        accepted = builder.attemptToPlaceBuilding(location);
        if (!accepted) return 'That building cannot be placed here.';
        return { message: 'Building placed and saved.', save: true };
      } finally {
        if (paid && !accepted && !builder.isThrowing()) {
          data.adjustResource(0, costs[0]); data.adjustResource(1, costs[1]);
          data.playerData.adjustSoftCurrency(costs[2]);
        }
        if (builder.isBuilding()) builder.clearInHand();
      }
    }
    close() {
      if (this.pending.size || this.failure) throw new Error('Finish construction before ending co-op.');
      this.manager.getRemainingBuildingsBeforeCap = this.original.remaining; this.manager.getNumScaffoldsForCap = this.original.scaffolds;
      delete this.game.desktopConstruction;
    }
  }
  if (typeof module !== 'undefined') module.exports = { HostConstruction };
  else root.PolycraftCoopConstruction = { HostConstruction };
})(globalThis);
