'use strict';
(function (root) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const CHEAT_CODE = 'moreamberplease';
  function createCheatCodeHandler(canType, reveal, code = CHEAT_CODE) {
    let typed = ''; let lastKey = 0;
    return event => {
      if (!canType() || event.ctrlKey || event.metaKey || event.altKey || !/^[a-z]$/.test(event.key)) { typed = ''; return; }
      if (event.repeat) return;
      if (event.timeStamp - lastKey > 3000) typed = '';
      lastKey = event.timeStamp;
      typed = code.startsWith(typed + event.key) ? typed + event.key : event.key === code[0] ? event.key : '';
      if (typed) { event.preventDefault(); event.stopImmediatePropagation(); }
      if (typed === code) { typed = ''; reveal(); }
    };
  }
  class Controls {
    attach(app, xpTable, guiTypes, infoPanels, upgradeMethods) {
      this.app = app;
      this.xpTable = xpTable;
      this.guiTypes = guiTypes;
      this.infoPanels = infoPanels; this.upgradeMethods = upgradeMethods;
      const render = app.render;
      if (render) app.render = (...args) => {
        const now = app.globals.appCurrentTime;
        // Desktop solo dialogs freeze simulation; avoid redrawing the same GPU-heavy scene at full rate.
        if (this.paused && !this.onlineWorld && !this.guestWorld && now - this.lastRenderTime < 0.1) return;
        this.lastRenderTime = now;
        return render.apply(app, args);
      };
      const update = app.updateGame;
      // Freezing the game update preserves an underlying tutorial/shop pause state.
      app.updateGame = (...args) => { if (!this.paused || this.onlineWorld) update.apply(app, args); };
    }
    manager() { return this.app?.globals.gameManager; }
    ready() { const game = this.manager(); return !this.guestWorld && !!(game?.hasLoadedLevel && !game.getLoading() && game.getHero()); }
    pause(value) {
      if (this.paused && !value && !this.onlineWorld && this.manager()?.gameClock) {
        this.manager().gameClock.prevEngineTime = this.app.globals.appCurrentTime;
      }
      this.paused = value;
      if (value) {
        if (this.onlineWorld) this.manager()?.getGameController()?.clearInputs();
        this.manager()?.getGameController()?.unlockMouse();
        document.exitPointerLock?.();
      }
    }
    data() {
      if (!this.ready()) throw new Error('Wait for your island and hero to finish loading.');
      return this.manager().getHero().getEC('ECPlayerData');
    }
    amounts() {
      const data = this.data();
      return { amber: data.getSoftCurrency(), wood: data.getResource(0), stone: data.getResource(1), woodCap: data.getResourceCap(0), stoneCap: data.getResourceCap(1) };
    }
    setAmounts(amber, wood, stone) {
      if (![amber, wood, stone].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647)) throw new Error('Enter whole numbers from 0 to 2,147,483,647.');
      const data = this.data();
      // Adjust the underlying currency directly so the Crown does not double an exact set.
      data.playerData.adjustSoftCurrency(amber - data.getSoftCurrency());
      data.adjustResource(0, Math.min(wood, data.getResourceCap(0)) - data.getResource(0));
      data.adjustResource(1, Math.min(stone, data.getResourceCap(1)) - data.getResource(1));
      return this.amounts();
    }
    progression() {
      const data = this.data();
      const level = data.getLevel();
      return { level, xp: data.getXP() - this.xpTable[level], points: data.getUpgradePoints(), maxLevel: this.xpTable.length - 1 };
    }
    maxLevelXP(level) {
      return (this.xpTable[level + 1] ?? 2147483648) - this.xpTable[level] - 1;
    }
    setProgression(level, xp, points) {
      const data = this.data();
      if (!Number.isInteger(level) || level < 0 || level >= this.xpTable.length) throw new Error('Choose a hero level from 0 to ' + (this.xpTable.length - 1) + '.');
      if (!Number.isSafeInteger(xp) || xp < 0 || xp > this.maxLevelXP(level)) throw new Error('XP in this level must be a whole number from 0 to ' + this.maxLevelXP(level) + '.');
      if (!Number.isSafeInteger(points) || points < 0 || points > 1000000) throw new Error('Choose whole hero upgrade points from 0 to 1,000,000.');
      const totalXP = this.xpTable[level] + xp;
      const oldLevel = data.getLevel();
      // Preserve purchased upgrades; this offset only changes unspent points.
      data.playerData.progress.desktopUpgradePoints = points + data.getUpgradedLevel() - level;
      if (totalXP > data.getXP()) data.adjustXP(totalXP - data.getXP());
      else {
        data.playerData.addXP(totalXP - data.getXP());
        data.xpStartPoint = totalXP;
        data.xpTime = this.app.globals.appCurrentTime;
        if (oldLevel !== level) {
          data.sendLevelUpEvent();
          this.manager().refreshHeroEntity();
        }
      }
      this.data().saveProgress();
      return this.progression();
    }
    totemUpgrades() {
      const data = this.data();
      const upgrades = new Map();
      for (const space of this.manager().getGameSpaceList()) {
        for (const entity of space.getEntitiesWithEC('ECHeroShrine')) {
          for (const upgrade of entity.getEC('ECHeroShrine').archetype.upgradeTypes) {
            upgrades.set(upgrade.upgradeType, { type: upgrade.upgradeType, name: upgrade.upgradeDisplayName, level: data.playerData.getHeroUpgrade(upgrade.upgradeType), max: upgrade.levels.length - 1 });
          }
        }
      }
      return [...upgrades.values()];
    }
    setTotemUpgrades(values) {
      const definitions = this.totemUpgrades();
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== definitions.length || !definitions.length) throw new Error('Choose a level for every totem upgrade.');
      for (const upgrade of definitions) {
        if (!Object.hasOwn(values, upgrade.type) || !Number.isInteger(values[upgrade.type]) || values[upgrade.type] < 0 || values[upgrade.type] > upgrade.max) throw new Error(upgrade.name + ': choose a whole level from 0 to ' + upgrade.max + '.');
      }
      const data = this.data();
      const points = data.getUpgradePoints();
      let changed = false;
      for (const upgrade of definitions) {
        if (upgrade.level !== values[upgrade.type]) {
          data.playerData.setHeroUpgrade(upgrade.type, values[upgrade.type]);
          changed = true;
        }
      }
      if (changed) {
        // Direct cheats keep unspent points while the original total tracks upgrades.
        data.playerData.progress.desktopUpgradePoints = points + data.getUpgradedLevel() - data.getLevel();
        this.manager().getHero().getEC('ECHeroUpgrades').refreshUpgrades();
        for (const space of this.manager().getGameSpaceList()) {
          for (const entity of space.getEntitiesWithEC('ECHeroShrine')) entity.getEC('ECHeroShrine').evaluateupgradeTypesValidity();
        }
        data.saveProgress();
        this.manager().getEventManager().notify('HeroUpgraded', {});
      }
    }
    demolitionInfo(entity) {
      const game = this.manager();
      const faction = game.getFactionManager().getHeroFactionName();
      const building = entity?.getEC('ECBuilding');
      if (!building || entity.shouldBeDestroyed() || entity.getEC('ECFaction')?.getFactionName() !== faction) return null;
      let reason = '';
      if (game.desktopConstruction?.claimed(entity)) reason = 'Building reserved by a saved hero';
      else if (entity.shouldLevelSave || !entity.shouldPlayerSave || entity.getEC('ECHeroShrine')) reason = 'Original map structure';
      else if (entity.getEC('ECGameCritical') || ['HQ', 'Workshop'].includes(building.getBuildingType()) || /^a_b_(hq|workshop)(?:_level_\d+)?$/.test(entity.getArchetypeName?.() || '') || entity.getEC('ECPlacedBuildingTracker')) reason = 'HQ, workshop or territory anchor';
      else if (entity.getEC('ECScaffold')) reason = 'Construction or moving in progress';
      else if (building.getBuildingsAbove().length) reason = 'Remove the buildings above this one first';
      return { id: entity.getName(), name: building.getBuildingName(), level: building.getLevel(), location: Array.from(entity.getv3Location()).map(n => Math.round(n * 10) / 10), reason };
    }
    canDemolish(entity) { return this.ready() && this.demolitionInfo(entity)?.reason === ''; }
    requestDemolition(entity) { if (this.canDemolish(entity)) this.onDemolish?.(entity.getName()); }
    drawDemolitionPrompt(building) {
      const game = this.manager(), renderer = this.app.globals.guiRenderer, gui = game.getIMGui();
      gui.doBackground();
      game.getGuiManager().addDrawGui('modalMessageFrame', { text1: 'Demolish ' + building.name + '?\nNo refund. Capacity may drop.' }, 'demolition-dialog');
      const cancel = gui.doButton({ id: 'demolition-cancel', text: 'Cancel demolition', v2ScreenLocation: renderer.getv2RenderLocation(-100, 100, 'topRight'), guiArchetype: 'shopClose' });
      const confirm = gui.doButton({ id: 'demolition-confirm', text: 'Demolish', v2ScreenLocation: renderer.getv2RenderLocation(0, 0), guiArchetype: 'demolitionConfirm' });
      return cancel || confirm ? !!confirm : null;
    }
    confirmDemolition(building) {
      const game = this.manager();
      const previous = game.getActiveGameState();
      const wasPaused = game.isPaused();
      const controller = game.getGameController();
      return new Promise(resolve => {
        const state = {
          name: 'GamestateDemolition', result: false,
          draw() { game.drawGameSpaces(); },
          draw2D() {},
          enterState() {
            controller.clearInputs();
            controller.setModeMenuScreen();
            game.onEnterMenu();
            game.startPaused();
          },
          exitState() {
            controller.clearInputs();
            if (!wasPaused) game.exitPaused();
            resolve(state.result);
          },
          update: () => {
            controller.update();
            game.getGameSoundManager().update();
            const choice = this.drawDemolitionPrompt(building);
            if (choice !== null || controller.isPressed(this.app.globals.inputDevice.keyCodes.ESCAPE)) {
              state.result = choice === true;
              game.setGameState(previous);
            }
          }
        };
        game.setGameState(state);
      });
    }
    demolishBuilding(id) {
      this.data();
      const game = this.manager();
      const entity = game.getGameEntityByName(id);
      const entry = this.demolitionInfo(entity);
      if (!entry || entry.reason) throw new Error(entry?.reason || 'This building is no longer available.');
      entity.setToBeDestroyed();
      // Use the engine cleanup while paused so pending removals cannot enter the save.
      for (const space of game.getGameSpaceList()) space.destroyDeadEntities();
    }
    heal() {
      this.data();
      const hero = this.manager().getHero();
      const health = hero.getEC('ECHealth');
      const life = hero.getEC('ECPlayerLife');
      health.resetHealth();
      if (life?.isDead()) {
        life.respawn(life.getV3RespawnLocation());
        life.respawnTime = undefined;
        life.respawnLocation = undefined;
        life.setToDraw(false);
      }
    }
    settings(cheats) { if (this.app) this.app.globals.desktopCheats = cheats.enabled ? cheats : {}; }
    cheatsEnabled() { return !!this.app?.globals.desktopCheats?.enabled; }
    fullscreenChanged(entered) {
      if (entered && !this.fullscreen) this.manager()?.getEventManager()?.notify('GoFullScreen', {});
      this.fullscreen = entered;
    }
    async checkpoint(bridge) {
      if (!this.ready()) throw new Error('The island is still loading. Please wait before saving or closing.');
      if (this.onlineWorld) return this.onlineWorld.checkpoint(bridge);
      const game = this.manager();
      const wasPaused = this.paused;
      this.pause(true);
      try {
        // Finish reward callbacks before capturing world and player state together.
        await this.settle(bridge, game);
        this.writeCheckpoint();
        await this.settle(bridge, game);
        return JSON.parse(JSON.stringify(bridge.state));
      } finally { this.pause(wasPaused); }
    }
    writeCheckpoint() {
      if (this.guestWorld) throw new Error('The host saves this online island.');
      const game = this.manager();
      game.saveLevel(true);
      const data = game.getPlayerData();
      for (const method of ['saveResource', 'saveSoftCurrency', 'saveConsumedSoftCurrency', 'saveHeroUpgrades', 'saveProgress', 'saveGameStats', 'saveSettings', 'saveShared', 'saveNumberOfGamesPlayed', 'saveScriptFlags', 'saveTaskFlags']) data[method]();
    }
    async settle(bridge, game) {
      const deadline = Date.now() + 10000;
      do {
        await wait(10);
        if (!bridge.pending && !game.getSaving()) return;
      } while (Date.now() < deadline);
      throw new Error('Game data did not finish saving. Your previous checkpoint is safe.');
    }
  }
  if (typeof module !== 'undefined') module.exports = { Controls, CHEAT_CODE, createCheatCodeHandler };
  else { root.PolycraftControls = new Controls(); root.createCheatCodeHandler = createCheatCodeHandler; }
})(globalThis);
