'use strict';
(function (root) {
  const { HostSession } = typeof module !== 'undefined' ? require('./multiplayer.js') : root.PolycraftMultiplayer;
  class HostWorld {
    constructor(controls, transport) {
      if (!(transport instanceof HostSession) || transport.closed || !controls.ready() || controls.onlineWorld) throw new Error('Hosting needs a loaded island and an available host session.');
      this.controls = controls;
      this.transport = transport;
      this.game = controls.manager();
      if (this.game.getActiveGameState().name !== 'GamestatePlaying') throw new Error('Enter the island with Play before hosting.');
      this.captures = [];
      this.closed = false;
      const game = this.game, clock = game.gameClock, controller = game.getGameController();
      this.original = { pause: clock.pause, controllerUpdate: controller.update, simulation: game.updateSimulation };
      clock.pause = () => {};
      clock.resume();
      controller.update = (...args) => {
        if (!controls.paused && !root.document?.querySelector('dialog[open]') && root.document?.getElementById('launcher')?.hidden !== false) this.original.controllerUpdate.apply(controller, args);
      };
      game.updateSimulation = (...args) => {
        this.worldUpdated = true;
        return this.original.simulation.apply(game, args);
      };
      controls.onlineWorld = this;
      controls.app.globals.desktopWorld = this;
      controller.clearInputs();
    }
    beginTick() { this.worldUpdated = false; }
    endTick() {
      if (this.closed || !this.game.hasLoadedLevel) return;
      if (!this.worldUpdated) {
        this.game.getPlayState()?.update();
        this.game.beginWorldUpdate(true);
        this.game.updateSimulation();
      }
      const captures = this.captures.splice(0);
      for (const capture of captures) {
        clearTimeout(capture.timer);
        try {
          const value = capture.read();
          if (value && typeof value.then === 'function') throw new Error('A world snapshot must be captured synchronously.');
          capture.resolve(value);
        } catch (error) { capture.reject(error); }
      }
    }
    atBoundary(read) {
      if (this.closed || !this.controls.ready() || this.captures.length >= 16) return Promise.reject(new Error('The online island is not ready to capture a snapshot.'));
      return new Promise((resolve, reject) => {
        const capture = { read, resolve, reject };
        capture.timer = setTimeout(() => {
          const index = this.captures.indexOf(capture);
          if (index !== -1) this.captures.splice(index, 1);
          reject(new Error('The online world did not reach a save boundary. Your previous save is safe.'));
        }, 5000);
        this.captures.push(capture);
      });
    }
    async checkpoint(bridge) {
      await this.controls.settle(bridge, this.game);
      const state = await this.atBoundary(() => {
        this.controls.writeCheckpoint();
        // LocalBridge applies writes synchronously; preserve this exact tick while acknowledgements finish.
        return JSON.stringify(bridge.state);
      });
      await this.controls.settle(bridge, this.game);
      return JSON.parse(state);
    }
    async close() {
      if (this.closed) return;
      this.closed = true;
      const game = this.game, clock = game.gameClock, controller = game.getGameController();
      clock.pause = this.original.pause;
      controller.update = this.original.controllerUpdate;
      game.updateSimulation = this.original.simulation;
      delete this.controls.app.globals.desktopWorld;
      delete this.controls.onlineWorld;
      if (game.isPaused()) clock.pause();
      controller.clearInputs();
      for (const capture of this.captures.splice(0)) {
        clearTimeout(capture.timer);
        capture.reject(new Error('The host ended the session before the snapshot completed.'));
      }
      this.transport.close();
      await root.desktop.onlineMode(false);
    }
  }
  async function startHostingWorld(controls, transport) {
    const world = new HostWorld(controls, transport);
    try { await root.desktop.onlineMode(true); }
    catch (error) { await world.close(); throw error; }
    return world;
  }
  const api = { startHostingWorld };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftOnlineWorld = api;
})(globalThis);
