'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build, devDependencies } = require('../package.json');
const installed = require('electron/package.json');
assert.equal(installed.version, devDependencies.electron, 'Build with the locked Electron version.');
const dist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
assert.equal(fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, ''), installed.version, 'The installed Electron runtime must match the lock.');
module.exports = { ...build,
  electronDist: dist,
  beforePack: ({ electronPlatformName, arch }) => {
    assert.equal(electronPlatformName, process.platform, 'CI must package its native platform.');
    const target = require('builder-util').Arch[arch];
    assert.ok(target === process.arch || process.platform === 'darwin' && process.arch === 'x64' && target === 'arm64', 'CI must package its native architecture or the Intel Mac to ARM Mac target.');
    if (electronPlatformName === 'darwin') assert.equal(execFileSync('lipo', ['-archs', path.join(dist, 'Electron.app/Contents/MacOS/Electron')], { encoding: 'utf8' }).trim(), target === 'x64' ? 'x86_64' : target, 'Installed Electron runtime architecture must match the target.');
  },
  afterExtract: context => {
    const resources = context.electronPlatformName === 'darwin' ? path.join(context.appOutDir, context.packager.info.framework.distMacOsAppName, 'Contents', 'Resources') : path.join(context.appOutDir, 'resources');
    // Custom electronDist skips these two removals in the pinned builder's normal cleanup.
    fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
    fs.rmSync(path.join(context.appOutDir, 'version'), { force: true });
  }
};
