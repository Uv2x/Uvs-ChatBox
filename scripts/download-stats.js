// Download stats for Uv's Chat Box releases, from GitHub's public API (no
// login needed). Run: `npm run stats`.
//
// How to read it:
//   installer  = someone downloaded the .exe (a new install, or a full update)
//   updates    = app updates done in-app (each one fetches the .blockmap)
//   checks     = update checks: every running copy checks at launch and every
//                4 hours, so this shows activity, not a count of people
// Counts are totals since each release was published, not per day.

const REPO = 'Uv2x/Uvs-ChatBox';

async function main() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'uvs-chatbox-stats' },
  });
  if (!res.ok) {
    console.error(`[stats] GitHub answered ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const releases = await res.json();
  const count = (assets, test) =>
    assets.filter((a) => test(a.name)).reduce((n, a) => n + a.download_count, 0);

  console.log(`\n  ${REPO} — downloads per release\n`);
  console.log('  version   published    installer  updates  checks');
  console.log('  ' + '-'.repeat(52));
  let installs = 0;
  for (const r of releases) {
    const exe = count(r.assets, (n) => n.endsWith('.exe'));
    const updates = count(r.assets, (n) => n.endsWith('.blockmap'));
    const checks = count(r.assets, (n) => n === 'latest.yml');
    installs += exe;
    console.log(
      `  ${r.tag_name.padEnd(9)} ${r.published_at.slice(0, 10)}   ${String(exe).padStart(9)}  ${String(updates).padStart(7)}  ${String(checks).padStart(6)}`,
    );
  }
  console.log('  ' + '-'.repeat(52));
  console.log(`  installer downloads, all releases: ${installs}\n`);
}

main().catch((e) => {
  console.error('[stats] failed:', e.message);
  process.exit(1);
});
