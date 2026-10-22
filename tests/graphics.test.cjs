'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareShader, diagnostics } = require('../desktop/graphics.js');
const runtime = require('./runtime-ast.cjs');
function context(high = 23) {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, HIGH_FLOAT: 3, MEDIUM_FLOAT: 4, FRAMEBUFFER: 5, FRAMEBUFFER_BINDING: 6,
    DEPTH_BITS: 7, VERSION: 8, SHADING_LANGUAGE_VERSION: 9, VENDOR: 10, RENDERER: 11, binding: { offscreen: true }, queries: 0,
    getShaderPrecisionFormat(stage, level) { this.queries++; return { precision: level === this.HIGH_FLOAT ? high : 10, rangeMin: 127, rangeMax: 127 }; },
    getParameter(key) { return key === this.FRAMEBUFFER_BINDING ? this.binding : key === this.DEPTH_BITS ? this.binding === null ? 24 : 16 : 'Test GPU'; },
    getExtension: () => null, getContextAttributes: () => ({ depth: true, stencil: true }),
    bindFramebuffer(target, binding) { this.binding = binding; }
  };
}
test('desktop shader compilation promotes default floats in both stages when high precision is supported', () => {
  const gl = context();
  const source = '#ifdef GL_ES\nprecision mediump float;\nprecision mediump int;\n#endif\nvarying vec4 position;';
  const expected = source.replace('mediump float', 'highp float');
  assert.equal(prepareShader(gl, source), expected);
  assert.equal(prepareShader(gl, source), expected);
  assert.equal(gl.queries, 2, 'Capability queries are cached per graphics context');
  assert.equal(source.includes('mediump float'), true, 'Original asset text is untouched');
  assert.equal(prepareShader(gl, 'precision highp float;'), 'precision highp float;');
  assert.equal(prepareShader(context(0), source), source, 'Unsupported hardware retains the original declarations');
  const noQuery = {}; assert.equal(prepareShader(noQuery, source), source);
});
test('graphics diagnostics report default-framebuffer depth and restore the active offscreen target', () => {
  const gl = context(), binding = gl.binding;
  prepareShader(gl, 'precision mediump float;');
  const game = { globals: { graphicsDevice: { gl }, camera: { nearPlane: 1, farPlane: 1000 } } };
  const result = diagnostics(game);
  assert.equal(result.defaultDepthBits, 24);
  assert.equal(gl.binding, binding);
  assert.equal(result.floatPolicy, 'highp'); assert.equal(result.shadersPromoted, 1);
  assert.equal(result.fragmentMedium.precision, 10);
  assert.equal(result.fragmentHigh.precision, 23);
  assert.equal(result.cameraNear, 1); assert.equal(result.cameraFar, 1000);
  const original = gl.getParameter;
  gl.getParameter = function (key) { if (key === this.DEPTH_BITS) throw new Error('lost'); return original.call(this, key); };
  assert.throws(() => diagnostics(game), /lost/);
  assert.equal(gl.binding, binding, 'Even diagnostic failures must restore rendering state');
});
test('engine input listeners explicitly permit cancellation and still deduplicate and remove bound handlers', () => {
  const add = runtime.method('addInternalEventListener'), remove = runtime.method('removeInternalEventListener');
  for (const type of ['mousewheel', 'DOMMouseScroll', 'wheel', 'touchstart', 'touchmove', 'keydown']) {
    const registrations = [], removals = [];
    const target = { addEventListener: (...args) => registrations.push(args), removeEventListener: (...args) => removals.push(args) };
    const input = { elementEventFlags: {}, boundFunctions: {} };
    const listener = function () { return this; };
    add.call(input, target, type, listener); add.call(input, target, type, listener);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0][2].capture, false);
    assert.equal(registrations[0][2].passive, false);
    assert.equal(registrations[0][1](), input);
    remove.call(input, target, type, listener);
    assert.equal(removals[0][1], registrations[0][1]); assert.equal(removals[0][2], false);
    add.call(input, target, type, listener); assert.equal(registrations.length, 2);
  }
});
