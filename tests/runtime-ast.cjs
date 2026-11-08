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
function scriptCommand(name) {
  const definition = one(objects.filter(o => o.properties.some(p => key(p) === 'name' && p.value.value === name) && o.properties.some(p => key(p) === 'updateFunction')), name + ' command');
  return evaluate(definition.properties.find(p => key(p) === 'updateFunction').value);
}
function objectWith(name) {
  return evaluate(one(objects.filter(o => o.properties.some(p => key(p) === name)), `object containing ${name}`));
}
function assignedObject(name, context) {
  return evaluate(one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === name && a.right.type === 'ObjectExpression'), name).right, context);
}
function entityFactoryName() {
  const factory = one(assignments.filter(a => a.left.type === 'MemberExpression' && !a.left.computed && a.left.property.name === 'entityFactory' && a.right.type === 'CallExpression' && a.right.callee.type === 'MemberExpression' && !a.right.callee.computed && a.right.callee.property.name === 'create' && a.right.callee.object.type === 'Identifier'), 'entity factory role');
  return factory.right.callee.object.name;
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
function visualEffectMethods(names) {
  const definition = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'buildKeyframeList')), 'visual effect prototype');
  const owner = definition.left.object.name, build = definition.right.properties.find(p => key(p) === 'buildTweens').value;
  const namespace = drawingDependency(build, 'Easing'), sprite = drawingDependency(build, 'blendStyle'), tweens = {};
  tweens.Easing = assignedObject('Easing', { [namespace]: tweens }); tweens.Interpolation = assignedObject('Interpolation', { [namespace]: tweens });
  const constructor = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.object.name === namespace && a.left.property.name === 'Tween'), 'tween constructor');
  tweens.Tween = evaluate(constructor.right, { [namespace]: tweens }); tweens.Create = value => new tweens.Tween(value);
  function Factory() {}
  Factory.prototype = evaluate(definition.right, { [namespace]: tweens, [sprite]: { prototype: { blendStyle: { NORMAL: 'normal' } } } });
  Factory.create = staticMethod(owner, 'create', { [owner]: Factory });
  const allDefinitions = assignments.filter(a => a.left.type === 'MemberExpression' && a.left.object.property?.name === 'archetypes' && a.left.object.object?.name === owner && a.right.type === 'ObjectExpression');
  const definitions = allDefinitions.filter(a => names.includes(a.left.property.name));
  const adapters = [];
  traverse(ast, { CallExpression(p) { if (p.node.callee.property?.name === 'attach' && p.node.callee.object.property?.name === 'PolycraftControls') adapters.push(p.node.arguments.find(argument => argument.type === 'ObjectExpression' && argument.properties.some(property => key(property) === 'tweens'))); } });
  const adapter = one(adapters, 'desktop effect adapter');
  for (const [name, binding, member] of [['create', owner, 'create'], ['factory', owner], ['archetypes', owner, 'archetypes'], ['tweens', namespace]]) {
    const value = one(adapter.properties.filter(p => key(p) === name), 'effect adapter ' + name).value;
    if (member ? value.object?.name !== binding || value.property?.name !== member : value.name !== binding) throw new Error('Incorrect desktop effect adapter ' + name);
  }
  const colours = {};
  traverse(ast, { ReferencedIdentifier(p) {
    if (!definitions.some(a => p.node.start >= a.right.start && p.node.end <= a.right.end)) return;
    const binding = p.scope.getBinding(p.node.name);
    if (!binding || Object.hasOwn(colours, p.node.name)) return;
    const assigned = one(binding.constantViolations.filter(p => p.node.type === 'AssignmentExpression').map(p => p.node.right), 'visual colour ' + p.node.name);
    colours[p.node.name] = evaluate(assigned);
  } });
  const archetypes = Object.fromEntries(definitions.map(a => [a.left.property.name, evaluate(a.right, colours)]));
  return { create: Factory.create, factory: Factory, archetypes, tweens, allNames: allDefinitions.map(a => a.left.property.name) };
}
let campaignSource;
function campaignRuntime(playing, features, panels) {
  if (!campaignSource) {
    const calls = []; traverse(ast, { CallExpression(p) { if (p.node.callee.object?.property?.name === 'PolycraftControls' && p.node.callee.property?.name === 'attach') calls.push(p.node); } });
    const adapter = one(calls, 'desktop adapters').arguments.find(argument => argument.type === 'ObjectExpression' && argument.properties.some(property => key(property) === 'enabled'));
    const get = name => one(adapter.properties.filter(property => key(property) === name), name).value;
    const archetypes = {}, balance = objectWith('campaign_tutorial_01'), namespace = get('archetypes').name;
    for (const assignment of assignments) if (assignment.left.object?.name === namespace && assignment.right.type === 'ObjectExpression') archetypes[assignment.left.property.name] = evaluate(assignment.right, { WarBalance: balance });
    const definition = one(assignments.filter(assignment => assignment.left.property?.name === 'prototype' && assignment.right.type === 'ObjectExpression' && assignment.right.properties.some(property => key(property) === 'confirmCampaign')), 'campaign preparation').right;
    const confirm = definition.properties.find(property => key(property) === 'confirmCampaign').value, update = definition.properties.find(property => key(property) === 'update').value;
    const start = one(properties.filter(property => key(property) === 'doCampaignStartBookend'), 'campaign bookend').value;
    const flag = one(properties.filter(property => key(property) === 'flagGuiArchetype' && property.start > start.start && property.end < start.end), 'campaign flag lookup').value.object;
    let flagDefinition; traverse(ast, { ReferencedIdentifier(p) { if (p.node.start === flag.start) flagDefinition = p.scope.getBinding(p.node.name).path.node.init; } });
    campaignSource = { end: one(properties.filter(property => key(property) === 'doCampaignEndBookend'), 'campaign result bookend').value, archetypes, namespace, definition, start, flag, flagValues: evaluate(flagDefinition), create: get('create'), enabled: get('enabled'), playing: drawingDependency(confirm, 'create'), panels: drawingDependency(update, 'doCampaignStartBookend'), panelHelpers: drawingDependency(start, 'doInfoPanel'), features: drawingDependency(get('enabled'), 'campaignsEnabled') };
  }
  const source = campaignSource;
  function Prepare() {}
  Prepare.prototype = evaluate(source.definition, { [source.playing]: playing, [source.panels]: panels });
  return { endPanel: evaluate(source.end, { [source.flag.name]: source.flagValues, [source.panelHelpers]: panels }), archetypes: source.archetypes, create: staticMethod(source.create.object.name, 'create', { [source.create.object.name]: Prepare }), enabled: evaluate(source.enabled, { [source.features]: features }), startPanel: evaluate(source.start, { [source.namespace]: source.archetypes, [source.flag.name]: source.flagValues, [source.panelHelpers]: panels }) };
}
function campaignRewards() {
  const give = one(properties.filter(property => key(property) === 'giveRewards'), 'native campaign reward').value;
  return evaluate(give, { [drawingDependency(give, 'LUMBER')]: { LUMBER: 0, STONE: 1 } });
}
function campaignScorePanel(panels, playing) {
  const definition = one(assignments.filter(a => a.left.property?.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'giveRewards')), 'native campaign result panel').right;
  const update = definition.properties.find(p => key(p) === 'updateMenu').value;
  const give = definition.properties.find(p => key(p) === 'giveRewards').value;
  return evaluate(definition, { [drawingDependency(update, 'doCampaignEndBookend')]: panels, [drawingDependency(update, 'create')]: playing, [drawingDependency(give, 'LUMBER')]: { LUMBER: 0, STONE: 1 } });
}
function campaignScore(globals) {
  const definition = one(assignments.filter(assignment => assignment.left.property?.name === 'prototype' && assignment.right.type === 'ObjectExpression' && assignment.right.properties.some(property => key(property) === 'getCampaignScoreInfo')), 'native campaign score');
  const deposit = definition.right.properties.find(property => key(property) === 'onResourceDeposited').value;
  function Score() {}
  Score.prototype = evaluate(definition.right, { [drawingDependency(deposit, 'LUMBER')]: { LUMBER: 0, STONE: 1 } });
  return staticMethod(definition.left.object.name, 'create', { [definition.left.object.name]: Score })(globals);
}
function preparationButton(renderer, types) {
  const buttons = []; traverse(ast, { CallExpression(p) { if (p.node.callee.property?.name === 'doButton' && p.node.arguments[0]?.type === 'ObjectExpression' && p.node.arguments[0].properties.some(property => key(property) === 'id' && property.value.value === 'SKIP PREPARE')) buttons.push(p.node.arguments[0]); } });
  const button = one(buttons, 'native preparation button');
  return evaluate(button, { [drawingDependency(button, 'getv2RenderLocation')]: renderer, [drawingDependency(button, 'BUTTON_IN_GAME')]: types });
}
function guiManagerMethods(tweens) {
  const definition = one(assignments.filter(a => a.left.property?.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'addGameMessage')), 'GUI manager prototype').right;
  const fade = one(definition.properties.filter(p => key(p) === 'fadeInTween'), 'GUI fade').value;
  return evaluate(definition, { [drawingDependency(fade, 'Easing')]: tweens });
}
function battleNoticeArchetype(name) {
  const definition = one(assignments.filter(a => a.left.property?.name === name && a.right.type === 'ObjectExpression'), name).right;
  return evaluate(definition, { [drawingDependency(definition, 'menuButtonFont')]: { menuButtonFont: 24 }, [drawingDependency(definition, 'strings')]: objectWith('healthFull') });
}
function soundManagerMethods() {
  const definition = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === 'prototype' && a.right.type === 'ObjectExpression' && a.right.properties.some(p => key(p) === 'updateListener')), 'sound manager prototype');
  const owner = definition.left.object.name, archetypes = {};
  for (const a of assignments) if (a.left.type === 'MemberExpression' && a.left.object.property?.name === 'archetypes' && a.left.object.object?.name === owner && a.right.type === 'ObjectExpression') archetypes[a.left.property.name ?? a.left.property.value] = evaluate(a.right);
  return { archetypes, methods: evaluate(definition.right, { [owner]: { archetypes } }) };
}
function audioActionMethods() {
  const result = {};
  traverse(ast, { CallExpression(p) {
    if (p.node.callee.property?.name !== 'registerAction' || !['SoundEffect', 'StopSoundEffect'].includes(p.node.arguments[0]?.value)) return;
    const argument = p.node.arguments[1], binding = p.scope.getBinding(argument.name), initializer = binding.path.node.init;
    if (initializer?.callee?.property?.name !== 'bind' || initializer.callee.object.type !== 'FunctionExpression') throw new Error('Unexpected original audio action handler');
    if (Object.hasOwn(result, p.node.arguments[0].value)) throw new Error('Ambiguous original audio action handler');
    result[p.node.arguments[0].value] = evaluate(initializer.callee.object);
  } });
  if (Object.keys(result).length !== 2) throw new Error('Missing original audio actions');
  return result;
}
function audioSourceMethods() {
  const create = one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === '_createBufferNode' && a.left.object.property?.name === 'prototype'), 'audio buffer source');
  const owner = create.left.object.object.name;
  return Object.fromEntries(['pause', 'resume', 'destroy'].map(name => [name, evaluate(one(assignments.filter(a => a.left.type === 'MemberExpression' && a.left.property.name === name && a.left.object.property?.name === 'prototype' && a.left.object.object.name === owner), 'audio source ' + name).right)]));
}
function movementDrawing(name = 'drawMove') {
  const draw = one(properties.filter(p => key(p) === name), 'movement drawing ' + name).value;
  return evaluate(draw, { [drawingDependency(draw, 'outline')]: objectWith('healthFull'),
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
module.exports = { campaignScorePanel, campaignRewards, campaignScore, preparationButton, campaignRuntime, guiManagerMethods, battleNoticeArchetype, method, prototypeWith, component, scriptCommand, objectWith, assignedObject, entityFactoryName, archetypeComponent, staticMethod, taskManagerFactory, healthDrawing, movementDrawing, visualEffectMethods, soundManagerMethods, audioActionMethods, audioSourceMethods, cameraMethods, taskGroupMethods };
