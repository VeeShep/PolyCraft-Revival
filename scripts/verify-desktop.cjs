'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const asar = require('@electron/asar'), resedit = require('resedit');
const root = path.resolve(__dirname, '..'), metadata = require('../package.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function verifyBinaries(directory, platform, arch) {
  assert.ok(['x64', 'arm64'].includes(arch), 'Unsupported target architecture.');
  const expected = platform === 'win32' ? { x64: 0x8664, arm64: 0xaa64 }[arch] : { x64: 62, arm64: 183 }[arch];
  const binaries = new Set();
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile()) continue;
      const header = Buffer.alloc(64), fd = fs.openSync(file, 'r');
      try {
        const length = fs.readSync(fd, header, 0, 64, 0);
        if (platform === 'win32' && (header.toString('ascii', 0, 2) === 'MZ' || /\.(exe|dll|node)$/i.test(entry.name))) {
          assert.ok(length === 64 && header.toString('ascii', 0, 2) === 'MZ', 'Invalid PE header: ' + file);
          const offset = header.readUInt32LE(60), pe = Buffer.alloc(26);
          assert.ok(offset >= 64 && fs.readSync(fd, pe, 0, pe.length, offset) === pe.length && pe.readUInt32LE(0) === 0x4550 && pe.readUInt16LE(24) === 0x20b, 'Invalid 64-bit PE signature: ' + file);
          assert.equal(pe.readUInt16LE(4), expected, 'Wrong architecture: ' + file); binaries.add(path.resolve(file));
        } else if (platform !== 'win32' && header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) {
          assert.ok(length === 64 && header[4] === 2 && header[5] === 1 && header[6] === 1 && header.readUInt16LE(52) === 64, 'Expected 64-bit little-endian ELF: ' + file);
          assert.equal(header.readUInt16LE(18), expected, 'Wrong architecture: ' + file); binaries.add(path.resolve(file));
        }
      } finally { fs.closeSync(fd); }
    }
  }
  visit(directory); assert.ok(binaries.size > 0, 'No platform executables found.'); return binaries;
}
function verifySource(directory) {
  const archive = path.join(directory, 'resources/app.asar');
  asar.uncache(archive);
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, metadata.version, 'Packaged version differs.');
  for (const file of ['game.canvas.js', 'desktop/main.cjs', 'desktop/multiplayer.js', 'assets/offline-ui/icons/png/512x512.png']) assert.equal(digest(asar.extractFile(archive, path.normalize(file))), digest(fs.readFileSync(path.join(root, file))), 'Packaged source/icon differs: ' + file);
}
function verifyWindows(directory, arch) {
  const binaries = verifyBinaries(directory, 'win32', arch), executable = path.join(directory, metadata.productName + '.exe');
  assert.ok(binaries.has(path.resolve(executable)), 'Missing Windows executable.');
  const image = resedit.NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true }), resources = resedit.NtExecutableResource.from(image);
  const signature = icon => { assert.ok(icon.isRaw(), 'Expected original PNG icon data.'); return `${icon.width || 256}x${icon.height || 256}:${digest(Buffer.from(icon.bin))}`; };
  const expected = resedit.Data.IconFile.from(fs.readFileSync(path.join(root, 'assets/offline-ui/icons/icon.ico'))).icons.map(item => signature(item.data)).sort();
  const groups = resedit.Resource.IconGroupEntry.fromEntries(resources.entries).filter(group => group.id === 1);
  assert.ok(groups.length > 0, 'Missing primary Windows icon group.');
  for (const group of groups) {
    assert.equal(group.icons.length, expected.length, 'Incomplete Windows icon group.');
    for (const icon of group.icons) {
      const entries = resources.entries.filter(entry => entry.type === 3 && entry.id === icon.iconID && entry.lang === group.lang);
      assert.ok(entries.length === 1 && entries[0].bin.byteLength === icon.dataSize, 'Missing or invalid Windows icon image.');
    }
    assert.deepEqual(group.getIconItemsFromEntries(resources.entries).map(signature).sort(), expected, 'Windows executable icon differs from approved hero badge.');
  }
  verifySource(directory); return binaries.size;
}
function verifyLinux(directory, arch, appImage = false) {
  const binaries = verifyBinaries(directory, 'linux', arch);
  assert.ok(binaries.has(path.resolve(directory, metadata.name)), 'Missing Linux ELF executable.');
  verifySource(directory);
  if (appImage) {
    const desktop = fs.readFileSync(path.join(directory, metadata.desktopName), 'utf8'), fields = new Map(); let active = false;
    for (const line of desktop.split(/\r?\n/)) {
      if (/^\[.*\]$/.test(line)) { active = line === '[Desktop Entry]'; continue; }
      const match = active && /^([^=#]+)=(.*)$/.exec(line);
      if (match) { assert.ok(!fields.has(match[1]), 'Duplicate desktop-entry field.'); fields.set(match[1], match[2]); }
    }
    for (const [key, value] of [['Name', metadata.productName], ['Type', 'Application'], ['Icon', metadata.name], ['StartupWMClass', metadata.desktopName.replace(/\.desktop$/, '')]]) assert.equal(fields.get(key), value, 'Wrong Linux desktop-entry ' + key);
    assert.match(fields.get('Exec') || '', /^AppRun(?: --no-sandbox)? %U$/, 'Wrong AppImage desktop launcher.');
    const approved = [512, 1024].map(size => digest(fs.readFileSync(path.join(root, `assets/offline-ui/icons/png/${size}x${size}.png`))));
    for (const file of [metadata.name + '.png', '.DirIcon']) assert.ok(approved.includes(digest(fs.readFileSync(path.join(directory, file)))), 'AppImage desktop icon differs from approved hero badge: ' + file);
  }
  return binaries.size;
}
if (require.main === module) {
  try {
    const [directory, platform, arch, ...extra] = process.argv.slice(2);
    assert.ok(directory && ['win32', 'linux', 'appimage'].includes(platform) && !extra.length, 'Usage: node scripts/verify-desktop.cjs DIRECTORY win32|linux|appimage x64|arm64');
    const count = platform === 'win32' ? verifyWindows(directory, arch) : verifyLinux(directory, arch, platform === 'appimage');
    console.log(`Verified ${count} ${platform}/${arch} binaries, packaged source/version and original hero icons.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyWindows, verifyLinux };
