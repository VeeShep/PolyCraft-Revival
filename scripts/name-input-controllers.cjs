'use strict';
const assert = require('node:assert/strict');
const traverse = require('@babel/traverse').default;
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
function role(ast, property) {
  const found = [];
  traverse(ast, { AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type === 'MemberExpression' && left.property.name === property && right.type === 'CallExpression' && right.callee.type === 'MemberExpression' && right.callee.property.name === 'create' && right.callee.object.type === 'Identifier') found.push(p.scope.getBinding(right.callee.object.name));
  } });
  assert.equal(found.length, 1, `Expected one factory for ${property}`);
  assert.ok(found[0], `Missing private binding for ${property}`);
  return found[0];
}
function selectInputControllers(ast) {
  const input = role(ast, 'gameController'), action = role(ast, 'controllerActionA');
  assert.ok(action === role(ast, 'controllerActionB'), 'Both controller actions must use the same constructor');
  assert.ok(input !== action, 'Input and action constructors must be distinct');
  const entries = [
    { binding: input, name: 'GameInputController', role: 'gameController', evidence: 'gameController factory assignment' },
    { binding: action, name: 'HeroControllerAction', role: 'controllerActionA', evidence: 'shared controllerActionA/controllerActionB factory assignments' }
  ];
  for (const { binding, role } of entries) assert.ok(binding.path.isFunctionDeclaration(), `Expected a private constructor for ${role}`);
  return entries.map(entry => ({ ...entry, descriptive: true }));
}
function nameInputControllers(source) { return renameBindings(source, selectInputControllers); }
if (require.main === module) writeNamingPass('input-controller-role-names', nameInputControllers);
module.exports = { nameInputControllers };
