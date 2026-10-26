'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { collectBuild } = require('../scripts/collect-build.cjs');
const { verifyMacApp } = require('../scripts/verify-mac.cjs');
const { version } = require('../package.json');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-artifacts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'build'), destination = path.join(directory, 'download');
  fs.mkdirSync(output);
  return { directory, output, destination };
}
test('tester bundles include only the expected platform packages, provenance, instructions and matching hashes', t => {
  const { output, directory } = fixture(t);
  const archives = {
    'mac-arm64': [`PolyCraft-Offline-${version}-mac-arm64.zip`],
    'mac-x64': [`PolyCraft-Offline-${version}-mac-x64.zip`],
    'win-x64': [`PolyCraft-Offline-${version}-win-x64.zip`],
    'win-arm64': [`PolyCraft-Offline-${version}-win-arm64.zip`],
    'linux-arm64-appimage': [`PolyCraft-Offline-${version}-linux-arm64.AppImage`],
    'linux-arm64-tar.gz': [`PolyCraft-Offline-${version}-linux-arm64.tar.gz`],
    'linux-x64-appimage': [`PolyCraft-Offline-${version}-linux-x86_64.AppImage`],
    'linux-x64-tar.gz': [`PolyCraft-Offline-${version}-linux-x64.tar.gz`]
  };
  fs.writeFileSync(path.join(output, 'game.log'), 'Do not upload');
  fs.writeFileSync(path.join(output, 'island.json'), 'Do not upload');
  for (const [platform, names] of Object.entries(archives)) {
    for (const name of names) fs.writeFileSync(path.join(output, name), Buffer.from('package bytes for ' + name));
    const destination = path.join(directory, platform);
    collectBuild(platform, output, destination);
    assert.deepEqual(fs.readdirSync(destination).sort(), [...names, 'BUILD_INFO.json', 'START HERE.txt', 'SHA256SUMS.txt'].sort());
    const metadata = JSON.parse(fs.readFileSync(path.join(destination, 'BUILD_INFO.json')));
    assert.equal(metadata.version, version); assert.equal(metadata.platform, platform);
    assert.match(metadata.sourceCommit, /^[a-f0-9]{40}$/i);
    assert.match(metadata.gameplayAcceptance, /Not established/);
    assert.match(fs.readFileSync(path.join(destination, 'START HERE.txt'), 'utf8'), /fresh named island/);
    assert.match(fs.readFileSync(path.join(destination, 'START HERE.txt'), 'utf8'), /win-arm64 for Windows on Arm/);
    const lines = fs.readFileSync(path.join(destination, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    assert.equal(lines.length, names.length + 2);
    for (const line of lines) {
      const [hash, name] = line.split('  ');
      assert.equal(createHash('sha256').update(fs.readFileSync(path.join(destination, name))).digest('hex'), hash);
    }
  }
});
test('incomplete builds and unsupported platforms cannot produce a tester download', t => {
  const { output, destination } = fixture(t);
  assert.throws(() => collectBuild('constructor', output, destination), /Unknown/);
  assert.throws(() => collectBuild('linux-x64-appimage', output, destination), /ENOENT/);
  fs.writeFileSync(path.join(output, `PolyCraft-Offline-${version}-mac-arm64.zip`), '');
  assert.throws(() => collectBuild('mac-arm64', output, destination), /empty package/);
  assert.equal(fs.existsSync(destination), false);
});
test('collecting a build never overwrites an existing download bundle', t => {
  const { output, destination } = fixture(t);
  fs.writeFileSync(path.join(output, `PolyCraft-Offline-${version}-win-x64.zip`), 'new package');
  fs.mkdirSync(destination); fs.writeFileSync(path.join(destination, 'keep.txt'), 'original');
  assert.throws(() => collectBuild('win-x64', output, destination), /overwrite/);
  assert.deepEqual(fs.readdirSync(destination), ['keep.txt']);
  assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'original');
});
function macFixture(t) {
  const { directory } = fixture(t), app = path.join(directory, 'PolyCraft Offline.app');
  const files = ['MacOS/PolyCraft Offline', 'Frameworks/Electron Framework.framework/Versions/A/Electron Framework', 'Frameworks/Helper.app/Contents/MacOS/Helper', 'Frameworks/libtest.dylib'];
  for (const file of files) { const target = path.join(app, 'Contents', file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, Buffer.from('cffaedfe00000000', 'hex')); }
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), 'not executable');
  return { app, files };
}
test('Mac artifact verification checks every executable and library against target arch before verifying the extracted signature', t => {
  const { app, files } = macFixture(t), calls = [];
  const run = (command, args) => { calls.push({ command, args }); return 'arm64\n'; };
  assert.equal(verifyMacApp(app, 'arm64', run), files.length);
  assert.equal(calls.filter(call => call.command === 'lipo').length, files.length);
  assert.deepEqual(calls.at(-1), { command: 'codesign', args: ['--verify', '--deep', '--strict', app] });
  assert.equal(verifyMacApp(app, 'x64', () => 'x86_64\n'), files.length);
  assert.throws(() => verifyMacApp(app, 'constructor', run), /Unsupported/);
});
test('Mac artifact verification refuses wrong or mixed architectures, missing framework and invalid signatures', t => {
  const { app } = macFixture(t); let signed = false;
  const wrong = (command, args) => { if (command === 'codesign') signed = true; return args.at(-1).endsWith('.dylib') ? 'x86_64' : 'arm64'; };
  assert.throws(() => verifyMacApp(app, 'arm64', wrong), /Wrong architecture/); assert.equal(signed, false);
  assert.throws(() => verifyMacApp(app, 'arm64', () => 'arm64 x86_64'), /Wrong architecture/);
  assert.throws(() => verifyMacApp(app, 'arm64', command => { if (command === 'codesign') throw new Error('Invalid signature'); return 'arm64'; }), /Invalid signature/);
  fs.unlinkSync(path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'));
  assert.throws(() => verifyMacApp(app, 'arm64', () => 'arm64'), /Missing Mach-O/);
});
