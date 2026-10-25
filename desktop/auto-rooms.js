'use strict';
(function (root) {
  const { RoomSession } = typeof module !== 'undefined' ? require('./rooms.js') : root.PolycraftRooms;
  const { stunOnly, hasTurn } = typeof module !== 'undefined' ? require('./auto-transport.js') : root.PolycraftAutoTransport;
  const rules = typeof module !== 'undefined' ? require('./room-protocol.js') : root.PolycraftRoomProtocol;
  const BUDGETS = { forward: 3000, upnp: 3000, stun: 6000, turn: 10000, admission: 8000, total: 30000 };
  class AutoRoomSession extends RoomSession {
    constructor(session, runtime = root, budgets = BUDGETS) { super(session, runtime); this.budgets = budgets; this.history = []; }
    record(attempt, outcome) {
      if (attempt.recorded) return;
      attempt.recorded = true;
      const result = { role: this.role, stage: attempt.stage, outcome, durationMs: Math.max(0, Math.round(performance.now() - attempt.started)) };
      this.history.push(result); if (this.history.length > 64) this.history.shift();
      return result;
    }
    diagnostics() { return { role: this.role, attempts: this.history.map(value => ({ ...value })) }; }
    route(entry, attempt, type, value) {
      const data = { attempt: attempt.id, stage: attempt.stage, type, ...(value === undefined ? {} : { value }) };
      return this.send('route', data, entry?.id);
    }
    candidate(value, link) {
      if (this.closed || !this.connected || link.closed) return;
      if (this.role === 'host') {
        const entry = [...this.requests.values()].find(entry => entry.route?.link === link), attempt = entry?.route;
        if (attempt?.offered && !attempt.done) this.route(entry, attempt, 'candidate', value).catch(error => attempt.finish(error));
        else if (this.session.transport.peers.has(link.peer)) {
          const pending = this.outgoing.get(link.peer) || []; if (pending.length < 128) pending.push(value); this.outgoing.set(link.peer, pending);
        }
      } else {
        const a = this.guestAttempt; if (!a || a.link !== link || a.cancelled || a.selected) return;
        if (a.answered) this.route(null, a, 'candidate', value).catch(error => this.failGuest(a, error));
        else { if (a.local.length < 128) a.local.push(value); }
      }
    }
    async approve(id, heroId) {
      const entry = this.requests.get(id);
      if (this.role !== 'host' || !entry || entry.route || entry.approving || !this.connected) throw new Error('Choose a waiting guest request.');
      if (!heroId) heroId = this.session.addGuest(entry.name);
      if ([...this.requests.values()].some(other => other !== entry && other.heroId === heroId)) throw new Error('That hero already has a selected or pending guest.');
      entry.heroId = heroId; entry.approving = true;
      try { await this.runtime.polycraft.checkpoint(); }
      catch (error) { entry.approving = false; delete entry.heroId; throw error; }
      entry.running = this.runHost(entry).catch(async error => {
        this.session.notify('Guest connection failed: ' + error.message);
        if (!this.closed && this.connected && this.requests.get(id) === entry) {
          await this.send('reject', 'No usable connection. Check forwarding, STUN/TURN settings or try again.', id).catch(() => {});
          this.requests.delete(id);
        }
      }).finally(() => { entry.approving = false; this.session.changed(); });
    }
    active(entry) { return !this.closed && this.connected && !this.session.stopping && this.requests.get(entry.id) === entry && !this.session.transport.closed; }
    async reject(id) {
      const entry = this.requests.get(id); if (!entry) throw new Error('Choose a guest request.');
      this.requests.delete(id);
      entry.route?.finish(new Error('The host cancelled joining.'), 'cancelled');
      this.session.transport.peers.get(entry.peer)?.close('The host removed this guest.');
      if (this.connected) await this.send('reject', 'The host declined this join request.', id);
      this.session.changed();
    }
    async runHost(entry) {
      entry.deadline = Date.now() + this.budgets.total;
      const transport = this.session.transport;
      const attempt = async stage => {
        if (!this.active(entry)) throw new Error('Join cancelled.');
        if (Date.now() >= entry.deadline) throw new Error('Connection setup deadline ended. Try joining again.');
        try { await this.attemptHost(entry, stage); return true; }
        catch (error) { if (entry.route?.locked || !this.active(entry) || Date.now() >= entry.deadline) throw error; return false; }
      };
      if (transport.forwardEndpoint?.host && await attempt('forward')) return;
      if (transport.nativeOptions?.upnp && transport.nativeReady) {
        const mapping = { stage: 'mapping', started: performance.now() };
        try { await transport.map(); this.record(mapping, 'ready'); }
        catch { this.record(mapping, 'failed'); /* No mapping or a slow router must not prevent WebRTC. */ }
        if (transport.endpoint?.mapped && await attempt('upnp')) return;
      }
      if (await attempt('stun')) return;
      if ((hasTurn(transport.iceServers) || entry.relay) && await attempt('turn')) return;
      throw new Error('Direct routes failed' + (hasTurn(transport.iceServers) || entry.relay ? ' and TURN could not connect.' : '; no TURN relay is configured.'));
    }
    async attemptHost(entry, stage) {
      const transport = this.session.transport, a = entry.route = { id: crypto.randomUUID(), stage, locked: false, started: performance.now() };
      let resolve, reject;
      const waiting = new Promise((yes, no) => { resolve = yes; reject = no; }); waiting.catch(() => {});
      a.finish = (error, outcome = error ? 'failed' : 'connected') => {
        if (a.done) return; a.done = true; clearTimeout(a.timer);
        const report = this.record(a, outcome); if (a.admitted) a.link.setup = report;
        error ? reject(error) : resolve();
      };
      const deadline = a.deadline = amount => {
        clearTimeout(a.timer);
        a.timer = setTimeout(() => a.finish(new Error(stage + ' connection timed out.'), 'timed out'), Math.max(1, Math.min(amount, entry.deadline - Date.now())));
      };
      deadline(this.budgets[stage]);
      try {
        this.session.notify('Checking ' + stage + ' connection for ' + entry.name + '…');
        const creating = transport.offer(stage, link => { a.link = link; if (a.done || !this.active(entry)) link.close('Route attempt expired.'); });
        creating.then(offer => { if (a.done && !a.admitted) transport.peers.get(offer.peer)?.close('Route attempt expired.'); }).catch(() => {});
        const offer = await Promise.race([creating, waiting]);
        if (!this.active(entry) || a.done) throw new Error('Join cancelled.');
        a.link = transport.peers.get(offer.peer); entry.peer = offer.peer;
        transport.watchers.set(offer.peer, (state, details) => {
          if (a.done) return;
          if (state === 'connected') { a.localReady = true; this.commitHost(entry, a, deadline).catch(error => a.finish(error)); }
          if (state === 'closed') a.finish(new Error(details.reason || 'Route connection ended.'));
        });
        await this.route(entry, a, 'offer', offer.invitation); a.offered = true;
        for (const value of this.outgoing.get(offer.peer) || []) await this.route(entry, a, 'candidate', value);
        this.outgoing.delete(offer.peer);
        await waiting;
      } catch (error) { a.finish(error); throw error; }
      finally {
        clearTimeout(a.timer);
        if (a.link) { transport.watchers.delete(a.link.peer); this.outgoing.delete(a.link.peer); }
        if (!a.admitted) {
          a.link?.close('Route attempt ended.');
          if (this.connected && a.offered) this.route(entry, a, 'cancel', 'Trying another route or ending this attempt.').catch(() => {});
        }
      }
    }
    async commitHost(entry, a, deadline) {
      if (a.done || a.locked || !a.localReady || !a.remoteReady) return;
      a.locked = true; deadline(this.budgets.admission);
      await this.route(entry, a, 'commit');
    }
    async handle(event) {
      if (event.type === 'signal' && event.kind === 'route') {
        rules.signal(event);
        if (this.role === 'host') return this.hostSignal(event);
        return this.guestSignal(event.data);
      }
      if (['closed', 'error', 'room-ended'].includes(event.type)) {
        for (const entry of this.requests.values()) if (entry.route && !entry.route.admitted) entry.route.finish(new Error('Room signaling ended.'));
        if (this.guestAttempt && !this.guestAttempt.selected) this.cancelGuest(this.guestAttempt);
      }
      if (event.type === 'left') {
        const entry = this.requests.get(event.id);
        if (entry?.route && !entry.route.admitted) entry.route.finish(new Error('Guest left.'));
      }
      return super.handle(event);
    }
    async hostSignal(event) {
      const entry = this.requests.get(event.from), a = entry?.route, r = event.data;
      if (!a || r.attempt !== a.id || r.stage !== a.stage || a.done) return;
      if (!['answer', 'candidate', 'ready', 'ack', 'failed'].includes(r.type)) throw new Error('Invalid guest route control.');
      try {
        if (r.type === 'answer') await this.session.transport.acceptReply(r.value);
        else if (r.type === 'candidate') await a.link.addCandidate(r.value);
        else if (r.type === 'ready') { a.remoteReady = true; await this.commitHost(entry, a, a.deadline); }
        else if (r.type === 'failed') a.finish(new Error(r.value || 'The guest could not use this route.'));
        else if (r.type === 'ack') {
          if (!a.locked || a.admitting) return;
          a.admitting = true;
          await this.session.world.admitConnectedPlayer(entry.heroId, a.link);
          if (a.done) { a.link.close('Admission deadline ended.'); return; }
          a.admitted = true; a.finish(); this.session.notify(entry.name + ' joined through ' + a.stage + '.');
        }
      } catch (error) { a.finish(error); }
    }
    guestSignal(r) {
      if (!['offer', 'candidate', 'commit', 'cancel'].includes(r.type)) throw new Error('Invalid host route control.');
      if (r.type === 'offer') {
        const old = this.guestAttempt;
        if (old?.selected || old?.locked) throw new Error('A game route is already selected.');
        if (old && rules.STAGES.indexOf(r.stage) <= rules.STAGES.indexOf(old.stage)) return;
        if (old) this.cancelGuest(old);
        const a = this.guestAttempt = { id: r.attempt, stage: r.stage, local: [], remote: [], started: performance.now() };
        this.startGuest(a, r.value).catch(error => this.failGuest(a, error)); return;
      }
      const a = this.guestAttempt;
      if (!a || a.cancelled || a.id !== r.attempt || a.stage !== r.stage) return;
      if (r.type === 'cancel') { if (a.selected) a.link.close('Host cancelled this route.'); else this.cancelGuest(a); return; }
      if (r.type === 'candidate') {
        if (a.link) a.link.addCandidate(r.value).catch(error => this.failGuest(a, error));
        else { if (a.remote.length >= 128) throw new Error('Too many queued route candidates.'); a.remote.push(r.value); }
      } else if (r.type === 'commit') {
        if (a.locked || !a.ready || a.link?.closed) return;
        a.locked = true;
        this.runtime.polycraft.runAction(async () => {
          if (a.cancelled || this.closed) throw new Error('Join cancelled.');
          await this.session.attachGuest(a.link); a.selected = true; this.onJoined?.();
          await this.route(null, a, 'ack'); a.link.setup = this.record(a, 'selected');
          this.session.notify('Connection selected: ' + a.stage + '. Waiting for the island.');
        }).catch(error => this.failGuest(a, error));
      }
    }
    async startGuest(a, invitation) {
      const native = a.stage === 'forward' || a.stage === 'upnp';
      if (native !== invitation.startsWith('polycraft-direct1.')) throw new Error('Route invitation does not match its transport.');
      const Peer = native ? this.runtime.PolycraftDirect.DirectPeer : this.runtime.PolycraftMultiplayer.PeerLink;
      const joined = await Peer.join(invitation, { desktop: this.runtime.desktop, trickle: true, iceServers: a.stage === 'stun' ? stunOnly(this.options.iceServers) : this.options.iceServers,
        onCreated: link => { a.link = link; link.probing = true; },
        onCandidate: (value, link) => this.candidate(value, link),
        onMessage: (_message, link) => { if (link.probing) throw new Error('Game data arrived before route admission.'); },
        onError: error => { if (!a.selected) this.failGuest(a, error); },
        onState: state => {
          if (a.cancelled || a.selected || this.guestAttempt !== a) return;
          if (state === 'connected' && !a.ready) { a.ready = true; this.route(null, a, 'ready').catch(error => this.failGuest(a, error)); }
          if (state === 'closed') this.failGuest(a, new Error('Guest route connection ended.'));
        } });
      if (a.cancelled || this.closed || this.guestAttempt !== a) { joined.connection.close('Stale route attempt.'); return; }
      if (joined.reply) await this.route(null, a, 'answer', joined.reply);
      a.answered = true;
      for (const value of a.local.splice(0)) await this.route(null, a, 'candidate', value);
      for (const value of a.remote.splice(0)) await a.link.addCandidate(value);
      a.link.activate?.();
    }
    failGuest(a, error) {
      if (a.failed || a.cancelled) return; a.failed = true;
      this.record(a, 'failed');
      if (this.connected && !this.closed) this.route(null, a, 'failed', error.message.slice(0, 256)).catch(() => {});
      this.session.notify('Route ' + a.stage + ': ' + error.message);
      if (!a.selected) { a.cancelled = true; a.link?.close('Route failed.'); }
      else a.link?.close('Selected route failed during admission.');
    }
    cancelGuest(a) { this.record(a, 'cancelled'); a.cancelled = true; a.local = []; a.remote = []; a.link?.close('Route attempt cancelled.'); }
    close() {
      for (const entry of this.requests.values()) if (entry.route && !entry.route.admitted) entry.route.finish(new Error('Room closed.'));
      if (this.guestAttempt && !this.guestAttempt.selected) this.cancelGuest(this.guestAttempt);
      super.close();
    }
  }
  const api = { AutoRoomSession, BUDGETS };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftAutoRooms = api;
})(globalThis);
