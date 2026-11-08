'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const naturalWorkers = require('./coop-natural-workers.cjs');

function fixture(t, mode = 'success') {
  const prior = global.window, directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-worker-unit-'));
  t.after(() => { if (prior === undefined) delete global.window; else global.window = prior; fs.rmSync(directory, { recursive: true, force: true }); });
  t.mock.method(console, 'log', () => {});
  const resources = [0, 0], callbacks = new Set(), events = [], failure = new Error('native observation wait failed');
  const workers = [0, 1].map(resource => {
    const target = { getName: () => 'source-' + resource, getEC: () => ({ getResourceType: () => resource }) };
    const original = function () { assert.equal(this, agent); events.push('native-harvest:' + resource); return .3; };
    const agent = Object.create({ interactWithTargetResourceDispenser: original }); agent.getTargetResourceDispenser = () => target;
    const entity = { getName: () => 'worker-' + resource, shouldBeDestroyed: () => false, getEC: () => agent, getv3Location: () => [resource, 0, 1] };
    return { entity, agent, original };
  });
  const deposit = (entity, resource, amount) => { resources[resource] += amount; callbacks.forEach(callback => callback({ entity, type: resource, amount })); };
  const game = { getBuildingManager: () => ({ getBuildingsAtMinLevel: type => [{ getEC: name => name === 'ECWildlingHouse' ? { getWildling: () => workers[type === 'Lumberling Hut' ? 0 : 1].entity } : null }] }),
    eventManager: { subscribe(name, callback) { assert.equal(name, 'ResourceDeposited'); callbacks.add(callback); }, unsubscribe(name, callback) { assert.equal(name, 'ResourceDeposited'); callbacks.delete(callback); } },
    getPlayerData: () => ({ getResource: type => resources[type] }), getGameEntityByName: id => workers.find(worker => worker.entity.getName() === id)?.entity, runScripts: true };
  const hostFile = path.join(directory, 'island.json');
  global.window = { hostWorld: { game }, polycraft: { async checkpoint(force) {
    assert.equal(force, true); fs.writeFileSync(hostFile, JSON.stringify({ state: { cheats: { everEnabled: false }, userData: { desktopCoop: JSON.stringify({ economy: { resource: resources } }) } } }));
  } } };
  let polls = 0, screenshots = 0;
  const guest = { async waitForTimeout(ms) {
    assert.equal(ms, 10000); polls++;
    if (mode === 'wait-error') throw failure;
    for (const worker of workers) assert.equal(worker.agent.interactWithTargetResourceDispenser(), .3);
    if (polls === 1) for (const resource of [0, 1]) deposit({ getName: () => 'unrelated-hero' }, resource, 2);
    if (['success', 'bad-hud'].includes(mode) && polls === 2) workers.forEach((worker, resource) => deposit(worker.entity, resource, resource + 1));
  }, async screenshot(options) { assert.equal(options.timeout, 5000); screenshots++; } };
  const host = { async evaluate(callback, argument) { return structuredClone(await callback(argument)); } };
  const guests = [0, 1, 2].map(index => ({ async waitForFunction(callback, floor) {
    assert.ok(floor.every((amount, resource) => amount <= resources[resource]));
    window.guestWorld = { hud: { state: { resources: resources.map(amount => amount + (mode === 'bad-hud' ? 1000 : 0)) } } }; assert.equal(callback(floor), true); events.push('hud:' + index);
  }, async evaluate(callback) { return callback(); } }));
  return { args: { host, guest, guests, async focusGuest(index) { events.push('focus:' + index); }, async focus() { events.push('focus-original'); }, hostFile },
    workers, callbacks, events, failure, polls: () => polls, screenshots: () => screenshots };
}
function restored(f) {
  assert.equal(f.callbacks.size, 0); assert.equal(global.window.nativeWorkerObservation, undefined);
  for (const worker of f.workers) { assert.equal(worker.agent.interactWithTargetResourceDispenser, worker.original); assert.equal(Object.hasOwn(worker.agent, 'interactWithTargetResourceDispenser'), false); }
}
test('worker observation requires worker-owned harvest/deposit pairs, accounts unrelated income and checks all guest HUDs plus save', async t => {
  const f = fixture(t); await naturalWorkers(f.args);
  assert.equal(f.polls(), 2, 'Unrelated hero deposits cannot satisfy native worker delivery.');
  for (const index of [0, 1, 2]) assert.ok(f.events.includes('hud:' + index));
  const save = JSON.parse(fs.readFileSync(f.args.hostFile)); assert.deepEqual(JSON.parse(save.state.userData.desktopCoop).economy.resource, [3, 4]);
  assert.equal(f.screenshots(), 0); restored(f);
});
test('worker observation stops after its bounded natural wait without accepting harvest alone or unrelated deposits', async t => {
  const f = fixture(t, 'no-delivery');
  await assert.rejects(naturalWorkers(f.args), /Each native worker must deliver a positive amount/);
  assert.equal(f.polls(), 24); assert.equal(f.screenshots(), 1); restored(f);
});
test('worker observation preserves a failed wait and always removes native method wrappers/subscriptions', async t => {
  const f = fixture(t, 'wait-error');
  await assert.rejects(naturalWorkers(f.args), error => error === f.failure);
  assert.equal(f.polls(), 1); assert.equal(f.screenshots(), 1); restored(f);
});

test('worker observation refuses guest HUD balances above the authoritative host', async t => {
  const f = fixture(t, 'bad-hud');
  await assert.rejects(naturalWorkers(f.args), /Guest HUD income must stay within observed host balances/);
  assert.equal(f.screenshots(), 1); restored(f);
});
