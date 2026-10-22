'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const packages = {
  'mac-arm64': [`PolyCraft-Offline-${version}-mac-arm64.zip`],
  'mac-x64': [`PolyCraft-Offline-${version}-mac-x64.zip`],
  'win-x64': [`PolyCraft-Offline-${version}-win-x64.zip`],
  'linux-x64': [`PolyCraft-Offline-${version}-linux-x86_64.AppImage`, `PolyCraft-Offline-${version}-linux-x64.tar.gz`]
};
function collectBuild(platform, output, destination) {
  if (!Object.hasOwn(packages, platform)) throw new Error('Unknown build platform.');
  const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/i.test(revision) || !/^[0-9A-Za-z.-]+$/.test(version)) throw new Error('Invalid source revision or version.');
  const names = packages[platform];
  for (const name of names) {
    const file = fs.statSync(path.join(output, name));
    if (!file.isFile() || !file.size) throw new Error('Missing or empty package: ' + name);
  }
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('Refusing to overwrite an existing download bundle.');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(output, name), path.join(destination, name));
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const metadata = { version, platform, sourceCommit: revision, run, buildHost: { platform: process.platform, arch: process.arch }, gameplayAcceptance: 'Not established by CI; see RESTORATION_STATUS.md and playtester reports.' };
  fs.writeFileSync(path.join(destination, 'BUILD_INFO.json'), JSON.stringify(metadata, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'START HERE.txt'), `PolyCraft Offline ${version} — ${platform}
Development build from ${revision}

Mac: Extract the ZIP, move PolyCraft Offline.app to Applications, and open it.
Use mac-arm64 for Apple Silicon or mac-x64 for Intel. Mac builds are ad-hoc
signed and are not notarized.

Windows: Extract the entire ZIP and open PolyCraft Offline.exe. Keep all
supporting files together. Windows builds are unsigned.

Linux: Mark the AppImage executable and open it. Alternatively, extract the
tar.gz and run polycraft-offline inside its folder with all supporting files.

No Node.js installation or game account is needed to play.
Start with a fresh named island for testing. Export important islands before
opening them in a newer build: newer save formats may not open in older apps.
Normal autosave remains enabled. Playable multiplayer is still in development.

These are build artifacts, not a declaration that gameplay passed on your OS.
Source, current status and controls:
https://github.com/VeeShep/PolyCraft-Revival/blob/${revision}/README.md
https://github.com/VeeShep/PolyCraft-Revival/blob/${revision}/RESTORATION_STATUS.md
${run ? '\nBuild run: ' + run + '\n' : ''}`);
  const files = [...names, 'BUILD_INFO.json', 'START HERE.txt'].sort();
  const checksums = files.map(name => createHash('sha256').update(fs.readFileSync(path.join(destination, name))).digest('hex') + '  ' + name);
  fs.writeFileSync(path.join(destination, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
  return files;
}
if (require.main === module) {
  try {
    const [platform, output, destination, ...extra] = process.argv.slice(2);
    if (!platform || !output || !destination || extra.length) throw new Error('Usage: node scripts/collect-build.cjs PLATFORM OUTPUT DESTINATION');
    const files = collectBuild(platform, output, destination);
    console.log('Tester bundle:', destination, files);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${platform}\n\nVersion: ${version}\n\nIncludes packages, source revision, tester instructions and SHA256 checksums. Gameplay acceptance remains separate.\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { collectBuild };
