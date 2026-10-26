'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { productName } = require('../package.json');
const magic = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
function verifyMacApp(app, arch, run = execFileSync) {
  const expected = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x86_64' : null;
  assert.ok(expected, 'Unsupported Mac target architecture.');
  const binaries = new Set();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const header = Buffer.alloc(4), descriptor = fs.openSync(file, 'r');
        try { fs.readSync(descriptor, header, 0, 4, 0); } finally { fs.closeSync(descriptor); }
        if (magic.has(header.toString('hex'))) {
          const found = run('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/);
          assert.deepEqual(found, [expected], 'Wrong architecture in ' + file);
          binaries.add(path.resolve(file));
        }
      }
    }
  }
  visit(path.join(app, 'Contents'));
  for (const relative of ['MacOS/' + productName, 'Frameworks/Electron Framework.framework/Versions/A/Electron Framework']) assert.ok(binaries.has(path.resolve(app, 'Contents', relative)), 'Missing Mach-O executable: ' + relative);
  run('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  return binaries.size;
}
if (require.main === module) {
  try {
    const [app, arch, ...extra] = process.argv.slice(2);
    if (!app || !arch || extra.length) throw new Error('Usage: node scripts/verify-mac.cjs APP ARCH');
    console.log('Verified Mac signature and', verifyMacApp(app, arch), arch, 'Mach-O files.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyMacApp };
