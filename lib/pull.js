// Pull from Shovel Command (Plow Command, Task 16, 10/21/26). The shovel crew keeps the site maps and the snow piles in their
// own Sheet; an admin (Matt, the dispatcher) copies them across from the Sites tab. ONE way, a PREVIEW first: the server reads
// both books and writes nothing (apply: false), the dialog shows the counts, and only Pull now sends the literal apply: true.
// What changes is the server's to decide (plow-command-script pull.js): this file asks, shows the counts and says what
// happened. It never works anything out for itself, and it reads and writes no storage (test/keys.test.js enforces the key set).
//
// The reply it reads (plow-command-script Code.js pullFromShovel_):
//   { ok: true, action, applied, adds: {sites, zones}, updates: {sites, zones}, unchanged: {sites, zones},
//     shovel_archived: [site ids], shovel_archived_zones: [{ id, name, site_id }], skipped: {zones}, preview? }
//     preview (the whole diff) rides a preview only; not read here. shovel_archived_zones (final wave I4): the piles still live
//     here whose shovel twin is archived or gone; the pull archives none of them, the dialog names them.
//   { ok: false, code: 'pull_failed', reason }   the shovel crew's Sheet could not be opened
// A "pile" is what the dispatcher calls a pulled zone (the server brings snow storage and keep-clear areas); "Left out" counts
// the shovel zones it does not bring (a sidewalk, a hand walk).
//
// ctx (built by app.js on every call): {S, $, esc, call, toast, showDialog, closeDialog, refresh(), signedOut(why)}.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnowPullUI = factory();
})(this, function () {
  'use strict';

  // ---------- the pure parts (node-tested, test/pull.test.js) ----------
  // A count the reply lacks, or that is not a number, is 0: the line never says undefined or NaN.
  function count(n) { return typeof n === 'number' && isFinite(n) ? n : 0; }
  function noun(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function pair(g) { g = g || {}; return noun(count(g.sites), 'site', 'sites') + ', ' + noun(count(g.zones), 'pile', 'piles'); }

  // The four groups of the preview line, each its own piece so the Spanish rules can finish each by itself (lib/es.js).
  function parts(reply) {
    reply = reply || {};
    return ['Adds: ' + pair(reply.adds), 'Updates: ' + pair(reply.updates), 'Unchanged: ' + pair(reply.unchanged),
      'Left out: ' + noun(count((reply.skipped || {}).zones), 'zone', 'zones')];
  }
  // "Adds: 2 sites, 3 piles · Updates: 1 site, 4 piles · Unchanged: 5 sites, 6 piles · Left out: 7 zones"
  function summary(reply) { return parts(reply).join(' · '); }

  // The sites the shovel crew archived and this book did not (the pull never archives): the plow Sheet's own name for an id
  // this phone knows (archived here or not), else the id itself. In the order the server sent them.
  function archivedNames(reply, sites) {
    var ids = reply && Array.isArray(reply.shovel_archived) ? reply.shovel_archived : [];
    var byId = Object.create(null);
    (sites || []).forEach(function (s) { if (s && s.id != null) byId[s.id] = s; });
    return ids.map(function (id) {
      var s = byId[id], name = s ? String(s.name == null ? '' : s.name).trim() : '';
      return name || String(id);
    });
  }

  // The piles the shovel side archived (or no longer has) that are still live here (final wave I4): the name the reply gives,
  // else the id, in the order sent. The pull archives none of them: the dispatcher decides.
  function archivedPileNames(reply) {
    var list = reply && Array.isArray(reply.shovel_archived_zones) ? reply.shovel_archived_zones : [];
    return list.map(function (z) {
      var name = z && z.name != null ? String(z.name).trim() : '';
      return name || String((z && z.id) || '');
    });
  }

  // The toast after Pull now: sites and piles summed, adds for "added" and updates for "updated".
  function pulledText(reply) {
    reply = reply || {};
    var a = reply.adds || {}, u = reply.updates || {};
    return 'Pulled: ' + (count(a.sites) + count(a.zones)) + ' added, ' + (count(u.sites) + count(u.zones)) + ' updated';
  }

  // The preview: the counts in one line (a span per group), then the archived names when there are any. The label of the
  // archived line translates; the names are a person's words (and ids) and sit under data-no-es.
  function previewHtml(reply, sites, esc) {
    var names = archivedNames(reply, sites), piles = archivedPileNames(reply);
    return '<p id="pull_sum">' + parts(reply).map(function (p) { return '<span>' + esc(p) + '</span>'; }).join(' · ') + '</p>' +
      (names.length ? '<p id="pull_arch">Archived on the shovel side (not archived here): <span data-no-es>' + names.map(esc).join(', ') + '</span></p>' : '') +
      (piles.length ? '<p id="pull_piles">Piles archived on the shovel side (still here): <span data-no-es>' + piles.map(esc).join(', ') + '</span></p>' : '');
  }

  // A refusal, as text (the toast) and as markup (the dialog). The server's own reason follows ours for a Sheet that would not
  // open (it is Google's English, so it sits under data-no-es); any other refusal is the reason as the app already words it.
  var NO_SHEET = "Couldn't open the shovel crew's Sheet:";
  function failText(r) {
    if (r && r.code === 'pull_failed') return NO_SHEET + ' ' + String(r.reason || '');
    return (r && r.reason) || "Couldn't reach the server. Try again.";
  }
  function failHtml(r, esc) {
    if (r && r.code === 'pull_failed') return NO_SHEET + ' <span data-no-es>' + esc(r.reason || '') + '</span>';
    return esc(failText(r));
  }

  // ---------- the dialog ----------
  // Which opening is current: a reply that comes back to a dialog since closed, or reopened, is nobody's and draws nothing.
  var seq = 0;

  async function open(ctx) {
    var mine = ++seq, $ = ctx.$;
    function here() { return mine === seq && $('dlg').open && !!$('pull_body'); }
    $('dlgIn').innerHTML = '<h2>Pull from Shovel Command</h2><div id="pull_body"><p class="muted">Loading…</p></div><div id="pull_err" class="err"></div>' +
      '<div class="row"><button id="pull_go" class="primary" disabled>Pull now</button><button id="dlgClose">Cancel</button></div>';
    ctx.showDialog();
    var r = await ctx.call('pullFromShovel', { apply: false });
    if (!here()) return;
    if (r.code === 'signin') { ctx.closeDialog(); ctx.signedOut(r.reason); return; }
    if (!r.ok) { $('pull_body').innerHTML = ''; $('pull_err').innerHTML = failHtml(r, ctx.esc); return; }
    $('pull_body').innerHTML = previewHtml(r, ctx.S.sites, ctx.esc);
    var go = $('pull_go');
    go.disabled = false;
    go.onclick = async function () {
      if (go.disabled) return;
      go.disabled = true; // one apply per tap: a second tap lands on a button already off
      $('pull_err').textContent = '';
      // The first Pull writes ~120 records: it may take longer than the 45 s any other call waits (final wave I3). If it still
      // says "Couldn't reach the server", wait a minute and Preview again before Pull now: the writes may have landed.
      var a = await ctx.call('pullFromShovel', { apply: true }, { timeout: 120000 });
      if (a.ok) {
        // It happened, whatever the dialog is doing now: say so and read the books again.
        if (here()) ctx.closeDialog();
        ctx.toast(pulledText(a));
        ctx.refresh();
        return;
      }
      if (a.code === 'signin') { if (here()) ctx.closeDialog(); ctx.signedOut(a.reason); return; }
      if (!here()) { ctx.toast(failText(a)); return; }
      $('pull_err').innerHTML = failHtml(a, ctx.esc);
      go.disabled = false;
    };
  }

  return { open: open, summary: summary, parts: parts, archivedNames: archivedNames, archivedPileNames: archivedPileNames, pulledText: pulledText, previewHtml: previewHtml,
    failText: failText, failHtml: failHtml };
});
