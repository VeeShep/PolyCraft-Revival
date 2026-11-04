'use strict';
(function (root) {
  const NAMES = Object.freeze(['vfx_hit_e_generic1', 'vfx_hit_e_generic2', 'vfx_hit_bullet', 'vfx_hero_melee_thump1h', 'vfx_hero_melee_thump1v',
    'vfx_hero_rankup1', 'vfx_hero_rankup2', 'vfx_hero_rankup3', 'vfx_hero_rankup4', 'vfx_healing1', 'vfx_healing2', 'vfx_healing3', 'vfx_healing4',
    'vfx_dth_e_generic1v', 'vfx_dth_e_generic2h', 'vfx_dth_e_generic2v', 'vfx_dth_e_generic3v', 'vfx_dth_death1', 'vfx_dth_death2', 'vfx_dth_death3',
    'vfx_dth_death4', 'vfx_dth_death5', 'vfx_hit_e_treasure', 'vfx_crt_building1', 'vfx_crt_building2', 'vfx_dth_building1', 'vfx_dth_building2',
    'vfx_dth_building3', 'vfx_dth_building4', 'vfx_dth_small_building1', 'vfx_dth_small_building2', 'vfx_dth_small_building3', 'vfx_dth_small_building4']);
  const PERSISTENT = Object.freeze(['vfx_dth_building3', 'vfx_dth_small_building3']), persistent = new Set(PERSISTENT);
  const names = new Set(NAMES), LIMITS = Object.freeze({ events: 128, active: 64, age: 2, tweens: 1024 });
  const object = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
  const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(number);
  const emptyEffects = () => ({ sequence: 0, events: [], active: [] });
  function validateEffects(state, time) {
    const fail = () => { throw new Error('Invalid world visual effects.'); };
    if (!object(state, ['sequence', 'events', 'active']) || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Array.isArray(state.events) || state.events.length > LIMITS.events || !Array.isArray(state.active) || state.active.length > LIMITS.active) fail();
    let previous = 0;
    const validate = event => {
      if (!object(event, ['id', 'time', 'name', 'location', 'direction', 'entity', 'scale', 'dilation']) || !Number.isSafeInteger(event.id) || event.id <= previous || event.id > state.sequence || !names.has(event.name) || !number(event.time) || event.time < 0 || event.time > time || !vector(event.location) || !(event.direction === null || vector(event.direction))) fail();
      if (!(event.entity === null || typeof event.entity === 'string' && event.entity.length > 0 && event.entity.length <= 256) || !number(event.scale) || event.scale < 0.05 || event.scale > 10 || !number(event.dilation) || event.dilation < 0.1 || event.dilation > 10) fail();
      previous = event.id;
    };
    for (const event of state.events) validate(event);
    const recent = new Map(state.events.map(event => [event.id, event]));
    previous = 0;
    for (const event of state.active) {
      validate(event);
      if (!persistent.has(event.name) || event.time + 40 / event.dilation <= time) fail();
      const prior = recent.get(event.id);
      if (prior && ['name', 'time', 'entity', 'scale', 'dilation', 'location', 'direction'].some(key => JSON.stringify(prior[key]) !== JSON.stringify(event[key]))) fail();
    }
    return state;
  }
  class HostEffects {
    constructor(game, api) {
      this.game = game; this.api = api; this.sequence = 0; this.events = []; this.active = new Map();
      if (!api?.factory) return;
      this.original = api.factory.create;
      this.identities = new Map(NAMES.map(name => [api.archetypes[name], name]).filter(([definition]) => definition));
      api.factory.create = (...args) => { this.record(...args); return this.original.apply(api.factory, args); };
    }
    record(globals, definition, location, direction, actor, screen, scale = 1, dilation = 1) {
      const name = this.identities.get(definition);
      if (!name || screen || globals !== this.game.globals) return;
      const event = { id: this.sequence + 1, time: globals.gameCurrentTime, name, location: Array.from(location || actor?.getv3Location() || []),
        direction: direction ? Array.from(direction) : null, entity: actor?.getName() || null, scale, dilation };
      try { validateEffects({ sequence: event.id, events: [event], active: [] }, event.time); } catch { return; }
      this.sequence++; this.events.push(event);
      if (persistent.has(name)) { this.active.set(event.id, event); if (this.active.size > LIMITS.active) this.active.delete(this.active.keys().next().value); }
      this.trim();
    }
    trim() {
      const time = this.game.globals.gameCurrentTime;
      this.events = this.events.filter(event => event.time >= time - LIMITS.age).slice(-LIMITS.events);
      for (const [id, event] of this.active) if (event.time + 40 / event.dilation <= time) this.active.delete(id);
    }
    capture() { this.trim(); return structuredClone({ sequence: this.sequence, events: this.events, active: [...this.active.values()] }); }
    close() { if (this.api?.factory) this.api.factory.create = this.original; }
  }
  class GuestEffects {
    constructor(api, scene, globals) { this.api = api; this.scene = scene; this.globals = globals; this.queue = []; this.owners = new Map(); this.active = new Set(); this.sequence = null; }
    context(time, action) {
      if (!this.api?.tweens) throw new Error('Original visual effect support is unavailable.');
      const scheduler = this.api.tweens, original = { add: scheduler.add, remove: scheduler.remove, getAll: scheduler.getAll }, clock = this.globals.gameCurrentTime;
      scheduler.add = tween => { if (this.queue.length >= LIMITS.tweens) throw new Error('Too many guest visual effects.'); this.queue.push(tween); this.owners.set(tween, this.current); };
      scheduler.remove = tween => { const index = this.queue.indexOf(tween); if (index >= 0) this.queue.splice(index, 1); this.owners.delete(tween); };
      scheduler.getAll = () => this.queue;
      this.globals.gameCurrentTime = time;
      try { return action(); }
      finally { Object.assign(scheduler, original); this.globals.gameCurrentTime = clock; }
    }
    receive(state, time) {
      if (this.closed) throw new Error('Guest visual effects have closed.');
      validateEffects(state, time);
      if (this.sequence !== null && state.sequence < this.sequence) throw new Error('World visual effect sequence moved backwards.');
      const create = event => {
        const definition = this.api?.archetypes[event.name];
        if (!definition) throw new Error('Unknown original visual effect.');
        const actor = event.entity && { shouldBeDestroyed: () => !this.scene.entities.has(event.entity), getv3Location: () => this.scene.entities.get(event.entity)?.displayLocation || this.scene.entities.get(event.entity)?.record.location || event.location };
        const before = new Set(this.queue); this.current = event.id;
        try { this.context(event.time, () => this.api.create(this.globals, definition, [...event.location], event.direction && [...event.direction], actor || undefined, undefined, event.scale, event.dilation)); }
        catch (error) { this.queue = this.queue.filter(tween => before.has(tween)); for (const tween of this.owners.keys()) if (!before.has(tween)) this.owners.delete(tween); throw error; }
      };
      if (this.sequence !== null) for (const event of state.events) {
        if (event.id > this.sequence && time - event.time <= LIMITS.age && !persistent.has(event.name)) create(event);
      }
      const desired = new Set(state.active.map(event => event.id));
      for (const [tween, id] of this.owners) if (this.active.has(id) && !desired.has(id)) { const index = this.queue.indexOf(tween); if (index >= 0) this.queue.splice(index, 1); this.owners.delete(tween); }
      for (const event of state.active) if (!this.active.has(event.id)) create(event);
      this.active = desired;
      this.sequence = state.sequence;
    }
    update(time) {
      if (this.closed || !this.queue.length) return;
      this.context(time, () => {
        for (const tween of [...this.queue]) { this.current = this.owners.get(tween); if (this.queue.includes(tween) && !tween.update(time * 1000, this.globals.appCurrentTime * 1000)) this.api.tweens.remove(tween); }
      });
    }
    close() { this.closed = true; this.queue.length = 0; this.owners.clear(); this.active.clear(); }
  }
  const api = { NAMES, PERSISTENT, LIMITS, emptyEffects, validateEffects, HostEffects, GuestEffects };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftWorldEffects = api;
})(globalThis);
