'use strict';
(function (root) {
  const resources = [1, 1, 1, 0, 0, 0], fractions = [0.1, 0.5, 1, 0.1, 0.5, 1];
  function shopView(menu, controls) {
    const data = { getResource: index => menu.resources[index], getResourceCap: index => menu.caps[index], getSoftCurrency: () => menu.amber };
    return Object.assign(Object.create(controls.shopMethods), { globals: controls.app.globals, gameManager: { getHero: () => ({ getEC: () => data }) } });
  }
  function craftMenu(hero, quote) {
    const data = hero.getEC('ECPlayerData');
    return { quote, resources: [data.getResource(0), data.getResource(1)], caps: [data.getResourceCap(0), data.getResourceCap(1)], amber: data.getSoftCurrency() };
  }
  function craftOffer(menu, index, controls) {
    const view = shopView(menu, controls);
    view.clearAmberCosts();
    // The original six slots hide duplicate Amber prices separately for wood and stone.
    for (let slot = 0; slot <= index; slot++) {
      const resource = resources[slot], fraction = fractions[slot];
      const visible = view.costAboveZeroAndNotUsed(resource, fraction);
      if (slot === index) {
        const amount = Math.round(Math.min(fraction * menu.caps[resource], menu.caps[resource] - menu.resources[resource]));
        return visible ? { resource, fraction, amount, cost: view.getCostForResourceAmount(amount) } : null;
      }
    }
  }
  const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2147483647;
  class GuestCraft {
    constructor(world) { this.world = world; }
    cancel() { this.menu = false; this.pending = this.view = this.state = null; }
    open() {
      const world = this.world;
      if (!world.identity || world.resyncing || world.connection.state !== 'connected') return;
      world.cancelLocalMenu(); this.menu = true; world.movement.flush(); this.refresh();
    }
    refresh() { this.pending = this.world.sendTarget('craftMenu', this.world.identity.entity); }
    receive(value) {
      const menu = value.craft;
      if (menu !== undefined && (!['craftMenu', 'craftResource'].includes(value.type) || !keys(menu, ['quote', 'resources', 'caps', 'amber']) || !Number.isSafeInteger(menu.quote) || menu.quote !== value.sequence || !amount(menu.amber) || ![menu.resources, menu.caps].every(values => Array.isArray(values) && values.length === 2 && [0, 1].every(index => amount(values[index]))))) throw new Error('Invalid crafting menu.');
      if (!['craftMenu', 'craftResource'].includes(value.type) || value.sequence !== this.pending) return;
      this.pending = null;
      if (!this.menu) return;
      if (!menu) { this.cancel(); return; }
      this.state = structuredClone(menu); this.updated = performance.now();
      const world = this.world, gui = world.game.getIMGui();
      this.view = shopView(this.state, world.controls);
      Object.assign(this.view.gameManager, { getGuiManager: () => world.game.getGuiManager(), getIMGui: () => ({ doBackground: () => gui.doBackground(), doText: (...args) => gui.doText(...args), doButton: options => gui.doButton({ ...options, passive: false }) }) });
      this.view.exit = () => world.cancelLocalMenu();
      this.view.fillFraction = (resource, fraction) => {
        if (this.pending || !this.menu) return;
        const index = resources.findIndex((item, slot) => item === resource && fractions[slot] === fraction);
        const sequence = this.pending = ++world.targetSequence;
        world.connection.send('action', { type: 'craftResource', target: world.identity.entity, sequence, quote: this.state.quote, index }).catch(error => { if (!world.connection.closed) world.connection.fail(error); });
      };
      this.view.setButtonPanal('resource');
      // Only normal conversions are available to guests, even when the host has enabled cheats.
      this.view.tabList = this.view.tabList.filter(tab => tab.guiArchetype === 'shopTabCraftUp');
      this.view.tabList[0].action = () => { if (!this.pending) this.refresh(); };
    }
    update() {
      if (!this.menu) return false;
      const world = this.world;
      if (world.controls.paused || !world.movement.nativeFocused || world.resyncing) { world.cancelLocalMenu(); return true; }
      if (!this.view) {
        const gui = world.game.getIMGui(), location = world.controls.app.globals.guiRenderer.getv2RenderLocation.bind(world.controls.app.globals.guiRenderer);
        gui.doBackground();
        gui.doText('Waiting for host…', location(0, 0), 20, 1);
        if (gui.doButton({ id: 'Shop Resume', guiArchetype: 'shopClose', buttonType: world.controls.guiTypes.BUTTON_NORMAL, v2ScreenLocation: location(-100, 100, 'topRight') })) world.cancelLocalMenu();
      } else {
        this.view.updateMenu(); this.view.handleClickEvent();
        if (this.menu && !this.pending && performance.now() - this.updated > 1000) this.refresh();
      }
      return true;
    }
  }
  const api = { craftMenu, craftOffer, GuestCraft };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftCrafting = api;
})(globalThis);
