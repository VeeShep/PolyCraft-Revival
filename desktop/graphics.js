'use strict';
(function (root) {
  const contexts = new WeakMap();
  function precision(gl, stage, level) {
    const format = gl.getShaderPrecisionFormat?.(stage, level);
    return format ? { precision: format.precision, rangeMin: format.rangeMin, rangeMax: format.rangeMax } : null;
  }
  function capabilities(gl) {
    if (!contexts.has(gl)) {
      const vertexHigh = precision(gl, gl.VERTEX_SHADER, gl.HIGH_FLOAT);
      const fragmentHigh = precision(gl, gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      contexts.set(gl, { vertexHigh, fragmentHigh, highp: vertexHigh?.precision > 0 && fragmentHigh?.precision > 0, promoted: 0 });
    }
    return contexts.get(gl);
  }
  function prepareShader(gl, source) {
    const support = capabilities(gl);
    if (!support.highp) return source;
    // Promote both stages together so shared uniforms and varyings keep matching precision.
    const result = source.replace(/\bprecision\s+mediump\s+float\s*;/g, 'precision highp float;');
    if (result !== source) support.promoted++;
    return result;
  }
  function diagnostics(game) {
    const gl = game.globals.graphicsDevice.gl, camera = game.globals.camera;
    const support = capabilities(gl), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const binding = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    let depthBits;
    try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); depthBits = gl.getParameter(gl.DEPTH_BITS); }
    finally { gl.bindFramebuffer(gl.FRAMEBUFFER, binding); }
    return {
      version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      context: gl.getContextAttributes(), defaultDepthBits: depthBits,
      cameraNear: camera.nearPlane, cameraFar: camera.farPlane,
      vertexHigh: support.vertexHigh, fragmentHigh: support.fragmentHigh,
      vertexMedium: precision(gl, gl.VERTEX_SHADER, gl.MEDIUM_FLOAT), fragmentMedium: precision(gl, gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT),
      floatPolicy: support.highp ? 'highp' : 'original', shadersPromoted: support.promoted
    };
  }
  const api = { prepareShader, diagnostics };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftGraphics = api;
})(globalThis);
