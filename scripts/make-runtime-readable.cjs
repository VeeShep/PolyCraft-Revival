'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const baseline = fs.readFileSync('reference/beta-1/game.canvas.js', 'utf8');
const manifest = require('../reference/beta-1/SHA256.json');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
assert.equal(hash(baseline), manifest['game.canvas.js'], 'Immutable Beta 1 baseline changed');
assert.equal(fs.readFileSync('game.canvas.js', 'utf8'), baseline, 'Refusing to overwrite subsequent runtime work; this transformation runs once');
const ast = parse(baseline, { sourceType: 'script' });
const names = new Map();
const key = node => node.key?.name ?? node.key?.value;
function select(p, original, name, evidence) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return;
  const binding = p.scope.getBinding(original);
  assert.ok(binding, `Missing binding for ${original}`);
  assert.equal(binding.constantViolations.length, 0, `Reassigned constructor ${original}`);
  assert.ok(!binding.scope.hasBinding(name), `Conflicting name ${name}`);
  const existing = names.get(binding);
  assert.ok(!existing || existing.name === name, `Conflicting evidence for ${original}`);
  names.set(binding, { original, name, offset: binding.identifier.start, evidence });
}
traverse(ast, {
  VariableDeclarator(p) {
    const init = p.node.init;
    if (p.node.id.type !== 'Identifier' || init?.type !== 'CallExpression' || init.arguments[0]?.type !== 'ObjectExpression') return;
    const property = init.arguments[0].properties.find(x => key(x) === 'entityComponentName');
    if (property?.value.type === 'StringLiteral') select(p, p.node.id.name, property.value.value, 'literal entityComponentName on component definition');
  },
  AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type !== 'MemberExpression' || left.object.type !== 'Identifier' || left.property.name !== 'prototype' || right.type !== 'ObjectExpression') return;
    const property = right.properties.find(x => key(x) === 'name' && x.value?.type === 'StringLiteral' && x.value.value.startsWith('Gamestate'));
    if (property) select(p, left.object.name, property.value.value, 'literal state name on prototype');
  }
});
for (const [binding, entry] of names) binding.scope.rename(entry.original, entry.name);
const output = generate(ast, { comments: true, compact: false }).code + '\n';
const parsed = parse(output, { sourceType: 'script' });
const canonical = tree => generate(tree, { compact: true, comments: false }).code;
assert.equal(canonical(parsed), canonical(ast), 'Formatted output differs from renamed syntax tree');
const reverse = parse(output, { sourceType: 'script' });
const originalNames = new Map([...names.values()].map(entry => [entry.name, entry.original]));
const restoredBindings = [];
traverse(reverse, { BindingIdentifier(p) {
  const binding = p.scope.getBinding(p.node.name);
  if (originalNames.has(p.node.name) && binding?.identifier === p.node) restoredBindings.push(binding);
} });
assert.equal(restoredBindings.length, names.size);
for (const binding of restoredBindings) {
  const original = originalNames.get(binding.identifier.name);
  for (const reference of binding.referencePaths) {
    assert.equal(reference.node.type, 'Identifier');
    reference.node.name = original;
  }
  binding.identifier.name = original;
}
assert.equal(canonical(reverse), canonical(parse(baseline)), 'Changes beyond the verified scoped names');
const report = { baselineSHA256: hash(baseline), formattedSHA256: hash(output), names: [...names.values()] };
fs.writeFileSync('game.canvas.js', output);
fs.writeFileSync('scripts/runtime-names.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Formatted full runtime and restored ${names.size} names using scoped bindings; syntax-tree round trip passed.`);
