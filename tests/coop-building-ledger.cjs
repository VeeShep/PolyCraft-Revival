'use strict';

module.exports = function observeBuildingResources(root = globalThis.window) {
  if (root.nativeBuildingResourceEvents) throw new Error('Building resource observation is already active.');
  const before = root.polycraft.controls.amounts(), data = root.hostWorld.game.getPlayerData();
  const models = new Set([data, ...Array.from(root.hostWorld.players?.active?.values() || [], row => row.model)]);
  const hooks = [], events = [], income = { wood: 0, stone: 0, amber: 0 };
  const sample = (owner, type) => {
    try { return { value: owner.getResource(type), cap: owner.getResourceCap(type) }; }
    catch (error) { return { error: String(error?.message ?? error) }; }
  };
  for (const data of models) {
    const original = data.adjustResource, own = Object.hasOwn(data, 'adjustResource');
    const wrapped = function (type, amount) {
      const before = sample(this, type);
      try { return original.apply(this, arguments); }
      finally {
        const after = sample(this, type), entry = { type, amount, before: before.value, after: after.value, cap: before.cap };
        if (before.error || after.error) entry.error = before.error || after.error;
        if (events.length < 1024) events.push(entry);
        else if (events.length === 1024) events.push({ overflow: true });
        if ((type === 0 || type === 1) && Number.isFinite(before.value) && Number.isFinite(after.value)) income[type === 0 ? 'wood' : 'stone'] += after.value - before.value;
      }
    };
    hooks.push({ data, original, own, wrapped });
    data.adjustResource = wrapped;
  }
  const restore = () => {
    for (const { data, original, own, wrapped } of hooks) {
      if (data.adjustResource === wrapped) { if (own) data.adjustResource = original; else delete data.adjustResource; }
    }
    if (root.nativeBuildingResourceEvents === events) delete root.nativeBuildingResourceEvents;
    if (root.nativeBuildingIncome === income) delete root.nativeBuildingIncome;
    if (root.restoreNativeBuildingIncome === restore) delete root.restoreNativeBuildingIncome;
  };
  root.nativeBuildingResourceEvents = events;
  root.nativeBuildingIncome = income; root.restoreNativeBuildingIncome = restore;
  return before;
};
