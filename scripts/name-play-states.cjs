'use strict';
const assert = require('node:assert/strict');
const traverse = require('@babel/traverse').default;
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
const NAMES = ['PlayStateBattle', 'PlayStateNormal', 'PlayStatePrepareForBattle'];
const key = node => node.key?.name ?? node.key?.value;
function selectPlayStates(ast) {
  const found = [], registrations = [];
  traverse(ast, {
    VariableDeclarator(p) {
      const { id, init } = p.node;
      if (id.type !== 'Identifier' || init?.type !== 'CallExpression' || init.callee.type !== 'MemberExpression' || init.callee.property.name !== 'extend' || init.callee.object.type !== 'Identifier' || init.arguments[0]?.type !== 'ObjectExpression') return;
      const names = init.arguments[0].properties.filter(property => key(property) === 'playStateName');
      if (!names.some(property => property.value?.type === 'StringLiteral' && NAMES.includes(property.value.value))) return;
      assert.equal(names.length, 1, 'Ambiguous play-state name');
      found.push({ binding: p.scope.getBinding(id.name), name: names[0].value.value, base: p.scope.getBinding(init.callee.object.name) });
    },
    AssignmentExpression(p) {
      const { left, right } = p.node;
      if (right.type !== 'Identifier' || left.type !== 'MemberExpression' || !left.computed || left.object.property?.name !== 'playStateCreationMap' || left.object.object.property?.name !== 'prototype' || left.property.property?.name !== 'playStateName' || left.property.object.property?.name !== 'prototype') return;
      registrations.push({ binding: p.scope.getBinding(right.name), key: p.scope.getBinding(left.property.object.object.name), base: p.scope.getBinding(left.object.object.object.name) });
    }
  });
  const entries = NAMES.map(name => {
    const matches = found.filter(entry => entry.name === name);
    assert.equal(matches.length, 1, 'Expected one play-state constructor for ' + name);
    const entry = matches[0];
    assert.ok(entry.binding && entry.base, 'Missing private play-state binding');
    const registered = registrations.filter(registration => registration.binding === entry.binding);
    assert.equal(registered.length, 1, 'Expected one factory registration for ' + name);
    assert.ok(registered[0].key === entry.binding && registered[0].base === entry.base, 'Mismatched play-state factory registration');
    return { binding: entry.binding, name, role: name, descriptive: false, evidence: 'literal playStateName and matching prototype factory registration' };
  });
  assert.equal(new Set(entries.map(entry => entry.binding)).size, NAMES.length, 'Play-state constructors must be distinct');
  return entries;
}
function namePlayStates(source) { return renameBindings(source, selectPlayStates); }
if (require.main === module) writeNamingPass('play-state-literal-names', namePlayStates);
module.exports = { namePlayStates };
