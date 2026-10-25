'use strict';
(function (root) {
  const network = typeof module !== 'undefined' ? require('./multiplayer.js') : root.PolycraftMultiplayer;
  const direct = typeof module !== 'undefined' ? require('./direct-transport.js') : root.PolycraftDirect;
  function stunOnly(servers) {
    return servers.flatMap(server => {
      const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => /^stuns?:/.test(url));
      return urls.length ? [{ urls }] : [];
    });
  }
  function hasTurn(servers) { return servers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/.test(url))); }
  class AutoHostSession extends direct.DirectHostSession {
    constructor(options) {
      super({ ...options, trickle: true, onState: (peer, state, details) => { options.onState?.(peer, state, details); this.watchers.get(peer)?.(state, details); } });
      this.kind = 'auto'; this.watchers = new Map();
    }
    async listen(options) {
      this.nativeOptions = options;
      let address = options.address;
      try {
        if (!address) address = (await this.desktop.direct('discover', options.stun ? { server: options.stun } : {})).address;
      } catch { /* Address discovery failure still permits UPnP or WebRTC. */ }
      if (this.closed) throw new Error('Host setup cancelled.');
      try { this.endpoint = await this.desktop.direct('start', { address: address || '', port: options.port, upnp: false, prepare: true, allowUpnp: options.upnp }); this.forwardEndpoint = this.endpoint; this.nativeReady = true; }
      catch { this.nativeReady = false; this.endpoint = null; }
    }
    async map() {
      if (!this.nativeOptions.upnp || !this.nativeReady) throw new Error('UPnP is disabled or the native listener is unavailable.');
      this.endpoint = await this.desktop.direct('map'); return this.endpoint;
    }
    async offer(stage, onCreated) {
      if (stage === 'forward' || stage === 'upnp') {
        if (!this.nativeReady || !(stage === 'forward' ? this.forwardEndpoint?.host : this.endpoint?.host)) throw new Error('No usable native endpoint.');
        const offer = await super.createInvitation({ onCreated: link => { link.probing = true; onCreated?.(link); } });
        if (stage === 'forward') { const packet = direct.invitation(offer.invitation); packet.host = this.forwardEndpoint.host; offer.invitation = direct.PREFIX + btoa(JSON.stringify(packet)); }
        return offer;
      }
      return network.HostSession.prototype.createInvitation.call(this, { iceServers: stage === 'stun' ? stunOnly(this.iceServers) : this.iceServers, probing: true, onCreated });
    }
    async acceptReply(text) { return network.HostSession.prototype.acceptReply.call(this, text); }
    close() { this.watchers.clear(); super.close(); }
  }
  const api = { AutoHostSession, stunOnly, hasTurn };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftAutoTransport = api;
})(globalThis);
