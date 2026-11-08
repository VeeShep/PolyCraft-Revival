'use strict';
const assert = require('node:assert/strict'), traverse = require('@babel/traverse').default;
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
const key = node => node.key?.name ?? node.key?.value;
function selectWorldCube(ast) {
  const components = [], assignments = [];
  traverse(ast, {
    ObjectExpression(p) { if (p.node.properties.some(property => key(property) === 'entityComponentName' && property.value?.value === 'ECPhysicsCube')) components.push(p); },
    AssignmentExpression(p) { assignments.push(p); }
  });
  assert.equal(components.length, 1, 'Expected one native ECPhysicsCube component');
  const methods = components[0].get('properties').filter(p => key(p.node) === 'activate' && p.node.value?.type === 'FunctionExpression');
  assert.equal(methods.length, 1, 'Expected one native cube activate method');
  const activate = methods[0].get('value'), fields = [];
  activate.traverse({ AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type !== 'MemberExpression' || left.computed || left.property.name !== 'worldCube') return;
    assert.ok(left.object.type === 'ThisExpression' && p.getFunctionParent() === activate, 'Expected worldCube on the activated component');
    assert.ok(right.type === 'CallExpression' && right.callee.type === 'MemberExpression' && !right.callee.computed && right.callee.property.name === 'create' && right.callee.object.type === 'Identifier', 'Expected native worldCube factory');
    fields.push(p.scope.getBinding(right.callee.object.name));
  } });
  assert.equal(fields.length, 1, 'Expected one activated worldCube factory');
  const binding = fields[0]; assert.ok(binding?.path.isFunctionDeclaration(), 'Expected private worldCube constructor');
  function definition(member) {
    const matches = assignments.filter(p => p.node.left.type === 'MemberExpression' && !p.node.left.computed && p.node.left.property.name === member && p.node.left.object.type === 'Identifier' && p.scope.getBinding(p.node.left.object.name) === binding);
    assert.equal(matches.length, 1, 'Expected one worldCube ' + member + ' definition'); return matches[0].get('right');
  }
  const prototype = definition('prototype'); assert.ok(prototype.isObjectExpression(), 'Expected native worldCube prototype');
  for (const name of ['collisionCheck', 'collisionResolve', 'stepifyFakeSphere', 'updateExtents', 'getExtents']) assert.equal(prototype.node.properties.filter(p => !p.computed && key(p) === name && p.value?.type === 'FunctionExpression').length, 1, 'Missing or ambiguous worldCube method: ' + name);
  const create = definition('create'); assert.ok(create.isFunctionExpression(), 'Expected native worldCube create');
  const constructions = []; create.traverse({ NewExpression(p) { constructions.push(p); } });
  assert.equal(constructions.length, 1, 'Expected one native worldCube construction');
  const construction = constructions[0];
  assert.ok(construction.node.callee.type === 'Identifier' && construction.scope.getBinding(construction.node.callee.name) === binding, 'Expected bound worldCube construction');
  return [{ binding, name: 'WorldCube', role: 'worldCube', descriptive: true, evidence: 'ECPhysicsCube.activate assigns this.worldCube from this bound factory; original collision, step and extents methods and native construction verified' }];
}
function nameWorldCube(source) { return renameBindings(source, selectWorldCube); }
if (require.main === module) writeNamingPass('world-cube-role-name', nameWorldCube);
module.exports = { nameWorldCube };
