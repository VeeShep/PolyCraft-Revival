'use strict';
(function (root) {
  const NAMES = Object.freeze([
    'explosion', 'explosionBig', 'stomp', 'smallScaffold', 'scaffold',
    'hitScaffold', 'levelUp', 'pistolshoteffect', 'meleeHit', 'thumper',
    'shot', 'vfx_hero_rankup1', 'vfx_hero_rankup2', 'vfx_hero_rankup3', 'vfx_hero_rankup4',
    'vfx_hero_melee_thump1h', 'vfx_hero_melee_thump1v', 'vfx_dth_e_generic1h', 'vfx_dth_e_generic1v', 'vfx_dth_e_generic2h',
    'vfx_dth_e_generic2v', 'vfx_dth_e_generic3v', 'vfx_hit_e_generic1', 'vfx_hit_e_generic2', 'vfx_bannerling_alert',
    'vfx_dth_death1', 'vfx_dth_death2', 'vfx_dth_death3', 'vfx_dth_death4', 'vfx_dth_death5',
    'vfx_inc_death', 'vfx_hit_e_treasure', 'vfx_crt_mortar', 'vfx_crt_bullet', 'vfx_fire_shotgunH1',
    'vfx_fire_shotgunV1', 'vfx_amb_bullet', 'vfx_amb_spit', 'vfx_hit_bullet', 'vfx_dst_r_generic',
    'vfx_dst_r_amber', 'vfx_dst_r_lumber', 'vfx_dst_r_stone', 'vfx_dst_r_xp', 'vfx_crt_building1',
    'vfx_crt_building2', 'vfx_dth_building1', 'vfx_dth_building2', 'vfx_dth_building3', 'vfx_dth_building4',
    'vfx_dth_small_building1', 'vfx_dth_small_building2', 'vfx_dth_small_building3', 'vfx_dth_small_building4', 'vfx_dst_fire1',
    'vfx_dst_fire2', 'vfx_dst_fire3', 'vfx_dst_fire4', 'vfx_dst_fire5', 'vfx_dst_fire6',
    'vfx_dst_fire_small1', 'vfx_dst_fire_small2', 'vfx_dst_fire_small3', 'vfx_dst_fire_small4', 'vfx_dst_fire_small5',
    'vfx_dst_fire_small6', 'vfx_healing1', 'vfx_healing2', 'vfx_healing3', 'vfx_healing4',
    'vfx_exp_0h', 'vfx_exp_0v', 'vfx_exp_1h', 'vfx_exp_1v', 'vfx_exp_2h',
    'vfx_exp_2v', 'vfx_exp_3h', 'vfx_exp_3v', 'vfx_expBig_0h', 'vfx_expBig_0v',
    'vfx_expBig_1h', 'vfx_expBig_1v', 'vfx_expBig_2h', 'vfx_expBig_2v', 'vfx_expBig_3h',
    'vfx_expBig_3v', 'vfx_exp_decal', 'vfx_exp_decalBig', 'vfx_mushroom_puff_1_1v', 'vfx_mushroom_puff_1_2h',
    'vfx_mushroom_puff_1_2v', 'vfx_mushroom_puff_1_3v', 'vfx_mushroom_puff_2_1v', 'vfx_mushroom_puff_2_2h', 'vfx_mushroom_puff_2_2v',
    'vfx_mushroom_puff_2_3v', 'vfx_mushroom_puff_3_1v', 'vfx_mushroom_puff_3_2h', 'vfx_mushroom_puff_3_2v', 'vfx_mushroom_puff_3_3v',
    'vfx_mushroom_hit1', 'vfx_mushroom_hit2', 'vfx_mushroom_hit3', 'vfx_bannerling_alert_mob', 'vfx_bannerling_alert_bombthrower',
    'vfx_bannerling_alert_boss', 'vfx_bannerling_alert_charger', 'vfx_bannerling_alert_commando', 'vfx_bannerling_alert_death', 'vfx_bannerling_alert_ranged',
    'vfx_bannerling_alert_thief', 'vfx_bannerling_alert_treasuredropper', 'vfx_dth_crate1', 'vfx_dth_crate2', 'vfx_dth_crate3',
    'vfx_dth_e_arrow1h', 'vfx_dth_e_arrow1v', 'vfx_dth_e_arrow2h', 'vfx_dth_e_arrow2v', 'vfx_dth_e_arrow3v',
    'vfx_upgrade_batch1', 'vfx_upgrade_batch2v', 'vfx_upgrade_batch3h', 'vfx_upgrade_batch3v', 'vfx_upgrade_batch4v',
    'vfx_upgrade_batch5'
  ]);
  const DURATIONS = Object.freeze({ vfx_dth_building3: 40, vfx_dth_small_building3: 40, vfx_exp_decal: 15, vfx_exp_decalBig: 15 });
  const PERSISTENT = Object.freeze(Object.keys(DURATIONS)), persistent = new Set(PERSISTENT);
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
      if (!persistent.has(event.name) || event.time + DURATIONS[event.name] / event.dilation <= time) fail();
      const prior = recent.get(event.id);
      if (prior && ['name', 'time', 'entity', 'scale', 'dilation', 'location', 'direction'].some(key => JSON.stringify(prior[key]) !== JSON.stringify(event[key]))) fail();
    }
    return state;
  }
  class HostEffects {
    constructor(game, api) {
      this.source = typeof game === 'function' ? game : () => game; this.api = api; this.sequence = 0; this.events = []; this.active = new Map();
      if (!api?.factory) return;
      this.original = api.factory.create;
      this.identities = new Map(NAMES.map(name => [api.archetypes[name], name]).filter(([definition]) => definition));
      this.wrapper = (...args) => { this.record(...args); return this.original.apply(api.factory, args); };
      api.factory.create = this.wrapper;
    }
    reset() { this.events.length = 0; this.active.clear(); this.world = null; this.lastTime = undefined; }
    unbind() {
      if (this.game && this.game.clearGameSpaces === this.clearWrapper) this.game.clearGameSpaces = this.clearOriginal;
      this.game = null; this.clearWrapper = null; this.clearOriginal = null;
    }
    synchronize() {
      if (this.closed || this.suspended) return null;
      const game = this.source();
      if (game !== this.game) {
        this.unbind(); this.reset(); this.game = game;
        if (game?.clearGameSpaces) {
          const clear = this.clearOriginal = game.clearGameSpaces;
          this.clearWrapper = (...args) => {
            try { return clear.apply(game, args); }
            finally { if (this.game === game) { this.reset(); this.unbind(); } }
          };
          game.clearGameSpaces = this.clearWrapper;
        }
      }
      if (!game || game.hasLoadedLevel === false || game.getLoading?.()) return null;
      const time = game.globals.gameCurrentTime, world = game.getGameSpaceList?.() || game;
      if (!number(time) || time < 0 || Array.isArray(world) && !world.length) return null;
      if (world !== this.world || time < this.lastTime) { this.reset(); this.world = world; }
      this.lastTime = time;
      return game;
    }
    record(globals, definition, location, direction, actor, screen, scale = 1, dilation = 1) {
      if (this.closed || this.suspended) return;
      const name = this.identities.get(definition);
      if (!name || screen) return;
      const game = this.synchronize();
      if (!game || globals !== game.globals) return;
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
      for (const [id, event] of this.active) if (event.time + DURATIONS[event.name] / event.dilation <= time) this.active.delete(id);
    }
    capture() {
      if (!this.synchronize()) return { sequence: this.sequence, events: [], active: [] };
      this.trim(); return structuredClone({ sequence: this.sequence, events: this.events, active: [...this.active.values()] });
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.reset(); this.unbind();
      if (this.wrapper && this.api?.factory?.create === this.wrapper) this.api.factory.create = this.original;
      this.source = () => null;
    }
  }
  class GuestEffects {
    constructor(api, scene, globals) { this.api = api; this.scene = scene; this.globals = globals; this.queue = []; this.drawQueue = []; this.owners = new Map(); this.active = new Set(); this.sequence = null; }
    context(time, action) {
      if (!this.api?.tweens) throw new Error('Original visual effect support is unavailable.');
      const scheduler = this.api.tweens, original = { add: scheduler.add, remove: scheduler.remove, getAll: scheduler.getAll, adddraw: scheduler.adddraw, removedraw: scheduler.removedraw }, clock = this.globals.gameCurrentTime;
      scheduler.add = tween => { if (this.queue.length + this.drawQueue.length >= LIMITS.tweens) throw new Error('Too many guest visual effects.'); this.queue.push(tween); this.owners.set(tween, this.current); };
      scheduler.remove = tween => { const index = this.queue.indexOf(tween); if (index >= 0) this.queue.splice(index, 1); this.owners.delete(tween); };
      scheduler.adddraw = tween => { if (this.queue.length + this.drawQueue.length >= LIMITS.tweens) throw new Error('Too many guest visual effects.'); this.drawQueue.push(tween); };
      scheduler.removedraw = tween => { const index = this.drawQueue.indexOf(tween); if (index >= 0) this.drawQueue.splice(index, 1); };
      scheduler.getAll = () => this.queue;
      this.globals.gameCurrentTime = time;
      try { return action(); }
      finally { Object.assign(scheduler, original); this.globals.gameCurrentTime = clock; }
    }
    present(action) {
      const previous = this.current; this.current = null;
      try { return this.context(this.globals.gameCurrentTime, action); }
      finally { this.current = previous; }
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
    update(time) { this.advance(this.queue, time, 'remove'); }
    draw(time) { this.advance(this.drawQueue, time, 'removedraw'); }
    advance(queue, time, remove) {
      if (this.closed || !queue.length) return;
      this.context(time, () => {
        for (const tween of [...queue]) { this.current = this.owners.get(tween); if (queue.includes(tween) && !tween.update(time * 1000, this.globals.appCurrentTime * 1000)) this.api.tweens[remove](tween); }
      });
    }
    close() { this.closed = true; this.queue.length = 0; this.drawQueue.length = 0; this.owners.clear(); this.active.clear(); }
  }
  const api = { NAMES, PERSISTENT, DURATIONS, LIMITS, emptyEffects, validateEffects, HostEffects, GuestEffects };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftWorldEffects = api;
})(globalThis);
