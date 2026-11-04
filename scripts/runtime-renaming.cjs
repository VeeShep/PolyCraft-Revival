'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parse } = require('@babel/parser');
const generate = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = ast => generate(ast, { compact: true, comments: false }).code;
function renameBindings(source, select) {
  const ast = parse(source, { sourceType: 'script' }), before = canonical(ast);
  traverse(ast, {
    WithStatement() { assert.fail('Dynamic scope prevents a verified private rename'); },
    CallExpression(p) { assert.ok(!(p.node.callee.type === 'Identifier' && p.node.callee.name === 'eval'), 'Dynamic eval prevents a verified private rename'); }
  });
  const entries = select(ast);
  const names = entries.map(({ binding, ...entry }) => {
    assert.ok(binding.scope.path.isFunction(), 'Expected a private function scope for ' + entry.role);
    assert.equal(binding.constantViolations.length, 0, `Reassigned constructor for ${entry.role}`);
    assert.notEqual(binding.identifier.name, entry.name, 'Private constructors already named; refusing to repeat this pass');
    assert.ok(!binding.scope.hasBinding(entry.name) && !binding.scope.hasGlobal(entry.name), `Conflicting name ${entry.name}`);
    return { original: binding.identifier.name, ...entry, offset: binding.identifier.start, references: binding.referencePaths.length };
  });
  const edits = new Map();
  for (const [index, { binding }] of entries.entries()) {
    const entry = names[index];
    for (const node of [binding.identifier, ...binding.referencePaths.map(reference => reference.node)]) {
      assert.ok(node.type === 'Identifier' && source.slice(node.start, node.end) === entry.original, 'Expected a plain identifier reference');
      edits.set(node.start, { start: node.start, end: node.end, name: entry.name });
    }
    binding.scope.rename(entry.original, entry.name);
  }
  const parts = []; let position = 0;
  for (const edit of [...edits.values()].sort((a, b) => a.start - b.start)) { parts.push(source.slice(position, edit.start), edit.name); position = edit.end; }
  parts.push(source.slice(position));
  const output = parts.join(''), reverse = parse(output, { sourceType: 'script' });
  assert.equal(canonical(reverse), canonical(ast), 'Generated syntax differs from the renamed tree');
  const restored = select(reverse);
  assert.equal(restored.length, names.length, 'Renamed constructor count changed');
  for (const entry of names) {
    const matches = restored.filter(candidate => candidate.role === entry.role);
    assert.equal(matches.length, 1, 'Expected one renamed constructor for ' + entry.role);
    const binding = matches[0].binding;
    assert.equal(binding.identifier.name, entry.name);
    binding.scope.rename(entry.name, entry.original);
  }
  assert.equal(canonical(reverse), before, 'Changes beyond the selected private bindings');
  return { output, names, inputSHA256: hash(source), outputSHA256: hash(output), inputCanonicalSHA256: hash(before), proof: 'Scoped reverse rename restores the canonical input syntax tree' };
}
function writeNamingPass(id, transform) {
  const manifestText = fs.readFileSync('scripts/runtime-names.json', 'utf8'), manifest = JSON.parse(manifestText);
  assert.equal(hash(fs.readFileSync('reference/beta-1/game.canvas.js')), manifest.baselineSHA256, 'Immutable Beta 1 baseline changed');
  assert.ok(!manifest.passes?.some(pass => pass.id === id), 'This naming pass is already recorded');
  const source = fs.readFileSync('game.canvas.js', 'utf8'), { output, ...record } = transform(source);
  manifest.passes = [...(manifest.passes || []), { id, ...record }];
  assert.equal(fs.readFileSync('game.canvas.js', 'utf8'), source, 'Runtime changed while naming');
  assert.equal(fs.readFileSync('scripts/runtime-names.json', 'utf8'), manifestText, 'Naming report changed while naming');
  fs.writeFileSync('game.canvas.js', output);
  fs.writeFileSync('scripts/runtime-names.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Named ${record.names.length} private bindings; canonical reverse-rename proof passed.`);
}
module.exports = { renameBindings, writeNamingPass };
