(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'));
  else root.CrewShiftLog = factory(root.CrewTime);
})(this, function (T) {
  'use strict';

  // The shift log is append-only: a tap, an undo, a storm control and a site
  // card are all new rows, never edits. So every answer here is a replay of the
  // rows, in the server's `seq` order. Never the phone's clock (it can be
  // wrong, and two taps can land in one millisecond), never array position
  // (the phone merges rows from a poll and from its own taps).

  // Plow Command (10/21/26): the LOT is the unit. Every site is one walk, the Lot, with two states:
  // plowed and problem. A zone (storage, no_touch, push) is a drawing on the map and is never a walk,
  // so a site answers the same one Lot whether it has no zones or thirty. A site is done when the newest
  // standing row on its lot is plowed. There are no passes (no Clean again), no curb roll-up and no Touched.
  var LOT_ID = 'lot';
  var DONE = ['plowed'];
  var EQUIPMENT = ['blower', 'snowrator', 'bobcat', 'sweepster'];

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }
  function inStorm(rows, stormId) {
    return (rows || []).filter(function (r) { return r.storm_id === stormId; });
  }

  function walkKey(siteId, zoneId) { return siteId + '|' + zoneId; }

  // What a driver taps at a site: its Lot. Always the one item, whatever the site's map holds (a fresh
  // object each call, so a caller changing it changes nothing for the next).
  function walksFor(siteId, zones) {
    return [{ zone_id: LOT_ID, type: 'lot', name: 'Lot' }];
  }

  // The lot takes plowed or problem; nothing else is walked.
  function statesFor(type) {
    return type === 'lot' ? ['plowed', 'problem'] : [];
  }

  // null when the tap is allowed, otherwise the reason it is not. The phone and the server both ask this,
  // so they refuse in the same words: the zone first, then the state, then the note.
  function checkTap(o) {
    o = o || {};
    if (o.zone_id !== LOT_ID) return 'Only the lot can be tapped';
    if (statesFor('lot').indexOf(o.state) === -1) return 'State must be plowed or problem';
    if (o.state === 'problem' && !String(o.note || '').trim()) return 'A problem needs a note';
    return null;
  }

  // The newest start row names the current storm; end / reopen / snowing /
  // stopped move that storm only. A late row about an older storm is ignored.
  // night_on changes neither (it only affects filing: see shiftFor).
  function stormState(stormRows) {
    var s = { storm_id: null, open: false, snowing: false };
    (stormRows || []).slice().sort(bySeq).forEach(function (r) {
      if (r.kind === 'start') { s = { storm_id: r.storm_id, open: true, snowing: false }; return; }
      if (r.storm_id !== s.storm_id) return;
      if (r.kind === 'end') s.open = false;
      else if (r.kind === 'reopen') s.open = true;
      else if (r.kind === 'snowing') s.snowing = true;
      else if (r.kind === 'stopped') s.snowing = false;
    });
    return s;
  }

  function hourOf(iso) { return Number(String(iso).slice(11, 13)); }

  // Which shift a tap belongs to, decided on the server from its own clock.
  // Before 9 AM it is still the night that began the evening before. After 9
  // it is day, unless a night_on was logged that same local evening and has
  // already happened.
  function shiftFor(iso, stormRows) {
    if (hourOf(iso) < T.SHIFT_CUTOVER_HOUR) return T.shiftId('night', T.shiftDate(iso));
    var date = String(iso).slice(0, 10);
    var now = Date.parse(iso);
    var night = (stormRows || []).some(function (r) {
      return r.kind === 'night_on' &&
        String(r.at).slice(0, 10) === date &&
        hourOf(r.at) >= T.SHIFT_CUTOVER_HOUR &&
        Date.parse(r.at) <= now;
    });
    return T.shiftId(night ? 'night' : 'day', date);
  }

  // Newest row per walk for one storm. A 'none' row is an undo back to not
  // done; it stays in the map so siteDone can see it is not done. A star row
  // ('*', a depth reading) is never a walk.
  // shiftId (final wave C3, 10/22/26): "a site is done THIS SHIFT when its newest standing row is plowed" (spec
  // section 2). Given a shift, only that shift's rows count, an undo row too (it carries the shift it was made in), so
  // a lot plowed last night reads not plowed on today's day shift until someone plows it today. The Storm tab, the
  // live view, the handoff and the route sheets all read per shift. Without one, every shift of the storm: the storm
  // view (nobody's screen reads it today; kept for a caller that wants the storm's newest row per lot).
  function walkStates(logRows, stormId, shiftId) {
    var out = {};
    inStorm(logRows, stormId).sort(bySeq).forEach(function (r) {
      if (r.zone_id === '*') return;
      if (shiftId && r.shift_id !== shiftId) return;
      out[walkKey(r.site_id, r.zone_id)] = r;
    });
    return out;
  }

  // Real taps among one site's rows: never a '*' row, never an undo row, never a
  // tap whose undo still stands (an undo that is itself undone gives it back).
  function realTaps(rows) {
    var undoneBy = {};
    rows.forEach(function (r) { if (r.zone_id !== '*' && r.undoes != null) (undoneBy[r.undoes] = undoneBy[r.undoes] || []).push(r); });
    function stands(r, depth) {
      return depth > 50 || !(undoneBy[r.id] || []).some(function (u) { return stands(u, depth + 1); });
    }
    return rows.filter(function (r) { return r.zone_id !== '*' && r.undoes == null && stands(r, 0); });
  }

  // What a walk goes back to if `seq` is undone. Only the newest row on its
  // walk can be undone; the state is whatever the row before it said, and so is the
  // note (a walk undone back to 'problem' must keep what the problem was). An undo
  // row can itself be undone, which gives the tap back; a tap whose undo stands is
  // no longer the newest row, so it is never undone twice. A depth row cannot be undone.
  // "The row before it" is the row before it in the SAME shift (final wave C3, 10/22/26): the lot is read per shift
  // (walkStates), so a day driver's mis-tap undone on a lot the night plowed goes back to 'none' (not plowed this shift),
  // never to the night's 'plowed'. Only the newest row is still asked across the whole storm.
  function undoTarget(logRows, stormId, seq) {
    var rows = inStorm(logRows, stormId).sort(bySeq);
    var row = rows.filter(function (r) { return Number(r.seq) === Number(seq); })[0];
    if (!row) return { ok: false, reason: 'That tap is not in this storm' };
    if (row.zone_id === '*') return { ok: false, reason: 'That cannot be undone' };
    var key = walkKey(row.site_id, row.zone_id);
    var same = rows.filter(function (r) { return walkKey(r.site_id, r.zone_id) === key; });
    var at = same.indexOf(row);
    if (at !== same.length - 1) return { ok: false, reason: 'Someone has tapped this lot since' };
    var before = same.slice(0, at).filter(function (r) { return r.shift_id === row.shift_id; });
    var prev = before.length ? before[before.length - 1] : null;
    return { ok: true, row: row, state: prev ? prev.state : 'none', note: prev ? String(prev.note || '') : '' };
  }

  // ---- New snow since (callouts, Matt 10/4/26) ----
  // Where "new snow since the last plowing" starts at one site, and the newest
  // depth reading after that point. The clock is, in order: the newest real tap
  // of the site (an undo is not work); else the storm's start row (a Storms-tab
  // row, so fromSeq is 0: Log seqs and Storms seqs are separate counters). A depth row
  // { zone_id: '*', state: 'depth', depth_in } is never a tap, so it never moves
  // the clock; it only counts while it is newer than the clock, so a tap after a
  // reading means the reading no longer applies.
  function snowSince(logRows, stormRows, stormId, siteId) {
    var rows = inStorm(logRows, stormId).filter(function (r) { return r.site_id === siteId; });
    var taps = realTaps(rows).sort(bySeq);
    var from = null, fromSeq = 0;
    if (taps.length) { var t = taps[taps.length - 1]; from = t.at; fromSeq = Number(t.seq); }
    else {
      var starts = (stormRows || []).filter(function (r) { return r.kind === 'start' && r.storm_id === stormId; }).sort(bySeq);
      if (starts.length) from = starts[starts.length - 1].at;
    }
    var depths = rows.filter(function (r) { return r.zone_id === '*' && r.state === 'depth' && Number(r.seq) > fromSeq; }).sort(bySeq);
    return { from: from, fromSeq: fromSeq, measured: depths.length ? depths[depths.length - 1] : null };
  }

  // ---- Open Problems (Matt, 10/4/26; one rule for the Problems box and the handoff) ----
  // A site's open Problems: a walk whose newest standing row is a Problem. Newest first. With no passes
  // there is nothing to carry from an earlier one, so each is just { row }: the lot is the only walk, so
  // there is at most one.
  // states: walkStates(logRows, stormId). Each: { row }.
  function openProblems(logRows, stormId, siteId, states) {
    var rows = inStorm(logRows, stormId).filter(function (r) { return r.site_id === siteId; }).sort(bySeq);
    var now = states || {}, found = [], seen = {};
    rows.forEach(function (r) {
      if (r.zone_id === '*' || seen[r.zone_id]) return;
      seen[r.zone_id] = true;
      var cur = now[walkKey(siteId, r.zone_id)];
      if (cur && cur.state === 'problem') found.push({ row: cur });
    });
    return found.sort(function (a, b) { return bySeq(b.row, a.row); });
  }

  // A zone's name on a line: its walk's name (the Lot), else its zone record (archived
  // since), else its id.
  function zoneName(siteId, zoneId, zones) {
    var w = walksFor(siteId, zones).filter(function (x) { return x.zone_id === zoneId; })[0];
    if (w) return String(w.name);
    var z = (zones || []).filter(function (x) { return x.id === zoneId; })[0];
    return z ? String(z.name) : String(zoneId);
  }

  function walkDone(siteId, w, states) {
    var r = (states || {})[walkKey(siteId, w.zone_id)];
    return !!r && DONE.indexOf(r.state) !== -1;
  }

  function siteDone(siteId, zones, states) {
    return walksFor(siteId, zones).every(function (w) { return walkDone(siteId, w, states); });
  }

  // How many of a site's walks are done, of how many: the lot is the only walk, so 0 or 1 of 1.
  function walkCount(siteId, zones, states) {
    var walks = walksFor(siteId, zones);
    return { done: walks.filter(function (w) { return walkDone(siteId, w, states); }).length, total: walks.length };
  }

  // ---- Day order (Part B2, Matt 10/4/26; shared here for the handoff 10/5/26) ----
  // Day shift lists ranked sites first (day_rank ascending, ties by their place
  // in the list), then the unranked in list order. A rank is a number; a blank,
  // a string, or a site the lookup does not know is unranked. Always a new
  // array: the input is never changed.
  function dayOrder(siteIds, siteById) {
    var items = (siteIds || []).map(function (id, i) {
      var site = (siteById || {})[id], r = site ? site.day_rank : null;
      return { id: id, i: i, rank: typeof r === 'number' && isFinite(r) ? r : null };
    });
    items.sort(function (a, b) {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank || a.i - b.i;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.i - b.i;
    });
    return items.map(function (x) { return x.id; });
  }

  // done: sites Done (their lot is plowed), of total. There is no Touched here, so there is no such key.
  function routeProgress(siteIds, zones, states) {
    var done = 0;
    (siteIds || []).forEach(function (id) {
      if (siteDone(id, zones, states)) done++;
    });
    return { done: done, total: (siteIds || []).length };
  }

  // First and last tap at a site in one shift, by seq.
  // Start/Finish count real taps only (Matt, 10/4/26: "a new guy mis-taps; an
  // undo is a correction, not work"): never an undo row, never a tap whose undo
  // still stands. An undo that is itself undone gives its tap back.
  function siteTimes(logRows, siteId, shiftId) {
    var all = (logRows || []).filter(function (r) { return r.site_id === siteId && r.shift_id === shiftId; });
    var rows = realTaps(all).sort(bySeq);
    return { start: rows.length ? rows[0].at : null, finish: rows.length ? rows[rows.length - 1].at : null };
  }

  function typedMinutes(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // The site cards for one site and shift. Each person has one card (a
  // re-save replaces their own, nobody else's); minutes are summed over those
  // cards. A blank adds nothing, and a piece of equipment nobody logged stays
  // null: blank is "not recorded", not "zero minutes".
  function visitTotals(visits, siteId, shiftId) {
    var rows = (visits || []).filter(function (v) { return v.site_id === siteId && v.shift_id === shiftId; }).sort(bySeq);
    var newest = {};
    rows.forEach(function (v) { newest[String(v.by_key || 'admin')] = v; });
    var cards = Object.keys(newest).map(function (k) { return newest[k]; });
    var minutes = {};
    EQUIPMENT.forEach(function (e) {
      var sum = null;
      cards.forEach(function (c) {
        var m = typedMinutes((c.equipment || {})[e]);
        if (m !== null) sum = (sum || 0) + m;
      });
      minutes[e] = sum;
    });
    return { cards: cards, minutes: minutes };
  }

  return { walkKey: walkKey, walksFor: walksFor, statesFor: statesFor, checkTap: checkTap, stormState: stormState,
    shiftFor: shiftFor, walkStates: walkStates, undoTarget: undoTarget, siteDone: siteDone,
    routeProgress: routeProgress, siteTimes: siteTimes, visitTotals: visitTotals, snowSince: snowSince,
    realTaps: realTaps, walkCount: walkCount, dayOrder: dayOrder, openProblems: openProblems, zoneName: zoneName };
});
