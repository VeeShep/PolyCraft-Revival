'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createLogger(directory) {
  const file = path.join(directory, 'game.log');
  return (event, details = {}) => {
    // Diagnostics must never interrupt gameplay or saving, even on a full disk.
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size >= 1024 * 1024) {
        fs.rmSync(file + '.previous', { force: true });
        fs.renameSync(file, file + '.previous');
      }
      const text = JSON.stringify(details);
      fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), event, details: text.length > 8192 ? { truncated: text.slice(0, 8192) } : details }) + '\n', { mode: 0o600 });
    } catch { /* Keep the last successful save usable if diagnostics cannot be written. */ }
  };
}
module.exports = { createLogger };
