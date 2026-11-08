'use strict';
const assert = require('node:assert/strict');
const { build, devDependencies } = require('../package.json');
assert.equal(require('electron/package.json').version, devDependencies.electron, 'Build with the locked Electron version.');
module.exports = { ...build, electronDownload: {
  // Preserve checksums through both builder adapters without forcing downloads or bypassing validation.
  force: false, checksums: require('electron/checksums.json')
} };
