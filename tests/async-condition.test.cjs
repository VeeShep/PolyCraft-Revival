'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const wait = require('./wait-for-async-condition.cjs');
test('async page wait polls resolved false values instead of succeeding on a Promise', async () => {
  let calls = 0, polls = 0; const argument = { expected: 'same argument' }, condition = async value => { assert.equal(value, argument); return ++calls === 3; };
  const page = { evaluate(callback, value) { assert.equal(callback, condition); return callback(value); }, async waitForTimeout(delay) { assert.equal(delay, 100); polls++; } };
  assert.equal(await wait(page, condition, argument, { timeout: 1000 }), true); assert.equal(calls, 3); assert.equal(polls, 2);
});
test('async false focus is refused with TimeoutError rather than bypassing native readiness', async () => {
  let calls = 0; const page = { async evaluate() { calls++; return false; }, waitForTimeout: delay => new Promise(resolve => setTimeout(resolve, delay)) };
  await assert.rejects(wait(page, async () => false, null, { timeout: 5 }), error => error.name === 'TimeoutError'); assert.equal(calls, 1);
});
test('page errors keep their original identity and stop polling immediately', async () => {
  const failure = new Error('Native query failed'), page = { async evaluate() { throw failure; }, waitForTimeout() { assert.fail('No retry after a query error'); } };
  await assert.rejects(wait(page, async () => false, null, { timeout: 1000 }), error => error === failure);
});
test('a stalled read is bounded and late success does not turn timeout into acceptance', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; }), page = { evaluate: () => pending, waitForTimeout() { assert.fail(); } };
  await assert.rejects(wait(page, async () => true, null, { timeout: 5 }), error => error.name === 'TimeoutError'); resolve(true); await pending;
});
test('visible helpers contain no inline or locally bound async predicates passed to Playwright polling', () => {
  const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default, failures = [];
  for (const name of fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs'))) {
    const ast = parse(fs.readFileSync(path.join(__dirname, name), 'utf8'), { sourceType: 'script' });
    traverse(ast, { CallExpression(p) {
      if (p.node.callee.type !== 'MemberExpression' || p.node.callee.property.name !== 'waitForFunction') return;
      let callback = p.node.arguments[0];
      if (callback?.type === 'Identifier') { const bound = p.scope.getBinding(callback.name)?.path.node; callback = bound?.type === 'VariableDeclarator' ? bound.init : bound; }
      if (callback?.async) failures.push(name + ':' + p.node.loc.start.line);
    } });
  }
  assert.deepEqual(failures, []);
});
