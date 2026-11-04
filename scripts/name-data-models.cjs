'use strict';
const assert = require('node:assert/strict');
const traverse = require('@babel/traverse').default;
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
const ROLES = [
  ['playerData', 'PlayerDataModel', ['saveProgress', 'saveHeroUpgrades']],
  ['taskManager', 'QuestTaskManager', ['saveCompletedTasks', 'giveTaskReward']],
  ['scoreInfo', 'CampaignScoreInfo', ['getCampaignScoreInfo', 'onCampaignEnded']]
];
function selectDataModels(ast) {
  const factories = [], prototypes = [];
  traverse(ast, { AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type !== 'MemberExpression' || left.computed) return;
    if (right.type === 'CallExpression' && right.callee.type === 'MemberExpression' && !right.callee.computed && right.callee.property.name === 'create' && right.callee.object.type === 'Identifier') factories.push({ role: left.property.name, binding: p.scope.getBinding(right.callee.object.name) });
    if (left.property.name === 'prototype' && left.object.type === 'Identifier' && right.type === 'ObjectExpression') prototypes.push({ binding: p.scope.getBinding(left.object.name), methods: right.properties.filter(property => property.type === 'ObjectProperty' && !property.computed && property.value.type === 'FunctionExpression').map(property => property.key.name ?? property.key.value) });
  } });
  const entries = ROLES.map(([role, name, methods]) => {
    const matches = factories.filter(factory => factory.role === role);
    assert.equal(matches.length, 1, 'Expected one factory for ' + role);
    const binding = matches[0].binding;
    assert.ok(binding?.path.isFunctionDeclaration(), 'Expected a private constructor for ' + role);
    const definitions = prototypes.filter(prototype => prototype.binding === binding);
    assert.ok(definitions.length === 1 && methods.every(method => definitions[0].methods.includes(method)), 'Missing native data methods for ' + role);
    return { binding, name, role, descriptive: true, evidence: role + ' factory assignment and native ' + methods.join('/') + ' methods' };
  });
  assert.equal(new Set(entries.map(entry => entry.binding)).size, ROLES.length, 'Data model constructors must be distinct');
  return entries;
}
function nameDataModels(source) { return renameBindings(source, selectDataModels); }
if (require.main === module) writeNamingPass('data-model-role-names', nameDataModels);
module.exports = { nameDataModels };
