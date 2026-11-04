// Post-package hook: compute SHA-256 for every .exe in ./release and write
// a sidecar <name>.sha256.txt next to it. Also prints a compact table to the
// console so the publisher can paste it into the release notes / download page.
//
// Run automatically via `npm run package` (see package.json "postpackage").
// Safe to run standalone too: `node scripts/hash-release.js`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RELEASE_DIR = path.resolve(__dirname, '..', 'release');

function sha256(file) {
  const buf = fs.readFileSync(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.log('[hash-release] no ./release directory — nothing to hash.');
    return;
  }
  const entries = fs.readdirSync(RELEASE_DIR).filter((f) => f.toLowerCase().endsWith('.exe'));
  if (entries.length === 0) {
    console.log('[hash-release] no .exe files in ./release — nothing to hash.');
    return;
  }
  console.log('\n  SHA-256 checksums (paste into release notes):');
  console.log('  ' + '-'.repeat(78));
  for (const name of entries) {
    const full = path.join(RELEASE_DIR, name);
    const hash = sha256(full);
    const sidecar = full + '.sha256.txt';
    fs.writeFileSync(sidecar, `${hash}  ${name}\n`, 'utf8');
    console.log(`  ${hash}  ${name}`);
  }
  console.log('  ' + '-'.repeat(78));
  console.log('  Sidecar files written: <installer>.sha256.txt\n');
}

main();
