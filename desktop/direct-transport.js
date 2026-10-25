'use strict';
(function (root) {
  const network = typeof module !== 'undefined' ? require('./multiplayer.js') : root.PolycraftMultiplayer;
  const PREFIX = 'polycraft-direct1.';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  function invitation(text) {
    if (typeof text !== 'string' || text.length > 4096 || !text.startsWith(PREFIX)) throw new Error('Paste a complete direct invitation.');
    let value; try { value = JSON.parse(atob(text.slice(PREFIX.length))); } catch { throw new Error('The direct invitation is damaged.'); }
    const keys = ['protocol', 'runtime', 'session', 'peer', 'nonce', 'pvp', 'expires', 'host', 'port', 'fingerprint', 'token'];
    if (!value || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key)) ||
      value.protocol !== network.PROTOCOL || value.runtime !== network.RUNTIME || ![value.session, value.peer, value.nonce].every(id => typeof id === 'string' && UUID.test(id)) || typeof value.pvp !== 'boolean' ||
      !Number.isSafeInteger(value.expires) || value.expires <= Date.now() || value.expires > Date.now() + 31 * 60000 ||
      typeof value.host !== 'string' || value.host.length > 253 || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.host) || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 ||
      ![value.fingerprint, value.token].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) throw new Error('This direct invitation is invalid, expired or incompatible.');
    return value;
  }
  class DirectPeer extends network.PeerLink {
    constructor(options) {
      super({ ...options, direct: true }); this.desktop = options.desktop; this.kind = 'direct';
      const link = this, channel = this.channel = new EventTarget();
      channel.readyState = 'connecting'; channel.bufferedAmount = 0;
      channel.send = text => {
        const bytes = new TextEncoder().encode(text).length;
        channel.bufferedAmount += bytes;
        link.desktop.direct('send', { id: link.peer, data: text }).then(() => {
          channel.bufferedAmount -= bytes;
          if (channel.bufferedAmount <= 128 * 1024) channel.dispatchEvent(new Event('bufferedamountlow'));
        }).catch(error => link.fail(error));
      };
      channel.close = () => { channel.readyState = 'closed'; this.unsubscribe?.(); this.desktop.direct('close', { id: this.peer }).catch(() => {}); };
      this.unsubscribe = this.desktop.onDirect(event => {
        if (event.id !== this.peer || this.closed) return;
        if (event.type === 'connected') {
          channel.readyState = 'open';
          if (this.role === 'host') this.activate();
        } else if (event.type === 'data') {
          try { this.receive(event.data); this.desktop.direct('read', { id: this.peer }).catch(error => this.fail(error)); }
          catch (error) { this.fail(error); }
        } else if (event.type === 'closed') this.close(event.reason);
      });
    }
    activate() {
      if (this.closed || this.state === 'connected') return;
      this.channel.readyState = 'open'; this.emit('connected', { path: 'direct TCP/TLS' });
      this.desktop.direct('activate', { id: this.peer }).catch(error => this.fail(error));
    }
    async diagnostics() { return { path: 'direct TCP/TLS', rttMs: null, bufferedBytes: this.channel.bufferedAmount }; }
    static async join(text, options = {}) {
      const packet = invitation(text);
      const connection = new DirectPeer({ ...options, ...packet, role: 'guest' });
      try {
        await options.desktop.direct('join', { id: packet.peer, host: packet.host, port: packet.port, fingerprint: packet.fingerprint, token: packet.token });
        if (connection.closed) throw new Error('The direct connection ended while joining.');
        return { connection, reply: '' };
      } catch (error) { connection.close(); throw error; }
    }
  }
  class DirectHostSession extends network.HostSession {
    constructor(options) { super(options); this.desktop = options.desktop; this.kind = 'direct'; }
    async listen(options) { this.endpoint = await this.desktop.direct('start', options); return this.endpoint; }
    async createInvitation() {
      if (this.closed || this.peers.size >= 3) throw new Error('This session has ended or already has four players.');
      const peer = crypto.randomUUID(), nonce = crypto.randomUUID(), expires = Date.now() + 30 * 60000;
      const endpoint = await this.desktop.direct('reserve', { id: peer, expires });
      if (this.closed) { await this.desktop.direct('close', { id: peer }); throw new Error('The direct invitation was cancelled.'); }
      const connection = new DirectPeer({ role: 'host', session: this.session, peer, nonce, expires, pvp: this.pvp, desktop: this.desktop,
        onMessage: (message, link) => this.onMessage?.(message, link),
        onState: (state, details) => { if (state === 'closed') this.peers.delete(peer); this.onState?.(peer, state, details); },
        onError: error => this.onError?.(peer, error) });
      this.peers.set(peer, connection); connection.emit('waiting');
      const value = { protocol: network.PROTOCOL, runtime: network.RUNTIME, session: this.session, peer, nonce, pvp: this.pvp, expires, ...endpoint };
      return { peer, invitation: PREFIX + btoa(JSON.stringify(value)) };
    }
    async acceptReply() { throw new Error('Direct invitations connect automatically; no guest reply is needed.'); }
    close() {
      if (this.closed) return;
      super.close(); this.stopped = this.desktop.direct('stop');
      this.stopped.catch(error => this.onError?.(null, error));
    }
  }
  const api = { PREFIX, invitation, DirectPeer, DirectHostSession };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftDirect = api;
})(globalThis);
