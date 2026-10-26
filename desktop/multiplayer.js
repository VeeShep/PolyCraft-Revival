'use strict';
(function (root) {
  const PROTOCOL = 1;
  const RUNTIME = 'polycraft-1.0.0.25-coop-21';
  const PREFIX = 'polycraft1.';
  const INVITE_LIFETIME = 30 * 60 * 1000;
  const CHUNK_BYTES = 8192;
  const MAX_FRAME = 16 * 1024;
  const MAX_TRANSFER = 32 * 1024 * 1024;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const HOST_MESSAGES = new Set(['welcome', 'snapshot', 'update', 'result', 'end']);
  const GUEST_MESSAGES = new Set(['hello', 'action', 'ack', 'resync']);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function requireValue(condition, message) { if (!condition) throw new Error(message); }
  function exactKeys(value, keys) {
    return plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  }
  function jsonValue(value, depth = 0, budget = { nodes: 0 }) {
    requireValue(depth <= 64 && ++budget.nodes <= 500000, 'Network data is too complex.');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { requireValue(value.length <= MAX_TRANSFER, 'Network data is too large.'); return; }
    if (typeof value === 'number') { requireValue(Number.isFinite(value), 'Invalid network number.'); return; }
    requireValue(typeof value === 'object', 'Network data must contain only JSON values.');
    requireValue(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Network data must contain only JSON objects.');
    for (const key of Object.keys(value)) {
      requireValue(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe key in network data.');
      jsonValue(value[key], depth + 1, budget);
    }
  }
  function base64(bytes) { return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')); }
  function unbase64(text) {
    requireValue(typeof text === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text), 'Invalid connection data encoding.');
    return Uint8Array.from(atob(text), character => character.charCodeAt(0));
  }
  function validateInvitation(packet, expectedKind) {
    requireValue(exactKeys(packet, ['protocol', 'runtime', 'kind', 'session', 'peer', 'nonce', 'pvp', 'expires', 'description']), 'Invalid PolyCraft invitation.');
    requireValue(packet.protocol === PROTOCOL && packet.runtime === RUNTIME, 'This invitation uses an incompatible PolyCraft version.');
    requireValue(['offer', 'answer'].includes(packet.kind) && (!expectedKind || packet.kind === expectedKind), expectedKind === 'answer' ? 'Paste the guest reply, not an invitation.' : 'Paste a host invitation, not a reply.');
    requireValue([packet.session, packet.peer, packet.nonce].every(id => typeof id === 'string' && UUID.test(id)) && typeof packet.pvp === 'boolean', 'Invalid invitation session.');
    requireValue(Number.isSafeInteger(packet.expires) && packet.expires > Date.now() && packet.expires <= Date.now() + INVITE_LIFETIME + 60000, 'This invitation has expired or its clock is incorrect. Ask the host for a new one.');
    const description = packet.description;
    requireValue(exactKeys(description, ['type', 'sdp']) && description.type === packet.kind && typeof description.sdp === 'string' && description.sdp.length <= 65536 && description.sdp.startsWith('v=0'), 'Invalid WebRTC connection description.');
    return packet;
  }
  function encodeInvitation(packet) {
    validateInvitation(packet);
    return PREFIX + base64(encoder.encode(JSON.stringify(packet)));
  }
  function decodeInvitation(text, expectedKind) {
    requireValue(typeof text === 'string' && text.length <= 128 * 1024, 'The invitation is missing or too large.');
    text = text.replace(/[\t\r\n ]/g, '');
    requireValue(text.startsWith(PREFIX), 'This is not a PolyCraft invitation or reply.');
    let packet;
    try { packet = JSON.parse(decoder.decode(unbase64(text.slice(PREFIX.length)))); }
    catch { throw new Error('The invitation is damaged. Copy the complete invitation or reply.'); }
    return validateInvitation(packet, expectedKind);
  }
  function validateIceServers(servers = []) {
    requireValue(Array.isArray(servers) && servers.length <= 8, 'Use at most eight STUN/TURN server entries.');
    return servers.map(server => {
      requireValue(plain(server) && Object.keys(server).every(key => ['urls', 'username', 'credential'].includes(key)), 'Invalid STUN/TURN server settings.');
      const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
      requireValue(Array.isArray(urls) && urls.length > 0 && urls.length <= 8 && urls.every(url => typeof url === 'string' && url.length <= 2048 && /^(?:stun|stuns|turn|turns):[^\s/@#]+$/.test(url)), 'Use stun:, stuns:, turn: or turns: server addresses.');
      const turn = urls.some(url => /^turns?:/.test(url));
      requireValue(!turn || (typeof server.username === 'string' && server.username.length > 0 && typeof server.credential === 'string' && server.credential.length > 0), 'TURN requires a username and password.');
      requireValue((server.username === undefined || (typeof server.username === 'string' && server.username.length <= 256)) && (server.credential === undefined || (typeof server.credential === 'string' && server.credential.length <= 1024)), 'Invalid TURN credentials.');
      return { urls: [...urls], ...(server.username === undefined ? {} : { username: server.username }), ...(server.credential === undefined ? {} : { credential: server.credential }) };
    });
  }

  class PeerLink {
    constructor({ role, session, peer, nonce, pvp, expires, iceServers = [], onMessage, onState, onError, direct = false, trickle = false, onCandidate }) {
      requireValue(['host', 'guest'].includes(role) && [session, peer, nonce].every(id => typeof id === 'string' && UUID.test(id)) && typeof pvp === 'boolean', 'Invalid peer settings.');
      this.role = role;
      this.session = session;
      this.peer = peer;
      this.nonce = nonce;
      Object.defineProperty(this, 'pvp', { value: pvp, enumerable: true });
      this.expires = expires;
      this.onMessage = onMessage;
      this.onState = onState;
      this.onError = onError;
      this.state = 'new';
      this.closed = false;
      this.abort = new AbortController();
      this.sentSequence = this.receivedSequence = this.sentTransfer = this.receivedTransfer = 0;
      this.pendingSends = 0;
      this.sentBytes = this.receivedBytes = this.sentFrames = this.receivedFrames = 0;
      this.queue = Promise.resolve();
      if (direct) return; // Direct TLS links reuse the same bounded, validated game framing.
      this.trickle = trickle; this.candidates = []; this.candidateCount = 0;
      this.pc = new RTCPeerConnection({ iceServers: validateIceServers(iceServers) });
      if (trickle) this.pc.onicecandidate = event => {
        if (!event.candidate || this.closed) return;
        onCandidate?.(event.candidate.toJSON(), this);
      };
      this.pc.onconnectionstatechange = () => {
        if (this.closed) return;
        if (this.pc.connectionState === 'failed') this.fail(new Error('Connection failed. Check that both players are on the same LAN, or configure STUN/TURN for internet play.'));
        else if (this.pc.connectionState === 'disconnected') {
          this.emit('disconnected');
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => this.fail(new Error('Connection lost. Ask the host for a new invitation to reconnect.')), 15000);
        } else if (this.pc.connectionState === 'connected') {
          clearTimeout(this.disconnectTimer);
          if (this.channel?.readyState === 'open') this.connected();
        }
      };
      this.pc.ondatachannel = event => {
        if (this.role !== 'guest' || this.channel || event.channel.label !== 'polycraft-v1' || !event.channel.ordered || event.channel.maxRetransmits !== null || event.channel.maxPacketLifeTime !== null) {
          event.channel.close();
          this.fail(new Error('Unexpected game data channel.'));
        } else this.attach(event.channel);
      };
    }
    emit(state, details = {}) {
      if (this.closed && state !== 'closed') return;
      this.state = state; this.onState?.(state, details);
    }
    fail(error) {
      if (this.closed) return;
      try { this.onError?.(error); } finally { this.close(error.message); }
    }
    attach(channel) {
      this.channel = channel;
      channel.bufferedAmountLowThreshold = 128 * 1024;
      channel.onopen = () => this.connected();
      channel.onclose = () => this.close('The other player disconnected.');
      channel.onerror = () => this.fail(new Error('The game connection encountered an error.'));
      channel.onmessage = event => {
        try { this.receive(event.data); }
        catch (error) { this.fail(error); }
      };
    }
    async connected() {
      if (this.closed || this.state === 'connected' || this.notifyingConnection) return;
      this.notifyingConnection = true;
      clearTimeout(this.connectionTimer);
      clearTimeout(this.expiryTimer);
      clearTimeout(this.disconnectTimer);
      const path = await this.connectionPath();
      this.notifyingConnection = false;
      if (!this.closed && this.channel?.readyState === 'open' && this.pc.connectionState !== 'disconnected') this.emit('connected', { path });
    }
    async connectionPath() { return (await this.diagnostics()).path; }
    traffic() {
      return { sentBytes: this.sentBytes, receivedBytes: this.receivedBytes, sentFrames: this.sentFrames, receivedFrames: this.receivedFrames,
        durationMs: this.trafficStarted === undefined ? 0 : Math.max(0, Math.round((this.trafficEnded ?? performance.now()) - this.trafficStarted)) };
    }
    async diagnostics() {
      const result = { path: 'unknown', rttMs: null, bufferedBytes: this.channel?.bufferedAmount || 0 };
      try {
        const stats = await this.pc.getStats();
        const transport = [...stats.values()].find(stat => stat.type === 'transport' && stat.selectedCandidatePairId);
        const pair = transport ? stats.get(transport.selectedCandidatePairId) : [...stats.values()].find(stat => stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded');
        if (!pair) return result;
        const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
        if (local && remote) result.path = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relayed' : 'direct';
        if (Number.isFinite(pair.currentRoundTripTime) && pair.currentRoundTripTime >= 0) result.rttMs = Math.round(pair.currentRoundTripTime * 1000);
      } catch { /* Missing browser statistics must not break a session. */ }
      return result;
    }
    async gather() {
      requireValue(!this.closed, 'Connection cancelled.');
      this.emit('gathering');
      if (this.pc.iceGatheringState === 'complete') return;
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer);
          this.pc.removeEventListener('icegatheringstatechange', changed);
          this.abort.signal.removeEventListener('abort', aborted);
          error ? reject(error) : resolve();
        };
        const changed = () => { if (this.pc.iceGatheringState === 'complete') finish(); };
        const aborted = () => finish(new Error('Connection cancelled.'));
        const timer = setTimeout(() => finish(new Error('Finding network addresses timed out. Check your STUN/TURN settings and try again.')), 20000);
        this.pc.addEventListener('icegatheringstatechange', changed);
        this.abort.signal.addEventListener('abort', aborted, { once: true });
        if (this.closed) aborted(); else changed();
      });
    }
    packet(kind) {
      const { type, sdp } = this.pc.localDescription;
      return { protocol: PROTOCOL, runtime: RUNTIME, kind, session: this.session, peer: this.peer, nonce: this.nonce, pvp: this.pvp, expires: this.expires, description: { type, sdp } };
    }
    async addCandidate(candidate) {
      requireValue(!this.closed && this.trickle && candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 2048 && candidate.candidate.startsWith('candidate:') && ++this.candidateCount <= 128, 'Invalid or excessive ICE candidates.');
      if (!this.remoteReady) { this.candidates.push(candidate); return; }
      await this.pc.addIceCandidate(candidate);
    }
    async remoteDescription(description) {
      await this.pc.setRemoteDescription(description); this.remoteReady = true;
      for (const candidate of this.candidates.splice(0)) await this.pc.addIceCandidate(candidate);
    }
    async makeInvitation() {
      requireValue(this.role === 'host' && this.state === 'new' && !this.closed, 'This connection already has an invitation.');
      try {
        this.attach(this.pc.createDataChannel('polycraft-v1', { ordered: true }));
        await this.pc.setLocalDescription(await this.pc.createOffer());
        if (!this.trickle) await this.gather();
        requireValue(!this.closed, 'Connection cancelled.');
        const invitation = encodeInvitation(this.packet('offer'));
        this.emit('waiting');
        this.expiryTimer = setTimeout(() => this.close('Invitation expired.'), this.expires - Date.now());
        return invitation;
      } catch (error) { this.close(error.message); throw error; }
    }
    startConnectionDeadline() {
      requireValue(!this.closed, 'Connection cancelled.');
      this.emit('connecting');
      this.connectionTimer = setTimeout(() => this.fail(new Error('Connection timed out. Check the reply, LAN/firewall settings or configured STUN/TURN relay.')), 90000);
    }
    async acceptReply(text) {
      requireValue(this.role === 'host' && this.state === 'waiting' && !this.closed, 'This invitation is no longer waiting for a reply.');
      const packet = decodeInvitation(text, 'answer');
      requireValue(packet.session === this.session && packet.peer === this.peer && packet.nonce === this.nonce && packet.pvp === this.pvp && packet.expires === this.expires, 'This reply belongs to a different invitation.');
      try {
        this.startConnectionDeadline();
        await this.remoteDescription(packet.description);
      } catch (error) { this.close(error.message); throw error; }
    }
    static async join(text, options = {}) {
      const packet = decodeInvitation(text, 'offer');
      const connection = new PeerLink({ ...options, role: 'guest', session: packet.session, peer: packet.peer, nonce: packet.nonce, pvp: packet.pvp, expires: packet.expires });
      try {
        options.onCreated?.(connection);
        await connection.remoteDescription(packet.description);
        await connection.pc.setLocalDescription(await connection.pc.createAnswer());
        if (!connection.trickle) await connection.gather();
        const reply = encodeInvitation(connection.packet('answer'));
        connection.startConnectionDeadline();
        return { connection, reply };
      } catch (error) { connection.close(error.message); throw error; }
    }
    async drain() {
      requireValue(!this.closed && this.channel?.readyState === 'open', 'The player is not connected.');
      if (this.channel.bufferedAmount <= 256 * 1024) return;
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer);
          this.channel.removeEventListener('bufferedamountlow', drained);
          this.abort.signal.removeEventListener('abort', aborted);
          error ? reject(error) : resolve();
        };
        const drained = () => finish();
        const aborted = () => finish(new Error('Connection closed during transfer.'));
        const timer = setTimeout(() => finish(new Error('The connection is too slow to finish the transfer.')), 30000);
        this.channel.addEventListener('bufferedamountlow', drained, { once: true });
        this.abort.signal.addEventListener('abort', aborted, { once: true });
        if (this.closed) aborted(); else if (this.channel.bufferedAmount <= 128 * 1024) drained();
      });
    }
    send(kind, payload) {
      try {
        requireValue((this.role === 'host' ? HOST_MESSAGES : GUEST_MESSAGES).has(kind), 'This player cannot send that kind of game message.');
        requireValue(plain(payload), 'A game message must be an object.');
        jsonValue(payload);
        const bytes = encoder.encode(JSON.stringify(payload));
        requireValue(bytes.length <= MAX_TRANSFER, 'Game transfer exceeds 32 MB.');
        requireValue(this.pendingSends < 4 && !this.closed && this.channel?.readyState === 'open', 'The connection is closed or still busy transferring game data.');
        this.pendingSends++;
        const operation = this.queue.then(async () => {
          const transfer = ++this.sentTransfer;
          const chunks = Math.ceil(bytes.length / CHUNK_BYTES);
          for (let index = 0; index < chunks; index++) {
            await this.drain();
            const frame = { session: this.session, peer: this.peer, sequence: ++this.sentSequence, transfer, kind, index, chunks, bytes: bytes.length, data: base64(bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)) };
            const text = JSON.stringify(frame);
            requireValue(Number.isSafeInteger(frame.sequence) && Number.isSafeInteger(transfer) && text.length <= MAX_FRAME, 'Invalid outgoing game frame.');
            this.channel.send(text);
            this.trafficStarted ??= performance.now(); this.sentBytes += encoder.encode(text).length; this.sentFrames++;
          }
        });
        this.queue = operation.catch(error => { this.fail(error); });
        return operation.finally(() => { this.pendingSends--; });
      } catch (error) { return Promise.reject(error); }
    }
    receive(text) {
      requireValue(!this.closed && typeof text === 'string' && text.length <= MAX_FRAME, 'Invalid or oversized game frame.');
      const frameBytes = encoder.encode(text).length;
      requireValue(frameBytes <= MAX_FRAME, 'Oversized game frame.');
      this.trafficStarted ??= performance.now(); this.receivedBytes += frameBytes; this.receivedFrames++;
      let frame;
      try { frame = JSON.parse(text); } catch { throw new Error('Invalid game frame JSON.'); }
      requireValue(exactKeys(frame, ['session', 'peer', 'sequence', 'transfer', 'kind', 'index', 'chunks', 'bytes', 'data']), 'Invalid game frame fields.');
      requireValue(frame.session === this.session && frame.peer === this.peer, 'Game frame belongs to another session.');
      requireValue(Number.isSafeInteger(frame.sequence) && frame.sequence === this.receivedSequence + 1, 'Repeated or out-of-order game frame.');
      requireValue((this.role === 'host' ? GUEST_MESSAGES : HOST_MESSAGES).has(frame.kind), 'A guest cannot send authoritative world changes.');
      requireValue(Number.isSafeInteger(frame.transfer) && Number.isSafeInteger(frame.index) && Number.isSafeInteger(frame.chunks) && Number.isSafeInteger(frame.bytes) && frame.bytes > 0 && frame.bytes <= MAX_TRANSFER && frame.chunks === Math.ceil(frame.bytes / CHUNK_BYTES) && frame.index >= 0 && frame.index < frame.chunks, 'Invalid game transfer size.');
      requireValue(typeof frame.data === 'string' && frame.data.length <= 4 * Math.ceil(CHUNK_BYTES / 3), 'Oversized game chunk.');
      if (!this.incoming) {
        requireValue(frame.index === 0 && frame.transfer === this.receivedTransfer + 1, 'Game transfer started out of order.');
        this.incoming = { transfer: frame.transfer, kind: frame.kind, chunks: frame.chunks, bytes: frame.bytes, next: 0, buffer: new Uint8Array(frame.bytes) };
      }
      const incoming = this.incoming;
      requireValue(incoming.transfer === frame.transfer && incoming.kind === frame.kind && incoming.chunks === frame.chunks && incoming.bytes === frame.bytes && incoming.next === frame.index, 'Interrupted or inconsistent game transfer.');
      const bytes = unbase64(frame.data);
      requireValue(bytes.length === Math.min(CHUNK_BYTES, frame.bytes - frame.index * CHUNK_BYTES), 'Truncated game chunk.');
      incoming.buffer.set(bytes, frame.index * CHUNK_BYTES);
      incoming.next++;
      this.receivedSequence = frame.sequence;
      clearTimeout(this.transferTimer);
      if (incoming.next === incoming.chunks) {
        let payload;
        try { payload = JSON.parse(decoder.decode(incoming.buffer)); } catch { throw new Error('Invalid game message JSON.'); }
        requireValue(plain(payload), 'Invalid game message.');
        jsonValue(payload);
        this.receivedTransfer = incoming.transfer;
        this.incoming = null;
        // Engine callbacks enqueue validated actions; they must not mutate a world from an incomplete transfer.
        this.onMessage?.({ kind: incoming.kind, payload }, this);
      } else this.transferTimer = setTimeout(() => this.fail(new Error('Game transfer was interrupted. Reconnect to request a fresh snapshot.')), 15000);
    }
    close(reason = 'Connection closed.') {
      if (this.closed) return;
      this.closed = true;
      this.trafficEnded = performance.now();
      for (const timer of [this.connectionTimer, this.expiryTimer, this.disconnectTimer, this.transferTimer]) clearTimeout(timer);
      this.incoming = null;
      this.candidates?.splice(0);
      this.abort.abort();
      this.channel?.close();
      this.pc?.close();
      this.emit('closed', { reason });
    }
  }

  class HostSession {
    constructor({ pvp = false, iceServers = [], onMessage, onState, onError, trickle = false, onCandidate } = {}) {
      requireValue(typeof pvp === 'boolean', 'Choose whether PvP is enabled before hosting.');
      this.session = crypto.randomUUID();
      Object.defineProperty(this, 'pvp', { value: pvp, enumerable: true });
      this.iceServers = validateIceServers(iceServers);
      this.onMessage = onMessage;
      this.onState = onState;
      this.onError = onError;
      this.trickle = trickle; this.onCandidate = onCandidate;
      this.peers = new Map();
      this.closed = false;
    }
    async createInvitation({ iceServers = this.iceServers, probing = false, onCreated } = {}) {
      requireValue(!this.closed && this.peers.size < 3, 'This island already has four players or pending invitations. Cancel an invitation or disconnect a player first.');
      const peer = crypto.randomUUID();
      const connection = new PeerLink({
        role: 'host', session: this.session, peer, nonce: crypto.randomUUID(), pvp: this.pvp, expires: Date.now() + INVITE_LIFETIME, iceServers,
        trickle: this.trickle, onCandidate: (candidate, link) => this.onCandidate?.(candidate, link),
        onMessage: (message, link) => this.onMessage?.(message, link),
        onState: (state, details) => { if (state === 'closed') this.peers.delete(peer); this.onState?.(peer, state, details); },
        onError: error => this.onError?.(peer, error)
      });
      connection.probing = probing; this.peers.set(peer, connection);
      try { onCreated?.(connection); return { peer, invitation: await connection.makeInvitation() }; }
      catch (error) { connection.close(error.message); throw error; }
    }
    async acceptReply(text) {
      requireValue(!this.closed, 'This session has ended.');
      const packet = decodeInvitation(text, 'answer');
      requireValue(packet.session === this.session && this.peers.has(packet.peer), 'This reply belongs to a different or cancelled invitation.');
      await this.peers.get(packet.peer).acceptReply(text);
      return packet.peer;
    }
    close() {
      this.closed = true;
      for (const connection of [...this.peers.values()]) connection.close('The host ended the session.');
      this.peers.clear();
    }
  }
  const api = { PROTOCOL, RUNTIME, CHUNK_BYTES, MAX_FRAME, MAX_TRANSFER, encodeInvitation, decodeInvitation, validateIceServers, PeerLink, HostSession };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftMultiplayer = api;
})(globalThis);
