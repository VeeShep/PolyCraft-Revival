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

test('resource approach diagnostics run before cleanup, bound screenshots and preserve the framing assertion on observation errors', async () => {
  const ast = parse(fs.readFileSync(path.join(__dirname, 'coop-natural-resources.cjs'), 'utf8')), failures = [], assertions = [];
  traverse(ast, {
    IfStatement(p) { if (p.node.test.type === 'UnaryExpression' && p.node.test.operator === '!' && p.node.test.argument.name === 'ready') failures.push(p.node); },
    CallExpression(p) { if (p.node.callee.object?.name === 'assert' && p.node.callee.property?.name === 'ok' && p.node.arguments[0]?.name === 'ready') assertions.push(p.node); }
  });
  assert.equal(failures.length, 1); assert.equal(assertions.length, 1);
  const code = '(async () => {' + generate(failures[0]).code + ';' + generate(assertions[0]).code + ';})()';
  for (const failure of [null, 'point', 'guest', 'host', 'screenshot', 'string']) {
    const messages = [], screenshots = [], observed = [];
    const fail = phase => { if (failure === phase) throw new Error(phase + ' failed'); };
    const context = { assert, path, ready: false, hero: 'assigned', target: { id: 'tree' }, hostFile: path.join('temporary', 'saves', 'island.json'), console: { log: (...args) => messages.push(args) },
      async targetPoint() { observed.push('point'); fail('point'); return { clear: false }; },
      host: { async evaluate(callback, args) { assert.equal(typeof callback, 'function'); assert.equal(args.hero, 'assigned'); assert.equal(args.id, 'tree'); observed.push('host'); fail('host'); return { distance: 9 }; } },
      guest: { async evaluate(callback) { assert.equal(typeof callback, 'function'); observed.push('guest'); fail('guest'); return { nativeFocused: false }; }, async screenshot(options) { screenshots.push(options); fail('screenshot'); if (failure === 'string') throw 'screenshot failed'; } } };
    await assert.rejects(vm.runInNewContext(code, context), error => error.code === 'ERR_ASSERTION' && /bring the resource into view/.test(error.message));
    assert.equal(screenshots.length, [null, 'screenshot', 'string'].includes(failure) ? 1 : 0);
    if (screenshots.length) { assert.equal(screenshots[0].path, path.join('temporary', 'resource-approach-failure.png')); assert.equal(screenshots[0].timeout, 5000); }
    if (!failure) { assert.deepEqual(observed, ['point', 'guest', 'host']); assert.equal(messages[0][0], 'Native resource approach failure:'); }
    else assert.ok(messages.some(row => row[0] === 'Resource approach diagnostics unavailable:' && row[1] === (failure === 'string' ? 'screenshot failed' : failure + ' failed')));
  }
});

test('resource approach and pickup restore real window focus before any further keyboard input', async () => {
  const ast = parse(fs.readFileSync(path.join(__dirname, 'coop-natural-resources.cjs'), 'utf8')), guards = [];
  traverse(ast, { IfStatement(p) {
    const body = p.node.consequent.body;
    if (body?.[0]?.expression?.argument?.callee?.name === 'focus' && body[1]?.type === 'ContinueStatement') guards.push(p.node);
  } });
  assert.equal(guards.length, 2);
  for (const guard of guards) for (const focused of [false, true]) for (const nativeFocused of [false, true]) {
    const state = { focused, nativeFocused }, events = [];
    const code = '(async () => { for (let step = 0; step < 2; step++) {' + generate(guard).code + '; input(); break; } })()';
    const context = { next: state, view: state, async focus() { events.push('focus'); state.focused = state.nativeFocused = true; }, input() { assert.equal(state.focused, true); assert.equal(state.nativeFocused, true); events.push('input'); } };
    await vm.runInNewContext(code, context);
    assert.deepEqual(events, focused && nativeFocused ? ['input'] : ['focus', 'input']);
    const error = new Error('Native window focus unavailable');
    context.focus = async () => { throw error; }; state.nativeFocused = false; events.length = 0;
    await assert.rejects(vm.runInNewContext(code, context), reason => reason === error);
    assert.deepEqual(events, [], 'Failed focus restoration must not send keyboard input.');
  }
});
