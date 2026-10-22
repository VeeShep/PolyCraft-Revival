'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  const controls = window.PolycraftControls;
  let slot;
  let bridge;
  let saving;
  let busy = false;
  let started = false;
  let wasReady = false;
  let closeRequested = false;
  let launcherPause = false;
  const status = message => { $('status').textContent = message; };
  function report(error) {
    console.error(error);
    window.desktop.reportError(String(error?.message || error).slice(0, 8192), String(error?.stack || '').slice(0, 8192)).catch(() => {});
    status(error.message || String(error));
    $('error-text').textContent = error.message || String(error);
    if (!$('error-dialog').open) $('error-dialog').showModal();
  }
  async function action(callback) {
    if (busy) return;
    busy = true;
    try { await callback(); } catch (error) { report(error); }
    finally { busy = false; }
  }
  async function checkpoint() {
    if (controls.guestWorld) { status('The host saves this online island.'); return; }
    if (saving) return saving;
    saving = (async () => {
      status('Saving…');
      const state = await controls.checkpoint(bridge);
      slot = await window.desktop.save(slot.id, state);
      status('Saved locally at ' + new Date(slot.updatedAt).toLocaleTimeString());
    })();
    try { await saving; } finally { saving = null; }
  }
  function button(label, callback) {
    const element = document.createElement('button');
    element.textContent = label;
    element.addEventListener('click', () => action(callback));
    return element;
  }
  async function play(id) {
    if (slot?.id === id && started) {
      $('launcher').hidden = true;
      $('play-area').hidden = false;
      $('game-actions').hidden = false;
      controls.pause(launcherPause);
      $('turbulenz_game_engine_canvas').focus();
      return;
    }
    if (started) await checkpoint();
    sessionStorage.setItem('polycraft-slot', id);
    location.reload();
  }
  async function rename(id, name) {
    $('rename-value').value = name;
    $('name-dialog').returnValue = '';
    $('name-dialog').showModal();
    const result = await new Promise(resolve => $('name-dialog').addEventListener('close', () => resolve($('name-dialog').returnValue), { once: true }));
    if (result === 'save') {
      const renamed = await window.desktop.rename(id, $('rename-value').value);
      if (slot?.id === id) { slot.name = renamed.name; $('slot-name').textContent = slot.name; }
      await refresh();
    }
  }
  async function refresh() {
    const saves = await window.desktop.list();
    $('save-list').replaceChildren();
    for (const save of saves) {
      const card = document.createElement('article');
      card.className = 'save';
      const title = document.createElement('h2');
      title.textContent = save.name;
      const info = document.createElement('p');
      info.textContent = save.error || ((save.recovered ? 'Recovery backup available • ' : '') + new Date(save.updatedAt).toLocaleString() + ' • ' + (save.everEnabled === true ? 'Cheats used' : save.everEnabled === false ? 'Clean' : 'Unknown history'));
      card.append(title, info);
      if (!save.error) card.append(
        button(slot?.id === save.id ? 'Resume' : 'Continue', () => play(save.id)),
        button('Rename', () => rename(save.id, save.name)),
        button('Export backup', async () => { if (slot?.id === save.id && started) await checkpoint(); if (await window.desktop.export(save.id)) status('Backup exported.'); })
      );
      card.append(button('Delete', async () => {
        if (await window.desktop.remove(save.id)) {
          if (slot?.id === save.id && started) { sessionStorage.removeItem('polycraft-slot'); location.reload(); }
          else await refresh();
        }
      }));
      $('save-list').append(card);
    }
    if (!saves.length) status('Create an island to start playing.');
  }
  function populateAmounts() {
    const amounts = controls.amounts();
    for (const key of ['amber', 'wood', 'stone']) $(key).value = amounts[key];
    $('wood').max = amounts.woodCap;
    $('stone').max = amounts.stoneCap;
  }
  function populateProgression() {
    const value = controls.progression();
    $('hero-level').value = value.level;
    $('hero-level').max = value.maxLevel;
    $('hero-xp').value = value.xp;
    $('hero-xp').max = controls.maxLevelXP(value.level);
    $('hero-points').value = value.points;
  }
  function populateTotems() {
    $('totem-levels').replaceChildren();
    for (const upgrade of controls.totemUpgrades()) {
      const label = document.createElement('label');
      label.textContent = upgrade.name + ' (0–' + upgrade.max + ')';
      const input = document.createElement('input');
      input.id = 'totem-' + upgrade.type;
      input.name = upgrade.type;
      input.type = 'number'; input.min = 0; input.max = upgrade.max; input.step = 1; input.required = true;
      input.value = upgrade.level;
      label.append(input);
      $('totem-levels').append(label);
    }
  }
  $('totem-form').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
      const values = Object.fromEntries([...new FormData($('totem-form'))].map(([key, value]) => [key, Number(value)]));
      controls.setTotemUpgrades(values);
      populateTotems();
      populateProgression();
      await checkpoint();
    });
  });
  controls.onDemolish = id => action(async () => {
    const building = controls.demolitionInfo(controls.manager().getGameEntityByName(id));
    if (!building || building.reason) throw new Error(building?.reason || 'This building is no longer available.');
    if (await controls.confirmDemolition(building)) {
      const wasPaused = controls.paused;
      controls.pause(true);
      try {
        controls.demolishBuilding(id);
        await checkpoint();
      } finally { controls.pause(wasPaused); }
    }
  });
  $('hero-level').addEventListener('input', () => {
    const level = Number($('hero-level').value);
    if (Number.isInteger(level) && level >= 0 && level < controls.xpTable.length) {
      $('hero-xp').max = controls.maxLevelXP(level);
      $('hero-xp').value = Math.min(Number($('hero-xp').value), controls.maxLevelXP(level));
    }
  });
  $('progression-form').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
      controls.setProgression(Number($('hero-level').value), Number($('hero-xp').value), Number($('hero-points').value));
      populateProgression();
      status('Hero progression updated. Spend upgrade points at a totem.');
    });
  });
  $('new-game').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => { if (started) await checkpoint(); const created = await window.desktop.create($('new-name').value); await play(created.id); });
  });
  $('import').addEventListener('click', () => action(async () => { if (await window.desktop.import()) { await refresh(); status('Backup imported as a new island.'); } }));
  $('save-now').addEventListener('click', () => action(checkpoint));
  $('slots').addEventListener('click', () => action(async () => {
    launcherPause = controls.paused;
    controls.pause(true);
    try { await checkpoint(); } catch (error) { controls.pause(launcherPause); throw error; }
    $('play-area').hidden = true;
    $('game-actions').hidden = true;
    $('launcher').hidden = false;
    await refresh();
  }));
  $('fullscreen').addEventListener('click', () => action(() => window.desktop.fullscreen()));
  function applyCheatMode() {
    if (bridge.state.cheats.enabled) bridge.state.cheats.everEnabled = true;
    controls.settings(bridge.state.cheats);
    $('cheats').hidden = !bridge.state.cheats.enabled;
    const state = controls.manager()?.getActiveGameState();
    if (state?.name === 'GamestateShop') state.setButtonPanal(bridge.state.cheats.enabled ? state.panelName : 'resource');
  }
  function openCheats() { return action(async () => {
    bridge.state.cheats.enabled = true;
    applyCheatMode();
    $('cheats-enabled').checked = true;
    $('cheat-tools').disabled = false;
    populateAmounts();
    populateProgression();
    populateTotems();
    controls.pause(true);
    $('invincible').checked = bridge.state.cheats.invincible;
    $('instant-build').checked = bridge.state.cheats.instantBuild;
    await checkpoint();
    $('cheat-pause').textContent = controls.onlineWorld ? 'The island keeps running while this menu is open.' : 'Game paused. Changes apply to this island.';
    $('cheat-dialog').showModal();
  }); }
  document.addEventListener('keydown', window.createCheatCodeHandler(
    () => started && !busy && controls.ready() && $('launcher').hidden && document.activeElement === $('turbulenz_game_engine_canvas') && !document.querySelector('dialog[open]') && controls.manager().getActiveGameState().name !== 'GamestateDemolition',
    openCheats
  ), true);
  $('cheats').addEventListener('click', openCheats);
  $('cheats-enabled').addEventListener('change', () => action(async () => {
    bridge.state.cheats.enabled = $('cheats-enabled').checked;
    applyCheatMode();
    $('cheat-tools').disabled = !bridge.state.cheats.enabled;
    await checkpoint();
  }));
  $('heal').addEventListener('click', () => action(async () => { controls.heal(); status('Hero health restored.'); }));
  $('fill').addEventListener('click', () => action(async () => {
    const amounts = controls.amounts();
    controls.setAmounts(amounts.amber, amounts.woodCap, amounts.stoneCap);
    populateAmounts(); status('Wood and stone storage filled.');
  }));
  $('resource-form').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => { controls.setAmounts(Number($('amber').value), Number($('wood').value), Number($('stone').value)); populateAmounts(); status('Resource amounts updated.'); });
  });
  for (const [id, key] of [['invincible', 'invincible'], ['instant-build', 'instantBuild']]) {
    $(id).addEventListener('change', () => { bridge.state.cheats[key] = $(id).checked; controls.settings(bridge.state.cheats); });
  }
  $('close-cheats').addEventListener('click', () => $('cheat-dialog').close());
  $('cheat-dialog').addEventListener('close', () => { controls.pause(false); $('turbulenz_game_engine_canvas').focus(); });
  let tips = []; let tipIndex = 0; let tipsPause = false;
  function showTip() {
    const [name, file] = tips[tipIndex];
    const title = name.replace('textures/loading-', '').replace('.jpg', '').replaceAll('-', ' ');
    $('tip-image').alt = 'Original PolyCraft loading tip: ' + title;
    $('tip-image').src = '/staticmax/' + file;
    $('tip-caption').textContent = 'Tip ' + (tipIndex + 1) + ' of ' + tips.length + ' · ' + title;
  }
  function nextTip(offset) { tipIndex = (tipIndex + offset + tips.length) % tips.length; showTip(); }
  document.addEventListener('keydown', window.createCheatCodeHandler(
    () => (!$('launcher').hidden || !controls.ready()) && !document.querySelector('dialog[open]') && !document.activeElement.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName),
    () => action(async () => {
      if (!tips.length) {
        const response = await fetch('/mapping_table.json');
        if (!response.ok) throw new Error('Unable to load the original tips.');
        tips = Object.entries((await response.json()).urnmapping).filter(([name]) => /^textures\/loading-.*\.jpg$/.test(name)).sort(([a], [b]) => a.localeCompare(b));
        if (!tips.length) throw new Error('No loading tips are available.');
      }
      tipsPause = !!controls.paused;
      if (controls.ready()) controls.pause(true);
      showTip(); $('tips-dialog').showModal();
    }), 'moretips'
  ), true);
  $('tip-previous').addEventListener('click', () => nextTip(-1));
  $('tip-next').addEventListener('click', () => nextTip(1));
  $('close-tips').addEventListener('click', () => $('tips-dialog').close());
  $('tips-dialog').addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); nextTip(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  $('tips-dialog').addEventListener('close', () => { controls.pause(tipsPause); if (started && $('launcher').hidden) $('turbulenz_game_engine_canvas').focus(); });
  window.desktop.onBeforeClose(async () => {
    if (closeRequested) return;
    closeRequested = true;
    controls.pause(true);
    try {
      if (started && wasReady) await checkpoint();
      await window.desktop.closeReady();
    } catch (error) { await window.desktop.closeFailed(error.message); controls.pause(false); report(error); }
    finally { closeRequested = false; }
  });
  window.addEventListener('error', event => report(new Error('Game error: ' + event.message)));
  window.addEventListener('unhandledrejection', event => report(event.reason instanceof Error ? event.reason : new Error(String(event.reason))));

  try {
    const id = sessionStorage.getItem('polycraft-slot');
    sessionStorage.removeItem('polycraft-slot');
    if (!id) { await refresh(); status('Choose a saved island or create a new one.'); return; }
    slot = await window.desktop.load(id);
    const read = async file => { const response = await fetch('/' + file); if (!response.ok) throw new Error('Missing game file: ' + file); return (await response.json()).data; };
    const [store, badges, leaderboards, notifications] = await Promise.all(['storeitems.json', 'badges.json', 'leaderboards.json', 'gamenotifications.json'].map(read));
    bridge = new window.LocalBridge(slot.state, { store, badges, leaderboards, notifications }, report);
    window.Turbulenz = { Services: { bridge: bridge.gameBridge }, Data: { mode: 'canvas' } };
    window.gameSlug = 'polycraft';
    window.TurbulenzEngine = {};
    // All real-money prices are zero; keep the existing product and inventory rules.
    for (const item of Object.values(store.items)) { item.price = 0; for (const code of Object.keys(item.prices)) item.prices[code] = 0; }
    const script = document.createElement('script');
    script.src = '/game.canvas.js';
    await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = () => reject(new Error('Unable to load the game engine.')); document.head.append(script); });
    const entry = window.TurbulenzEngine.onload;
    const canvas = $('turbulenz_game_engine_canvas');
    $('launcher').hidden = true;
    $('play-area').hidden = false;
    $('game-actions').hidden = false;
    $('slot-name').textContent = slot.name;
    window.TurbulenzEngine = window.WebGLTurbulenzEngine.create({ canvas, fillParent: true });
    if (!window.TurbulenzEngine) throw new Error('PolyCraft could not initialize WebGL. Check your graphics driver.');
    window.TurbulenzEngine.onload = entry;
    entry();
    let nativeFullscreen = false;
    const syncFullscreen = () => controls.fullscreenChanged(nativeFullscreen || !!document.fullscreenElement);
    document.addEventListener('fullscreenchange', syncFullscreen);
    window.desktop.onFullscreenChanged(entered => { nativeFullscreen = entered; syncFullscreen(); });
    applyCheatMode();
    started = true;
    canvas.focus();
    status(slot.recovered ? 'Recovered the previous valid checkpoint. Loading island…' : 'Loading island…');
    bridge.onPurchase = () => action(checkpoint);
    const loading = setInterval(() => {
      if (controls.ready()) {
        if ($('tips-dialog').open) controls.pause(true);
        wasReady = true;
        clearInterval(loading);
        try {
          const graphics = window.PolycraftGraphics.diagnostics(controls.manager());
          console.info('PolyCraft graphics:', JSON.stringify(graphics));
          window.desktop.reportGraphics(JSON.stringify(graphics)).catch(error => console.warn('Graphics diagnostic unavailable:', error.message));
        } catch (error) { console.warn('Graphics diagnostic unavailable:', error.message); }
        status(slot.recovered ? 'Island loaded from its recovery backup.' : 'Island ready. Autosave is on.');
      }
    }, 250);
    setInterval(() => {
      if (!busy && controls.ready() && $('launcher').hidden) action(checkpoint);
    }, 30000);
    // These references support reproducible game acceptance checks without privileged access.
    window.polycraft = { controls, bridge, checkpoint, slot: () => slot };
  } catch (error) {
    $('launcher').hidden = false;
    await refresh();
    report(error);
  }
})();
