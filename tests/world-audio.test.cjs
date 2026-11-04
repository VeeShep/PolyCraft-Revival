'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HostAudio, GuestAudio, SOUNDS, LOOPS, LIMITS, emptyAudio, validateAudio } = require('../desktop/world-audio.js');
const { soundManagerMethods } = require('./runtime-ast.cjs');
const native = soundManagerMethods();
function fixture() {
  const played = [], sources = [], location = [1, 2, 3]; let loaded = true;
  const source = (globalSource = false) => {
    const value = { globalSource, playing: false, stop() { this.playing = false; }, play(sound) { this.playing = true; played.push({ source: this, sound }); } };
    sources.push(value); return value;
  };
  const globals = { gameCurrentTime: 1, gameTimeStep: 0.1, settings: { volume: 1 }, soundManager: {},
    mathDevice: { v3BuildZero: () => [0, 0, 0], v3Copy: value => [...value], v3Equal: (a, b) => a.every((value, i) => value === b[i]), saturate: value => Math.max(0, Math.min(1, value)), lerp: (a, b, f) => a + (b - a) * f } };
  const manager = Object.assign(Object.create(native.methods), { globals, activeSoundSourceList: [], soundSourceDepot: Array.from({ length: 50 }, source), soundSourceGlobalDepot: [source(true)],
    soundManager: { isSoundLoaded: () => loaded, isSoundMissing: () => !loaded, get: path => path } });
  const game = { globals, gameSoundManager: manager }, entity = { getName: () => 'hero', getv3Location: () => location, shouldBeDestroyed: () => false };
  return { game, manager, entity, location, played, sources, unloaded: () => { loaded = false; } };
}
const play = (id, name = 'aud_shotgunshot', entity = 'hero') => ({ id, op: 'play', name, entity, location: [1, 2, 3], fade: 0, time: 1, target: null });
const loop = (id, entity = 'hero') => ({ id, name: 'aud_amb_fire', entity, location: [1, 2, 3], fade: null });
test('world sound whitelist matches original archetypes and loop flags and excludes music and local GUI sounds', () => {
  assert.equal(new Set(SOUNDS).size, SOUNDS.length);
  for (const name of SOUNDS) {
    const definition = native.archetypes[name]; assert.ok(definition, name);
    for (const value of definition.sounds || [definition]) assert.equal(!!value.loop, LOOPS.includes(name), name);
  }
  for (const name of ['aud_test', 'aud_music_day', 'aud_music_day_preview', 'aud_amber_spend', 'aud_alert', 'aud_newquest', 'aud_badge_complete']) assert.equal(SOUNDS.includes(name), false);
});
test('host captures original entity/action/effect intents independently of mute or missing assets and restores native hooks', () => {
  const f = fixture(), originalPlay = f.manager.playInternal, originalStop = f.manager.stopInternal;
  f.manager.playInternal('aud_amb_fire', null, f.entity);
  const recorder = new HostAudio(f.game), initial = recorder.capture(); assert.equal(initial.loops.length, 1);
  f.game.globals.settings.volume = 0; f.unloaded();
  const at = [10, 11, 12]; f.manager.playInternal('aud_shotgunshot', at, f.entity); at.fill(99);
  f.manager.playInternal('aud_music_day'); f.manager.playInternal('aud_alert', [0, 0, 0]); f.manager.playInternal('aud_explosion');
  f.manager.playInternal('aud_explosion', [NaN, 0, 0]);
  const state = recorder.capture(); assert.equal(state.events.length, 2); assert.deepEqual(state.events[1].location, [10, 11, 12]);
  assert.equal(state.events[1].entity, 'hero'); validateAudio(state, 1);
  f.location[0] = 20; assert.equal(recorder.capture().loops[0].location[0], 20); assert.equal(initial.loops[0].location[0], 1);
  f.entity.shouldBeDestroyed = () => true; f.location[0] = 30; assert.equal(recorder.capture().loops[0].location[0], 20);
  recorder.close(); assert.equal(f.manager.playInternal, originalPlay); assert.equal(f.manager.stopInternal, originalStop);
  const detached = fixture(); detached.manager.playInternal('aud_amb_fire', null, detached.entity); detached.manager.playInternal('aud_amb_fire');
  detached.entity.shouldBeDestroyed = () => true; detached.manager.updateSoundSource(detached.manager.activeSoundSourceList[0]);
  const late = new HostAudio(detached.game); assert.equal(late.capture().loops.length, 1); assert.equal(late.capture().loops[0].entity, 'hero');
  detached.manager.stopInternal('aud_amb_fire', detached.entity, 0); assert.equal(late.capture().loops.length, 0); late.close();
});
test('native stop order keeps overlapping same-name loops separate and bounded snapshots retain current loops after old events expire', () => {
  const f = fixture(), recorder = new HostAudio(f.game);
  f.manager.playInternal('aud_amb_fire', null, f.entity); f.manager.playInternal('aud_amb_fire', null, f.entity);
  assert.deepEqual(recorder.capture().loops.map(value => value.id), [1, 2]);
  f.manager.stopInternal('aud_amb_fire', f.entity, 0.5);
  assert.deepEqual(recorder.capture().loops.map(value => value.id), [1, 2]); assert.equal(recorder.capture().loops[0].fade.until, 1.5); assert.equal(f.manager.activeSoundSourceList[0].fadeTime, 0.5);
  for (let i = 0; i < LIMITS.events + 10; i++) f.manager.playInternal('aud_shotgunshot', [0, 0, 0]);
  assert.equal(recorder.capture().events.length, LIMITS.events);
  f.game.globals.gameCurrentTime = 4; assert.equal(recorder.capture().events.length, 0); assert.equal(recorder.capture().loops.length, 1);
  for (let i = 0; i < LIMITS.loops + 10; i++) f.manager.playInternal('aud_amb_fire', [0, 0, 0]);
  assert.equal(recorder.capture().loops.length, LIMITS.loops); validateAudio(recorder.capture(), 4); recorder.close();
});
test('host records outermost intent once when native playback recurses and releases the guard on errors', () => {
  const f = fixture(); let failure = false;
  f.manager.playInternal = function () { if (failure) throw new Error('device lost'); if (!this.inner) { this.inner = true; try { this.playInternal('aud_hit_mushroom', [0, 0, 0]); } finally { this.inner = false; } } };
  const recorder = new HostAudio(f.game);
  f.manager.playInternal('aud_shotgunshot', [0, 0, 0]); assert.equal(recorder.capture().events.length, 1);
  failure = true; assert.throws(() => f.manager.playInternal('aud_explosion', [0, 0, 0]), /device lost/);
  failure = false; f.manager.playInternal('aud_explosion', [0, 0, 0]); assert.equal(recorder.capture().events.length, 3); recorder.close();
});
test('guest joins current loops without replaying history, plays fresh effects once across full resyncs and follows displayed actors', () => {
  const f = fixture(), scene = { entities: new Map([['hero', { displayLocation: [4, 5, 6] }]]) }, guest = new GuestAudio(f.manager, scene);
  const initial = { sequence: 2, events: [play(1), play(2, 'aud_amb_fire')], loops: [loop(2)] };
  guest.receive(initial, 1); assert.equal(f.played.length, 1); assert.equal(guest.loops.size, 1);
  const next = { sequence: 3, events: [...initial.events, play(3)], loops: [loop(2)] };
  guest.receive(next, 1); guest.receive(structuredClone(next), 1); assert.equal(f.played.length, 2);
  const entry = guest.loops.get(2).entry; f.manager.updateSoundSource(entry); assert.deepEqual(entry.soundSource.position, [4, 5, 6]);
  scene.entities.get('hero').displayLocation = [7, 8, 9]; f.manager.updateSoundSource(entry); assert.deepEqual(entry.soundSource.position, [7, 8, 9]);
  const expired = { sequence: 4, events: [play(4)], loops: [] }; guest.receive(expired, 4);
  assert.equal(f.played.length, 2, 'stale missed one-shot is skipped'); assert.equal(entry.soundSource.playing, false); assert.equal(guest.loops.size, 0);
  assert.throws(() => guest.receive(initial, 4), /backwards/);
});
test('guest loop stops preserve native fade and same-name instance order, retry unavailable assets and repair lost stops', () => {
  const f = fixture(), guest = new GuestAudio(f.manager, { entities: new Map() });
  guest.receive({ sequence: 2, events: [], loops: [loop(1, null), loop(2, null)] }, 1);
  const first = guest.loops.get(1).entry, second = guest.loops.get(2).entry;
  guest.receive({ sequence: 3, events: [{ id: 3, op: 'stop', name: 'aud_amb_fire', entity: null, location: null, fade: 0.5, time: 1, target: 1 }], loops: [{ ...loop(1, null), fade: { duration: 0.5, until: 1.5 } }, loop(2, null)] }, 1);
  assert.equal(first.fadeTime, 0.5); assert.equal(first.soundSource.playing, true); assert.equal(guest.loops.get(2).entry, second);
  guest.receive({ sequence: 4, events: [], loops: [] }, 1); assert.equal(second.soundSource.playing, false); assert.equal(guest.loops.size, 0);
  const missing = fixture(); missing.unloaded(); const retry = new GuestAudio(missing.manager, { entities: new Map() });
  retry.receive({ sequence: 1, events: [], loops: [loop(1, null)] }, 1); assert.equal(retry.loops.size, 0);
  missing.manager.soundManager.isSoundLoaded = () => true; missing.manager.soundManager.isSoundMissing = () => false;
  retry.receive({ sequence: 1, events: [], loops: [loop(1, null)] }, 1); assert.equal(retry.loops.size, 1);
});
test('world audio parsing refuses arbitrary assets, oversized histories, unordered identities and invalid or future metadata', () => {
  validateAudio(emptyAudio(), 1);
  const valid = { sequence: 1, events: [play(1)], loops: [] }; validateAudio(valid, 1);
  for (const fade of [undefined, {}, { duration: 0, until: 2 }, { duration: 31, until: 2 }, { duration: 1, until: 1 }, { duration: 1, until: 3 }, { duration: 1, until: NaN }]) {
    assert.throws(() => validateAudio({ sequence: 1, events: [], loops: [{ ...loop(1), fade }] }, 1), /Invalid world audio/);
  }
  for (const change of [{ name: 'sounds/explosion.ogg' }, { name: 'aud_music_day' }, { op: 'other' }, { id: 0 }, { time: 2 }, { time: NaN }, { entity: '' }, { location: [0, 0, Infinity] }, { fade: 1 }, { unexpected: 1 }]) {
    const state = structuredClone(valid); Object.assign(state.events[0], change); assert.throws(() => validateAudio(state, 1), /Invalid world audio/);
  }
  for (const state of [{ sequence: 1, events: [play(1), play(1)], loops: [] }, { sequence: 0, events: [play(1)], loops: [] },
    { sequence: 1, events: [], loops: [loop(1), loop(1)] }, { sequence: 1, events: [play(1)], loops: [loop(1)] },
    { sequence: 1000, events: Array.from({ length: LIMITS.events + 1 }, (_, i) => play(i + 1)), loops: [] },
    { sequence: 1000, events: [], loops: Array.from({ length: LIMITS.loops + 1 }, (_, i) => loop(i + 1)) }]) assert.throws(() => validateAudio(state, 1), /Invalid world audio/);
});

test('repeated native fading stops retain the first loop identity, and guests never stop a different instance when one is missing', () => {
  const f = fixture(), host = new HostAudio(f.game);
  f.manager.playInternal('aud_amb_fire', null, f.entity); f.manager.playInternal('aud_amb_fire', null, f.entity);
  f.manager.stopInternal('aud_amb_fire', f.entity, 0.5); f.manager.stopInternal('aud_amb_fire', f.entity, 0.5);
  let state = host.capture(); assert.deepEqual(state.events.slice(-2).map(event => event.target), [1, 1]); assert.deepEqual(state.loops.map(value => value.id), [1, 2]);
  f.manager.stopInternal('aud_amb_fire', f.entity, 0); state = host.capture(); assert.equal(state.events.at(-1).target, 1); assert.deepEqual(state.loops.map(value => value.id), [2]);
  const g = fixture(), guest = new GuestAudio(g.manager, { entities: new Map() });
  guest.receive({ sequence: 2, events: [], loops: [loop(2, null)] }, 1);
  const second = guest.loops.get(2).entry;
  guest.receive({ sequence: 3, events: [{ id: 3, op: 'stop', name: 'aud_amb_fire', entity: null, location: null, fade: 0, time: 1, target: 1 }], loops: [loop(2, null)] }, 1);
  assert.equal(second.soundSource.playing, true); assert.equal(g.played.length, 1); host.close();
});

test('a loop started and faded between snapshots is audible for the remaining fade, including on late join', () => {
  const f = fixture(), guest = new GuestAudio(f.manager, { entities: new Map() }); guest.receive(emptyAudio(), 1);
  const state = { sequence: 2, events: [play(1, 'aud_amb_fire', null), { id: 2, op: 'stop', name: 'aud_amb_fire', entity: null, location: null, fade: 1, target: 1, time: 1 }],
    loops: [{ ...loop(1, null), fade: { duration: 1, until: 2 } }] };
  guest.receive(state, 1.2); const entry = guest.loops.get(1).entry;
  assert.equal(f.played.length, 1); assert.equal(entry.soundSource.playing, true); assert.ok(Math.abs(entry.fadeTime - 0.8) < 1e-9); assert.equal(entry.startFadeTime, 1);
  entry.fadeTime = 0.7; guest.receive(structuredClone(state), 1.3); assert.equal(entry.fadeTime, 0.7, 'repeated snapshots do not restart the fade');
  const late = fixture(), joined = new GuestAudio(late.manager, { entities: new Map() }); joined.receive(state, 1.5);
  assert.equal(late.played.length, 1); assert.equal(joined.loops.get(1).entry.fadeTime, 0.5);
  guest.receive({ sequence: 2, events: [], loops: [] }, 2); assert.equal(entry.soundSource.playing, false);
});
test('replicated one-shot stops cannot stop local menu audio with the same archetype', () => {
  const f = fixture(), guest = new GuestAudio(f.manager, { entities: new Map() }); guest.receive(emptyAudio(), 1);
  f.manager.playInternal('aud_celebrate'); const local = f.manager.activeSoundSourceList[0];
  guest.receive({ sequence: 1, events: [play(1, 'aud_celebrate', null)], loops: [] }, 1);
  const remote = f.manager.activeSoundSourceList[1];
  guest.receive({ sequence: 2, events: [{ id: 2, op: 'stop', name: 'aud_celebrate', entity: null, location: null, fade: 0, time: 1, target: null }], loops: [] }, 1);
  assert.equal(local.soundSource.playing, true); assert.equal(remote.soundSource.playing, false);
});
