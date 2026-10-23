'use strict';
(function (root) {
  const keys = (value, names) => value && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const vector = (value, size) => Array.isArray(value) && value.length === size && Array.from({ length: size }, (_, index) => value[index]).every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e6);
  class GuestConstruction {
    constructor(world) { this.world = world; this.lastQuery = -Infinity; }
    cancel() { this.menu = this.placement = this.preview = this.request = this.pending = null; this.click = false; }
    receive(value, selected) {
      if (value.construction) {
        const menu = value.construction, indices = new Set(), factory = this.world.game.getEntityFactory();
        if (value.type !== 'target' || !keys(menu, ['source', 'products']) || !text(menu.source) || !Array.isArray(menu.products) || !menu.products.length || menu.products.length > 32) throw new Error('Invalid construction menu.');
        for (const product of menu.products) {
          if (!keys(product, ['index', 'name', 'archetype', 'costs', 'valid', 'affordable', 'time', 'repeat']) || !Number.isInteger(product.index) || product.index < 0 || product.index >= 32 || indices.has(product.index) || !text(product.name) || !text(product.archetype) || !factory.getECArchetype(product.archetype, 'ECBuilding') || !Array.isArray(product.costs) || product.costs.length !== 3 || ![0, 1, 2].every(index => Number.isSafeInteger(product.costs[index]) && product.costs[index] >= 0 && product.costs[index] <= 2147483647) || !['valid', 'affordable', 'repeat'].every(key => typeof product[key] === 'boolean') || typeof product.time !== 'number' || !Number.isFinite(product.time) || product.time < 0 || product.time > 1e9) throw new Error('Invalid construction product.');
          indices.add(product.index);
        }
        if (selected) { this.menu = structuredClone(menu); this.menuUpdated = performance.now(); this.placement = this.preview = this.request = this.pending = null; }
      } else if (selected) this.menu = null;
      if (value.preview) {
        const preview = value.preview;
        if (value.type !== 'preview' || !keys(preview, ['source', 'index', 'location', 'position', 'extents', 'buffer', 'valid']) || !text(preview.source) || !Number.isInteger(preview.index) || preview.index < 0 || preview.index >= 32 || !vector(preview.location, 3) || !vector(preview.position, 3) || !vector(preview.extents, 2) || preview.extents.some(number => number < 0 || number > 1000) || typeof preview.buffer !== 'number' || !Number.isFinite(preview.buffer) || preview.buffer < 0 || preview.buffer > 1000 || typeof preview.valid !== 'boolean') throw new Error('Invalid building preview.');
      }
      if (value.type === 'preview' && this.request?.sequence === value.sequence) {
        if (value.preview && (value.preview.source !== this.placement?.source || value.preview.index !== this.placement?.product.index)) throw new Error('Preview selects another product.');
        this.preview = value.preview ? structuredClone(value.preview) : null; this.request = null;
      }
      if (value.type === 'build' && this.pending === value.sequence) {
        this.lastBuildResult = { ...value }; this.pending = null; this.preview = null; this.lastQuery = performance.now();
        if (!this.placement?.product.repeat) this.cancel();
      }
    }
    cursor() {
      const world = this.world, globals = world.controls.app.globals, math = globals.mathDevice, camera = globals.camera;
      const hero = world.scene.entities.get(world.identity.entity), device = globals.graphicsDevice;
      if (!hero || !device.width || !device.height) return null;
      const [x, y] = world.guiInput.position;
      const inverse = math.m44Inverse(camera.viewProjectionMatrix);
      if (!inverse?.length) return null;
      const point = math.m44Transform(inverse, math.v4Build(2 * x / device.width - 1, 1 - 2 * y / device.height, -1, 1));
      if (!Number.isFinite(point[3]) || Math.abs(point[3]) < 1e-8) return null;
      // The legacy screenToWorld drops w; perspective unprojection must divide before casting the ray.
      const near = math.v3Build(point[0] / point[3], point[1] / point[3], point[2] / point[3]);
      const origin = math.m43Pos(camera.matrix);
      const location = math.getRayPlaneIntersection(hero.displayLocation || hero.record.location, math.v3BuildYAxis(), origin, math.v3Sub(near, origin));
      return location && vector(Array.from(location), 3) ? Array.from(location) : null;
    }
    matches(location) { const cursor = this.cursor(); return cursor && Math.hypot(...location.map((number, index) => number - cursor[index])) < 0.05; }
    pointer(event, value) {
      if (!this.placement || this.pending || value.button !== 0) return;
      const captured = this.world.game.getIMGui().hasCapturedInput();
      if (event === (root.PointerEvent ? 'pointerdown' : 'mousedown')) this.click = !captured;
      if (event === (root.PointerEvent ? 'pointerup' : 'mouseup')) {
        if (this.click && !captured && this.preview?.valid && this.matches(this.preview.location)) {
          this.lastBuildResult = null; this.pending = this.world.sendBuild(this.placement.source, this.placement.product.index, this.preview.location);
        }
        this.click = false;
      }
    }
    update() {
      const world = this.world, globals = world.controls.app.globals;
      const source = this.menu?.source || this.placement?.source;
      if (!source) return;
      const gui = world.game.getIMGui();
      const entry = world.scene.entities.get(source), record = entry?.record;
      if (!record || world.controls.paused || !world.movement.nativeFocused) { world.cancelLocalMenu(); return; }
      if (this.menu) {
        if (performance.now() - this.menuUpdated > 1000 && !world.selectionRequest) world.selectionRequest = world.sendTarget('target', source);
        const products = this.menu.products, scale = gui.getRadialScaleFactor(products.length);
        const point = globals.camera.worldToScreen(entry.displayLocation || record.location);
        if (!point) return;
        const center = products.length > 1 ? gui.getRadialCentre(point, scale) : point;
        if (products.length > 1) world.game.getGuiManager().addDrawGui('radialFrame', { v2ScreenLocation: center, scale }, 'guest-build-frame');
        for (let index = 0; index < products.length; index++) {
          const product = products[index], kind = product.costs[1] > 0 ? 'Stone' : product.costs[2] > 0 ? 'Amber' : 'Lumber';
          const archetype = product.valid ? (product.affordable ? 'build' + kind : 'buildInvalid' + kind + 'CantAfford') : 'buildInvalid' + kind;
          if (gui.doButton({ id: 'guest-build-' + source + '-' + product.index, text1: 'Build ' + product.name, text2: String(product.costs[0]), text3: String(product.costs[1]), text4: String(product.costs[2]), text5: world.game.getHero().getEC('ECPlayerBuilder').formatTimeToString(product.time, true),
            v2ScreenLocation: products.length > 1 ? gui.addRadialOffset(center, index, products.length, scale) : center,
            buttonType: world.controls.guiTypes.BUTTON_ROUND, guiArchetype: archetype }) && product.valid && product.affordable) {
            this.placement = { source, product }; this.menu = null; this.preview = this.request = null; this.world.selectionRequest = null; this.lastQuery = -Infinity; break;
          }
        }
        return;
      }
      const location = this.cursor(), now = performance.now();
      if (location && !this.pending && !this.request && now - this.lastQuery >= 200 && (!this.preview || !this.matches(this.preview.location) || now - this.lastQuery >= 1000)) {
        this.lastQuery = now;
        this.request = { sequence: world.sendPlacement('preview', source, this.placement.product.index, location) };
      }
      if (this.preview) {
        const builder = world.game.getHero().getEC('ECPlayerBuilder'), valid = this.preview.valid && this.matches(this.preview.location) && !this.pending;
        const color = Array.from(valid ? builder.getv4ValidBuildPositionTextureColor() : builder.getv4InvalidBuildPositionTextureColor());
        for (const buffer of [0, this.preview.buffer]) globals.simpleSpriteRenderer.addSprite({ v3Location: this.preview.position, sizeX: Math.max(0, this.preview.extents[0] - buffer) * 0.5, sizeY: Math.max(0, this.preview.extents[1] - buffer) * 0.5,
          v4color: [color[0], color[1], color[2], color[3] * (buffer ? 1 : 0.5)], texture: builder.getBuildingGuidelineTexture(), out: globals.mathDevice.v3BuildYAxis(), blendStyle: globals.simpleSpriteRenderer.blendStyle.NORMAL_NO_Z });
      }
      if (gui.doButton({ id: 'guest-build-cancel', text: 'Cancel building', v2ScreenLocation: gui.getv2ScreenBarLocation(), buttonType: world.controls.guiTypes.BUTTON_WIDE, guiArchetype: 'buttonWide' })) world.cancelLocalMenu();
    }
  }
  if (typeof module !== 'undefined') module.exports = { GuestConstruction };
  else root.PolycraftGuestConstruction = { GuestConstruction };
})(globalThis);
