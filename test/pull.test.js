// The Pull from Shovel Command dialog (lib/pull.js), its pure parts: the preview line, the archived names, the toast and
// the preview markup. The reply is the server's (plow-command-script Code.js pullFromShovel_): the counts are numbers,
// shovel_archived holds ids, and `preview` (the whole diff) is not read by the phone.
// Expected values are worked out on paper in the comments above each assertion.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Pull = require('../lib/pull.js');

// Every number differs from every other, so a swapped or mislabelled count cannot read right by luck.
//   adds      2 sites, 3 zones (piles)      updates  1 site, 4 zones      unchanged  5 sites, 6 zones
//   left out  7 zones                        shovel-side archived: S9 and S4 and PS-1
const REPLY = { ok: true, action: 'pullFromShovel', applied: false,
  adds: { sites: 2, zones: 3 }, updates: { sites: 1, zones: 4 }, unchanged: { sites: 5, zones: 6 },
  shovel_archived: ['S9', 'S4', 'PS-1'], skipped: { zones: 7 } };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (html) => html.replace(/<[^>]+>/g, '');

test('summary: the brief\'s line, each count in its place (a lone site reads "1 site")', () => {
  // adds.sites 2 -> "2 sites"; adds.zones 3 -> "3 piles"; updates.sites 1 -> "1 site" (singular); updates.zones 4 -> "4 piles";
  // unchanged 5 sites, 6 piles; skipped.zones 7 -> "7 zones". The separator is a middle dot with a space each side.
  assert.equal(Pull.summary(REPLY),
    'Adds: 2 sites, 3 piles · Updates: 1 site, 4 piles · Unchanged: 5 sites, 6 piles · Left out: 7 zones');
});

test('summary: one of each, and zeros, read right', () => {
  // 1 -> singular on all three nouns; 0 -> plural. Worked per group: adds 1/1, updates 0/0, unchanged 0/1, left out 1.
  assert.equal(Pull.summary({ adds: { sites: 1, zones: 1 }, updates: { sites: 0, zones: 0 }, unchanged: { sites: 0, zones: 1 }, skipped: { zones: 1 } }),
    'Adds: 1 site, 1 pile · Updates: 0 sites, 0 piles · Unchanged: 0 sites, 1 pile · Left out: 1 zone');
});

test('summary: a count the reply lacks, or that is not a number, reads 0 (never undefined or NaN)', () => {
  const zero = 'Adds: 0 sites, 0 piles · Updates: 0 sites, 0 piles · Unchanged: 0 sites, 0 piles · Left out: 0 zones';
  assert.equal(Pull.summary({ ok: true }), zero);
  assert.equal(Pull.summary({ adds: { sites: '2', zones: null }, updates: {}, unchanged: { sites: NaN }, skipped: {} }), zero);
});

test('archivedNames: a site this phone knows by its plow name, an id it does not know as the id, in the order sent', () => {
  // S9 is in the plow Sheet as "Tudor Centre"; PS-1 is archived here and still a known site ("Other lot"); S4 is not known at all.
  // Order sent: S9, S4, PS-1 -> "Tudor Centre", "S4", "Other lot".
  const sites = [{ id: 'S9', name: 'Tudor Centre' }, { id: 'PS-1', name: 'Other lot', archived: true }, { id: 'S2', name: 'Not asked about' }];
  assert.deepEqual(Pull.archivedNames(REPLY, sites), ['Tudor Centre', 'S4', 'Other lot']);
  // Nothing archived on the shovel side, or a reply that does not say: none.
  assert.deepEqual(Pull.archivedNames({ shovel_archived: [] }, sites), []);
  assert.deepEqual(Pull.archivedNames({}, sites), []);
  assert.deepEqual(Pull.archivedNames({ shovel_archived: 'S9' }, sites), []);
});

test('archivedNames: a known site with no name falls back to its id (a blank name is not a name)', () => {
  assert.deepEqual(Pull.archivedNames({ shovel_archived: ['S5'] }, [{ id: 'S5', name: '  ' }]), ['S5']);
});

test('pulledText: sites and piles summed, adds for "added" and updates for "updated"', () => {
  // adds 2 sites + 3 piles = 5 added; updates 1 site + 6 piles = 7 updated. (Not the preview's REPLY: there 3 + 2 and 1 + 4 would
  // both be 5 and the two could be swapped without notice.)
  assert.equal(Pull.pulledText({ adds: { sites: 2, zones: 3 }, updates: { sites: 1, zones: 6 } }), 'Pulled: 5 added, 7 updated');
  assert.equal(Pull.pulledText({ adds: { sites: 0, zones: 0 }, updates: { sites: 0, zones: 0 } }), 'Pulled: 0 added, 0 updated');
  assert.equal(Pull.pulledText({}), 'Pulled: 0 added, 0 updated');
});

test('previewHtml: the counts in one line, the archived line only when something is archived, names escaped and kept out of Spanish', () => {
  const sites = [{ id: 'S9', name: 'Tudor <b>Centre</b>' }];
  const html = Pull.previewHtml(REPLY, sites, esc);
  // The line a person reads is exactly summary(); the label sits outside data-no-es (it translates), the names inside it (they never do).
  assert.equal(text(html.match(/<p id="pull_sum">.*?<\/p>/)[0]), Pull.summary(REPLY));
  assert.match(html, /<p id="pull_arch">Archived on the shovel side \(not archived here\): <span data-no-es>Tudor &lt;b&gt;Centre&lt;\/b&gt;, S4, PS-1<\/span><\/p>/);
  assert.equal(html.indexOf('<b>'), -1, 'a name is never markup');
  // Nothing archived: no archived line at all (not an empty label).
  assert.equal(Pull.previewHtml({ ...REPLY, shovel_archived: [] }, sites, esc).indexOf('pull_arch'), -1);
});

test('the dialog reads and writes no storage (the keys test enforces the exact key set; this names the file)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pull.js'), 'utf8');
  assert.equal(/localStorage|sessionStorage|indexedDB|caches\./.test(src), false);
});

test('failText and failHtml: a Sheet that would not open names the reason after ours; any other refusal is the server\'s own words', () => {
  assert.equal(Pull.failText({ code: 'pull_failed', reason: 'Service error' }), "Couldn't open the shovel crew's Sheet: Service error");
  assert.equal(Pull.failText({ code: 'forbidden', reason: 'Only the dispatcher can do that.' }), 'Only the dispatcher can do that.');
  assert.equal(Pull.failText({ code: 'busy', reason: 'Busy, try again.' }), 'Busy, try again.');
  // No reason at all (it should not happen): the no-signal line the app already uses, never "undefined".
  assert.equal(Pull.failText({ code: 'network' }), "Couldn't reach the server. Try again.");
  // As markup: the reason is escaped, and under data-no-es for ours only (Google's English is not for the Spanish rows).
  assert.equal(Pull.failHtml({ code: 'pull_failed', reason: '<i>x</i>' }, esc), "Couldn't open the shovel crew's Sheet: <span data-no-es>&lt;i&gt;x&lt;/i&gt;</span>");
  assert.equal(Pull.failHtml({ code: 'busy', reason: 'a<b' }, esc), 'a&lt;b');
});

// ---- Final wave I4 and I3 (10/22/26) ----
// I4: a later Pull names the piles the shovel side archived (or no longer has) that are still live here; the pull archives
// none of them. The reply carries them whole: shovel_archived_zones [{ id, name, site_id }].
test('archivedPileNames: the piles the shovel side archived, by the name the reply gives (else the id), in the order sent (I4)', () => {
  // Z-g "West pile", then Z-h whose name is blank -> its id, then Z-k "Hydrant strip".
  const reply = { shovel_archived_zones: [{ id: 'Z-g', name: 'West pile', site_id: 'S-1' }, { id: 'Z-h', name: ' ', site_id: 'S-1' },
    { id: 'Z-k', name: 'Hydrant strip', site_id: 'S-2' }] };
  assert.deepEqual(Pull.archivedPileNames(reply), ['West pile', 'Z-h', 'Hydrant strip']);
  // None, or a reply from before the wave that does not say: none.
  assert.deepEqual(Pull.archivedPileNames({ shovel_archived_zones: [] }), []);
  assert.deepEqual(Pull.archivedPileNames({}), []);
});

test('previewHtml: the piles archived on the shovel side get their own line, names kept out of Spanish; none, no line (I4)', () => {
  const reply = { ...REPLY, shovel_archived_zones: [{ id: 'Z-g', name: 'West <i>pile</i>', site_id: 'S-1' }, { id: 'Z-h', name: 'Ramp', site_id: 'S-2' }] };
  const html = Pull.previewHtml(reply, [], esc);
  assert.match(html, /<p id="pull_piles">Piles archived on the shovel side \(still here\): <span data-no-es>West &lt;i&gt;pile&lt;\/i&gt;, Ramp<\/span><\/p>/);
  assert.equal(Pull.previewHtml(REPLY, [], esc).indexOf('pull_piles'), -1);
});

// I3: the apply can outlast the 45 s every call waits (the first Pull writes ~120 records): it asks for 120 s. The preview keeps
// the ordinary wait. The dialog is driven here through a small stand-in for the page (each id one object).
test('the dialog: the preview asks with the ordinary wait, Pull now asks with a 120 s wait (I3)', async () => {
  const els = {}, calls = [];
  const $ = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', disabled: false, open: true });
  const ctx = { S: { sites: [] }, $, esc, toast: () => {}, showDialog: () => {}, closeDialog: () => { $('dlg').open = false; },
    refresh: () => {}, signedOut: () => {},
    call: async (action, body, opts) => { calls.push([action, body, opts]); return { ...REPLY, applied: body.apply === true }; } };
  await Pull.open(ctx);
  await els.pull_go.onclick();
  assert.deepEqual(calls.map((c) => [c[0], c[1], c[2]]), [['pullFromShovel', { apply: false }, undefined],
    ['pullFromShovel', { apply: true }, { timeout: 120000 }]]);
});
