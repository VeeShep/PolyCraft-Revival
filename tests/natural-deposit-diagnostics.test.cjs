'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, generate = require('@babel/generator').default;

test('deposit failure diagnostics capture a bounded screenshot and preserve the original assertion when observations fail', async () => {
  const ast = parse(fs.readFileSync(path.join(__dirname, 'coop-natural-deposit.cjs'), 'utf8')), failures = [], assertions = [], errors = [];
  traverse(ast, {
    IfStatement(p) { if (p.node.test.name === 'walkingError') errors.push(p.node); if (p.node.test.type === 'UnaryExpression' && p.node.test.operator === '!' && p.node.test.argument.name === 'emptied') failures.push(p.node); },
    CallExpression(p) { if (p.node.callee.object?.name === 'assert' && p.node.callee.property?.name === 'equal' && p.node.arguments[0]?.name === 'emptied') assertions.push(p.node); }
  });
  assert.equal(failures.length, 1); assert.equal(assertions.length, 1); assert.equal(errors.length, 1);
  const code = '(async () => {' + generate(failures[0]).code + ';' + generate(errors[0]).code + ';' + generate(assertions[0]).code + ';})()';
  const folder = path.join('temporary', 'probe');
  for (const walkingError of [undefined, new Error('ground click refused')]) for (const failure of [null, 'host', 'screenshot', 'string']) {
    const messages = [], screenshots = [];
    const reason = failure === 'host' ? 'host observation failed' : 'screenshot failed';
    const context = { assert, path, walkingError, emptied: false, hero: 'guest', resource: 1, hostFile: path.join(folder, 'saves', 'island.json'), console: { log: (...args) => messages.push(args) },
      host: { async evaluate(callback, args) { assert.equal(typeof callback, 'function'); assert.equal(args.hero, 'guest'); assert.equal(args.resource, 1); if (failure === 'host') throw new Error('host observation failed'); return { carried: 10 }; } },
      guest: { async screenshot(options) { screenshots.push(options); if (failure === 'screenshot') throw new Error(reason); if (failure === 'string') throw reason; } } };
    await assert.rejects(vm.runInNewContext(code, context), error => walkingError ? error === walkingError : error.code === 'ERR_ASSERTION' && /Original proximity depositing/.test(error.message));
    assert.equal(screenshots.length, failure === 'host' ? 0 : 1);
    if (screenshots.length) { assert.equal(screenshots[0].path, path.join(folder, 'resource-deposit-failure.png')); assert.equal(screenshots[0].timeout, 5000); }
    if (failure) assert.ok(messages.some(row => row[0] === 'Native deposit diagnostics unavailable:' && row[1] === reason));
    else assert.equal(messages[0][0], 'Native deposit failure state:');
  }
});
