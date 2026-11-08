'use strict';

module.exports = function traceResourceInput(world = globalThis.guestWorld) {
  if (world.resourceInputTrace) throw new Error('Resource input tracing is already active.');
  const events = [], hooks = [];
  const capture = () => {
    try {
      const gui = world.game.getIMGui();
      const highlights = [];
      for (const [id, view] of world.resourceHighlights ?? []) {
        highlights.push({ id, near: view.smartValid, hot: view.hot });
        if (highlights.length === 8) break;
      }
      return { time: performance.now(), focused: globalThis.document?.hasFocus() ?? null,
        tick: world.scene?.tick ?? null, cursor: world.movement.canvas?.style?.cursor ?? null,
        highlightCount: world.resourceHighlights?.size ?? 0, highlights,
        available: world.movement.available(), nativeFocused: world.movement.nativeFocused, paused: world.controls.paused,
        resyncing: world.resyncing, closed: world.connection.closed, captured: gui.hasCapturedInput(),
        hot: ['guest-shop', 'guest-pause', 'guest-fullscreen', 'guest-skip-prepare'].filter(id => gui.isHot(id)),
        sequence: world.targetSequence, selection: world.selectionRequest, drag: world.groundDrag?.target ?? null,
        down: world.guiInput.down, pendingDown: world.guiInput.pendingDown, description: world.quests?.description?.taskId,
        questPending: world.quests?.pending, questOpenRequest: world.quests?.openRequest,
        menu: !!world.construction.menu, placement: !!world.construction.placement };
    } catch (error) { return { traceError: String(error?.message ?? error) }; }
  };
  for (const name of ['pointer', 'clickTarget']) {
    const original = world[name], own = Object.hasOwn(world, name);
    const wrapped = function (...args) {
      if (name === 'pointer' && !/(down|up)$/.test(args[0])) return original.apply(this, args);
      const event = name === 'pointer' ? args[1] : args[0];
      const row = { name, event: name === 'pointer' ? args[0] : name, x: event.clientX, y: event.clientY, button: event.button, before: capture() };
      try { return original.apply(this, args); }
      finally { row.after = capture(); if (events.length === 24) events.shift(); events.push(row); }
    };
    world[name] = wrapped; hooks.push({ name, original, wrapped, own });
  }
  world.resourceInputTrace = { events, restore() {
    for (const { name, original, wrapped, own } of hooks) if (world[name] === wrapped) {
      if (own) world[name] = original; else delete world[name];
    }
    delete world.resourceInputTrace;
  } };
};
