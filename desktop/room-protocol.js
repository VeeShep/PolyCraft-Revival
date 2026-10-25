'use strict';
(function (root) {
  const VERSION = 1, MAX_MESSAGE = 192 * 1024;
  function roomName(value) {
    if (typeof value !== 'string') throw new Error('Enter a room name.');
    const name = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,47}$/.test(name)) throw new Error('Use 3–48 letters, numbers, dashes or underscores for the room name.');
    return name;
  }
  function password(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128 || !value.trim()) throw new Error('Use a room password of 8–128 characters. Spaces and capitals count.');
    return value;
  }
  function serverUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a room server address of at most 2048 characters.');
    let url; try { url = new URL(value); } catch { throw new Error('Enter the room server address, beginning with wss://.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'wss:' || (url.protocol === 'ws:' && loopback)) || url.username || url.password || url.search || url.hash) throw new Error('Use wss:// for room servers; ws:// is allowed only on this computer.');
    return url.href;
  }
  function signal(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['offer', 'answer', 'candidate', 'reject'].includes(value.kind)) throw new Error('Invalid room connection message.');
    if (value.kind === 'candidate') {
      const c = value.data;
      if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => !['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'].includes(k)) ||
        typeof c.candidate !== 'string' || c.candidate.length > 2048 || !c.candidate.startsWith('candidate:') ||
        (c.sdpMid != null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 256)) ||
        (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 65535)) ||
        (c.usernameFragment != null && (typeof c.usernameFragment !== 'string' || c.usernameFragment.length > 256))) throw new Error('Invalid room ICE candidate.');
    } else if (typeof value.data !== 'string' || !value.data.length || value.data.length > (value.kind === 'reject' ? 256 : 128 * 1024)) throw new Error('Invalid room offer, reply or rejection.');
    return value;
  }
  const api = { VERSION, MAX_MESSAGE, roomName, password, serverUrl, signal };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftRoomProtocol = api;
})(globalThis);
