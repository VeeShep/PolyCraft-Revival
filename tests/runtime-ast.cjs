'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const ast = parse(fs.readFileSync(path.join(__dirname, '../game.canvas.js'), 'utf8'), { sourceType: 'script' });
const properties = [];
const assignments = [];
const objects = [];
traverse(ast, {
  ObjectProperty(p) { properties.push(p.node); },
  AssignmentExpression(p) { assignments.push(p.node); },
  ObjectExpression(p) { objects.push(p.node); }
});
const key = node => node.key?.name ?? node.key?.value;
function one(nodes, description) {
  if (nodes.length !== 1) throw new Error(`Expected one ${description}, found ${nodes.length}`);
  return nodes[0];
}
function evaluate(node, context = {}) { return vm.runInNewContext('(' + generate(node).code + ')', context); }
function method(name, context) {
  const functions = properties.filter(p => key(p) === name && p.value.type === 'FunctionExpression').map(p => p.value);
  functions.push(...assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === name && a.right.type === 'FunctionExpression').map(a => a.right));
  return evaluate(one(functions, name), context);
}
function prototypeWith(name, context) {
  return evaluate(one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === name)), `prototype containing ${name}`).right, context);
}
function component(name, context) {
  return evaluate(one(objects.filter(o => o.properties.some(p => key(p) === 'entityComponentName' && p.value.value === name)), name), context);
}
function objectWith(name) {
  return evaluate(one(objects.filter(o => o.properties.some(p => key(p) === name)), `object containing ${name}`));
}
function assignedObject(name, context) {
  return evaluate(one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === name && a.right.type === 'ObjectExpression'), name).right, context);
}
function staticMethod(owner, name, context) {
  return evaluate(one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.object.name === owner && a.left.property.name === name && a.right.type === 'FunctionExpression'), `${owner}.${name}`).right, context);
}
function taskManagerFactory({ manager, renderer, groups, badges, tasks, window }) {
  const prototype = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'awardCompletedTaskList')), 'task manager prototype');
  const owner = prototype.left.object.name;
  const factory = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.object.name === owner && a.left.property.name === 'create' && a.right.type === 'FunctionExpression'), 'task manager factory');
  const local = assignments.filter(a => a.start > factory.start && a.end < factory.end);
  const assigned = name => one(local.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === name), name);
  const group = assigned('criticalTaskGroup');
  // Resolve private namespace names from their public roles so readability renames do not break this fixture.
  return evaluate(factory.right, { [owner]: manager, [assigned('taskRenderer').right.callee.object.name]: renderer, [group.right.callee.object.name]: groups,
    [assigned('badgeTaskGroup').right.callee.object.name]: badges, [group.right.arguments[2].object.name]: tasks, window });
}
module.exports = { method, prototypeWith, component, objectWith, assignedObject, staticMethod, taskManagerFactory };
