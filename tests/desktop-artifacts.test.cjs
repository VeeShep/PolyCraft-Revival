'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const asar = require('@electron/asar'), resedit = require('resedit');
const { verifyWindows, verifyLinux } = require('../scripts/verify-desktop.cjs');
const metadata = require('../package.json'), root = path.resolve(__dirname, '..');
function pe(arch, icon = 'original') {
  const executable = resedit.NtExecutable.createEmpty(false, false); executable.newHeader.fileHeader.machine = arch === 'arm64' ? 0xaa64 : 0x8664;
  const resources = resedit.NtExecutableResource.from(executable);
  if (icon !== 'missing') {
    const images = resedit.Data.IconFile.from(fs.readFileSync(path.join(root, 'assets/offline-ui/icons/icon.ico'))).icons.map(item => item.data);
    if (icon === 'changed') new Uint8Array(images[0].bin)[100] ^= 1;
    resedit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, images);
  }
  resources.outputResource(executable); return Buffer.from(executable.generate());
}
function elf(arch) {
  const header = Buffer.alloc(64); header.set([127, 69, 76, 70, 2, 1, 1]); header.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18); header.writeUInt16LE(64, 52); return header;
}
async function fixture(t, platform, arch) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-desktop-artifacts-')); t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'app'), source = path.join(parent, 'source'); fs.mkdirSync(path.join(directory, 'resources'), { recursive: true }); fs.mkdirSync(source);
  for (const name of ['game.canvas.js', 'assets/offline-ui/icons/png/512x512.png']) {
    const target = path.join(source, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, name), target);
  }
  fs.cpSync(path.join(root, 'desktop'), path.join(source, 'desktop'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: metadata.version, name: metadata.name, productName: metadata.productName, main: metadata.main, type: metadata.type }));
  const archive = path.join(directory, 'resources/app.asar'); await asar.createPackage(source, archive);
  const binary = platform === 'win32' ? pe(arch) : elf(arch), executable = path.join(directory, platform === 'win32' ? metadata.productName + '.exe' : metadata.name);
  fs.writeFileSync(executable, binary); fs.mkdirSync(path.join(directory, 'helpers')); const helper = path.join(directory, 'helpers', platform === 'win32' ? 'helper.dll' : 'helper.so'); fs.writeFileSync(helper, binary);
  const desktop = path.join(directory, metadata.desktopName), text = `[Desktop Entry]\nName=${metadata.productName}\nType=Application\nExec=AppRun --no-sandbox %U\nIcon=${metadata.name}\nStartupWMClass=polycraft-offline\n`;
  fs.writeFileSync(desktop, text);
  for (const name of [metadata.name + '.png', '.DirIcon']) fs.copyFileSync(path.join(root, 'assets/offline-ui/icons/png/512x512.png'), path.join(directory, name));
  return { directory, source, archive, executable, helper, binary, desktop, text };
}
test('Windows package checks inspect x64/ARM64 executables and nested libraries, primary icon resources and packaged source', async t => {
  for (const arch of ['x64', 'arm64']) { const f = await fixture(t, 'win32', arch); assert.equal(verifyWindows(f.directory, arch), 2); }
});
test('Windows package checks reject mixed architectures, invalid PE headers, missing primary executables and default/missing icon resources', async t => {
  const f = await fixture(t, 'win32', 'x64');
  fs.writeFileSync(f.helper, pe('arm64')); assert.throws(() => verifyWindows(f.directory, 'x64'), /Wrong architecture/); fs.writeFileSync(f.helper, f.binary);
  fs.writeFileSync(f.executable, Buffer.from('not a Windows executable')); assert.throws(() => verifyWindows(f.directory, 'x64'), /Invalid PE/);
  for (const icon of ['changed', 'missing']) { fs.writeFileSync(f.executable, pe('x64', icon)); assert.throws(() => verifyWindows(f.directory, 'x64'), /icon/); }
  fs.unlinkSync(f.executable); assert.throws(() => verifyWindows(f.directory, 'x64'), /Missing Windows executable/);
  assert.throws(() => verifyWindows(f.directory, 'constructor'), /Unsupported/);
});
test('Linux portable/AppImage checks inspect x64/ARM64 ELF files, packaged window icon and original desktop association', async t => {
  for (const arch of ['x64', 'arm64']) { const f = await fixture(t, 'linux', arch); assert.equal(verifyLinux(f.directory, arch), 2); assert.equal(verifyLinux(f.directory, arch, true), 2); }
});
test('Linux checks reject mixed/truncated binaries, missing executable, mismatched desktop fields and both incorrect launcher icons', async t => {
  const f = await fixture(t, 'linux', 'arm64');
  fs.writeFileSync(f.helper, elf('x64')); assert.throws(() => verifyLinux(f.directory, 'arm64'), /Wrong architecture/);
  fs.writeFileSync(f.helper, elf('arm64').subarray(0, 20)); assert.throws(() => verifyLinux(f.directory, 'arm64'), /Expected 64-bit/); fs.writeFileSync(f.helper, f.binary);
  fs.unlinkSync(f.executable); assert.throws(() => verifyLinux(f.directory, 'arm64'), /Missing Linux ELF/); fs.writeFileSync(f.executable, f.binary);
  for (const text of [f.text.replace('Icon=polycraft-offline', 'Icon=electron'), f.text.replace('Exec=AppRun --no-sandbox %U', 'Exec=wrong-app'), f.text.replace('StartupWMClass=polycraft-offline', 'StartupWMClass=Electron'), f.text + 'Icon=polycraft-offline\n']) {
    fs.writeFileSync(f.desktop, text); assert.throws(() => verifyLinux(f.directory, 'arm64', true), /desktop|launcher/);
  }
  fs.writeFileSync(f.desktop, f.text);
  for (const name of [metadata.name + '.png', '.DirIcon']) {
    const file = path.join(f.directory, name), original = fs.readFileSync(file); fs.writeFileSync(file, 'default Electron icon');
    assert.throws(() => verifyLinux(f.directory, 'arm64', true), /desktop icon differs/); fs.writeFileSync(file, original);
  }
});
test('package checks refuse stale metadata or game/icon bytes in the finished app.asar', async t => {
  const f = await fixture(t, 'linux', 'x64');
  fs.writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({ version: '1.0.0-beta.1' })); await asar.createPackage(f.source, f.archive);
  assert.throws(() => verifyLinux(f.directory, 'x64'), /version differs/);
  fs.writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({ version: metadata.version, name: metadata.name, productName: metadata.productName, main: metadata.main, type: metadata.type }));
  for (const name of ['game.canvas.js', 'assets/offline-ui/icons/png/512x512.png']) {
    const file = path.join(f.source, name), original = fs.readFileSync(file); fs.writeFileSync(file, 'stale packaged bytes'); await asar.createPackage(f.source, f.archive);
    assert.throws(() => verifyLinux(f.directory, 'x64'), /source\/icon differs/); fs.writeFileSync(file, original);
  }
});
test('package source verification rejects stale desktop modules, launcher markup, styles and missing files', async t => {
  const f = await fixture(t, 'linux', 'x64');
  for (const name of ['coop-input.js', 'saves.cjs', 'controls.js', 'guest-world.js', 'index.html', 'style.css']) {
    const file = path.join(f.source, 'desktop', name), original = fs.readFileSync(file);
    fs.writeFileSync(file, 'stale desktop module'); await asar.createPackage(f.source, f.archive);
    assert.throws(() => verifyLinux(f.directory, 'x64'), /Packaged source\/icon differs: desktop/, name);
    fs.writeFileSync(file, original);
  }
  fs.unlinkSync(path.join(f.source, 'desktop/saves.cjs')); await asar.createPackage(f.source, f.archive);
  assert.throws(() => verifyLinux(f.directory, 'x64'), /saves\.cjs|not found/);
});
test('source verification refuses unsupported desktop source entries instead of silently skipping them', async t => {
  const f = await fixture(t, 'linux', 'x64'), read = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (directory, options) {
    if (path.resolve(directory) === path.join(root, 'desktop')) return [{ name: 'unsupported.js', isDirectory: () => false, isFile: () => false }];
    return read.call(this, directory, options);
  });
  assert.throws(() => verifyLinux(f.directory, 'x64'), /Unsupported desktop source entry/);
});
test('desktop source verification refuses unexpected archive files and source links', async t => {
  const f = await fixture(t, 'linux', 'x64'), extra = path.join(f.source, 'desktop/obsolete.js');
  fs.writeFileSync(extra, 'obsolete packaged module'); await asar.createPackage(f.source, f.archive);
  assert.throws(() => verifyLinux(f.directory, 'x64'), /Packaged desktop entries differ/);
  fs.unlinkSync(extra);
  const input = path.join(f.source, 'desktop/coop-input.js'); fs.unlinkSync(input); fs.symlinkSync('../game.canvas.js', input);
  await asar.createPackage(f.source, f.archive);
  assert.throws(() => verifyLinux(f.directory, 'x64'), /Packaged source link/);
});
test('source verification rejects changed application identity, entry point or JavaScript module type', async t => {
  const f = await fixture(t, 'linux', 'x64'), file = path.join(f.source, 'package.json'), original = JSON.parse(fs.readFileSync(file));
  for (const [key, value] of [['name', 'other-game'], ['productName', 'Electron'], ['main', 'desktop/bridge.js'], ['type', 'module']]) {
    fs.writeFileSync(file, JSON.stringify({ ...original, [key]: value })); await asar.createPackage(f.source, f.archive);
    assert.throws(() => verifyLinux(f.directory, 'x64'), /Packaged (name|productName|main|type) differs/, key);
  }
});
test('Windows-style Git checkout keeps packaged source LF and preserves reference/asset bytes exactly', t => {
  const { execFileSync } = require('node:child_process'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-checkout-lines-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.copyFileSync(path.join(root, '.gitattributes'), path.join(directory, '.gitattributes'));
  const files = { 'game.canvas.js': Buffer.from('function original() {\n return "unchanged";\n}\n'), 'desktop/main.cjs': Buffer.from('module.exports = {};\n'), 'reference/beta-1/game.canvas.js': Buffer.from('original\r\nreference\r\n'), 'assets/legacy.json': Buffer.from('{\r\n "original":true\r\n}\r\n') };
  for (const [name, bytes] of Object.entries(files)) { const target = path.join(directory, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
  const git = args => execFileSync('git', ['-c', 'core.autocrlf=true', ...args], { cwd: directory, stdio: 'pipe' });
  git(['init', '-q']); git(['add', '.gitattributes', ...Object.keys(files)]);
  const output = path.join(directory, 'checkout'); git(['checkout-index', '--all', '--prefix=' + output + path.sep]);
  for (const [name, bytes] of Object.entries(files)) assert.deepEqual(fs.readFileSync(path.join(output, name)), bytes, 'Checkout changed bytes: ' + name);
});
