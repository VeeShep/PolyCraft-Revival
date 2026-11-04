'use strict';
(function (root) {
  const rules = typeof module !== 'undefined' ? require('./room-protocol.js') : root.PolycraftRoomProtocol;
  const { stunOnly } = typeof module !== 'undefined' ? require('./auto-transport.js') : root.PolycraftAutoTransport;
  class RelayRenewals {
    constructor(room) { this.room = room; this.states = new Map(); }
    live(state) {
      const room = this.room, entry = state.entry, link = entry.route?.link;
      return !this.closed && this.states.get(entry.id) === state && !room.closed && room.connected && !room.session.stopping && !entry.signalingEnded && room.requests.get(entry.id) === entry && entry.route?.admitted && entry.route.stage === 'turn' && link && !link.closed && room.session.transport.peers.get(link.peer) === link;
    }
    watch(entry, expires) {
      if (!Number.isSafeInteger(expires)) return;
      this.remove(entry.id);
      const state = { entry, expires, failures: 0 }; this.states.set(entry.id, state); this.schedule(state);
    }
    schedule(state, delay) {
      clearTimeout(state.timer);
      if (!this.live(state)) { this.remove(state.entry.id); return; }
      const remaining = state.expires - Date.now(), margin = Math.min(60000, Math.max(20000, remaining / 2));
      state.timer = setTimeout(() => this.start(state).catch(() => this.failedState(state)), delay ?? Math.max(1000, remaining - margin));
    }
    async start(state) {
      if (!this.live(state)) { this.remove(state.entry.id); return; }
      if (state.tx || state.probing) return;
      const link = state.entry.route.link;
      if (link.state !== 'connected') { this.schedule(state, 1000); return; }
      state.probing = true; let probeTimer;
      const { path } = await Promise.race([Promise.resolve().then(() => link.diagnostics()), new Promise(resolve => { state.probeDone = () => resolve({ path: 'unknown' }); probeTimer = setTimeout(state.probeDone, 2000); })]).finally(() => { clearTimeout(probeTimer); state.probeDone = null; state.probing = false; });
      if (!this.live(state) || state.tx) return;
      if (path === 'direct') { this.schedule(state, 60000); return; }
      if (path !== 'relayed') { this.failedState(state); return; }
      const tx = this.transaction(link, crypto.randomUUID(), state); state.tx = tx;
      try { await this.send(tx, 'request'); } catch { this.fail(tx); }
    }
    transaction(link, id, state) {
      const tx = { link, id, state, phase: 'requested', controller: new AbortController() };
      tx.timer = setTimeout(() => this.fail(tx), 20000); return tx;
    }
    tracked(tx) { return !this.closed && !this.room.closed && (tx.state ? this.states.get(tx.state.entry.id) === tx.state && tx.state.tx === tx : this.guest === tx); }
    active(tx) { return this.tracked(tx) && !tx.link.closed && (tx.state ? this.live(tx.state) : this.room.guestAttempt?.link === tx.link && this.room.session.connection === tx.link); }
    send(tx, type, value) { return this.room.send('renew', { id: tx.id, type, ...(value === undefined ? {} : { value }) }, tx.state?.entry.id); }
    perform(tx, operation) { tx.running = Promise.resolve().then(() => { if (this.active(tx)) return operation(); }).catch(() => this.fail(tx)).finally(() => { if (this.tracked(tx) && !this.active(tx)) this.fail(tx, false); }); }
    clear(tx) {
      clearTimeout(tx.timer); tx.controller.abort(); tx.credentials = null;
      tx.link.cancelRestart().catch(() => {});
      if (tx.state) { if (tx.state.tx === tx) tx.state.tx = null; } else if (this.guest === tx) this.guest = null;
    }
    failedState(state) {
      if (this.states.get(state.entry.id) !== state) return;
      if (!this.live(state)) { this.remove(state.entry.id); return; }
      if (++state.failures < 3) this.schedule(state, 15000);
      else this.remove(state.entry.id);
      this.room.session.notify('Relay renewal could not finish. Reconnect if the current game connection stops working.');
    }
    fail(tx, tellServer = true) {
      if (!this.tracked(tx)) return;
      if (tellServer && this.active(tx) && this.room.connected) this.send(tx, 'failed', 'Relay renewal did not finish.').catch(() => {});
      this.clear(tx); if (tx.state) this.failedState(tx.state);
    }
    handle(event) {
      rules.signal(event);
      const room = this.room, data = event.data;
      if (!room.relayService) throw new Error('Unexpected relay renewal.');
      let tx;
      if (room.role === 'host') tx = this.states.get(event.from)?.tx;
      else {
        const attempt = room.guestAttempt, link = attempt?.link;
        if (data.type === 'credentials' && !this.guest) {
          if (!attempt?.selected || attempt.stage !== 'turn' || link?.closed || !link || room.session.connection !== link) throw new Error('Relay renewal needs the selected guest connection.');
          tx = this.guest = this.transaction(link, data.id);
        } else tx = this.guest;
      }
      if (!tx || tx.id !== data.id || !this.active(tx)) return;
      if (data.type === 'failed') { this.fail(tx, false); return; }
      if (data.type === 'credentials') {
        if (tx.phase !== 'requested') throw new Error('Repeated relay renewal credentials.');
        tx.credentials = rules.relayCredentials(data.value); tx.phase = 'credentials';
        if (room.role === 'guest') { tx.phase = 'ready'; this.send(tx, 'ready').catch(() => this.fail(tx)); }
        else this.offerIfReady(tx);
      } else if (room.role === 'host' && data.type === 'ready') {
        if (tx.ready) throw new Error('Repeated relay renewal readiness.'); tx.ready = true; this.offerIfReady(tx);
      } else if (room.role === 'guest' && data.type === 'offer' && tx.phase === 'ready') {
        tx.phase = 'answering';
        this.perform(tx, async () => {
          const answer = await tx.link.restartAnswer(data.value, [...stunOnly(room.options.iceServers || []), ...tx.credentials.iceServers], tx.controller.signal);
          if (!this.active(tx)) return;
          tx.phase = 'answered'; await this.send(tx, 'answer', answer);
          if (!this.active(tx)) return;
          await tx.link.confirmRestart(); if (!this.active(tx)) return;
          tx.phase = 'checked'; await this.send(tx, 'connected');
        });
      } else if (room.role === 'host' && data.type === 'answer' && tx.phase === 'offered') {
        tx.phase = 'checking';
        this.perform(tx, async () => {
          await tx.link.acceptRestartAnswer(data.value); if (!this.active(tx)) return;
          await tx.link.confirmRestart(); if (!this.active(tx)) return;
          // Fresh host traffic lets controlled ICE retire its old receiving pair before confirming.
          room.session.world.requestResync(tx.link, { version: 1, tick: 0 });
          tx.checked = true; this.completeIfReady(tx);
        });
      } else if (room.role === 'host' && data.type === 'connected' && tx.phase === 'checking' && !tx.remoteChecked) {
        tx.remoteChecked = true; this.completeIfReady(tx);
      } else if (room.role === 'guest' && data.type === 'complete' && tx.phase === 'checked') {
        tx.link.finishRestart(); clearTimeout(tx.timer); tx.credentials = null; this.guest = null;
      } else throw new Error('Unexpected relay renewal control.');
    }
    completeIfReady(tx) {
      if (!tx.checked || !tx.remoteChecked || tx.phase !== 'checking') return;
      tx.phase = 'completing';
      this.perform(tx, async () => {
        await this.send(tx, 'complete'); if (!this.active(tx)) return;
        tx.link.finishRestart(); tx.state.expires = tx.credentials.expires; tx.state.failures = 0;
        clearTimeout(tx.timer); tx.credentials = null; tx.state.tx = null;
        this.schedule(tx.state); this.room.session.notify('Relay credentials renewed.');
      });
    }
    offerIfReady(tx) {
      if (!tx.ready || tx.phase !== 'credentials') return;
      tx.phase = 'offering';
      this.perform(tx, async () => {
        const offer = await tx.link.restartOffer([...stunOnly(this.room.options.iceServers || []), ...tx.credentials.iceServers], tx.controller.signal);
        if (!this.active(tx)) return;
        tx.phase = 'offered'; await this.send(tx, 'offer', offer);
      });
    }
    remove(id) { const state = this.states.get(id); if (!state) return; clearTimeout(state.timer); state.probeDone?.(); if (state.tx) this.clear(state.tx); this.states.delete(id); }
    peerClosed(link) {
      for (const state of this.states.values()) if (state.entry.route?.link === link) this.remove(state.entry.id);
      if (this.guest?.link === link) this.clear(this.guest);
    }
    close() { this.closed = true; for (const id of this.states.keys()) this.remove(id); if (this.guest) this.clear(this.guest); }
  }
  const api = { RelayRenewals };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftRelayRenewal = api;
})(globalThis);
