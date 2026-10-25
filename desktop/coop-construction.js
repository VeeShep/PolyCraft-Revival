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
    dispenser(hero, source) {
      const dispenser = source.getEC('ECDispenser');
      const owner = source.getEC('ECAttach')?.getBaseEntity() || source;
      return dispenser && !dispenser.archetype.destroySelfOnDispense && !owner.shouldBeDestroyed?.() && !(owner.getEC('ECHealth')?.getHealth() <= 0) && owner.isFriendlyWith(hero) ? dispenser : null;
    }
    menu(hero, source) {
      const dispenser = this.dispenser(hero, source);
      if (!dispenser?.contents.length) return null;
      dispenser.evaluateProductInfo();
      return { source: source.getName(), products: dispenser.contents.slice(0, 32).flatMap((product, index) => {
        if (dispenser.archetype.showUnavailableDueToPrerequisites === false && !dispenser.arePrerequisitesMet(index)) return [];
        if (dispenser.getQuantityPerPurchase(index) !== 1 || !this.game.getEntityFactory().getECArchetype(product.dispensedArchetypeName, 'ECBuilding')) return [];
        return [{ index, name: dispenser.getDispenseName(index), archetype: product.dispensedArchetypeName,
          costs: [dispenser.getResourceCost(index), dispenser.getSecondaryResourceCost(index), dispenser.getSoftCurrencyCost(index)],
          valid: !!dispenser.getValid(index), affordable: !!dispenser.canAfford(hero, index), time: dispenser.getBuildTime(index), repeat: !!dispenser.getUsesInfiniteBuildMode(index) }];
      }) };
    }
    preview(hero, source, index, location) {
      const dispenser = this.dispenser(hero, source), product = dispenser?.getProductInfo(index);
      if (!product || dispenser.getQuantityPerPurchase(index) !== 1) return 'That building is not available here.';
      const factory = this.game.getEntityFactory(), definition = factory.getECArchetype(product.dispensedArchetypeName, 'ECBuilding');
      if (!definition) return 'That building is not available here.';
      dispenser.evaluateProductInfo();
      // Shadow placement fields only: preview queries must never create entities, spend or fire EmptyHanded.
      const builder = Object.assign(Object.create(hero.getEC('ECPlayerBuilder')), {
        heldObjectName: product.dispensedArchetypeName, v3HeldObjectExtents: factory.getv3ObjectFootprintExtents(product.dispensedArchetypeName),
        heldObjectFootplateBuffer: factory.getObjectBuildBuffer(product.dispensedArchetypeName),
        spBuildingParentEntity: dispenser.buildingParentEntity?.getSmartPointer(), spMoveFromEntity: undefined,
        v3LastPlacedLocation: undefined, throwing: 0, maxLinePlacementLength: factory.getBuildingMaxLinePlacementLength(product.dispensedArchetypeName),
        heldEntityIsTrap: definition.buildingType === 'Trap', heldEntityCanPlaceAnywhere: definition.canPlaceAnywhere, heldEntityStackable: definition.stackable,
        heldEntityMustPlaceNearCreator: definition.mustPlaceNearCreator, heldEntityBuildingType: definition.buildingType
      });
      const snapped = builder.getv3BuildLocation(location);
      const valid = !!(dispenser.getValid(index) && dispenser.canAfford(hero, index) && this.canPlace(builder) && builder.canBuildAtPosition(snapped));
      return { message: valid ? 'Click to place. Escape cancels.' : 'Cannot build here, or requirements are not met.',
        preview: { source: source.getName(), index, location: [...location], position: Array.from(this.game.placeOnGround(snapped, 0.1)),
          extents: [builder.v3HeldObjectExtents[0], builder.v3HeldObjectExtents[2]], buffer: builder.heldObjectFootplateBuffer, valid } };
    }
    heldStatus(hero) {
      const builder = hero.getEC('ECPlayerBuilder');
      return builder.isBuilding() ? { archetype: builder.getHeldObjectName(), quantity: builder.getHeldItemQuantity(), cancelable: builder.canCancelHeldBuilding() } : null;
    }
    heldPreview(hero, location) {
      const builder = hero.getEC('ECPlayerBuilder');
      if (!builder.isBuilding() || builder.isThrowing()) return 'No settled building is held.';
      const position = builder.getv3BuildLocation(location), extents = builder.getv3HeldObjectExtents();
      const valid = !!(this.canPlace(builder) && builder.canBuildAtPosition(position) && builder.canAffordToPlaceBuilding() && (!builder.shouldPayWhenPlacingBuildings || builder.areBuildingPrerequisitesMet(builder.getHeldObjectName())));
      return { message: valid ? 'Click to place the held building.' : 'Cannot place the held building here.',
        preview: { source: hero.getName(), index: 0, location: [...location], position: Array.from(this.game.placeOnGround(position, 0.1)), extents: [extents[0], extents[2]], buffer: builder.heldObjectFootplateBuffer, valid } };
    }
    placeHeld(hero, location) {
      const builder = hero.getEC('ECPlayerBuilder');
      if (!builder.isBuilding() || builder.isThrowing()) return 'No settled building is held.';
      if (!builder.attemptToPlaceBuilding(location)) return 'That held building cannot be placed here.';
      return { message: 'Held building placed and saved.', save: true, held: this.heldStatus(hero) };
    }
    cancelHeld(hero) {
      const builder = hero.getEC('ECPlayerBuilder');
      if (builder.isThrowing() || !builder.cancelHeldBuilding()) return 'That held building cannot be cancelled.';
      return { message: 'Held building cancelled and saved.', save: true, held: null };
    }
    build(hero, source, index, location) {
      const dispenser = this.dispenser(hero, source), builder = hero.getEC('ECPlayerBuilder');
      if (!dispenser || dispenser.getQuantityPerPurchase(index) !== 1) return 'This is not an available building dispenser.';
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
