'use strict';
(function (root) {
  const { HostSession } = typeof module !== 'undefined' ? require('./multiplayer.js') : root.PolycraftMultiplayer;
  const { captureSnapshot, createDelta } = typeof module !== 'undefined' ? require('./world-state.js') : root.PolycraftWorldState;
  const { CoopPlayers } = typeof module !== 'undefined' ? require('./coop-players.js') : root.PolycraftCoopPlayers;
  const { HostMovement } = typeof module !== 'undefined' ? require('./coop-input.js') : root.PolycraftCoopInput;
  const { HostActions } = typeof module !== 'undefined' ? require('./coop-actions.js') : root.PolycraftCoopActions;
  const { HostConstruction } = typeof module !== 'undefined' ? require('./coop-construction.js') : root.PolycraftCoopConstruction;
  class HostWorld {
    constructor(controls, transport) {
      if (!(transport instanceof HostSession) || transport.closed || !controls.ready() || controls.onlineWorld) throw new Error('Hosting needs a loaded island and an available host session.');
      this.controls = controls;
      this.transport = transport;
      this.game = controls.manager();
      if (this.game.getActiveGameState().name !== 'GamestatePlaying') throw new Error('Enter the island with Play before hosting.');
      this.captures = [];
      this.streams = new Map();
      this.guestSlots = new Map();
      this.peerPlayers = new Map();
      this.detachedPlayers = new Set();
      this.actionSaves = new Set();
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
    beginTick() {
      this.worldUpdated = false;
      for (const binding of this.peerPlayers.values()) {
        const entry = this.players?.active.get(binding.id);
        if (!entry || !binding.ready) continue;
        if (!this.closing && !binding.releasing && !binding.connection.closed && binding.connection.state === 'connected') {
          binding.input.apply(entry.hero);
          const result = binding.actions.apply(this.game, entry.hero, this.players, this.controls);
          if (result) {
            const { save, ...payload } = result;
            const saved = save ? root.polycraft.checkpoint(true) : Promise.resolve();
            if (save) { this.actionSaves.add(saved); saved.then(() => this.actionSaves.delete(saved), () => this.actionSaves.delete(saved)); }
            saved.then(() => { if (!binding.connection.closed) return binding.connection.send('result', payload); }).catch(error => { if (!binding.connection.closed) binding.connection.fail(error); });
          }
        }
        else binding.input.stop(entry.hero);
      }
    }
    endTick() {
      if (this.closed || !this.game.hasLoadedLevel) return;
      if (!this.worldUpdated) {
        this.game.getPlayState()?.update();
        this.game.beginWorldUpdate(true);
        this.game.updateSimulation();
      }
      this.players?.flushRefreshes();
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
      let state;
      do {
        await this.construction?.settle();
        state = await this.atBoundary(() => {
          if (this.construction?.pending.size) return null;
          this.players?.capture();
          this.controls.writeCheckpoint();
          // LocalBridge applies writes synchronously; preserve this exact tick while acknowledgements finish.
          return JSON.stringify(bridge.state);
        });
      } while (state === null);
      await this.controls.settle(bridge, this.game);
      return JSON.parse(state);
    }
    async enablePlayers(bridge) {
      if (this.players) throw new Error('Co-op heroes are already active.');
      await root.polycraft.checkpoint();
      this.players = await this.atBoundary(() => {
        const players = new CoopPlayers(this.game, bridge);
        try { this.construction = new HostConstruction(this.game); return players; }
        catch (error) { players.close(); throw error; }
      });
      this.original.peerState = this.transport.onState;
      this.original.peerMessage = this.transport.onMessage;
      this.transport.onState = (peer, state, details) => {
        if (!this.closed) {
          if (state === 'connected' && !this.transport.peers.get(peer)?.probing) this.connectPlayer(peer).catch(error => this.transport.peers.get(peer)?.fail(error));
          if (state === 'closed') {
            const binding = this.peerPlayers.get(peer);
            if (binding) this.releasePlayer(binding).catch(error => this.transport.onError?.(peer, error));
          }
        }
        this.original.peerState?.(peer, state, details);
      };
      this.transport.onMessage = (message, connection) => {
        const binding = this.peerPlayers.get(connection.peer);
        if (this.closing && binding?.connection === connection && this.transport.peers.get(connection.peer) === connection) return;
        this.playerFor(connection);
        if (message.kind === 'resync') { this.requestResync(connection, message.payload); return; }
        if (message.kind === 'action') {
          if (['target', 'demolish', 'build', 'preview', 'upgrade', 'held', 'cancelBuild', 'life', 'revive'].includes(message.payload.type)) binding.actions.receive(message.payload);
          else binding.input.receive(message.payload);
          return;
        }
        if (message.kind !== 'hello' || Object.keys(message.payload).length !== 1 || message.payload.version !== 1) throw new Error('Invalid guest message. Guests cannot select heroes or edit saved state.');
        this.original.peerMessage?.(message, connection);
      };
      return this.players;
    }
    async createPlayerInvitation(id) {
      if (!this.players || this.closed || this.closing || id === this.players.registry.data.host || this.guestSlots.has(id) || (this.players.active.has(id) && !this.detachedPlayers.has(id))) throw new Error('Choose an available saved guest hero before creating an invitation.');
      this.players.registry.player(id);
      const binding = { id, input: new HostMovement(), actions: new HostActions() };
      this.guestSlots.set(id, binding);
      try {
        await root.polycraft.checkpoint();
        if (this.closed || this.closing) throw new Error('The host ended the session.');
        const invitation = await this.transport.createInvitation();
        binding.peer = invitation.peer;
        binding.connection = this.transport.peers.get(invitation.peer);
        if (this.closed || this.closing || !binding.connection || binding.connection.closed) {
          binding.connection?.close('The host ended the session.');
          throw new Error('The invitation was cancelled.');
        }
        this.peerPlayers.set(binding.peer, binding);
        return { ...invitation, playerId: id };
      } catch (error) { if (this.guestSlots.get(id) === binding) this.guestSlots.delete(id); throw error; }
    }
    playerFor(connection) {
      const binding = this.peerPlayers.get(connection.peer);
      if (this.closed || this.closing || connection.closed || connection.state !== 'connected' || this.transport.peers.get(connection.peer) !== connection || binding?.connection !== connection || !binding.ready || binding.releasing) throw new Error('This connection has no assigned co-op hero.');
      const entry = this.players.active.get(binding.id);
      if (!entry) throw new Error('The assigned hero is not active.');
      return { id: binding.id, ...entry };
    }
    async admitConnectedPlayer(id, connection) {
      if (!this.players || this.closed || this.closing || id === this.players.registry.data.host || this.guestSlots.has(id) || (this.players.active.has(id) && !this.detachedPlayers.has(id)) || !connection.probing || connection.closed || connection.state !== 'connected' || this.transport.peers.get(connection.peer) !== connection || this.peerPlayers.has(connection.peer)) throw new Error('This checked connection cannot claim that guest hero.');
      this.players.registry.player(id);
      const binding = { id, peer: connection.peer, connection, input: new HostMovement(), actions: new HostActions() };
      this.guestSlots.set(id, binding); this.peerPlayers.set(connection.peer, binding);
      try {
        await root.polycraft.checkpoint();
        if (this.closed || this.closing || connection.closed || this.transport.peers.get(connection.peer) !== connection) throw new Error('The selected connection ended before admission.');
        connection.probing = false;
        await this.connectPlayer(connection.peer);
        if (connection.closed || !binding.ready) throw new Error('Guest admission did not complete.');
      } catch (error) { connection.close('Guest admission failed.'); await this.releasePlayer(binding); throw error; }
    }
    async connectPlayer(peer) {
      const binding = this.peerPlayers.get(peer), connection = this.transport.peers.get(peer);
      if (!binding || binding.connection !== connection) throw new Error('This invitation has no host-assigned hero.');
      if (binding.joining || binding.joined || binding.releasing) return;
      binding.joining = true;
      const joined = await this.atBoundary(() => {
        if (this.closing || connection.closed || binding.releasing) return null;
        if (!this.players.active.has(binding.id)) this.players.add(binding.id);
        else if (!this.detachedPlayers.has(binding.id)) throw new Error('This hero is already controlled by another player.');
        this.detachedPlayers.delete(binding.id);
        binding.joined = true;
        const entity = this.players.active.get(binding.id).hero.getName();
        const snapshot = captureSnapshot(this.game); snapshot.hero = entity;
        return { welcome: { version: 1, playerId: binding.id, name: this.players.registry.player(binding.id).name,
          entity, pvp: this.transport.pvp }, snapshot };
      });
      if (!joined || this.closing || connection.closed) return;
      await connection.send('welcome', joined.welcome);
      if (this.closing || connection.closed || binding.releasing) return;
      binding.ready = true;
      this.streamTo(connection, joined.snapshot);
    }
    async releasePlayer(binding) {
      if (binding.releasing) return;
      binding.releasing = true;
      this.streams.get(binding.connection)?.stop();
      try {
        if (binding.joined && !this.closed) {
          await this.atBoundary(() => {
            const entry = this.players.active.get(binding.id);
            if (entry) binding.input.stop(entry.hero);
            try { this.players.remove(binding.id); }
            catch (error) {
              // Keep a disconnected hero's held construction alive until the host can reconnect or finish it.
              if (!this.players.active.has(binding.id)) throw error;
              this.detachedPlayers.add(binding.id);
              throw error;
            }
          });
        }
      } finally {
        if (this.peerPlayers.get(binding.peer) === binding) this.peerPlayers.delete(binding.peer);
        if (this.guestSlots.get(binding.id) === binding) this.guestSlots.delete(binding.id);
        if (binding.joined && !this.closed) await root.polycraft.checkpoint();
      }
    }
    snapshot(connection) {
      return this.atBoundary(() => {
        const player = connection && this.players ? this.playerFor(connection) : null;
        const snapshot = captureSnapshot(this.game);
        if (player) snapshot.hero = player.hero.getName();
        return snapshot;
      });
    }
    requestResync(connection, value) {
      const stream = this.streams.get(connection);
      if (this.closed || this.closing || !stream || connection.closed || connection.state !== 'connected' || this.transport.peers.get(connection.peer) !== connection) throw new Error('Resynchronizing requires this guest\'s active world stream.');
      if (!value || Object.keys(value).length !== 2 || value.version !== 1 || !Number.isSafeInteger(value.tick) || value.tick < 0) throw new Error('Invalid world resync request.');
      const now = performance.now();
      if (now - stream.resyncRequestedAt >= 1000) { stream.resyncRequestedAt = now; stream.forceFull = true; }
    }
    streamTo(connection, initial) {
      if (this.closed || this.closing || connection.closed || connection.state !== 'connected' || this.transport.peers.get(connection.peer) !== connection || this.streams.has(connection)) throw new Error('World streaming requires a connected guest of this host.');
      const stream = { stopped: false, initial, previous: null, lastFull: -Infinity, resyncRequestedAt: -Infinity, forceFull: false };
      const stop = () => { if (stream.stopped) return; stream.stopped = true; clearTimeout(stream.timer); this.streams.delete(connection); };
      stream.stop = stop;
      this.streams.set(connection, stream);
      const send = async () => {
        if (stream.stopped || this.closed || connection.closed) { stop(); return; }
        try {
          const state = stream.initial || await this.snapshot(connection);
          stream.initial = null;
          if (stream.stopped || this.closed || connection.closed) { stop(); return; }
          const full = stream.forceFull || performance.now() - stream.lastFull >= 5000;
          stream.forceFull = false;
          const delta = !full && stream.previous && createDelta(stream.previous, state);
          await connection.send(delta ? 'update' : 'snapshot', delta || state);
          if (!delta) stream.lastFull = performance.now();
          stream.previous = state;
        } catch (error) {
          const cancelled = stream.stopped || this.closing || this.closed || connection.closed;
          stop();
          if (!cancelled) connection.fail(error);
          return;
        }
        // Wait for transfer completion before the next capture, so slow guests cannot accumulate world snapshots.
        if (!stream.stopped) stream.timer = setTimeout(send, 100);
      };
      send();
      return stop;
    }
    async close() {
      if (this.closed) return;
      if (this.closing) throw new Error('The host session is already ending.');
      this.closing = true;
      try {
        for (const stream of this.streams.values()) stream.stop();
        if (this.players) {
          await Promise.all(this.actionSaves);
          await root.polycraft.checkpoint(true);
          await this.atBoundary(() => this.players.close());
          this.construction?.close();
        }
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
        if (this.players) { this.transport.onState = this.original.peerState; this.transport.onMessage = this.original.peerMessage; }
        this.guestSlots.clear(); this.peerPlayers.clear(); this.detachedPlayers.clear();
        await root.desktop.onlineMode(false);
      } finally { this.closing = false; }
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
