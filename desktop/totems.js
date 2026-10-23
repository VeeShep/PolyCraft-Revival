'use strict';
(function (root) {
  function totemMenu(hero, source, controls) {
    const shrine = source.getEC('ECHeroShrine');
    if (!shrine || !source.getEC('ECInteractable')?.getActive()) return null;
    const data = hero.getEC('ECPlayerData'), upgrades = hero.getEC('ECHeroUpgrades');
    const level = data.getLevel(), points = data.getUpgradePoints();
    return { source: source.getName(), level, points, products: shrine.archetype.upgradeTypes.map((definition, index) => {
      const current = upgrades.getHeroUpgrade(definition.upgradeType), maxed = current >= definition.levels.length - 1;
      const prerequisites = definition.prerequisites.every(item => upgrades.getHeroUpgrade(item.upgradeType) >= item.level);
      const amber = points === 0 && level > 0 && !maxed;
      const eligibilityLevel = amber ? level + 1 : level;
      const eligible = !maxed && prerequisites && eligibilityLevel >= definition.minimumHeroLevel;
      const available = eligible && (points > 0 || (amber && controls.xpTable[level + 1] !== undefined && data.getSoftCurrency() >= 75));
      let text = definition.upgradeDisplayName + '\n';
      if (!level && !points) text = 'Level Up\nto unlock hero upgrades';
      else if (maxed) text += '(Maxed Out!)';
      else if (!prerequisites) text += '(Need to upgrade ' + definition.prerequisiteText + ')';
      else if (eligibilityLevel < definition.minimumHeroLevel) text += '(Unlocked at Level ' + definition.minimumHeroLevel + ')';
      else if (amber) text += '(Level up or boost using Amber)';
      else text += definition.levels[current + 1].levelText;
      return { index, level: current, available, amber, text };
    }) };
  }
  function upgradeTotem(game, hero, players, source, action, controls) {
    const menu = totemMenu(hero, source, controls), product = menu?.products[action.index];
    if (!product || product.level !== action.level || product.amber !== action.amber) return 'That upgrade changed. Select the totem again.';
    if (!product.available) return 'Upgrade requirements are not met, or there is not enough Amber.';
    if (product.amber) {
      const id = [...players.active].find(([, entry]) => entry.hero === hero)?.[0];
      if (!id) throw new Error('The upgrade hero is not assigned to this session.');
      const data = hero.getEC('ECPlayerData');
      data.adjustSoftCurrency(-75); data.levelUp();
      hero = players.active.get(id).hero;
    }
    const shrine = source.getEC('ECHeroShrine'), upgrades = hero.getEC('ECHeroUpgrades');
    // Shrine caches describe the host; a private view keeps each guest's levels separate.
    const view = Object.assign(Object.create(shrine), { upgradeLevels: shrine.archetype.upgradeTypes.map(item => upgrades.getHeroUpgrade(item.upgradeType)) });
    view.upgradeHero(hero, action.index);
    return { message: 'Hero upgraded and saved.', save: true, totem: totemMenu(hero, source, controls) };
  }
  const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  class GuestTotem {
    constructor(world) { this.world = world; }
    cancel() { this.menu = this.pending = null; }
    receive(value, selected) {
      const menu = value.totem;
      if (menu) {
        if (!keys(menu, ['source', 'level', 'points', 'products'])) throw new Error('Invalid totem menu.');
        const definition = this.world.game.getEntityFactory().getECArchetype(this.world.scene.entities.get(menu.source)?.record.archetype, 'ECHeroShrine');
        if (typeof menu.source !== 'string' || !menu.source.length || menu.source.length > 256 || !Number.isSafeInteger(menu.level) || menu.level < 0 || menu.level >= this.world.controls.xpTable.length || !Number.isSafeInteger(menu.points) || menu.points < 0 || menu.points > 2147483647 + this.world.controls.xpTable.length - 1 || !definition || !Array.isArray(menu.products) || menu.products.length !== definition.upgradeTypes.length) throw new Error('Invalid totem menu.');
        for (let index = 0; index < menu.products.length; index++) {
          const product = menu.products[index];
          if (!keys(product, ['index', 'level', 'available', 'amber', 'text']) || product.index !== index || !Number.isInteger(product.level) || product.level < 0 || product.level >= definition.upgradeTypes[index].levels.length || typeof product.available !== 'boolean' || typeof product.amber !== 'boolean' || typeof product.text !== 'string' || product.text.length > 512) throw new Error('Invalid totem upgrade.');
        }
      }
      if (selected) { this.menu = menu ? structuredClone(menu) : null; this.updated = performance.now(); }
      if (value.type === 'upgrade' && this.pending === value.sequence) { this.lastResult = structuredClone(value); this.cancel(); }
    }
    update() {
      if (!this.menu) return;
      const world = this.world, entry = world.scene.entities.get(this.menu.source);
      if (!entry || world.controls.paused || !world.movement.nativeFocused || world.resyncing) { world.cancelLocalMenu(); return; }
      if (performance.now() - this.updated > 1000 && !world.selectionRequest && !this.pending) world.selectionRequest = world.sendTarget('target', this.menu.source);
      const gui = world.game.getIMGui(), scale = gui.getRadialScaleFactor(this.menu.products.length);
      const point = world.controls.app.globals.camera.worldToScreen(entry.displayLocation || entry.record.location);
      if (!point) return;
      const center = gui.getRadialCentre(point, scale), globals = world.controls.app.globals;
      // Original radial bounds leave room for icons but clip the lower two-line label.
      center[1] = Math.min(center[1], Math.max(gui.getRadialSize(scale), globals.graphicsDevice.height - gui.getRadialSize(scale) - 120 * globals.guiRenderer.getScaleFactor()));
      world.game.getGuiManager().addDrawGui('radialFrame', { v2ScreenLocation: center, scale }, 'guest-totem-frame');
      const definition = world.game.getEntityFactory().getECArchetype(entry.record.archetype, 'ECHeroShrine');
      for (const product of this.menu.products) {
        const style = product.amber ? 'heroUpgradeUsingAmber' : product.available ? 'heroUpgradeValid' : 'heroUpgradeInvalid';
        if (gui.doButtonFromGuiArchetype(style, { text1: product.text, text4: product.amber ? '75' : '', svg1: definition.svgPath,
          buttonType: world.controls.guiTypes.BUTTON_ROUND, v2ScreenLocation: gui.addRadialOffset(center, product.index, this.menu.products.length, scale) }, 'guest-totem-' + this.menu.source + '-' + product.index) && product.available && !this.pending) {
          this.lastResult = null; world.selectionRequest = null; this.pending = world.sendUpgrade(this.menu.source, product.index, product.level, product.amber);
        }
      }
    }
  }
  const api = { totemMenu, upgradeTotem, GuestTotem };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftTotems = api;
})(globalThis);
