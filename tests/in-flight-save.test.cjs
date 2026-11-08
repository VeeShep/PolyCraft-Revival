'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const saveInFlight = require('./coop-save-in-flight.cjs');

function fixture(t, mode, own) {
  const prior = { window: global.window, document: global.document, MutationObserver: global.MutationObserver };
  t.after(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete global[key]; else global[key] = value; });
  const observers = [], button = new EventTarget(), status = { textContent: 'Saved locally at before' }, error = { open: false };
  const carrier = { flying: true, numFlyingResourceBlocks: 1, flyingTweens: [{}], hasAnyFlyingResource() { return this.flying; } };
  const actor = { getEC: () => carrier };
  const capture = function (entity) {
    assert.equal(this, players); assert.equal(entity, actor);
    if (mode !== 'stuck') { carrier.flying = false; carrier.numFlyingResourceBlocks = 0; carrier.flyingTweens.length = 0; }
    return { inventory: {} };
  };
  const players = Object.assign(Object.create({ captureHero: capture }), { active: new Map([['assigned', { hero: actor }]]) });
  if (own) players.captureHero = capture;
  global.window = { hostWorld: { players, game: { gameClock: { getFrameIndex: () => 7 } } } };
  global.document = { getElementById: id => ({ 'save-now': button, status, 'error-dialog': error })[id] };
  global.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  };
  const changeStatus = text => { status.textContent = text; observers.filter(o => o.connected).forEach(o => o.callback()); };
  const host = {
    async evaluate(callback, argument) { return structuredClone(await callback(argument)); },
    async waitForFunction(callback, argument, options) { assert.ok([180000, 15000].includes(options.timeout)); assert.ok(callback(argument)); },
    locator(id) {
      assert.equal(id, '#save-now');
      return { async click() {
        if (mode === 'missed') carrier.flying = false;
        button.dispatchEvent(new Event('click'));
        changeStatus('Saving…');
        if (mode !== 'no-boundary') players.captureHero(actor);
        if (mode === 'save-error') error.open = true;
        else changeStatus('Saved locally at after');
      } };
    }
  };
  t.mock.method(console, 'log', () => {});
  return { host, players, capture, observers };
}
for (const own of [false, true]) {
  test('mid-flight UI save observer retains original capture ownership and a real active boundary (own=' + own + ')', async t => {
    const f = fixture(t, 'normal', own), result = await saveInFlight({ host: f.host, hero: 'assigned' });
    assert.equal(result.clicked.flying, true); assert.equal(result.boundary.before.flying, true); assert.equal(result.boundary.after.count, 0);
    assert.equal(f.players.captureHero, f.capture); assert.equal(Object.hasOwn(f.players, 'captureHero'), own);
    assert.ok(f.observers.every(o => !o.connected)); assert.equal(global.window.cancelNativeFlightSave, undefined);
  });
  for (const [mode, message] of [['missed', /clicked while the transfer is active/], ['no-boundary', /save boundary/], ['stuck', /strictly equal/], ['save-error', /finish successfully/]]) {
    test('mid-flight UI save rejects ' + mode + ' and restores observers (own=' + own + ')', async t => {
      const f = fixture(t, mode, own);
      await assert.rejects(saveInFlight({ host: f.host, hero: 'assigned' }), message);
      assert.equal(f.players.captureHero, f.capture); assert.equal(Object.hasOwn(f.players, 'captureHero'), own);
      assert.ok(f.observers.every(o => !o.connected)); assert.equal(global.window.cancelNativeFlightSave, undefined);
    });
  }
}
