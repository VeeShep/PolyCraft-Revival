'use strict';
(function (root) {
  const KEY_AXES = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  class HostMovement {
    constructor(now = () => performance.now()) {
      this.now = now; this.sequence = 0; this.move = [0, 0]; this.receivedAt = -Infinity;
      this.tokens = 30; this.tokenTime = now();
    }
    receive(value) {
      if (!value || Object.keys(value).length !== 3 || value.type !== 'move' ||
          !Number.isSafeInteger(value.sequence) || value.sequence !== this.sequence + 1 ||
          !Array.isArray(value.move) || value.move.length !== 2 || !value.move.every(number => typeof number === 'number' && Number.isFinite(number)) ||
          !Number.isFinite(Math.hypot(...value.move)) || Math.hypot(...value.move) > 1.000001) {
        throw new Error('Invalid or repeated movement intent. Guests cannot select heroes or edit saved state.');
      }
      const now = this.now();
      this.tokens = Math.min(30, this.tokens + Math.max(0, now - this.tokenTime) * 0.03); this.tokenTime = now;
      if (this.tokens < 1) throw new Error('Too many movement messages.');
      this.tokens--; this.sequence = value.sequence; this.receivedAt = now;
      const length = Math.max(1, Math.hypot(...value.move));
      this.move = value.move.map(number => number / length);
    }
    apply(hero) {
      const move = this.now() - this.receivedAt <= 600 && hero.getEC('ECHealth').getHealth() > 0 ? this.move : [0, 0];
      if (move[0] || move[1]) {
        const location = hero.getv3Location();
        hero.getEC('ECLocomotion').setDestination([location[0] + move[0] * 5, location[1], location[2] + move[1] * 5]);
        this.moving = true;
      } else this.stop(hero);
    }
    stop(hero) {
      if (this.moving) hero.getEC('ECLocomotion').clearDestination();
      this.moving = false;
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
        if (!focused) { this.keys.clear(); this.flush(); }
      };
      this.unsubscribeFocus = root.desktop?.onWindowFocusChanged?.(focused => { receivedFocusEvent = true; focus(focused); });
      root.desktop?.windowFocused?.().then(focused => { if (!receivedFocusEvent) focus(focused); }).catch(error => { if (!this.closed) this.world.connection.fail(error); });
      if (!root.addEventListener || !this.canvas) return;
      const listen = (event, handler) => { root.addEventListener(event, handler, { capture: true, passive: false }); this.listeners.push([event, handler]); };
      listen('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey || root.document.activeElement !== this.canvas) return;
        if (event.code === 'Tab') { this.keys.clear(); this.flush(); return; }
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.code === 'Escape') { this.world.cancelLocalMenu?.(); this.keys.clear(); this.flush(); return; }
        if (this.world.localMenu?.()) { this.keys.clear(); this.flush(); return; }
        if (event.repeat) return;
        if (KEY_AXES[event.code] && this.available()) this.keys.add(event.code);
        this.flush();
      });
      listen('keyup', event => {
        if (!KEY_AXES[event.code]) return;
        this.keys.delete(event.code);
        if (root.document.activeElement === this.canvas) { event.preventDefault(); event.stopImmediatePropagation(); }
        this.flush();
      });
      listen('blur', () => { this.keys.clear(); this.flush(); });
      listen('focusout', () => { if (root.document.activeElement !== this.canvas) { this.keys.clear(); this.flush(); } });
      for (const event of ['mousemove', 'pointermove', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'contextmenu']) listen(event, value => {
        if (value.target !== this.canvas) return;
        value.preventDefault(); value.stopImmediatePropagation();
        if (['mousedown', 'pointerdown', 'touchstart'].includes(event)) this.canvas.focus();
        if (['mousemove', 'pointermove', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].includes(event)) this.world.pointer?.(event, value);
        if (event === (root.PointerEvent ? 'pointerdown' : 'mousedown') && value.button === 0 && !this.world.construction?.placement && this.available()) this.world.clickTarget(value);
      });
      this.timer = setInterval(() => this.flush(), 50);
    }
    available() {
      return !this.closed && !this.world.localMenu?.() && this.nativeFocused && this.world.identity && this.world.scene.snapshot && this.world.connection.state === 'connected' && !this.world.connection.closed && !this.world.controls.paused && root.document?.hasFocus() && root.document.activeElement === this.canvas && !root.document.querySelector('dialog[open]') && root.document.getElementById('launcher')?.hidden !== false;
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
    async flush() {
      if (this.closed || !this.world.identity || !this.world.scene.snapshot || this.world.connection.closed || this.world.connection.state !== 'connected') return;
      if (this.pending) { this.dirty = true; return this.pending; }
      const move = this.direction(), now = performance.now(), changed = move.some((number, index) => number !== this.lastMove[index]);
      if ((!changed && !(move[0] || move[1])) || ((move[0] || move[1] || !changed) && now - this.lastSent < 50)) return;
      this.lastMove = move; this.lastSent = now;
      try {
        this.pending = this.world.connection.send('action', { type: 'move', sequence: ++this.sequence, move });
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
