// Sidewalk installs like Inventory and Bootprint: its own icon, full screen.
// titanalaska.github.io carries every Titan app, so scope and start_url must be
// "./" (= /Sidewalk/) or the install would swallow, or be swallowed by, another app.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f));
// A PNG's width and height sit in its IHDR chunk, bytes 16-23.
const pngSize = (f) => { const b = read(f); assert.strictEqual(b.toString('ascii', 1, 4), 'PNG', f + ' is not a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest: own scope, full screen, the name the crew see', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.strictEqual(m.start_url, './');
  assert.strictEqual(m.scope, './');
  assert.strictEqual(m.display, 'standalone');
  // Plow Command (Matt, 10/21/26): the name on the home screen and the install sheet is the one the crew read on the page.
  assert.strictEqual(m.name, 'Plow Command'); // matches the page title and header
  assert.strictEqual(m.short_name, 'Plow Command');
  assert.match(m.description, /plow/i);
  assert.doesNotMatch(m.description, /sidewalk|snow crew/i);
});

test('the page title and its header read the manifest name, so the tab, the install sheet and the screen agree', () => {
  const html = read('index.html').toString();
  const name = JSON.parse(read('manifest.json')).name;
  assert.strictEqual(name, 'Plow Command');
  assert.ok(html.includes('<title>' + name + '</title>'), 'the <title> is not ' + name);
  assert.ok(html.includes('<h1>' + name + '</h1>'), 'the header <h1> is not ' + name);
  assert.ok(!html.includes('Snow Crew'), 'the old name is still in the page');
});

test('manifest icons exist at the sizes they claim, one maskable', () => {
  const m = JSON.parse(read('manifest.json'));
  for (const i of m.icons) {
    const [w, h] = pngSize(i.src.replace('./', ''));
    assert.strictEqual(w + 'x' + h, i.sizes, i.src);
  }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'any' && i.sizes === '192x192'));
});

// Plow Command is its own app on the same home screen as the shovel app (Matt, 10/21/26): if its icons were
// the same bytes, two different installs would look the same and the crew could not tell them apart.
// Worked on paper: the fork was cut from the shovel repo, so before the plow blade is drawn each of the
// three files hashes the SAME as the sibling repo's file (same SHA-256, so equal = 3 of 3). Once drawn,
// 0 of 3 may match. The sibling is read-only and lives beside this repo in Matt's working folder; a clone
// of the public repo has no such folder, so the check is skipped with its reason and never fails there.
// It compares against that folder's checked-out icons AND the icons on its `shovel-command` branch, which is
// where the shovel-over-snowflake icon actually lives (the checked-out branch holds the older bare snowflake).
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const shovelRepo = path.join(root, '..', 'Snow-App-repo');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
test('the three icons are not the shovel app\'s icons', { skip: fs.existsSync(path.join(shovelRepo, 'icon-512.png')) ? false : 'the shovel app\'s folder (../Snow-App-repo) is not beside this repo, so there is nothing to compare against' }, () => {
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    const mine = sha(read(f));
    const theirs = path.join(shovelRepo, f);
    if (fs.existsSync(theirs)) assert.notStrictEqual(mine, sha(fs.readFileSync(theirs)), f + ' is byte-for-byte the shovel app\'s checked-out icon');
    let onBranch = null;
    try { onBranch = execFileSync('git', ['-C', shovelRepo, 'show', 'shovel-command:' + f], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }); } catch (e) { /* no git, or no such branch: the checked-out comparison above stands */ }
    if (onBranch) assert.notStrictEqual(mine, sha(onBranch), f + ' is byte-for-byte the shovel-command branch\'s icon');
  }
});

test('the page links the manifest and an iPhone icon', () => {
  const html = read('index.html').toString();
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.json">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icon-192\.png">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
});

test('the shell caches the shift log files', () => {
  const sw = read('sw.js').toString();
  const shell = JSON.parse(sw.match(/var SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  // The three new files by name...
  for (const f of ['lib/shiftlog.js', 'lib/routesheet.js', 'lib/handoff.js', 'lib/shiftlogui.js', 'lib/es.js', 'lib/weather.js', 'lib/callout.js', 'lib/share.js']) assert.ok(shell.includes(f), f + ' is not in the shell');
  // ...and, so the next file added can't be forgotten, EVERY script the page loads.
  const html = read('index.html').toString();
  const loaded = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(loaded.length > 10, 'found the page\'s script tags');
  for (const f of loaded) assert.ok(shell.includes(f), f + ' is loaded by index.html but not in the shell');
  // A new shell means a new cache name, or installed phones keep the old one.
  assert.match(sw, /var CACHE_VERSION = 'titan-plow-shell-3';/);
});

// Plow Command has no MOA outlines (spec, 10/21/26): the sign-in carries every zone with its ring, so the kept copies
// (lib/outlines.js) and the shared points file (lib/points.js) are gone. Neither may come back into the page or the
// shell, and every file the shell lists must exist: the install's addAll fails whole on one missing file, and an
// installed phone would then never take a new shell.
test('no outlines: the page and the shell carry neither points.js nor outlines.js, and every shell file exists', () => {
  const html = read('index.html').toString();
  const loaded = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(loaded.includes('lib/mapview.js'), 'found the page\'s script tags');
  for (const f of ['lib/points.js', 'lib/outlines.js']) assert.ok(!loaded.includes(f), f + ' is still loaded by index.html');
  const sw = read('sw.js').toString();
  const shell = JSON.parse(sw.match(/var SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const f of ['lib/points.js', 'lib/outlines.js']) assert.ok(!shell.includes(f), f + ' is still in the shell');
  for (const f of shell.filter((x) => x !== './')) assert.ok(fs.existsSync(path.join(root, f)), f + ' is in the shell but not in the repo');
});

test('the offline shell carries the manifest and icons', () => {
  const sw = read('sw.js').toString();
  for (const f of ['manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) assert.ok(sw.includes("'" + f + "'"), f);
});
