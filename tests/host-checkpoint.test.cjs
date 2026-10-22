'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
test('fresh checkpoints wait for an older write then capture again, serializing simultaneous fresh requests', async () => {
  let source;
  traverse(parse(fs.readFileSync(require.resolve('../desktop/host.js'), 'utf8')), { FunctionDeclaration(path) { if (path.node.id.name === 'checkpoint') source = generate(path.node).code; } });
  assert.ok(source);
  const captures = [], writes = [];
  let version = 1, release, firstStarted, active = 0;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const context = { bridge: {}, status() {}, controls: { checkpoint: async () => { captures.push(version); return { version }; } },
    window: { desktop: { save: async (id, state) => {
      assert.equal(active++, 0, 'Disk writes never overlap'); writes.push(state.version);
      if (writes.length === 1) { firstStarted(); await gate; }
      active--; return { id, updatedAt: 0, state };
    } } } };
  const checkpoint = vm.runInNewContext('let saving; let slot = {id: "temporary"}; ' + source + '; checkpoint;', context);
  const old = checkpoint(); await started;
  version = 2;
  const fresh = checkpoint(true), another = checkpoint(true), duplicate = checkpoint();
  assert.deepEqual(captures, [1]); release();
  await Promise.all([old, fresh, another, duplicate]);
  assert.deepEqual(captures, [1, 2, 2]); assert.deepEqual(writes, [1, 2, 2]); assert.equal(active, 0);
});
