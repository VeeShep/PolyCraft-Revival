'use strict';
const assert = require('node:assert/strict'), traverse = require('@babel/traverse').default;
const { selectWorldModels } = require('./name-world-models.cjs');
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
const key = node => node.key?.name ?? node.key?.value;
function selectWorldFactories(ast) {
  const manager = selectWorldModels(ast).find(entry => entry.role === 'gameManager').binding, assignments = [];
  traverse(ast, { AssignmentExpression(p) { assignments.push(p); } });
  function definition(binding, member) {
    const matches = assignments.filter(p => p.node.left.type === 'MemberExpression' && !p.node.left.computed && p.node.left.object.type === 'Identifier' && p.node.left.property.name === member && p.scope.getBinding(p.node.left.object.name) === binding);
    assert.equal(matches.length, 1, 'Expected one world-factory ' + member + ' definition'); return matches[0].get('right');
  }
  function method(binding, name) {
    const prototype = definition(binding, 'prototype'); assert.ok(prototype.isObjectExpression(), 'Expected native world-factory prototype');
    const matches = prototype.get('properties').filter(p => p.node.type === 'ObjectProperty' && !p.node.computed && key(p.node) === name && p.node.value.type === 'FunctionExpression');
    assert.equal(matches.length, 1, 'Missing or ambiguous native world-factory method: ' + name); return matches[0].get('value');
  }
  function constructor(binding, methods) {
    assert.ok(binding?.path.isFunctionDeclaration(), 'Expected private world-factory constructor');
    for (const name of methods) method(binding, name);
    const factory = definition(binding, 'create'); assert.ok(factory.isFunctionExpression(), 'Expected native world-factory create');
    let count = 0;
    factory.traverse({ NewExpression(p) { if (p.node.callee.type === 'Identifier' && p.node.callee.name === binding.identifier.name) {
      assert.ok(p.scope.getBinding(p.node.callee.name) === binding, 'Shadowed world-factory construction'); count++;
    } } });
    assert.equal(count, 1, 'Expected one bound world-factory construction');
  }
  const managerFactory = definition(manager, 'create'), factories = [];
  for (const [role, name, methods] of [['entityFactory', 'EntityFactory', ['createEntity', 'createInactiveEntityInstance', 'getEntityArchetype']], ['blockFactory', 'BlockFactory', ['createBlockInstance', 'getArchetype']]]) {
    const matches = [];
    managerFactory.traverse({ AssignmentExpression(p) {
      const { left, right } = p.node;
      if (left.type !== 'MemberExpression' || left.computed || left.property.name !== role) return;
      const instance = left.object.type === 'Identifier' && p.scope.getBinding(left.object.name), init = instance?.path.node.init;
      assert.ok(instance?.path.isVariableDeclarator() && !instance.constantViolations.length && init?.type === 'NewExpression' && init.callee.type === 'Identifier' && instance.path.scope.getBinding(init.callee.name) === manager, 'Expected factory on the created gameManager');
      assert.ok(right.type === 'CallExpression' && right.callee.type === 'MemberExpression' && !right.callee.computed && right.callee.property.name === 'create' && right.callee.object.type === 'Identifier', 'Expected native ' + role + ' create');
      matches.push(p.scope.getBinding(right.callee.object.name));
    } });
    assert.equal(matches.length, 1, 'Expected one ' + role + ' assignment');
    const binding = matches[0]; constructor(binding, methods);
    factories.push({ binding, name, role, evidence: role + ' factory on the created gameManager, native methods and bound create construction' });
  }
  const products = factories.map((factory, index) => {
    const name = index === 0 ? 'GameEntity' : 'GameBlock', member = index === 0 ? 'createEntity' : 'createBlockInstance', calls = [];
    method(factory.binding, member).traverse({ CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'create' && callee.object.type === 'Identifier') calls.push(p.scope.getBinding(callee.object.name));
    } });
    assert.equal(calls.length, 1, 'Expected one product constructor call in ' + member);
    const binding = calls[0]; constructor(binding, index === 0 ? ['getECSaveData', 'deserializeECSaveData', 'getv3Location', 'getGameSpace', 'addEC'] : ['getArchetypeName', 'getv3Location', 'addToGameSpace', 'removeFromGameSpace']);
    return { binding, name, role: name, evidence: factory.role + '.' + member + ' uses this bound create factory, with native persistence/spatial methods' };
  });
  const entries = [...factories, ...products]; assert.equal(new Set(entries.map(entry => entry.binding)).size, entries.length, 'World factories and products must be distinct');
  return entries.map(entry => ({ ...entry, descriptive: true }));
}
function nameWorldFactories(source) { return renameBindings(source, selectWorldFactories); }
if (require.main === module) writeNamingPass('world-factory-role-names', nameWorldFactories);
module.exports = { nameWorldFactories };
