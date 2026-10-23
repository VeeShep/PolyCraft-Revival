'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuestConstruction } = require('../desktop/guest-construction.js');
const product = () => ({ index: 0, name: 'Wall', archetype: 'wall', costs: [0, 100, 0], valid: true, affordable: true, time: 10, repeat: true });
const menu = () => ({ type: 'target', sequence: 1, construction: { source: 'Workshop', products: [product()] } });
function setup() {
  const sent = [], drawn = [], sprites = []; let sequence = 1, clicked;
  const builder = { formatTimeToString: String, getv4ValidBuildPositionTextureColor: () => [0, 1, 0, 1], getv4InvalidBuildPositionTextureColor: () => [1, 0, 0, 1], getBuildingGuidelineTexture: () => 'textures/block.dds' };
  const gui = { hasCapturedInput: () => false, getRadialScaleFactor: () => 1, getv2ScreenBarLocation: () => [0, 100], doButton: options => { drawn.push(options); return options.id === clicked; } };
  const world = { controls: { guiTypes: { BUTTON_ROUND: {}, BUTTON_WIDE: {} }, app: { globals: { camera: { worldToScreen: () => [100, 100] }, mathDevice: { v3BuildYAxis: () => [0, 1, 0] }, simpleSpriteRenderer: { blendStyle: { NORMAL_NO_Z: 1 }, addSprite: value => sprites.push(value) } } } },
    movement: { nativeFocused: true }, scene: { entities: new Map([['Workshop', { record: { location: [0, 0, 0] } }]]) },
    game: { getIMGui: () => gui, getEntityFactory: () => ({ getECArchetype: name => name === 'wall' ? {} : null }), getHero: () => ({ getEC: () => builder }) },
    sendPlacement(type, source, index, location) { sent.push({ type, source, index, location }); return ++sequence; },
    sendBuild(source, index, location) { return this.sendPlacement('build', source, index, location); } };
  const ui = new GuestConstruction(world); world.cancelLocalMenu = () => ui.cancel(); ui.cursor = () => [1, 0, 2];
  return { ui, world, sent, drawn, sprites, click: value => { clicked = value; }, preview: valid => ({ type: 'preview', sequence, preview: { source: 'Workshop', index: 0, location: [1, 0, 2], position: [1, 0.1, 2], extents: [2, 2], buffer: 0.2, valid } }) };
}
test('cursor unprojection divides homogeneous coordinates before casting onto the replicated hero plane and refuses invalid rays', () => {
  const { ui, world } = setup(); delete ui.cursor;
  world.identity = { entity: 'hero' }; world.scene.entities.set('hero', { displayLocation: [0, 3, 0], record: { location: [0, 30, 0] } }); world.guiInput = { position: [10, 20] };
  const globals = world.controls.app.globals;
  globals.camera.matrix = []; globals.camera.viewProjectionMatrix = [1]; globals.graphicsDevice = { width: 200, height: 100 };
  const math = globals.mathDevice;
  math.m44Inverse = matrix => { assert.equal(matrix, globals.camera.viewProjectionMatrix); return [2]; };
  math.v4Build = (...values) => values; math.v3Build = (...values) => values;
  math.m44Transform = (inverse, clip) => { assert.deepEqual(inverse, [2]); assert.deepEqual(clip, [-0.9, 0.6, -1, 1]); return [10, 6, 10, 2]; };
  math.m43Pos = () => [1, 2, 3]; math.v3Sub = (a, b) => a.map((value, index) => value - b[index]);
  math.getRayPlaneIntersection = (plane, normal, origin, direction) => {
    assert.deepEqual(plane, [0, 3, 0]); assert.deepEqual(origin, [1, 2, 3]); assert.deepEqual(direction, [4, 1, 2]);
    return origin.map((value, index) => value + direction[index] * (plane[1] - origin[1]) / direction[1]);
  };
  assert.deepEqual(ui.cursor(), [5, 3, 5]);
  math.getRayPlaneIntersection = () => [Infinity, 3, 5]; assert.equal(ui.cursor(), null);
  math.m44Transform = () => [10, 6, 10, 0]; assert.equal(ui.cursor(), null);
  math.m44Inverse = () => []; assert.equal(ui.cursor(), null);
});
test('host menu validation refuses duplicate products, uninstalled archetypes, forged values and malformed preview geometry', () => {
  for (const mutate of [value => value.construction.products.push(product()), value => { value.construction.products[0].costs[1] = -1; }, value => { value.construction.products[0].archetype = 'unknown'; }, value => { value.construction.products[0].valid = 1; }]) {
    const { ui } = setup(), value = menu(); mutate(value); assert.throws(() => ui.receive(value, true), /Invalid/); assert.equal(ui.menu, undefined);
  }
  const { ui, preview } = setup(), value = preview(true); value.preview.position[1] = NaN;
  assert.throws(() => ui.receive(value, false), /Invalid/);
});
test('original product artwork selects a repeat blueprint; one outstanding preview controls valid-click builds and cancel leaves no request active', () => {
  const { ui, sent, drawn, sprites, click, preview } = setup();
  ui.receive(menu(), true); ui.update(); assert.equal(drawn[0].guiArchetype, 'buildStone');
  click('guest-build-Workshop-0'); ui.update(); assert.equal(ui.menu, null); assert.equal(ui.placement.product.name, 'Wall');
  click(undefined); ui.update(); ui.update(); assert.equal(sent.length, 1); assert.equal(sent[0].type, 'preview');
  ui.receive(preview(true), false); ui.update(); assert.equal(sprites.length, 2); assert.equal(sprites[0].texture, 'textures/block.dds'); assert.equal(sprites[0].v4color[1], 1);
  const event = { button: 0 }; ui.pointer('mousedown', event); ui.pointer('mouseup', event);
  assert.equal(sent.at(-1).type, 'build'); assert.deepEqual(sent.at(-1).location, [1, 0, 2]);
  ui.receive({ type: 'build', sequence: ui.pending }, false); assert.ok(ui.placement, 'Infinite original build mode retains the local blueprint');
  ui.lastQuery = -Infinity; ui.update(); ui.receive(preview(false), false); ui.pointer('mousedown', event); ui.pointer('mouseup', event);
  assert.equal(sent.filter(value => value.type === 'build').length, 1, 'Invalid outlines never place');
  click('guest-build-cancel'); ui.update(); assert.equal(ui.placement, null); assert.equal(ui.request, null);
  ui.receive(menu(), false); assert.equal(ui.menu, null, 'A cancelled selection does not reopen from a late response');
});
test('a stale valid outline cannot place at an old cursor location; blur and vanished sources cancel', () => {
  const { ui, world, sent, click, preview } = setup(); ui.receive(menu(), true); click('guest-build-Workshop-0'); ui.update(); click(undefined); ui.update(); ui.receive(preview(true), false);
  ui.cursor = () => [5, 0, 5]; ui.pointer('mousedown', { button: 0 }); ui.pointer('mouseup', { button: 0 });
  assert.equal(sent.some(value => value.type === 'build'), false);
  world.movement.nativeFocused = false; ui.update(); assert.equal(ui.placement, null);
  world.movement.nativeFocused = true; ui.receive(menu(), true); world.scene.entities.clear(); ui.update(); assert.equal(ui.menu, null);
});
