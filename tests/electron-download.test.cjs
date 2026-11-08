'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const project = require('../package.json');
const filename = path.join(__dirname, '../scripts/ci-builder-config.cjs'), source = fs.readFileSync(filename, 'utf8');
function load({ platform = 'darwin', arch = 'arm64', version = project.devDependencies.electron, runtimeVersion = version, fileSystem = fs, runtimeError } = {}) {
  const root = path.join(os.tmpdir(), 'controlled-electron-module'), metadata = path.join(root, 'package.json');
  const scopedRequire = name => name === '../package.json' ? project : name === 'electron/package.json' ? { version } : name === 'node:fs' ? { ...fileSystem, readFileSync(file, ...args) { if (file === path.join(root, 'dist', 'version')) { if (runtimeError) throw runtimeError; return runtimeVersion; } return fileSystem.readFileSync(file, ...args); } } : require(name);
  scopedRequire.resolve = name => { assert.equal(name, 'electron/package.json'); return metadata; };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: scopedRequire, __dirname: path.dirname(filename), process: { platform, arch } }, { filename });
  return { config: module.exports, dist: path.join(root, 'dist') };
}
test('CI preserves existing package options and selects the installed matching runtime for all six native targets', () => {
  for (const platform of ['darwin', 'linux', 'win32']) for (const arch of ['arm64', 'x64']) {
    const { config, dist } = load({ platform, arch }), { electronDist, afterExtract, ...rest } = config;
    assert.deepEqual(rest, project.build); assert.equal(typeof afterExtract, 'function');
    assert.equal(electronDist({ platformName: platform, arch }), dist);
    assert.equal(config.electronDownload, undefined, 'No second Electron archive download or checksum bypass is configured.');
  }
});
test('CI refuses a mismatched package/runtime version, missing runtime or cross-platform/architecture target', () => {
  assert.throws(() => load({ version: '0.0.0' }), /locked Electron version/);
  const missing = Object.assign(new Error('missing runtime'), { code: 'ENOENT' });
  assert.throws(() => load({ runtimeError: missing }).config.electronDist({ platformName: 'darwin', arch: 'arm64' }), error => error === missing);
  const { config } = load();
  assert.throws(() => config.electronDist({ platformName: 'win32', arch: 'arm64' }), /native platform/);
  assert.throws(() => config.electronDist({ platformName: 'darwin', arch: 'x64' }), /native architecture/);
  assert.throws(() => load({ runtimeVersion: '0.0.0' }).config.electronDist({ platformName: 'darwin', arch: 'arm64' }), /runtime must match/);
  assert.equal(load({ runtimeVersion: 'v' + project.devDependencies.electron + '\n' }).config.electronDist({ platformName: 'darwin', arch: 'arm64' }).endsWith('dist'), true);
});
test('CI custom-runtime cleanup removes only default startup files, retains game/source files before packaging integrity metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-runtime-cleanup-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const platform of ['darwin', 'linux', 'win32']) {
    const output = path.join(root, platform), resources = platform === 'darwin' ? path.join(output, 'Electron.app/Contents/Resources') : path.join(output, 'resources'); fs.mkdirSync(resources, { recursive: true });
    for (const name of ['default_app.asar', 'app.asar', 'hero.png']) fs.writeFileSync(path.join(resources, name), name);
    fs.writeFileSync(path.join(output, 'version'), project.devDependencies.electron);
    const context = { electronPlatformName: platform, appOutDir: output, packager: { info: { framework: { distMacOsAppName: 'Electron.app' } } } };
    const { config } = load(); config.afterExtract(context);
    assert.equal(config.afterPack, project.build.afterPack);
    assert.equal(fs.existsSync(path.join(resources, 'default_app.asar')), false);
    assert.equal(fs.existsSync(path.join(output, 'version')), false);
    assert.equal(fs.readFileSync(path.join(resources, 'app.asar'), 'utf8'), 'app.asar'); assert.equal(fs.readFileSync(path.join(resources, 'hero.png'), 'utf8'), 'hero.png');
    config.afterExtract(context);
  }
});
test('CI cleanup refuses directories instead of recursively deleting unexpected content', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-runtime-failure-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const blocked = path.join(root, 'resources/default_app.asar'); fs.mkdirSync(blocked, { recursive: true });
  fs.writeFileSync(path.join(root, 'version'), 'must remain after failed cleanup');
  const context = { electronPlatformName: 'linux', appOutDir: root }, { config } = load();
  assert.throws(() => config.afterExtract(context)); assert.equal(fs.statSync(blocked).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(root, 'version'), 'utf8'), 'must remain after failed cleanup');
});
