'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { build, devDependencies } = require('../package.json');
const installed = require('electron/package.json');
assert.equal(installed.version, devDependencies.electron, 'Build with the locked Electron version.');
const dist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
assert.equal(fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, ''), installed.version, 'The installed Electron runtime must match the lock.');
module.exports = { ...build,
  electronDist: dist,
  beforePack: ({ electronPlatformName, arch }) => {
    assert.equal(electronPlatformName, process.platform, 'CI must package its native platform.');
    assert.equal(require('builder-util').Arch[arch], process.arch, 'CI must package its native architecture.');
  },
  afterExtract: context => {
    const resources = context.electronPlatformName === 'darwin' ? path.join(context.appOutDir, context.packager.info.framework.distMacOsAppName, 'Contents', 'Resources') : path.join(context.appOutDir, 'resources');
    // Custom electronDist skips these two removals in the pinned builder's normal cleanup.
    fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
    fs.rmSync(path.join(context.appOutDir, 'version'), { force: true });
  }
};
