'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
const upstream = { commit: '2cd2857c3f5f00d1d0f31bcb1577f905eee4c068', path: 'jslib/scenenode.js', sha256: '97e95c83a47a44ef70f25e647819f5256e10c93f234766e7861257df60df8100' };
const MATCHES = ['getName', 'getParent', 'getDisabled', 'childNeedsUpdate', 'getCustomLocalExtents', 'getCustomWorldExtents', 'hasLightInstances'];
function prototypes(ast) {
  const groups = new Map();
  traverse(ast, { AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type !== 'MemberExpression' || left.computed || left.object.type !== 'MemberExpression' || left.object.computed || left.object.property.name !== 'prototype' || left.object.object.type !== 'Identifier' || right.type !== 'FunctionExpression') return;
    const binding = p.scope.getBinding(left.object.object.name);
    if (!binding) return;
    if (!groups.has(binding)) groups.set(binding, { binding, methods: new Map(), duplicate: false });
    const group = groups.get(binding), name = left.property.name;
    if (group.methods.has(name)) group.duplicate = true;
    group.methods.set(name, generate(right, { compact: true, comments: false }).code);
  } });
  return [...groups.values()];
}
function selectSceneNode(ast) {
  const source = fs.readFileSync(path.join(__dirname, '../reference/turbulenz-2cd2857/scenenode.js'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), upstream.sha256, 'Pinned upstream SceneNode reference changed');
  const references = prototypes(parse(source.toString())).filter(group => group.binding.identifier.name === 'SceneNode');
  assert.equal(references.length, 1, 'Expected one upstream SceneNode definition');
  const reference = references[0];
  assert.ok(!reference.duplicate && reference.methods.size === 57, 'Ambiguous upstream SceneNode methods');
  const matches = prototypes(ast).filter(group => group.methods.size === reference.methods.size && [...reference.methods.keys()].every(name => group.methods.has(name)));
  assert.equal(matches.length, 1, 'Expected one matching SceneNode method inventory');
  const candidate = matches[0];
  assert.ok(!candidate.duplicate, 'Duplicate SceneNode prototype method');
  assert.ok(candidate.binding.path.isFunctionDeclaration() || candidate.binding.path.isVariableDeclarator() && candidate.binding.path.node.init?.type === 'FunctionExpression', 'Expected a private SceneNode constructor');
  for (const name of MATCHES) assert.equal(candidate.methods.get(name), reference.methods.get(name), 'Upstream SceneNode method differs: ' + name);
  return [{ binding: candidate.binding, name: 'SceneNode', role: 'upstream SceneNode', descriptive: false, evidence: '57 matching public method names and 7 exact canonical method bodies; other bodies are not asserted identical', upstream, matchingMethods: MATCHES }];
}
function nameSceneNode(source) { return renameBindings(source, selectSceneNode); }
if (require.main === module) writeNamingPass('upstream-scene-node-name', nameSceneNode);
module.exports = { nameSceneNode };
