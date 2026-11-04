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
function archetypeComponent(name, component) {
  const definition = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === name && a.right.type === 'ObjectExpression'), name).right;
  return evaluate(one(definition.properties.filter(p => key(p) === component), `${name}.${component}`).value);
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
function drawingDependency(node, property) {
  const names = new Set();
  traverse(ast, { MemberExpression(p) { if (p.node.start >= node.start && p.node.end <= node.end && p.node.property.name === property) { let base = p.node.object; while (base.type === 'MemberExpression') base = base.object; names.add(base.name); } } });
  return one([...names], 'public renderer dependency ' + property);
}
function healthDrawing() {
  const health = one(objects.filter(o => o.properties.some(p => key(p) === 'entityComponentName' && p.value.value === 'ECHealth')), 'health component');
  const drawHealth = health.properties.find(p => key(p) === 'drawHealthBar').value;
  const drawBar = one(properties.filter(p => key(p) === 'drawProgressBarFromFraction'), 'world bar').value;
  const colors = objectWith('healthFull');
  return { healthMethods: evaluate(health, { [drawingDependency(drawHealth, 'healthMid')]: colors }), drawProgressBar: evaluate(drawBar, {
    [drawingDependency(drawBar, 'progressBarTexturePath')]: { progressBarTexturePath: 'textures/block.dds' }, [drawingDependency(drawBar, 'NORMAL_NO_Z')]: { prototype: { blendStyle: { NORMAL_NO_Z: 'no-depth' } } }, [drawingDependency(drawBar, 'outline')]: colors }) };
}
function soundManagerMethods() {
  const definition = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'updateListener')), 'sound manager prototype');
  const owner = definition.left.object.name, archetypes = {};
  for (const a of assignments) if (a.left.type === 'MemberExpression' && a.left.object.property?.name === 'archetypes' && a.left.object.object?.name === owner && a.right.type === 'ObjectExpression') archetypes[a.left.property.name] = evaluate(a.right);
  return { archetypes, methods: evaluate(definition.right, { [owner]: { archetypes } }) };
}
function audioSourceMethods() {
  const create = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === '_createBufferNode' && a.left.object.property?.name === 'prototype'), 'audio buffer source');
  const owner = create.left.object.object.name;
  return Object.fromEntries(['pause', 'resume', 'destroy'].map(name => [name, evaluate(one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === name && a.left.object.property?.name === 'prototype' && a.left.object.object.name === owner), 'audio source ' + name).right)]));
}
function movementDrawing() {
  const draw = one(properties.filter(p => key(p) === 'drawMove'), 'movement drawing').value;
  return evaluate(draw, { [drawingDependency(draw, 'outlineSoft')]: objectWith('healthFull'),
    [drawingDependency(draw, 'NORMAL_NO_Z')]: { prototype: { blendStyle: { NORMAL_NO_Z: 'no-depth', NORMAL: 'normal' } } } });
}
function cameraMethods(zoomer) {
  const prototype = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'buildSphereCentreAndExtents')), 'camera prototype').right;
  const start = prototype.properties.find(p => key(p) === 'startZoomer').value;
  const create = start.body.body.find(node => node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression').expression.right;
  return evaluate(prototype, { [create.callee.object.name]: { create: zoomer } });
}
function taskGroupMethods(tasks) {
  const prototype = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'createTaskConditionState')), 'task group prototype').right;
  const render = prototype.properties.find(p => key(p) === 'getRenderInfoForTask').value;
  const lookup = render.body.body[0].declarations.find(d => d.init?.type === 'MemberExpression' && d.init.object.property?.name === 'archetypes');
  return evaluate(prototype, { [lookup.init.object.object.name]: tasks });
}
module.exports = { method, prototypeWith, component, objectWith, assignedObject, archetypeComponent, staticMethod, taskManagerFactory, healthDrawing, movementDrawing, soundManagerMethods, audioSourceMethods, cameraMethods, taskGroupMethods };
