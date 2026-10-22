'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = context => {
  // Finder metadata on copied bundles invalidates otherwise valid ad-hoc signatures.
  if (context.electronPlatformName === 'darwin') {
    execFileSync('xattr', ['-dr', 'com.apple.FinderInfo', path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app')]);
  }
};
