'use strict';
(function (root) {
  const LOOPS = Object.freeze(['aud_amb_e_berserker', 'aud_amb_e_death', 'aud_amb_fire', 'aud_amb_s_cave', 'aud_amb_s_runningwater', 'aud_amb_s_waves']);
  const SOUNDS = Object.freeze([...LOOPS, 'aud_hero_rankup', 'aud_healing', 'aud_crt_e_bannerling', 'aud_attack_death', 'aud_hit_generic',
    'aud_hit_e_berserker', 'aud_dth_e_death', 'aud_hit_e_treasure', 'aud_amb_amber', 'aud_amb_xp', 'aud_dst_xp', 'aud_dynamite',
    'aud_dth_building', 'aud_scenery_mushroom', 'aud_hit_mushroom', 'aud_dst_fire', 'aud_explosion', 'aud_explosionBerserker',
    'aud_explosionBarrel', 'aud_explosionMine', 'aud_shotguncock', 'aud_shotgunreload', 'aud_shotgundryfire', 'aud_shotgunshot',
    'aud_celebrate', 'aud_celebrate_build', 'aud_crate_destroy', 'aud_amb_s_firefly']);
  const LIMITS = Object.freeze({ events: 128, loops: 50, age: 2 });
  const sounds = new Set(SOUNDS), loops = new Set(LOOPS);
  const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
  const position = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(number);
  const entityName = value => value === null || typeof value === 'string' && value.length > 0 && value.length <= 256;
  const identity = value => Number.isSafeInteger(value) && value > 0;
  const emptyAudio = () => ({ sequence: 0, events: [], loops: [] });
  function validateAudio(value, time = Infinity) {
    const fail = () => { throw new Error('Invalid world audio.'); };
    if (!keys(value, ['sequence', 'events', 'loops']) || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.events) || value.events.length > LIMITS.events || !Array.isArray(value.loops) || value.loops.length > LIMITS.loops) fail();
    let previous = 0;
    for (const event of value.events) {
      if (!keys(event, ['id', 'op', 'name', 'entity', 'location', 'fade', 'time', 'target']) || !identity(event.id) || event.id <= previous || event.id > value.sequence || !sounds.has(event.name) || !entityName(event.entity) || !number(event.time) || event.time < 0 || event.time > time) fail();
      if (event.op === 'play' ? !position(event.location) || event.fade !== 0 || event.target !== null : event.op !== 'stop' || event.location !== null || !number(event.fade) || event.fade < 0 || event.fade > 30 || !(event.target === null || loops.has(event.name) && identity(event.target) && event.target < event.id)) fail();
      previous = event.id;
    }
    const plays = new Map(value.events.map(event => [event.id, event]));
    previous = 0;
    for (const loop of value.loops) {
      if (!keys(loop, ['id', 'name', 'entity', 'location', 'fade']) || !identity(loop.id) || loop.id <= previous || loop.id > value.sequence || !loops.has(loop.name) || !entityName(loop.entity) || !position(loop.location)) fail();
      if (loop.fade !== null && (!keys(loop.fade, ['duration', 'until']) || !number(loop.fade.duration) || loop.fade.duration <= 0 || loop.fade.duration > 30 || !number(loop.fade.until) || loop.fade.until < 0 || Number.isFinite(time) && (loop.fade.until <= time || loop.fade.until > time + loop.fade.duration))) fail();
      const event = plays.get(loop.id);
      if (event && (event.op !== 'play' || event.name !== loop.name || event.entity !== loop.entity)) fail();
      previous = loop.id;
    }
    return value;
  }
  class HostAudio {
    constructor(game) {
      this.game = game; this.manager = game.gameSoundManager;
      this.sequence = 0; this.events = []; this.loops = new Map();
      this.original = { play: this.manager.playInternal, stop: this.manager.stopInternal };
      for (const entry of this.manager.activeSoundSourceList || []) {
        if (!loops.has(entry.soundName) || entry.soundSource.globalSource || !entry.soundSource.playing || entry.startFadeTime !== undefined) continue;
        const location = entry.v3Location || entry.soundSource.position;
        const actor = entry.gameEntity || (entry.gameEntityName && { getName: () => entry.gameEntityName, getv3Location: () => location, shouldBeDestroyed: () => true });
        this.play(entry.soundName, location, actor);
      }
      this.manager.playInternal = (...args) => {
        const outer = !this.playing;
        this.playing = true;
        try { if (outer) this.play(...args); return this.original.play.apply(this.manager, args); }
        finally { this.playing = !outer; }
      };
      this.manager.stopInternal = (...args) => { this.stop(...args); return this.original.stop.apply(this.manager, args); };
    }
    append(event) {
      const time = this.game.globals.gameCurrentTime;
      event.id = ++this.sequence; event.time = time; this.events.push(event);
      this.trim(time);
      return event.id;
    }
    trim(time) {
      this.events = this.events.filter(event => event.time >= time - LIMITS.age).slice(-LIMITS.events);
      for (const [id, loop] of this.loops) if (loop.fade && loop.fade.until <= time) this.loops.delete(id);
    }
    play(name, location, entity) {
      if (!sounds.has(name) || !location && !entity) return;
      const point = Array.from(location || entity.getv3Location()), idName = entity?.getName() || null;
      if (!position(point) || !entityName(idName)) return;
      const id = this.append({ op: 'play', name, entity: idName, location: point, fade: 0, target: null });
      if (loops.has(name)) {
        this.loops.set(id, { id, name, entity: idName, location: point, fade: null, actor: entity });
        if (this.loops.size > LIMITS.loops) this.loops.delete(this.loops.keys().next().value);
      }
    }
    stop(name, entity, fade = 0) {
      if (!sounds.has(name)) return;
      const idName = entity?.getName() || null;
      if (!entityName(idName)) return;
      this.trim(this.game.globals.gameCurrentTime);
      fade = number(fade) ? Math.max(0, Math.min(30, fade)) : 0;
      let target = null;
      for (const [id, loop] of this.loops) if (loop.name === name && loop.entity === idName) {
        target = id;
        if (fade > 0) loop.fade = { duration: fade, until: this.game.globals.gameCurrentTime + fade }; else this.loops.delete(id);
        break;
      }
      this.append({ op: 'stop', name, entity: idName, location: null, fade, target });
    }
    capture() {
      this.trim(this.game.globals.gameCurrentTime);
      const active = [];
      for (const loop of this.loops.values()) {
        if (loop.actor && !loop.actor.shouldBeDestroyed()) loop.location = Array.from(loop.actor.getv3Location());
        const { actor, ...record } = loop; active.push(record);
      }
      return structuredClone({ sequence: this.sequence, events: this.events, loops: active });
    }
    close() { this.manager.playInternal = this.original.play; this.manager.stopInternal = this.original.stop; }
  }
  class GuestAudio {
    constructor(manager, scene) { this.manager = manager; this.scene = scene; this.sequence = null; this.loops = new Map(); this.oneShots = new Map(); }
    actor(record) {
      if (!record.entity) return null;
      return { getName: () => record.entity, shouldBeDestroyed: () => !this.scene.entities.has(record.entity),
        getv3Location: () => this.scene.entities.get(record.entity)?.displayLocation || this.scene.entities.get(record.entity)?.record.location || record.location };
    }
    play(record) {
      const before = new Set(this.manager.activeSoundSourceList);
      const actor = this.actor(record);
      this.manager.playInternal(record.name, [...record.location], actor);
      return this.manager.activeSoundSourceList.find(entry => !before.has(entry) && entry.soundName === record.name);
    }
    stop(entry, fade = 0) {
      const index = this.manager.activeSoundSourceList.indexOf(entry);
      if (index < 0) return;
      if (fade > 0) entry.fadeTime = entry.startFadeTime = fade;
      else { entry.soundSource.stop(); this.manager.removeActiveSoundByIndex(index); }
    }
    receive(state, time) {
      validateAudio(state, time);
      if (this.sequence !== null && state.sequence < this.sequence) throw new Error('World audio sequence moved backwards.');
      const desired = new Map(state.loops.map(record => [record.id, record]));
      if (this.sequence !== null) for (const event of state.events) {
        if (event.id <= this.sequence || time - event.time > LIMITS.age) continue;
        if (event.op === 'play') {
          if (!loops.has(event.name)) { const entry = this.play(event); if (entry) this.oneShots.set(event.id, entry); }
        } else if (!loops.has(event.name)) {
          const entry = [...this.oneShots.values()].find(entry => this.manager.activeSoundSourceList.includes(entry) && entry.soundSource.playing && entry.soundName === event.name && (entry.gameEntityName || null) === event.entity);
          if (entry) this.stop(entry, event.fade);
        }
      }
      this.sequence = state.sequence;
      for (const [id, entry] of this.oneShots) if (!this.manager.activeSoundSourceList.includes(entry) || !entry.soundSource.playing) this.oneShots.delete(id);
      for (const [id, value] of this.loops) if (!desired.has(id)) { this.stop(value.entry); this.loops.delete(id); }
      for (const [id, record] of desired) {
        let existing = this.loops.get(id);
        if (!existing || !this.manager.activeSoundSourceList.includes(existing.entry) || !existing.entry.soundSource.playing) {
          const entry = this.play(record);
          if (!entry) { this.loops.delete(id); continue; }
          existing = { entry, name: record.name, entity: record.entity }; this.loops.set(id, existing);
        }
        if (existing.name !== record.name || existing.entity !== record.entity) throw new Error('World audio loop identity changed.');
        if (!record.entity) existing.entry.soundSource.position = [...record.location];
        if (record.fade && (existing.fadeUntil !== record.fade.until || existing.fadeDuration !== record.fade.duration)) {
          existing.entry.fadeTime = record.fade.until - time; existing.entry.startFadeTime = record.fade.duration;
          existing.fadeUntil = record.fade.until; existing.fadeDuration = record.fade.duration;
        }
      }
    }
  }
  const api = { SOUNDS, LOOPS, LIMITS, emptyAudio, validateAudio, HostAudio, GuestAudio };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftWorldAudio = api;
})(globalThis);
