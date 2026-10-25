'use strict';
const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const protocol = require('./room-protocol.js');
class RoomSocket {
  constructor(emit) { this.emit = emit; }
  async open(options) {
    if (this.socket) throw new Error('Close the current room connection first.');
    const url = protocol.serverUrl(options?.url), room = protocol.roomName(options?.room), password = protocol.password(options?.password);
    if (!['create', 'join'].includes(options.type) || typeof options.runtime !== 'string' || options.runtime.length > 80 || (options.type === 'join' && (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 80))) throw new Error('Invalid room connection settings.');
    const id = this.id = randomUUID(), socket = this.socket = new WebSocket(url, { handshakeTimeout: 8000, maxPayload: protocol.MAX_MESSAGE, perMessageDeflate: false });
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => { reject(new Error('Room server timed out. Check its address and try again.')); this.close(); }, 10000);
      socket.on('open', () => { socket.send(JSON.stringify({ v: protocol.VERSION, type: options.type, room, password, runtime: options.runtime, ...(options.type === 'join' ? { name: options.name, relay: options.relay === true } : {}) })); });
      socket.on('error', () => { if (!ready) { reject(new Error('Cannot reach the room server. Check its address, connection and TLS certificate.')); this.close(); } });
      socket.on('message', (bytes, binary) => {
        try {
          const message = JSON.parse(bytes.toString());
          if (binary || !message || message.v !== protocol.VERSION || !['created', 'joined', 'request', 'signal', 'left', 'room-ended', 'error'].includes(message.type)) throw new Error('Invalid room server reply.');
          if (message.type === 'signal') protocol.signal(message);
          if (message.type === 'error') throw new Error(typeof message.message === 'string' ? message.message.slice(0, 256) : 'Room server rejected the request.');
          if (!ready) {
            if (message.type !== (options.type === 'create' ? 'created' : 'joined') || message.room !== room) throw new Error('Unexpected room server reply.');
            ready = true; clearTimeout(timer); resolve({ id, room });
          } else this.emit({ ...message, connectionId: id });
        } catch (error) { if (!ready) reject(error); else this.emit({ connectionId: id, type: 'error', message: error.message }); this.close(); }
      });
      socket.on('close', () => {
        clearTimeout(timer); if (this.socket === socket) this.socket = null;
        if (!ready) reject(new Error('Room connection ended before joining.'));
        this.emit({ connectionId: id, type: 'closed' });
      });
    });
  }
  send(options) {
    if (!this.socket || options?.id !== this.id || this.socket.readyState !== 1) throw new Error('The room server is disconnected.');
    protocol.signal(options);
    const message = JSON.stringify({ v: protocol.VERSION, type: 'signal', kind: options.kind, data: options.data, ...(options.to ? { to: options.to } : {}) });
    if (Buffer.byteLength(message) > protocol.MAX_MESSAGE || this.socket.bufferedAmount > 512 * 1024) throw new Error('Room connection is too busy.');
    return new Promise((resolve, reject) => this.socket.send(message, error => error ? reject(error) : resolve()));
  }
  close() { const socket = this.socket; this.socket = null; socket?.terminate(); }
  request(operation, options) {
    if (operation === 'open') return this.open(options);
    if (operation === 'send') return this.send(options);
    if (operation === 'close') return this.close();
    throw new Error('Invalid room socket operation.');
  }
}
module.exports = { RoomSocket };
