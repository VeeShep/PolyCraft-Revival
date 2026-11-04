'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostEffects, GuestEffects, NAMES, PERSISTENT, DURATIONS, LIMITS, emptyEffects, validateEffects } = require('../desktop/world-effects.js');
const { visualEffectMethods } = require('./runtime-ast.cjs');
const native = visualEffectMethods(NAMES);
function fixture() {
  const sprites = [], solo = [], scheduler = native.tweens;
  scheduler.add = tween => solo.push(tween); scheduler.remove = tween => { const i = solo.indexOf(tween); if (i >= 0) solo.splice(i, 1); }; scheduler.getAll = () => solo;
  const globals = { gameCurrentTime: 100, appCurrentTime: 200, simpleSpriteRenderer: { addSprite: sprite => sprites.push(JSON.parse(JSON.stringify(sprite))) }, camera: { matrix: [] },
    mathDevice: { v3Copy: value => [...value], v3BuildYAxis: () => [0, 1, 0], v3LengthSq: value => value.reduce((sum, v) => sum + v*v, 0), v3Normalize: value => value.map(v => v / Math.hypot(...value)),
      v3ScalarMul: (value, scale) => value.map(v => v * scale), v3AddScalarMul: (point, speed, time) => point.map((value, i) => value + speed[i] * time), v4Build: (...values) => values, m43At: () => [0, 0, 1] } };
  scheduler.globals = globals;
  return { api: native, globals, sprites, solo, scene: { entities: new Map([['hero', { displayLocation: [5, 6, 7] }]]) } };
}
const event = (id = 1) => ({ id, time: 1, name: 'vfx_hit_e_generic1', location: [1, 2, 3], direction: null, entity: 'hero', scale: 1, dilation: 1 });
test('world effect whitelist resolves actual original finite sprite definitions and excludes local menu artwork', () => {
  assert.equal(new Set(NAMES).size, NAMES.length);
  for (const name of NAMES) { const definition = native.archetypes[name]; assert.ok(definition, name); assert.ok(definition.texturePath.startsWith('textures/'), name); assert.ok(definition.lifetime > 0 && definition.lifetime <= 40, name); }
  assert.equal(NAMES.includes('vfx_buildoption_1v'), false);
});
test('host captures native visual factory calls once with owned vectors, bounds history and restores the exact factory', () => {
  const f = fixture(), game = { globals: f.globals }, original = native.factory.create, host = new HostEffects(game, native), location = [1, 2, 3];
  native.factory.create(f.globals, native.archetypes.vfx_hit_e_generic1, location);
  location[0] = 99; const state = host.capture(); assert.deepEqual(state.events[0].location, [1, 2, 3]); assert.equal(f.solo.length, 1);
  native.factory.create(f.globals, native.archetypes.vfx_hit_e_generic1, [0, 0, 0], null, null, [1, 2]);
  assert.equal(host.capture().events.length, 1, 'screen-local effects stay out of replication');
  for (let i = 0; i < LIMITS.events + 1; i++) host.record(f.globals, native.archetypes.vfx_hit_e_generic1, [0, 0, 0]);
  assert.equal(host.capture().events.length, LIMITS.events); f.globals.gameCurrentTime += 3; assert.equal(host.capture().events.length, 0);
  host.close(); assert.equal(native.factory.create, original);
});
test('guest native sprites follow displayed entities without advancing solo tweens and repeated snapshots do not replay hits', () => {
  const f = fixture(), guest = new GuestEffects(native, f.scene, f.globals), original = { add: native.tweens.add, remove: native.tweens.remove, getAll: native.tweens.getAll };
  let soloUpdates = 0; native.tweens.Create({ value: 0 }).to({ value: 1 }, 1).onUpdate(() => { soloUpdates++; }).start();
  guest.receive({ sequence: 1, events: [event(1)], active: [] }, 1); assert.equal(guest.queue.length, 0, 'initial hits are history');
  const state = { sequence: 2, events: [event(2)], active: [] }; guest.receive(state, 1); guest.receive(structuredClone(state), 1); assert.equal(guest.queue.length, 1);
  guest.update(1.1); assert.equal(f.sprites.length, 1); assert.deepEqual(f.sprites[0].v3Location, [5, 6, 7]); assert.equal(f.sprites[0].texture, native.archetypes.vfx_hit_e_generic1.texturePath);
  f.scene.entities.delete('hero'); guest.update(1.15); assert.deepEqual(f.sprites.at(-1).v3Location, [1, 2, 3]);
  assert.equal(soloUpdates, 0); assert.equal(f.solo.length, 1); assert.equal(f.globals.gameCurrentTime, 100);
  for (const key of Object.keys(original)) assert.equal(native.tweens[key], original[key]);
  guest.update(2); assert.equal(guest.queue.length, 0); guest.close();
});
test('native multi-keyframe chains keep their start clocks and every child in the guest queue', () => {
  const f = fixture(), guest = new GuestEffects(native, f.scene, f.globals), definition = { texturePath: 'textures/loop.dds', alignment: 'camera',
    keyFrames: [{ scale: 1, colour: [1, 1, 1, 1], life: 0 }, { scale: 2, colour: [1, 1, 1, 1], life: 0.1 }, { scale: 3, colour: [1, 1, 1, 0], life: 0.2 }] };
  guest.context(1, () => native.create(f.globals, definition, [1, 2, 3])); assert.equal(guest.queue.length, 1); assert.equal(f.solo.length, 0);
  guest.update(1.11); assert.equal(guest.queue.length, 1); guest.update(1.16); assert.ok(f.sprites.at(-1).size > 2); assert.ok(f.sprites.at(-1).size < 3);
  guest.update(1.3); assert.equal(guest.queue.length, 0); assert.equal(f.solo.length, 0); assert.equal(f.globals.gameCurrentTime, 100);
});
test('creation and update failures restore the original scheduler and clock; close never completes or starts chained work', () => {
  const f = fixture(), api = { ...native }, guest = new GuestEffects(api, f.scene, f.globals), originalAdd = native.tweens.add, failure = new Error('sprite unavailable');
  guest.receive(emptyEffects(), 1); api.create = () => { native.tweens.add({ update() {} }); throw failure; };
  assert.throws(() => guest.receive({ sequence: 1, events: [event()], active: [] }, 1), error => error === failure); assert.equal(guest.queue.length, 0);
  assert.equal(native.tweens.add, originalAdd); assert.equal(f.globals.gameCurrentTime, 100);
  guest.queue.push({ update() { throw failure; } }); assert.throws(() => guest.update(1), error => error === failure);
  assert.equal(native.tweens.add, originalAdd); assert.equal(f.globals.gameCurrentTime, 100);
  guest.close(); guest.update(2); assert.equal(guest.queue.length, 0); assert.equal(f.sprites.length, 0);
  assert.throws(() => guest.receive(emptyEffects(), 2), /closed/);
});
test('effect parser refuses arbitrary assets, screen state, invalid bounds, oversized histories and replayed identity order', () => {
  const state = { sequence: 1, events: [event()], active: [] }; validateEffects(state, 1);
  for (const extra of [{ name: 'textures/loop.dds' }, { name: 'vfx_buildoption_1v' }, { scale: 0 }, { scale: 11 }, { dilation: 0 }, { time: 2 }, { entity: '' }, { location: [NaN, 0, 0] }, { screen: [1, 2] }]) {
    const bad = structuredClone(state); Object.assign(bad.events[0], extra); assert.throws(() => validateEffects(bad, 1), /Invalid world visual effects/);
  }
  assert.throws(() => validateEffects({ sequence: 2, events: [event(1), event(1)], active: [] }, 1), /Invalid/);
  assert.throws(() => validateEffects({ sequence: 1000, events: Array.from({ length: LIMITS.events + 1 }, (_, i) => event(i + 1)), active: [] }, 1), /Invalid/);
});

test('original forty-second decals survive journal expiry and late join, retain phase across resync and stop when removed', () => {
  const f = fixture(), host = new HostEffects({ globals: f.globals }, native); f.globals.gameCurrentTime = 1;
  for (const name of PERSISTENT.filter(name => DURATIONS[name] === 40)) { assert.equal(native.archetypes[name].lifetime, 40); host.record(f.globals, native.archetypes[name], [1, 2, 3]); }
  f.globals.gameCurrentTime = 20; const state = host.capture(); assert.equal(state.events.length, 0); assert.equal(state.active.length, 2); validateEffects(state, 20);
  const guest = new GuestEffects(native, f.scene, f.globals); guest.receive(state, 20); assert.equal(guest.queue.length, 2);
  guest.update(20); assert.equal(f.sprites.length, 2); assert.ok(f.sprites[0].v4color[3] < native.archetypes[PERSISTENT[0]].startColour[3]);
  guest.receive(structuredClone(state), 20); assert.equal(guest.queue.length, 2);
  f.globals.gameCurrentTime = 41; guest.receive(host.capture(), 41); assert.equal(guest.queue.length, 0); assert.equal(guest.owners.size, 0);
  host.close();
});
test('decal parsing and active/tween caps prevent unbounded presentation state without damaging solo queues', () => {
  const f = fixture(), guest = new GuestEffects(native, f.scene, f.globals), active = { ...event(), name: PERSISTENT[0] };
  assert.throws(() => validateEffects({ sequence: 1, events: [], active: [active] }, 41), /Invalid/);
  assert.throws(() => validateEffects({ sequence: 1, events: [], active: [event()] }, 1), /Invalid/);
  assert.throws(() => validateEffects({ sequence: 1, events: [event()], active: [active] }, 1), /Invalid/);
  assert.throws(() => validateEffects({ sequence: 1000, events: [], active: Array.from({ length: LIMITS.active + 1 }, (_, i) => ({ ...active, id: i + 1 })) }, 1), /Invalid/);
  guest.receive(emptyEffects(), 1); guest.queue = Array.from({ length: LIMITS.tweens }, () => ({ update() {} }));
  const add = native.tweens.add;
  assert.throws(() => guest.receive({ sequence: 1, events: [event()], active: [] }, 1), /Too many guest visual effects/);
  assert.equal(guest.queue.length, LIMITS.tweens); assert.equal(native.tweens.add, add); assert.equal(f.globals.gameCurrentTime, 100); assert.equal(f.solo.length, 0); guest.close();
});

test('all audited non-GUI world definitions use the original factory successfully without advancing solo work', () => {
  const excluded = name => /^(vfx_gui_|vfx_buildoption_|vfx_wb_)/.test(name) || ['vfx_test', 'charge', 'chargeUp', 'arrowPulse', 'criticalArrowPulse'].includes(name);
  assert.deepEqual([...NAMES].sort(), native.allNames.filter(name => !excluded(name)).sort(), 'new or unclassified native definitions need an explicit scope decision');
  const f = fixture(), guest = new GuestEffects(native, f.scene, f.globals); guest.receive(emptyEffects(), 1);
  const events = NAMES.map((name, i) => ({ ...event(i + 1), name, direction: [0, 0, 1], entity: null }));
  const active = events.filter(value => PERSISTENT.includes(value.name));
  guest.receive({ sequence: events.length, events, active }, 1); assert.equal(guest.queue.length, NAMES.length);
  guest.update(1.05); assert.ok(f.sprites.length > 50);
  for (const sprite of f.sprites) { assert.ok(sprite.v3Location.every(Number.isFinite)); assert.ok(Number.isFinite(sprite.size)); assert.ok(sprite.v4color.every(Number.isFinite)); }
  for (const name of PERSISTENT) assert.equal(native.archetypes[name].lifetime, DURATIONS[name]);
  assert.equal(f.solo.length, 0); assert.equal(f.globals.gameCurrentTime, 100); guest.close();
});
test('native explosion decals retain their fifteen-second phase on late join and expire at the original deadline', () => {
  const f = fixture(), host = new HostEffects({ globals: f.globals }, native); f.globals.gameCurrentTime = 1;
  for (const name of ['vfx_exp_decal', 'vfx_exp_decalBig']) host.record(f.globals, native.archetypes[name], [1, 2, 3]);
  f.globals.gameCurrentTime = 10; const state = host.capture(); assert.equal(state.events.length, 0); assert.equal(state.active.length, 2);
  const guest = new GuestEffects(native, f.scene, f.globals); guest.receive(state, 10); guest.update(10);
  assert.equal(f.sprites.length, 2); assert.ok(f.sprites[0].v4color[3] < native.archetypes.vfx_exp_decal.startColour[3]);
  guest.receive(state, 10); assert.equal(guest.queue.length, 2); f.globals.gameCurrentTime = 16;
  const expired = host.capture(); assert.equal(expired.active.length, 0); guest.receive(expired, 16); assert.equal(guest.queue.length, 0);
  assert.throws(() => validateEffects(state, 16), /Invalid/); host.close();
});
