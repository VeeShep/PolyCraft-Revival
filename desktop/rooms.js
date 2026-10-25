'use strict';
(function (root) {
  const rules = typeof module !== 'undefined' ? require('./room-protocol.js') : root.PolycraftRoomProtocol;
  class RoomSession {
    constructor(session, runtime = root) {
      this.session = session; this.runtime = runtime; this.requests = new Map(); this.outgoing = new Map(); this.early = []; this.queue = Promise.resolve();
      this.unsubscribe = runtime.desktop.onRoom(event => {
        if (this.closed) return;
        if (!this.id) { if (this.early.length < 16) this.early.push(event); return; }
        this.receive(event);
      });
    }
    async open(role, settings) {
      this.role = role;
      try {
        const connected = await this.runtime.desktop.room('open', { ...settings, room: rules.roomName(settings.room), password: rules.password(settings.password), type: role === 'host' ? 'create' : 'join', runtime: this.runtime.PolycraftMultiplayer.RUNTIME });
        if (this.closed) throw new Error('Room connection cancelled.');
        this.id = connected.id; this.name = connected.room; this.connected = true;
        this.session.notify(role === 'host' ? 'Room “' + this.name + '” is open. Guests enter its name and password; approve each guest below.' : 'Waiting for the host to approve joining “' + this.name + '”.');
        for (const event of this.early.splice(0)) this.receive(event);
      } catch (error) { this.close(); throw error; }
    }
    receive(event) {
      if (event.connectionId !== this.id || this.closed) return;
      this.queue = this.queue.then(() => this.handle(event)).catch(error => { this.session.notify(error.message); });
    }
    async send(kind, data, to) { await this.runtime.desktop.room('send', { id: this.id, kind, data, ...(to ? { to } : {}) }); }
    candidate(candidate, link) {
      if (this.closed || !this.connected) return;
      if (this.role === 'host') {
        const entry = [...this.requests.values()].find(entry => entry.peer === link.peer);
        if (entry?.offered) this.send('candidate', candidate, entry.id).catch(error => this.session.notify(error.message));
        else {
          const queue = this.outgoing.get(link.peer) || []; if (queue.length < 128) queue.push(candidate); this.outgoing.set(link.peer, queue);
        }
      } else if (this.answered) this.send('candidate', candidate).catch(error => this.session.notify(error.message));
      else { this.localCandidates ||= []; if (this.localCandidates.length < 128) this.localCandidates.push(candidate); }
    }
    async approve(id, heroId) {
      const entry = this.requests.get(id);
      if (this.role !== 'host' || !entry || entry.peer || entry.approving || !this.connected) throw new Error('Choose a waiting guest request.');
      entry.approving = true;
      try {
        if (!heroId) heroId = this.session.addGuest(entry.name);
        const offer = await this.session.world.createPlayerInvitation(heroId);
        if (this.closed || !this.requests.has(id)) { this.session.transport.peers.get(offer.peer)?.close('Room request cancelled.'); throw new Error('This guest request ended.'); }
        entry.peer = offer.peer;
        await this.send('offer', offer.invitation, id); entry.offered = true;
        for (const candidate of this.outgoing.get(offer.peer) || []) await this.send('candidate', candidate, id);
        this.outgoing.delete(offer.peer);
        this.session.notify('Approved ' + entry.name + '. Connecting automatically.');
      } catch (error) {
        const link = this.session.transport.peers.get(entry.peer);
        if (link && link.state !== 'connected') link.close('Room invitation failed.');
        this.outgoing.delete(entry.peer);
        throw error;
      } finally { entry.approving = false; this.session.changed(); }
    }
    async reject(id) {
      const entry = this.requests.get(id); if (!entry || entry.approving) throw new Error('Choose an available guest request.');
      if (entry.peer) this.session.transport.peers.get(entry.peer)?.close('The host removed this guest.');
      if (this.connected) await this.send('reject', 'The host declined this join request.', id);
      this.requests.delete(id); this.session.changed();
    }
    async handle(event) {
      if (this.closed) return;
      if (event.type === 'closed' || event.type === 'room-ended' || event.type === 'error') {
        this.connected = false;
        for (const [id, entry] of this.requests) {
          const link = this.session.transport?.peers.get(entry.peer);
          if (!link || link.state !== 'connected') { link?.close('Room signaling ended before connecting.'); this.requests.delete(id); }
        }
        this.outgoing.clear();
        if (this.role === 'guest' && this.session.connection && this.session.connection.state !== 'connected') this.session.connection.close('Room signaling ended before connecting.');
        if (event.type === 'error') this.failure = event.message;
        this.session.notify((this.failure || 'Room server disconnected.') + ' Existing game connections keep running; new joins need a room server connection.'); return;
      }
      if (event.type === 'request') {
        if (this.role !== 'host' || this.requests.size >= 3 || typeof event.id !== 'string' || !/^[a-f0-9-]{36}$/.test(event.id) || typeof event.name !== 'string' || event.name.length > 80) throw new Error('Invalid guest request.');
        this.requests.set(event.id, { id: event.id, name: event.name }); this.session.notify(event.name + ' wants to join. Select a guest hero or create a new one, then approve.'); return;
      }
      if (event.type === 'left') {
        const entry = this.requests.get(event.id), link = entry && this.session.transport?.peers.get(entry.peer);
        if (link && link.state !== 'connected') link.close('Guest left the room.');
        this.requests.delete(event.id); this.session.changed(); return;
      }
      if (event.type !== 'signal') return;
      rules.signal(event);
      if (this.role === 'host') {
        const entry = this.requests.get(event.from), link = entry && this.session.transport.peers.get(entry.peer);
        if (!link || !entry.offered) throw new Error('This room message has no approved guest.');
        if (event.kind === 'answer') await this.session.transport.acceptReply(event.data);
        else if (event.kind === 'candidate') await link.addCandidate(event.data);
        else throw new Error('Guests cannot send host offers.');
      } else {
        if (event.kind === 'reject') { this.failure = event.data; this.session.notify(event.data); return; }
        if (event.kind === 'candidate') {
          if (this.session.connection) await this.session.connection.addCandidate(event.data);
          else { this.remoteCandidates ||= []; if (this.remoteCandidates.length >= 128) throw new Error('Too many queued room candidates.'); this.remoteCandidates.push(event.data); }
        } else if (event.kind === 'offer') {
          if (this.session.world || this.joining) throw new Error('Repeated room offer.');
          this.joining = true;
          const connect = async () => {
            if (this.closed) throw new Error('Room connection cancelled.');
            await this.session.connect('guest', { ...this.options, trickle: true, onCandidate: (value, link) => this.candidate(value, link) }, event.data, true);
            this.onJoined?.();
          };
          await this.runtime.polycraft.runAction(connect);
          if (this.closed) { await this.session.end(); return; }
          if (this.session.outgoing) await this.send('answer', this.session.outgoing);
          this.session.outgoing = ''; this.answered = true;
          for (const candidate of this.localCandidates || []) await this.send('candidate', candidate);
          this.localCandidates = [];
          for (const candidate of this.remoteCandidates || []) await this.session.connection.addCandidate(candidate);
          this.remoteCandidates = [];
          this.session.notify('Room reply exchanged automatically. Return to game while connecting.');
        }
      }
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.unsubscribe?.(); this.requests.clear(); this.outgoing.clear(); this.early = [];
      this.runtime.desktop.room('close').catch(() => {});
    }
  }
  if (typeof module !== 'undefined') module.exports = { RoomSession };
  else root.PolycraftRooms = { RoomSession };
})(globalThis);
