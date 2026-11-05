'use strict';
const assert = require('node:assert/strict'), traverse = require('@babel/traverse').default;
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
const key = node => node.key?.name ?? node.key?.value;
function property(object, name, type) {
  const matches = object.properties.filter(value => value.type === 'ObjectProperty' && !value.computed && key(value) === name);
  assert.ok(matches.length === 1 && matches[0].value.type === type, 'Missing or ambiguous world-model property: ' + name);
  return matches[0].value;
}
function selectWorldModels(ast) {
  const assignments = [], spaceBindings = new Set(), managers = [];
  traverse(ast, {
    AssignmentExpression(p) {
      assignments.push(p);
      const { left, right } = p.node;
      if (left.type !== 'MemberExpression' || left.computed || left.property.name !== 'gameManager' || left.object.type !== 'MemberExpression' || left.object.computed || left.object.object.type !== 'ThisExpression' || left.object.property.name !== 'globals' || right.type !== 'Identifier') return;
      const instance = p.scope.getBinding(right.name), init = instance?.path.node.init;
      assert.ok(instance?.path.isVariableDeclarator() && !instance.constantViolations.length && init?.type === 'CallExpression' && init.callee.type === 'MemberExpression' && !init.callee.computed && init.callee.property.name === 'create' && init.callee.object.type === 'Identifier', 'Expected a stable gameManager factory assignment');
      managers.push(instance.path.scope.getBinding(init.callee.object.name));
    },
    CallExpression(p) {
      const { callee, arguments: args } = p.node;
      if (args[0]?.type === 'StringLiteral' && args[0].value === 'GameSpace' && callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'create' && callee.object.type === 'Identifier') spaceBindings.add(p.scope.getBinding(callee.object.name));
    }
  });
  function definition(binding, member) {
    const matches = assignments.filter(p => p.node.left.type === 'MemberExpression' && !p.node.left.computed && p.node.left.object.type === 'Identifier' && p.node.left.property.name === member && p.scope.getBinding(p.node.left.object.name) === binding);
    assert.equal(matches.length, 1, 'Expected one world-model ' + member + ' definition');
    return matches[0].get('right');
  }
  function constructor(binding, methods) {
    assert.ok(binding?.path.isFunctionDeclaration(), 'Expected a private world-model constructor');
    const prototype = definition(binding, 'prototype'); assert.ok(prototype.isObjectExpression(), 'Expected world-model prototype');
    for (const name of methods) property(prototype.node, name, 'FunctionExpression');
    const factory = definition(binding, 'create'); assert.ok(factory.isFunctionExpression(), 'Expected world-model factory');
    let constructions = 0;
    factory.traverse({ NewExpression(p) { if (p.node.callee.type === 'Identifier' && p.node.callee.name === binding.identifier.name) {
      assert.ok(p.scope.getBinding(p.node.callee.name) === binding, 'Shadowed world-model constructor in factory'); constructions++;
    } } });
    assert.equal(constructions, 1, 'Expected one bound world-model construction');
    return { prototype, factory };
  }
  assert.equal(managers.length, 1, 'Expected one gameManager factory role');
  const manager = managers[0], managerDefinition = constructor(manager, ['saveLevel', 'getGameSpaceList', 'serializeGameSpaces', 'deserializeGameSpaces']);
  assert.equal(spaceBindings.size, 1, 'Expected one GameSpace factory role');
  const space = [...spaceBindings][0]; constructor(space, ['getEntityList', 'getBlockList', 'getExtents', 'addEntities']);
  const clocks = [];
  managerDefinition.factory.traverse({ AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type !== 'MemberExpression' || left.computed || left.property.name !== 'gameClock') return;
    const instance = left.object.type === 'Identifier' && p.scope.getBinding(left.object.name), init = instance?.path.node.init;
    assert.ok(instance?.path.isVariableDeclarator() && !instance.constantViolations.length && init?.type === 'NewExpression' && init.callee.type === 'Identifier' && instance.path.scope.getBinding(init.callee.name) === manager, 'Expected clock on the created gameManager');
    assert.ok(right.type === 'CallExpression' && right.callee.type === 'MemberExpression' && !right.callee.computed && right.callee.property.name === 'create' && right.callee.object.type === 'Identifier', 'Expected gameClock factory');
    clocks.push(p.scope.getBinding(right.callee.object.name));
  } });
  assert.equal(clocks.length, 1, 'Expected one gameClock factory role');
  const clock = clocks[0]; constructor(clock, ['tick', 'pause', 'resume', 'getCurrentTime', 'getTimeStep']);
  const persistenceCalls = [];
  const saveMethod = managerDefinition.prototype.get('properties').find(p => key(p.node) === 'saveLevel').get('value');
  saveMethod.traverse({ CallExpression(p) {
    const callee = p.node.callee;
    if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'MemberExpression' || callee.object.computed || callee.object.object.type !== 'Identifier') return;
    if (callee.object.property.name === 'Serialize' && callee.property.name === 'serializePlayerSave' || callee.object.property.name === 'SaveLoad' && callee.property.name === 'saveLevelToUserData') persistenceCalls.push({ method: callee.property.name, binding: p.scope.getBinding(callee.object.object.name) });
  } });
  assert.ok(persistenceCalls.length === 2 && new Set(persistenceCalls.map(value => value.method)).size === 2 && persistenceCalls[0].binding === persistenceCalls[1].binding, 'Expected matching native serialization and user-data save namespace');
  const persistence = persistenceCalls[0].binding;
  assert.ok(persistence?.path.isVariableDeclarator() && persistence.path.node.init?.type === 'ObjectExpression', 'Expected a private level-persistence namespace');
  const namespace = persistence.path.node.init;
  property(namespace, 'createEmptyLevel', 'FunctionExpression');
  for (const [section, methods] of [['Parse', ['parseLevelData', 'parseGameSpaceData', 'deserializeGameSpaceList']], ['Serialize', ['serializePlayerSave', 'serializeLevel', 'serializeGameSpace', 'serializeEntity']], ['SaveLoad', ['saveLevelToUserData', 'loadLevelFromUserData', 'typedArrayReplacer']]]) {
    const object = property(namespace, section, 'ObjectExpression'); for (const name of methods) property(object, name, 'FunctionExpression');
  }
  const entries = [
    { binding: manager, name: 'GameManager', role: 'gameManager', evidence: 'stable this.globals.gameManager factory assignment, bound create constructor and native save/world serialization methods' },
    { binding: space, name: 'GameSpace', role: 'gameSpace', evidence: 'unique GameSpace-labelled factory owner, bound create constructor and native entity/block/extents methods' },
    { binding: clock, name: 'GameClock', role: 'gameClock', evidence: 'gameClock factory assigned to the created gameManager, bound create constructor and native tick/pause/resume/time methods' },
    { binding: persistence, name: 'LevelPersistence', role: 'levelPersistence', evidence: 'gameManager.saveLevel uses this same Parse/Serialize/SaveLoad namespace for serializePlayerSave and saveLevelToUserData' }
  ];
  assert.equal(new Set(entries.map(entry => entry.binding)).size, entries.length, 'World-model roles must be distinct');
  return entries.map(entry => ({ ...entry, descriptive: true }));
}
function nameWorldModels(source) { return renameBindings(source, selectWorldModels); }
if (require.main === module) writeNamingPass('world-model-role-names', nameWorldModels);
module.exports = { nameWorldModels, selectWorldModels };
