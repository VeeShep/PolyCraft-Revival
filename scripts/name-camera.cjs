'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
const { prototypes } = require('./name-scene-node.cjs');
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
const upstream = { commit: '2cd2857c3f5f00d1d0f31bcb1577f905eee4c068', path: 'jslib/camera.js', sha256: 'b035fbda8c1a87e88fe7225d07321e5082b6c670a9967776f26b8a7412d6d7b8' };
function factory(ast, binding) {
  const matches = [];
  traverse(ast, { AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type === 'MemberExpression' && !left.computed && left.object.type === 'Identifier' && left.property.name === 'create' && p.scope.getBinding(left.object.name) === binding && right.type === 'FunctionExpression') matches.push(p.get('right'));
  } });
  assert.equal(matches.length, 1, 'Expected one Camera factory');
  assert.ok(matches[0].scope.getBinding(binding.identifier.name) === binding, 'Expected unshadowed Camera constructor in factory');
  const tree = parse('(' + generate(matches[0].node, { comments: false }).code + ')');
  traverse(tree, { FunctionExpression(p) {
    assert.equal(p.node.params.length, 1, 'Expected one Camera math-device parameter');
    const bindings = Object.values(p.scope.bindings);
    assert.equal(bindings.length, 2, 'Expected Camera factory parameter and instance only');
    const instance = bindings.find(value => value.path.isVariableDeclarator());
    assert.ok(instance?.path.node.init?.type === 'NewExpression' && instance.path.node.init.callee.name === binding.identifier.name, 'Expected Camera instance construction');
    // Compare factory syntax after changing only local names and the free constructor reference.
    assert.ok(!p.scope.hasBinding('__camera') && !p.scope.hasGlobal('__camera') && !p.scope.hasBinding('__md') && !p.scope.hasGlobal('__md') && !p.scope.hasGlobal('__ctor'), 'Camera factory normalization collision');
    p.scope.rename(p.node.params[0].name, '__md'); p.scope.rename(instance.identifier.name, '__camera');
    instance.path.node.init.callee.name = '__ctor';
    p.skip();
  } });
  return generate(tree, { compact: true, comments: false }).code;
}
function selectCamera(ast) {
  const source = fs.readFileSync(path.join(__dirname, '../reference/turbulenz-2cd2857/camera.js'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), upstream.sha256, 'Pinned upstream Camera reference changed');
  const referenceAST = parse(source.toString()), references = prototypes(referenceAST).filter(group => group.binding.identifier.name === 'Camera');
  assert.equal(references.length, 1, 'Expected one upstream Camera definition');
  const reference = references[0];
  assert.ok(!reference.duplicate && reference.methods.size === 14, 'Ambiguous upstream Camera methods');
  const matches = prototypes(ast).filter(group => [...reference.methods.keys()].every(name => group.methods.has(name)));
  assert.equal(matches.length, 1, 'Expected one matching Camera core method inventory');
  const candidate = matches[0];
  assert.ok(!candidate.duplicate, 'Duplicate Camera prototype method');
  assert.ok(candidate.binding.path.isFunctionDeclaration() || candidate.binding.path.isVariableDeclarator() && candidate.binding.path.node.init?.type === 'FunctionExpression', 'Expected a private Camera constructor');
  assert.equal(candidate.methods.get('updateFrustumPlanes'), reference.methods.get('updateFrustumPlanes'), 'Upstream Camera method differs: updateFrustumPlanes');
  assert.equal(factory(ast, candidate.binding), factory(referenceAST, reference.binding), 'Upstream Camera factory differs');
  return [{ binding: candidate.binding, name: 'Camera', role: 'upstream Camera', descriptive: false, evidence: '14 matching core method names, exact canonical updateFrustumPlanes body and factory syntax after local-name normalization; game extensions and other bodies are not asserted identical', upstream, matchingMethods: ['updateFrustumPlanes'], matchingFactory: 'create' }];
}
function nameCamera(source) { return renameBindings(source, selectCamera); }
if (require.main === module) writeNamingPass('upstream-camera-name', nameCamera);
module.exports = { nameCamera };
