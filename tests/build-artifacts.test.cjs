'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { collectBuild } = require('../scripts/collect-build.cjs');
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
    'linux-x64': [`PolyCraft-Offline-${version}-linux-x86_64.AppImage`, `PolyCraft-Offline-${version}-linux-x64.tar.gz`]
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
  assert.throws(() => collectBuild('linux-x64', output, destination), /ENOENT/);
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
