'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CoopPlayers } = require('../desktop/coop-players.js');
const { CoopData, KEY, validateLife, validateCoop } = require('../desktop/coop-data.js');
const { Saves, emptyState } = require('../desktop/saves.cjs');
const runtime = require('./runtime-ast.cjs').component('ECPlayerLife');
function fixture() {
  const healthEvents = [], locomotion = { reset() {}, setActive() {} };
  const health = { setInvulnerable: value => healthEvents.push(['invulnerable', value]), setDisableHealthBar: value => healthEvents.push(['bar', value]) };
  const game = { globals: { gameCurrentTime: 100 }, getHeroRespawnPosition: () => [1, 0, 2] };
  const life = Object.assign(Object.create(runtime), { state: runtime.states.NORMAL, lives: -1, infiniteLives: false, deathAnimationDuration: 1,
    archetype: { respawnDelay: 30 }, globals: { gameCurrentTime: 100, mathDevice: { v3Copy: value => [...value] } }, gameManager: game,
    getEntityEC: name => name === 'ECHealth' ? health : locomotion,
    playDeathAnimation(location) { this.deathTime = this.globals.gameCurrentTime; this.respawnLocation = [...location]; } });
  const hero = { getEC: name => name === 'ECPlayerLife' ? life : health };
  const players = Object.assign(Object.create(CoopPlayers.prototype), { game });
  const clock = value => { game.globals.gameCurrentTime = life.globals.gameCurrentTime = value; };
  return { life, hero, players, game, clock, healthEvents };
}
test('waiting lifecycle preserves fractional remaining time, lives, destination and frozen offline duration without replaying a death', () => {
  const f = fixture(); f.life.scheduleRespawn([8, 1, 9], 20.25); f.life.state = f.life.states.RESPAWNING; f.clock(105);
  const saved = f.players.captureLife(f.hero); assert.equal(saved.remaining, 15.25); assert.equal(saved.lives, -1);
  const restored = fixture(); restored.clock(10000); restored.players.restoreLife(restored.hero, saved, { current: 0 });
  assert.equal(restored.life.respawnTime, 10015.25); assert.equal(restored.life.state, restored.life.states.RESPAWNING);
  assert.deepEqual(restored.life.respawnLocation, [8, 1, 9]); assert.equal(restored.life.lives, -1); assert.deepEqual(restored.healthEvents, [['invulnerable', true], ['bar', true]]);
  saved.location[0] = 99; assert.equal(restored.life.respawnLocation[0], 8);
  restored.clock(10005); assert.equal(restored.players.captureLife(restored.hero).remaining, 10.25);
});
test('death animation restores its own remaining duration even with positive saved health, then schedules the original full wait', () => {
  const f = fixture(); f.life.beginRespawn(); f.clock(100.75);
  const saved = f.players.captureLife(f.hero); assert.equal(saved.phase, 'dying'); assert.equal(saved.remaining, 0.25);
  const restored = fixture(); restored.clock(500); restored.players.restoreLife(restored.hero, saved, { current: 10 });
  assert.equal(restored.life.state, restored.life.states.DYING); assert.equal(restored.life.deathTime, 499.25);
  restored.clock(500.25); restored.life.updateDeathAnimation(); assert.equal(restored.life.respawnTime, 530.25);
  assert.equal(restored.life.state, restored.life.states.RESPAWNING);
});
test('original finite and infinite lives survive repeated dying/waiting disk restores without replaying a death', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-finite-life-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = new Saves(path.join(root, 'saves')), slot = saves.create('Disposable lifecycle contracts');
  function nativeActor(lives, infiniteLives, time = 100) {
    const events = [], globals = { gameCurrentTime: time, mathDevice: { v3Copy: v => [...v], v3Build: (...v) => v, v3Add: (a, b) => a.map((v, i) => v + b[i]) } };
    const health = { resetHealth: () => events.push('health'), setInvulnerable() {}, setDisableHealthBar() {}, setInvulnerableDuration() {} };
    const locomotion = { reset() {}, setActive() {} }, components = { ECHealth: health, ECLocomotion: locomotion, ECPhysicsSphere: { reset() {} } };
    const game = { globals, getHeroRespawnPosition: () => [1, 0, 2], getScoreInfo: () => ({ onHeroDeath: () => events.push('death') }) };
    globals.metricsManager = { sendGameMetric: name => events.push(name) };
    const entity = { getEC: name => components[name], setv3Location() {}, showMesh() {}, flashDeath() {} };
    const life = components.ECPlayerLife = Object.assign(Object.create(runtime), { entity, gameManager: game, globals, state: runtime.states.NORMAL,
      lives, infiniteLives, deathAnimationDuration: 1, archetype: { respawnDelay: 15, respawnInvulnerableTime: 5 },
      getEntityEC: name => components[name], setToDraw() {}, playSound: name => events.push(name) });
    return { life, entity, globals, events, players: Object.assign(Object.create(CoopPlayers.prototype), { game }) };
  }
  for (const infinite of [false, true]) for (const startingLives of [3, 1, 0]) for (const phase of ['dying', 'waiting']) {
    let actor = nativeActor(startingLives, infinite);
    actor.life.loseLife();
    const remainingLives = startingLives - (infinite ? 0 : 1);
    assert.equal(actor.life.lives, remainingLives); assert.equal(actor.events.filter(v => v === 'death').length, 1);
    actor.globals.gameCurrentTime += phase === 'dying' ? .75 : 1;
    if (phase === 'waiting') actor.life.updateDeathAnimation();
    for (let reload = 0; reload < 2; reload++) {
      const saved = actor.players.captureLife(actor.entity);
      assert.equal(saved.phase, phase); assert.equal(saved.lives, remainingLives); assert.equal(saved.infiniteLives, infinite);
      const state = saves.load(slot.id).state, data = new CoopData(state), player = data.data.players[0];
      player.location = [4, 0, 5]; player.health = { current: 0, maximum: 50 }; player.life = saved;
      data.persist(); saves.save(slot.id, state);
      const disk = new CoopData(saves.load(slot.id).state).data.players[0].life;
      assert.deepEqual(disk, saved);
      actor = nativeActor(99, !infinite, 1000 + reload * 100);
      actor.players.restoreLife(actor.entity, disk, { current: 0 });
      assert.deepEqual(actor.players.captureLife(actor.entity), saved);
      assert.ok(!actor.events.includes('death') && !actor.events.some(v => v.startsWith('heroDeath_')));
    }
    if (phase === 'dying') {
      actor.globals.gameCurrentTime += .25; actor.life.updateDeathAnimation();
      assert.equal(actor.players.captureLife(actor.entity).remaining, 15);
    }
    actor.globals.gameCurrentTime += 15; actor.life.updateScheduleRespawn(); actor.life.updateScheduleRespawn();
    assert.equal(actor.life.state, runtime.states.NORMAL); assert.equal(actor.life.lives, remainingLives);
    assert.equal(actor.events.filter(v => v === 'health').length, 1); assert.equal(actor.events.filter(v => v === 'spawnHero').length, 1);
    actor.life.loseLife(); assert.equal(actor.life.lives, remainingLives - (infinite ? 0 : 1));
    assert.equal(actor.events.filter(v => v === 'death').length, 1);
  }
});
test('legacy unknown death timing restarts the original wait for zero health, while normal lives and malformed lifecycle checks are retained', () => {
  const f = fixture(); f.players.restoreLife(f.hero, null, { current: 0 }); assert.equal(f.life.respawnTime, 130); assert.equal(f.life.state, f.life.states.RESPAWNING); assert.deepEqual(f.healthEvents, [['invulnerable', true], ['bar', true]]);
  const normal = { phase: 'normal', remaining: 0, location: null, lives: 2, infiniteLives: true };
  const other = fixture(); other.players.restoreLife(other.hero, normal, { current: 10 }); assert.equal(other.life.lives, 2); assert.equal(other.life.infiniteLives, true); assert.equal(other.life.respawnTime, undefined);
  for (const invalid of [{ ...normal, remaining: -1 }, { ...normal, location: [0, 0, 0] }, { ...normal, phase: 'waiting' }, { ...normal, lives: 1.5 }, { ...normal, remaining: NaN }, { ...normal, secret: true }]) assert.throws(() => validateLife(invalid), /Invalid co-op/);
  const state = emptyState(), data = new CoopData(state); data.data.players[0].life = normal;
  assert.throws(() => validateCoop(data.data), /position and health/);
});
test('actual schema-3 files migrate with exact pre-v6 bytes and refuse the frozen Beta 11 reader through rename, recovery and export/import', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-life-save-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = new (require('../reference/coop-schema-3/saves.cjs').Saves)(path.join(root, 'saves'));
  const slot = old.create('Old host'); new (require('../reference/coop-schema-3/coop-data.js').CoopData)(slot.state).persist(); old.save(slot.id, slot.state);
  const file = old.file(slot.id), bytes = fs.readFileSync(file), saves = new Saves(old.directory), loaded = saves.load(slot.id), data = new CoopData(loaded.state);
  assert.equal(data.data.version, 4); assert.equal(data.data.players[0].life, null); assert.deepEqual(fs.readFileSync(file), bytes);
  const host = data.data.players[0]; host.location = [0, 0, 0]; host.health = { current: 0, maximum: 10 };
  host.life = { phase: 'waiting', remaining: 12.5, location: [1, 0, 2], lives: 1, infiniteLives: false }; data.persist();
  assert.equal(saves.save(slot.id, loaded.state).version, 6); assert.deepEqual(fs.readFileSync(file + '.pre-v6'), bytes);
  assert.throws(() => old.load(slot.id), error => error.code === 'UNSUPPORTED_SAVE'); assert.throws(() => old.save(slot.id, slot.state), /Unsupported/);
  saves.rename(slot.id, 'Renamed'); fs.writeFileSync(file, '{broken'); const recovered = saves.load(slot.id); assert.equal(recovered.recovered, true);
  assert.equal(JSON.parse(recovered.state.userData[KEY]).players[0].life.remaining, 12.5);
  const exported = path.join(root, 'backup.json'); saves.export(slot.id, exported); const imported = saves.import(exported);
  assert.deepEqual(new CoopData(imported.state).data.players[0].life, host.life); assert.deepEqual(fs.readFileSync(file + '.pre-v6'), bytes);
  fs.unlinkSync(file); assert.throws(() => old.load(slot.id), error => error.code === 'UNSUPPORTED_SAVE');
  saves.remove(slot.id); assert.equal(fs.existsSync(file + '.pre-v6'), false);
});

test('positive-health death animations still block host movement and interaction intents', () => {
  const f = fixture(), { HostMovement } = require('../desktop/coop-input.js'), { HostActions } = require('../desktop/coop-actions.js');
  let destination = null;
  const locomotion = { setDestination: value => { destination = value; }, clearDestination: () => { destination = null; }, clearDestinationEntity() {} };
  const hero = { shouldBeDestroyed: () => false, getv3Location: () => [0, 0, 0], getEC: name => ({ ECPlayerLife: f.life, ECHealth: { getHealth: () => 10 }, ECLocomotion: locomotion, ECPlayerBuilder: { isBuilding: () => false, isThrowing: () => false } })[name] };
  const movement = new HostMovement(() => 0); movement.receive({ type: 'move', sequence: 1, move: [1, 0] }); movement.apply(hero); assert.ok(destination);
  f.life.state = f.life.states.DYING; movement.apply(hero); assert.equal(destination, null);
  const game = { getGameEntityByName: () => ({ shouldBeDestroyed: () => false }), isScriptLocked: () => false };
  assert.match(new HostActions().execute(game, hero, {}, 'target'), /Finish/);
});
test('failed pre-v6 preservation leaves the old primary unchanged, and failed primary writes can retry from the exact backup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-life-failure-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = new (require('../reference/coop-schema-3/saves.cjs').Saves)(path.join(root, 'saves')), slot = old.create('Legacy');
  new (require('../reference/coop-schema-3/coop-data.js').CoopData)(slot.state).persist(); old.save(slot.id, slot.state);
  const file = old.file(slot.id), bytes = fs.readFileSync(file); let backupFailure = true, primaryFailure = false;
  const io = { ...fs, linkSync(source, destination) { if (backupFailure && destination.endsWith('.pre-v6')) throw new Error('backup refused'); fs.linkSync(source, destination); }, renameSync(source, destination) { if (primaryFailure && destination === file) throw new Error('primary refused'); fs.renameSync(source, destination); } };
  const saves = new Saves(old.directory, io), loaded = saves.load(slot.id); new CoopData(loaded.state).persist();
  assert.throws(() => saves.save(slot.id, loaded.state), /backup refused/); assert.deepEqual(fs.readFileSync(file), bytes);
  backupFailure = false; primaryFailure = true; assert.throws(() => saves.save(slot.id, loaded.state), /primary refused/); assert.deepEqual(fs.readFileSync(file + '.pre-v6'), bytes);
  primaryFailure = false; assert.equal(saves.save(slot.id, loaded.state).version, 6); assert.deepEqual(fs.readFileSync(file + '.pre-v6'), bytes);
  const source = path.join(root, 'original.json'); fs.writeFileSync(source, bytes); const before = fs.readdirSync(old.directory).sort();
  backupFailure = true; assert.throws(() => saves.import(source), /backup refused/); assert.deepEqual(fs.readdirSync(old.directory).sort(), before);
  backupFailure = false; const imported = saves.import(source); assert.deepEqual(fs.readFileSync(saves.file(imported.id) + '.pre-v6'), bytes);
  new CoopData(imported.state).persist(); saves.save(imported.id, imported.state);
  assert.deepEqual(fs.readFileSync(saves.file(imported.id) + '.pre-v6'), bytes); assert.deepEqual(fs.readFileSync(source), bytes);
});
