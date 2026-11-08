'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const config = require('../scripts/ci-builder-config.cjs'), project = require('../package.json'), checksums = require('electron/checksums.json');
const get = require('@electron/get');
function folder(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-electron-download-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('CI retains existing package options and refuses an installed Electron version different from the exact project pin', () => {
  const { electronDownload, ...rest } = config; assert.deepEqual(rest, project.build);
  assert.equal(electronDownload.checksums, checksums); assert.equal(electronDownload.force, false);
  const source = fs.readFileSync(path.join(__dirname, '../scripts/ci-builder-config.cjs'), 'utf8');
  const context = { module: { exports: {} }, require(name) { return name === 'electron/package.json' ? { version: '0.0.0' } : require(name === '../package.json' ? '../package.json' : name); } };
  assert.throws(() => vm.runInNewContext(source, context), /Build with the locked Electron version/);
});
test('actual pinned builder forwards the official table for all six targets; checksum-only legacy options lose it', async t => {
  const dir = folder(t), zip = path.join(dir, 'download.zip'); fs.writeFileSync(zip, 'controlled downloader fixture');
  const seen = [];
  const download = async options => {
    if (!options.checksums) throw new Error('Remote checksum lookup is unavailable.');
    assert.equal(options.checksums, checksums); assert.notEqual(options.unsafelyDisableChecksums, true); seen.push(options); return zip;
  };
  const file = require.resolve('app-builder-lib/out/util/electronGet.js'), localRequire = require('node:module').createRequire(file), loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: loaded, exports: loaded.exports, process, console, Buffer, setTimeout, clearTimeout, require: name => name === '@electron/get' ? { ...get, downloadArtifact: download } : localRequire(name) }, { filename: file });
  const { downloadElectronArtifactZip } = loaded.exports;
  const outerSource = fs.readFileSync(require.resolve('app-builder-lib/out/electron/ElectronFramework.js'), 'utf8');
  const parsed = require('@babel/parser').parse(outerSource), adapter = parsed.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'createDownloadOpts');
  assert.ok(adapter, 'The pinned outer framework download adapter must be inspected.');
  const adapt = vm.runInNewContext('(' + outerSource.slice(adapter.start, adapter.end) + ')');
  const base = { version: project.devDependencies.electron, artifactName: 'electron', cacheDir: path.join(dir, 'cache') };
  await assert.rejects(downloadElectronArtifactZip({ ...base, platformName: 'darwin', arch: 'arm64', electronDownload: { checksums } }), /Remote checksum lookup is unavailable/);
  await assert.rejects(downloadElectronArtifactZip({ ...base, platformName: 'darwin', arch: 'arm64', electronDownload: adapt({ electronDownload: { mirrorOptions: {}, checksums } }, 'darwin', 'arm64', base.version) }), /Remote checksum lookup is unavailable/);
  for (const platformName of ['darwin', 'win32', 'linux']) for (const arch of ['arm64', 'x64']) {
    const file = `electron-v${base.version}-${platformName}-${arch}.zip`; assert.match(checksums[file], /^[a-f0-9]{64}$/);
    assert.equal(await downloadElectronArtifactZip({ ...base, platformName, arch, electronDownload: adapt(config, platformName, arch, base.version) }), zip);
  }
  assert.equal(seen.length, 6);
});
test('real Electron downloader avoids remote checksum fetch with a supplied table and still rejects corrupted bytes', async t => {
  const dir = folder(t), payload = Buffer.from('controlled Electron archive bytes'), calls = [];
  const file = `electron-v${project.devDependencies.electron}-linux-x64.zip`;
  const downloader = { async download(url, destination) { calls.push(url); if (url.endsWith('SHASUMS256.txt')) throw new Error('Remote checksums unavailable'); await fs.promises.writeFile(destination, payload); } };
  const options = { version: project.devDependencies.electron, artifactName: 'electron', platform: 'linux', arch: 'x64', force: true, downloader, cacheRoot: path.join(dir, 'cache') };
  await assert.rejects(get.downloadArtifact(options), /Remote checksums unavailable/);
  calls.length = 0;
  const supplied = { [file]: crypto.createHash('sha256').update(payload).digest('hex') };
  const archive = await get.downloadArtifact({ ...options, checksums: supplied });
  assert.deepEqual(fs.readFileSync(archive), payload); assert.equal(calls.length, 1); assert.ok(calls[0].endsWith(file));
  await assert.rejects(get.downloadArtifact({ ...options, checksums: { [file]: '0'.repeat(64) } }), /checksum|sha256/i);
});
