'use strict';
const assert = require('node:assert/strict'), traverse = require('@babel/traverse').default;
const { selectWorldModels } = require('./name-world-models.cjs');
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
function selectManagerModels(ast, roles) {
  const manager = selectWorldModels(ast).find(entry => entry.role === 'gameManager').binding, assignments = [];
  traverse(ast, { AssignmentExpression(p) { assignments.push(p); } });
  function definition(binding, member) {
    const matches = assignments.filter(p => p.node.left.type === 'MemberExpression' && !p.node.left.computed && p.node.left.object.type === 'Identifier' && p.node.left.property.name === member && p.scope.getBinding(p.node.left.object.name) === binding);
    assert.equal(matches.length, 1, 'Expected one manager-model ' + member + ' definition'); return matches[0].get('right');
  }
  const factory = definition(manager, 'create'), entries = [];
  for (const [role, name, methods] of roles) {
    const fields = [];
    factory.traverse({ AssignmentExpression(p) {
      const { left, right } = p.node;
      if (left.type !== 'MemberExpression' || left.computed || left.property.name !== role) return;
      const instance = left.object.type === 'Identifier' && p.scope.getBinding(left.object.name), init = instance?.path.node.init;
      assert.ok(instance?.path.isVariableDeclarator() && !instance.constantViolations.length && init?.type === 'NewExpression' && init.callee.type === 'Identifier' && instance.path.scope.getBinding(init.callee.name) === manager, 'Expected manager field on the created gameManager');
      assert.ok(right.type === 'CallExpression' && right.callee.type === 'MemberExpression' && !right.callee.computed && right.callee.property.name === 'create' && right.callee.object.type === 'Identifier', 'Expected manager-model factory call');
      fields.push(p.scope.getBinding(right.callee.object.name));
    } });
    assert.equal(fields.length, 1, 'Expected one native manager field: ' + role);
    const binding = fields[0]; assert.ok(binding?.path.isFunctionDeclaration(), 'Expected private manager-model constructor');
    const prototype = definition(binding, 'prototype'); assert.ok(prototype.isObjectExpression(), 'Expected native manager-model prototype');
    for (const method of methods) assert.equal(prototype.node.properties.filter(p => p.type === 'ObjectProperty' && !p.computed && (p.key.name ?? p.key.value) === method && p.value.type === 'FunctionExpression').length, 1, 'Missing or ambiguous manager-model method: ' + method);
    const create = definition(binding, 'create'); assert.ok(create.isFunctionExpression(), 'Expected native manager-model create');
    let count = 0;
    create.traverse({ NewExpression(p) { if (p.node.callee.type === 'Identifier' && p.node.callee.name === binding.identifier.name) {
      assert.ok(p.scope.getBinding(p.node.callee.name) === binding, 'Shadowed manager-model constructor'); count++;
    } } });
    assert.equal(count, 1, 'Expected one bound manager-model construction');
    entries.push({ binding, name, role, descriptive: true, evidence: 'factory assigned to the created gameManager.' + role + ', bound native construction and methods: ' + methods.join(', ') });
  }
  assert.equal(new Set(entries.map(entry => entry.binding)).size, entries.length, 'manager-model roles must be distinct');
  return entries;
}
function nameUiModels(source) { return renameBindings(source, ast => selectManagerModels(ast, [
  ['gameCamera', 'GameCamera', ['setDesiredFocus', 'setDesiredPosition', 'getCameraValues', 'update']],
  ['eventManager', 'GameEventManager', ['subscribe', 'unsubscribe', 'notify', 'reset']],
  ['guiManager', 'GuiManager', ['addDrawGui', 'clearDrawList', 'completeDraw', 'addGameMessage']],
  ['gameScoresUI', 'GameScoresUI', ['drawResourceBar', 'drawSoftCurrency', 'drawRanking', 'setPrepareTimeRemaining']]
])); }
if (require.main === module) writeNamingPass('ui-model-role-names', nameUiModels);
module.exports = { nameUiModels, selectManagerModels };
