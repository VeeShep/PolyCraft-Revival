'use strict';
const { createHmac, randomUUID } = require('node:crypto');
const { validateIceServers } = require('../desktop/multiplayer.js');
function createTurnIssuer({ urls, secret, ttl = 21600 } = {}) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024 || !Number.isInteger(ttl) || ttl < 60 || ttl > 21600) throw new Error('Invalid TURN secret or lifetime.');
  const servers = validateIceServers([{ urls, username: 'validation', credential: 'validation' }]);
  if (!servers[0].urls.every(url => /^turns?:/.test(url))) throw new Error('TURN issuer requires only TURN URLs.');
  return roomExpiry => {
    const expires = Math.floor(Math.min(Date.now() + ttl * 1000, roomExpiry) / 1000);
    if (!Number.isSafeInteger(expires) || expires * 1000 < Date.now() + 30000) return null;
    const username = expires + ':' + randomUUID(), credential = createHmac('sha1', secret).update(username).digest('base64');
    return { expires: expires * 1000, iceServers: [{ urls: [...servers[0].urls], username, credential }] };
  };
}
module.exports = { createTurnIssuer };
