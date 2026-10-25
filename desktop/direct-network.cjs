'use strict';
const tls = require('node:tls');
const { randomBytes, X509Certificate, timingSafeEqual } = require('node:crypto');
const { MAX_FRAME } = require('./multiplayer.js');
const { discover } = require('./stun.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
function check(value, message) { if (!value) throw new Error(message); }
function port(value) { check(Number.isInteger(value) && value >= 1024 && value <= 65535, 'Choose a TCP port from 1024 to 65535.'); return value; }
function host(value) {
  check(typeof value === 'string' && value.length <= 253 && /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/.test(value), 'Enter an IPv4 address or hostname, without a port or URL.');
  return value;
}
function id(value) { check(typeof value === 'string' && UUID.test(value), 'Invalid direct connection ID.'); return value; }
function fingerprint(cert) { return new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase(); }
function equal(a, b) { return typeof a === 'string' && typeof b === 'string' && HEX.test(a) && HEX.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }

// The renderer handles game rules/framing; only bounded TLS socket operations cross IPC.
class DirectNetwork {
  constructor(emit, { mapperFactory, certificates } = {}) {
    this.emit = emit; this.links = new Map(); this.sockets = new Set();
    this.mapperFactory = mapperFactory || (async () => { const { default: NatAPI } = await import('@silentbot1/nat-api'); return new NatAPI({ enableUPNP: true, enablePMP: false, ttl: 1200, autoUpdate: true, upnpPermanentFallback: false, description: 'PolyCraft Revival co-op' }); });
    this.certificates = certificates || (() => require('selfsigned').generate([{ name: 'commonName', value: 'PolyCraft direct session' }], { keySize: 2048, algorithm: 'sha256' }));
  }
  async start(options) {
    check(!this.server && !this.starting && this.links.size === 0, 'End the current direct session first.');
    const listenPort = port(options?.port), address = options?.address ? host(options.address) : '';
    check(typeof options?.upnp === 'boolean' && (address || options.upnp), 'Enter the address guests will connect to, or choose UPnP.');
    this.starting = true;
    try {
      const keys = await this.certificates();
      this.pin = fingerprint(keys.cert);
      const server = this.server = tls.createServer({ key: keys.private, cert: keys.cert, minVersion: 'TLSv1.3', handshakeTimeout: 10000 }, socket => this.accept(socket));
      server.maxConnections = 12;
      server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
      server.on('tlsClientError', () => {});
      server.on('error', () => {}); // listen rejects startup errors; socket failures are reported per peer.
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenPort, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); }); });
      let externalAddress = address, warning = '', mapped = false;
      if (options.upnp) {
        this.mapper = await this.mapperFactory();
        try {
          check(await this.mapper.map({ publicPort: listenPort, privatePort: listenPort, protocol: 'TCP' }), 'The router did not accept the mapping.');
          mapped = true;
          if (!externalAddress) externalAddress = host(await this.mapper.externalIp());
        } catch {
          await this.mapper.destroy().catch(() => {}); this.mapper = null;
          check(address, 'UPnP failed. Enter your public IPv4/hostname and forward the TCP port manually, or use WebRTC with TURN.');
          warning = 'UPnP failed. Forward TCP ' + listenPort + ' manually before inviting internet guests.';
        }
      }
      this.endpoint = { host: externalAddress, port: listenPort, fingerprint: this.pin };
      return { ...this.endpoint, mapped, warning };
    } catch (error) { await this.stop(); throw error; }
    finally { this.starting = false; }
  }
  reserve(options) {
    check(this.server?.listening && this.links.size < 3, 'Direct hosting is unavailable or already has three guests.');
    const peer = id(options?.id); check(!this.links.has(peer), 'This guest already has an invitation.');
    check(Number.isSafeInteger(options.expires) && options.expires > Date.now() && options.expires <= Date.now() + 31 * 60000, 'Invalid invitation expiry.');
    const link = { id: peer, token: randomBytes(32).toString('hex'), expires: options.expires, active: false };
    link.timer = setTimeout(() => this.close(peer), options.expires - Date.now()); link.timer.unref();
    this.links.set(peer, link);
    return { ...this.endpoint, token: link.token };
  }
  accept(socket) {
    let link;
    this.readLines(socket, line => {
      if (!link) {
        let auth; try { auth = JSON.parse(line); } catch { throw new Error('Invalid direct authentication.'); }
        check(auth && Object.keys(auth).length === 2, 'Invalid direct authentication.');
        link = this.links.get(id(auth.id));
        check(link && !link.socket && link.expires > Date.now() && equal(auth.token, link.token), 'Invalid or used direct invitation.');
        link.socket = socket; link.token = null; clearTimeout(link.timer);
        socket.write('OK\n'); this.connected(link);
      } else this.deliver(link, line);
    }, () => link);
  }
  async join(options) {
    check(!this.server && this.links.size === 0, 'End the current direct session first.');
    const peer = id(options?.id), address = host(options.host), remotePort = port(options.port);
    check(HEX.test(options.fingerprint) && HEX.test(options.token), 'Invalid direct invitation credentials.');
    const link = { id: peer, active: false };
    this.links.set(peer, link);
    try {
      await new Promise((resolve, reject) => {
        // The exact certificate from the private invitation is checked before sending its token.
        const socket = link.socket = tls.connect({ host: address, port: remotePort, family: 4, minVersion: 'TLSv1.3', rejectUnauthorized: false });
        this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket));
        socket.on('secureConnect', () => {
          try {
            check(equal(fingerprint(socket.getPeerCertificate().raw), options.fingerprint), 'The host certificate does not match the invitation.');
            socket.write(JSON.stringify({ id: peer, token: options.token }) + '\n');
          } catch (error) { reject(error); socket.destroy(); }
        });
        let authenticated = false;
        socket.once('error', reject); socket.once('close', () => { if (!authenticated) reject(new Error('Direct connection failed. Check the address, TCP forwarding and firewall, or use WebRTC with TURN.')); });
        this.readLines(socket, line => {
          if (!authenticated) { check(line === 'OK', 'The host rejected this invitation.'); authenticated = true; this.connected(link); resolve(); }
          else this.deliver(link, line);
        }, () => link);
      });
      return true;
    } catch (error) { this.close(peer); throw error; }
  }
  readLines(socket, receive, getLink) {
    let pending = Buffer.alloc(0), waiting = false;
    socket.setNoDelay(true); socket.setTimeout(10000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => { const link = getLink(); if (link?.socket === socket) this.close(link.id); });
    const process = () => {
      if (waiting || socket.destroyed) return;
      try {
        while (pending.length) {
          const end = pending.indexOf(10);
          check(end <= MAX_FRAME && (end !== -1 || pending.length <= MAX_FRAME), 'Oversized direct game frame.');
          if (end === -1) break;
          const line = pending.subarray(0, end).toString('utf8'); pending = pending.subarray(end + 1);
          receive(line);
          const link = getLink();
          if (link?.pending !== undefined) { waiting = true; socket.pause(); return; }
        }
        socket.resume();
      } catch { socket.destroy(); }
    };
    socket.on('data', chunk => {
      if (pending.length + chunk.length > 256 * 1024) { socket.destroy(); return; }
      pending = Buffer.concat([pending, chunk]); process();
    });
    socket.directRead = () => { waiting = false; process(); };
  }
  connected(link) {
    link.socket.setTimeout(60000);
    this.emit({ id: link.id, type: 'connected' });
  }
  deliver(link, line) {
    check(line.length > 0 && Buffer.byteLength(line) <= MAX_FRAME, 'Invalid direct game frame.');
    link.pending = line;
    if (link.active) this.emit({ id: link.id, type: 'data', data: line });
  }
  activate(peer) {
    const link = this.links.get(id(peer)); check(link?.socket && !link.active, 'Direct connection is not ready.');
    link.active = true; if (link.pending !== undefined) this.emit({ id: peer, type: 'data', data: link.pending });
  }
  read(peer) {
    const link = this.links.get(id(peer)); if (!link?.active) return;
    delete link.pending; link.socket.directRead();
  }
  async send(peer, text) {
    const link = this.links.get(id(peer));
    check(link?.socket && !link.socket.destroyed && typeof text === 'string' && text.length > 0 && !text.includes('\n') && Buffer.byteLength(text) <= MAX_FRAME, 'Invalid or closed direct game transfer.');
    check(link.socket.writableLength <= 512 * 1024, 'Direct connection is too slow.');
    await new Promise((resolve, reject) => link.socket.write(text + '\n', error => error ? reject(error) : resolve()));
  }
  close(peer) {
    const link = this.links.get(id(peer)); if (!link) return;
    this.links.delete(peer); clearTimeout(link.timer); link.socket?.destroy();
    this.emit({ id: peer, type: 'closed', reason: 'Direct connection ended. Check the host, firewall or forwarding before reconnecting.' });
  }
  async stop() {
    this.discovery?.abort();
    for (const peer of [...this.links.keys()]) this.close(peer);
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server; this.server = null; this.endpoint = null;
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    const mapper = this.mapper; this.mapper = null;
    if (mapper) await mapper.destroy();
  }
  async request(operation, options) {
    switch (operation) {
      case 'discover': {
        check(!this.discovery, 'Address discovery is already running.');
        const controller = this.discovery = new AbortController();
        try { return await discover({ server: options?.server, signal: controller.signal }); }
        finally { if (this.discovery === controller) this.discovery = null; }
      }
      case 'start': return this.start(options);
      case 'reserve': return this.reserve(options);
      case 'join': return this.join(options);
      case 'activate': return this.activate(options?.id);
      case 'read': return this.read(options?.id);
      case 'send': return this.send(options?.id, options?.data);
      case 'close': return this.close(options?.id);
      case 'stop': return this.stop();
      default: throw new Error('Invalid direct network operation.');
    }
  }
}
module.exports = { DirectNetwork, host, port };
