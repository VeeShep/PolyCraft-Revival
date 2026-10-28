'use strict';
(function (root) {
  const KEY_AXES = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', KeyD: 'right' };
  const CAMERA_KEYS = ['ArrowLeft', 'ArrowRight'];
  class HostMovement {
    constructor(now = () => performance.now()) {
      this.now = now; this.sequence = 0; this.move = [0, 0]; this.receivedAt = -Infinity;
      this.tokens = 30; this.tokenTime = now(); this.walkTokens = 4; this.walkTime = now();
    }
    receive(value) {
      const walk = value?.type === 'walk';
      if (!value || Object.keys(value).length !== (walk ? 4 : 3) || !['move', 'walk'].includes(value.type) ||
          !Number.isSafeInteger(value.sequence) || value.sequence !== this.sequence + 1 ||
          (walk ? !['click', 'drag', 'release'].includes(value.mode) || !Array.isArray(value.location) || value.location.length !== 3 || !Array.from(value.location).every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e6) :
          !Array.isArray(value.move) || value.move.length !== 2 || !Array.from(value.move).every(number => typeof number === 'number' && Number.isFinite(number)) || !Number.isFinite(Math.hypot(...value.move)) || Math.hypot(...value.move) > 1.000001)) {
        throw new Error('Invalid or repeated movement intent. Guests cannot select heroes or edit saved state.');
      }
      const now = this.now();
      this.tokens = Math.min(30, this.tokens + Math.max(0, now - this.tokenTime) * 0.03); this.tokenTime = now;
      if (this.tokens < 1) throw new Error('Too many movement messages.');
      if (walk && value.mode !== 'drag') {
        this.walkTokens = Math.min(4, this.walkTokens + Math.max(0, now - this.walkTime) * 0.01); this.walkTime = now;
        if (this.walkTokens < 1) throw new Error('Too many walking commands.');
        this.walkTokens--;
      }
      if (walk) {
        this.pendingWalk = { location: [...value.location], mode: value.mode }; this.cancelWalk = false; this.move = [0, 0];
      } else {
        const length = Math.max(1, Math.hypot(...value.move));
        this.move = value.move.map(number => number / length); this.pendingWalk = null; this.cancelWalk = this.walking || this.cancelWalk;
      }
      this.tokens--; this.sequence = value.sequence; this.receivedAt = now;
    }
    apply(hero, game, controls) {
      const life = hero.getEC('ECPlayerLife'), incapacitated = life && (life.isDead?.() || life.states && life.state !== life.states.NORMAL);
      if (hero.getEC('ECHealth').getHealth() <= 0 || incapacitated || game?.isScriptLocked?.()) { this.stop(hero); return; }
      if (this.cancelWalk) this.stop(hero);
      if (this.pendingWalk) {
        const requested = this.pendingWalk;
        this.stop(hero, true);
        const builder = hero.getEC('ECPlayerBuilder');
        if (builder?.isBuilding() || builder?.isThrowing() || !controls?.movementMethods || requested.mode === 'drag' && this.now() - this.receivedAt > 600) return;
        const location = [requested.location[0], hero.getv3Location()[1], requested.location[2]], steering = requested.mode === 'drag', methods = controls.movementMethods;
        const view = { gameManager: game, globals: game.globals, getHeroEntity: () => hero, getTargetEntity: () => null,
          getv3WorldCursorLocation: () => location, getHighHeroLocation: () => hero.getCentreLocation() };
        view.collisionInfo = methods.collision.call(view, location);
        methods.destination.call(view, !steering, requested.mode !== 'click', !steering);
        this.walking = true; this.steering = steering;
        return;
      }
      if (this.walking) {
        const builder = hero.getEC('ECPlayerBuilder');
        if (builder?.isBuilding() || builder?.isThrowing() || this.steering && this.now() - this.receivedAt > 600) this.stop(hero);
        return;
      }
      const move = this.now() - this.receivedAt <= 600 ? this.move : [0, 0];
      if (move[0] || move[1]) {
        const location = hero.getv3Location(), locomotion = hero.getEC('ECLocomotion');
        hero.getEC('ECNav')?.endPath(); locomotion.clearDestinationEntity();
        locomotion.setDestination([location[0] + move[0] * 5, location[1], location[2] + move[1] * 5]);
        this.moving = true;
      } else this.stop(hero);
    }
    stop(hero, force = false) {
      if (force || this.moving || this.walking) {
        hero.getEC('ECNav')?.endPath();
        const locomotion = hero.getEC('ECLocomotion'); locomotion.clearDestination(); locomotion.clearDestinationEntity();
      }
      this.moving = this.walking = this.steering = this.cancelWalk = false; this.pendingWalk = null;
    }
  }
  class GuestMovement {
    constructor(world) {
      this.world = world; this.keys = new Set(); this.sequence = 0; this.lastMove = [0, 0]; this.lastSent = -Infinity;
      this.canvas = root.document?.getElementById?.('turbulenz_game_engine_canvas');
      this.listeners = [];
      this.nativeFocused = !root.desktop?.windowFocused;
      let receivedFocusEvent = false;
      const focus = focused => {
        if (this.closed) return;
        this.nativeFocused = focused;
        if (!focused) { this.world.cancelGroundDrag?.(); this.keys.clear(); this.flush(); }
      };
      this.unsubscribeFocus = root.desktop?.onWindowFocusChanged?.(focused => { receivedFocusEvent = true; focus(focused); });
      root.desktop?.windowFocused?.().then(focused => { if (!receivedFocusEvent) focus(focused); }).catch(error => { if (!this.closed) this.world.connection.fail(error); });
      if (!root.addEventListener || !this.canvas) return;
      const listen = (event, handler) => { root.addEventListener(event, handler, { capture: true, passive: false }); this.listeners.push([event, handler]); };
      listen('keydown', event => {
        if (event.ctrlKey || event.metaKey || root.document.activeElement !== this.canvas) return;
        if (event.code === 'KeyF' && !event.altKey || event.code === 'Enter' && event.altKey) {
          event.preventDefault(); event.stopImmediatePropagation();
          if (!event.repeat) this.world.toggleFullscreen?.();
          return;
        }
        if (event.altKey) return;
        if (event.code === 'Tab') { this.keys.clear(); this.flush(); return; }
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.code === 'KeyP') { if (!event.repeat) this.world.togglePauseMenu?.(); this.keys.clear(); this.flush(); return; }
        if (event.code === 'Escape') {
          if (this.world.construction?.placement?.held) this.world.construction.cancelHeld();
          else if (this.world.controls.fullscreen && !this.world.localMenu?.() && !this.world.construction?.placement) this.world.toggleFullscreen?.();
          else this.world.cancelLocalMenu?.();
          this.keys.clear(); this.flush(); return;
        }
        if (this.world.localMenu?.()) { this.keys.clear(); this.flush(); return; }
        if (event.repeat) return;
        if ((KEY_AXES[event.code] || CAMERA_KEYS.includes(event.code)) && this.available()) this.keys.add(event.code);
        this.flush();
      });
      listen('keyup', event => {
        if (!KEY_AXES[event.code] && !CAMERA_KEYS.includes(event.code)) return;
        this.keys.delete(event.code);
        if (root.document.activeElement === this.canvas) { event.preventDefault(); event.stopImmediatePropagation(); }
        this.flush();
      });
      listen('blur', () => { this.world.cancelGroundDrag?.(); this.keys.clear(); this.flush(); });
      listen('focusout', () => { if (root.document.activeElement !== this.canvas) { this.world.cancelGroundDrag?.(); this.keys.clear(); this.flush(); } });
      for (const event of ['pointercancel', 'lostpointercapture']) listen(event, value => { if (value.target === this.canvas) this.world.cancelGroundDrag?.(true); });
      for (const event of ['mousemove', 'pointermove', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'contextmenu']) listen(event, value => {
        if (value.target !== this.canvas) { if (event === (root.PointerEvent ? 'pointerup' : 'mouseup')) this.world.cancelGroundDrag?.(true); return; }
        value.preventDefault(); value.stopImmediatePropagation();
        if (['mousedown', 'pointerdown', 'touchstart'].includes(event)) this.canvas.focus();
        if (['mousemove', 'pointermove', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].includes(event)) this.world.pointer?.(event, value);
        if (event === (root.PointerEvent ? 'pointerdown' : 'mousedown') && value.button === 0 && !this.world.construction?.placement && this.available()) this.world.clickTarget(value);
      });
      this.timer = setInterval(() => this.flush(), 50);
    }
    available() {
      return !this.closed && !this.world.resyncing && (!this.world.lifeState || this.world.lifeState.phase === 'normal') && !this.world.localMenu?.() && this.nativeFocused && this.world.identity && this.world.scene.snapshot && this.world.connection.state === 'connected' && !this.world.connection.closed && !this.world.controls.paused && root.document?.hasFocus() && root.document.activeElement === this.canvas && !root.document.querySelector('dialog[open]') && root.document.getElementById('launcher')?.hidden !== false;
    }
    direction() {
      if (!this.available()) { this.keys.clear(); return [0, 0]; }
      const axes = new Set([...this.keys].map(key => KEY_AXES[key]));
      const x = Number(axes.has('right')) - Number(axes.has('left')), y = Number(axes.has('forward')) - Number(axes.has('back'));
      const matrix = this.world.controls.app.globals.camera.matrix;
      let right = [matrix[0], matrix[2]], forward = [-matrix[6], -matrix[8]];
      const rightLength = Math.hypot(...right), forwardLength = Math.hypot(...forward);
      if (!(Number.isFinite(rightLength) && Number.isFinite(forwardLength) && rightLength > 0 && forwardLength > 0)) return [0, 0];
      right = right.map(number => number / rightLength); forward = forward.map(number => number / forwardLength);
      const move = [right[0] * x + forward[0] * y, right[1] * x + forward[1] * y], length = Math.hypot(...move);
      return length ? move.map(number => number / length) : [0, 0];
    }
    requestWalk(location, mode = 'click') {
      if (!location || !this.available() || this.direction().some(Boolean)) return false;
      this.walkRequested = true; this.stopWalk = false; this.lastMove = [0, 0]; this.queuedWalk = { location: [...location], mode };
      this.flush();
      return true;
    }
    cancelWalk() {
      if (!this.walkRequested && !this.queuedWalk) return;
      this.stopWalk = true; this.queuedWalk = null; this.flush();
    }
    async flush() {
      if (this.closed || !this.world.identity || !this.world.scene.snapshot || this.world.connection.closed || this.world.connection.state !== 'connected') return;
      const available = this.available(), move = this.direction(), cancelWalk = this.walkRequested && (this.stopWalk || !available || move.some(Boolean));
      if (cancelWalk) { this.stopWalk = true; this.queuedWalk = null; this.world.cancelGroundDrag?.(); }
      if (this.pending) { this.dirty = true; return this.pending; }
      const now = performance.now(), walk = this.queuedWalk, changed = move.some((number, index) => number !== this.lastMove[index]);
      if (!walk && !cancelWalk && ((!changed && !move.some(Boolean)) || ((move.some(Boolean) || !changed) && now - this.lastSent < 50))) return;
      if (cancelWalk) { this.walkRequested = this.stopWalk = false; }
      this.queuedWalk = null; this.lastMove = walk ? [0, 0] : move; this.lastSent = now;
      try {
        this.pending = this.world.connection.send('action', walk ? { type: 'walk', sequence: ++this.sequence, ...walk } : { type: 'move', sequence: ++this.sequence, move });
        await this.pending;
      } catch (error) { if (!this.closed && !this.world.connection.closed) this.world.connection.fail(error); }
      finally {
        this.pending = null;
        if (this.dirty) { this.dirty = false; await this.flush(); }
      }
    }
    close() {
      if (this.closed) return;
      this.closed = true; clearInterval(this.timer); this.keys.clear();
      this.unsubscribeFocus?.();
      for (const [event, handler] of this.listeners) root.removeEventListener(event, handler, true);
    }
  }
  const api = { HostMovement, GuestMovement };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftCoopInput = api;
})(globalThis);
