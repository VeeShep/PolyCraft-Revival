'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = ast => generate(ast, { compact: true, comments: false }).code;
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
function nameInputControllers(source) {
  const ast = parse(source, { sourceType: 'script' }), before = canonical(ast);
  const input = role(ast, 'gameController'), action = role(ast, 'controllerActionA');
  assert.ok(action === role(ast, 'controllerActionB'), 'Both controller actions must use the same constructor');
  assert.ok(input !== action, 'Input and action constructors must be distinct');
  const entries = [
    { binding: input, name: 'GameInputController', role: 'gameController', evidence: 'gameController factory assignment' },
    { binding: action, name: 'HeroControllerAction', role: 'controllerActionA', evidence: 'shared controllerActionA/controllerActionB factory assignments' }
  ];
  const names = entries.map(({ binding, name, role, evidence }) => {
    assert.ok(binding.path.isFunctionDeclaration(), `Expected a private constructor for ${role}`);
    assert.equal(binding.constantViolations.length, 0, `Reassigned constructor for ${role}`);
    assert.notEqual(binding.identifier.name, name, 'Input controllers already named; refusing to repeat this pass');
    assert.ok(!binding.scope.hasBinding(name) && !binding.scope.hasGlobal(name), `Conflicting name ${name}`);
    return { original: binding.identifier.name, name, role, evidence, offset: binding.identifier.start, references: binding.referencePaths.length, descriptive: true };
  });
  const edits = new Map();
  for (let index = 0; index < entries.length; index++) {
    const binding = entries[index].binding, entry = names[index];
    for (const node of [binding.identifier, ...binding.referencePaths.map(reference => reference.node)]) {
      assert.ok(node.type === 'Identifier' && source.slice(node.start, node.end) === entry.original, 'Expected a plain identifier reference');
      edits.set(node.start, { start: node.start, end: node.end, name: entry.name });
    }
    binding.scope.rename(entry.original, entry.name);
  }
  const parts = []; let position = 0;
  for (const edit of [...edits.values()].sort((a, b) => a.start - b.start)) { parts.push(source.slice(position, edit.start), edit.name); position = edit.end; }
  parts.push(source.slice(position));
  const output = parts.join('');
  const reverse = parse(output, { sourceType: 'script' });
  assert.ok(canonical(reverse) === canonical(ast), 'Generated syntax differs from the renamed tree');
  for (const entry of names) {
    const binding = role(reverse, entry.role);
    assert.equal(binding.identifier.name, entry.name);
    binding.scope.rename(entry.name, entry.original);
  }
  assert.ok(canonical(reverse) === before, 'Changes beyond the selected private bindings');
  return { output, names, inputSHA256: hash(source), outputSHA256: hash(output), inputCanonicalSHA256: hash(before), proof: 'Scoped reverse rename restores the canonical input syntax tree' };
}
if (require.main === module) {
  const manifest = JSON.parse(fs.readFileSync('scripts/runtime-names.json', 'utf8'));
  assert.equal(hash(fs.readFileSync('reference/beta-1/game.canvas.js')), manifest.baselineSHA256, 'Immutable Beta 1 baseline changed');
  assert.ok(!manifest.passes?.some(pass => pass.id === 'input-controller-role-names'), 'This naming pass is already recorded');
  const result = nameInputControllers(fs.readFileSync('game.canvas.js', 'utf8'));
  const { output, ...record } = result;
  manifest.passes = [...(manifest.passes || []), { id: 'input-controller-role-names', ...record }];
  fs.writeFileSync('game.canvas.js', output);
  fs.writeFileSync('scripts/runtime-names.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log('Named two private input controllers; canonical reverse-rename proof passed.');
}
module.exports = { nameInputControllers };
