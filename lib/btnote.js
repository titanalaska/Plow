(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowBtNote = factory(root.CrewShiftLog);
})(this, function (L) {
  'use strict';

  // The "Copy for BT" text for one site and shift (Matt, 10/3/26). The app only
  // writes the text: the lead pastes it into BuilderTrend and posts as
  // themselves, photos and all. Nothing here, or anywhere, talks to BT.
  //
  // The lot (Plow Command, 10/21/26), the times, depth, materials and minutes are all this shift's: a lot is done THIS SHIFT
  // (final wave C3, spec section 2), so a lot the night plowed reads "Not plowed." in the day's note until the day plows it.

  var MACHINES = [['blower', 'Blower'], ['snowrator', 'Snowrator'], ['bobcat', 'Bobcat'], ['sweepster', 'Sweepster']];

  // "2026-12-04T23:55:00.000-09:00" -> "11:55 PM", read off the string itself so
  // the answer never depends on the phone's time zone.
  function clock(iso) {
    if (!iso) return '';
    var h = Number(iso.slice(11, 13)), m = iso.slice(14, 16);
    return (h % 12 === 0 ? 12 : h % 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
  }

  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }

  // The lot's line: its newest standing row in the shift (an undo row carries the state it went back to).
  // "Plowed.", "Problem: <note>." ("Problem." with no note), or "Not plowed." when nobody has plowed it
  // or the tap was taken back.
  function lotLine(row) {
    var state = row ? row.state : 'none';
    if (state === 'plowed') return 'Plowed.';
    if (state === 'problem') return 'Problem' + (blank(row.note) ? '' : ': ' + String(row.note).trim()) + '.';
    return 'Not plowed.';
  }

  // o: {site, zones, storm_id, log, visits}
  function btNote(o, shiftId) {
    var site = o.site, stormLog = (o.log || []).filter(function (r) { return r.storm_id === o.storm_id; });
    var siteLog = stormLog.filter(function (r) { return r.site_id === site.id; });
    var lot = L.walksFor(site.id, o.zones)[0];
    var lines = [lotLine(L.walkStates(siteLog, o.storm_id, shiftId)[L.walkKey(site.id, lot.zone_id)])];

    var cards = L.visitTotals((o.visits || []).filter(function (v) { return v.storm_id === o.storm_id; }), site.id, shiftId);
    var depths = cards.cards.map(function (c) { return c.depth_in; }).filter(function (d) { return !blank(d); }).map(Number)
      .sort(function (a, b) { return a - b; });
    if (depths.length) lines.push('Depth: ' + (depths[0] === depths[depths.length - 1] ? depths[0] : depths[0] + '-' + depths[depths.length - 1]) + '"');
    var mats = cards.cards.map(function (c) { return c.materials_used; }).filter(function (m) { return !blank(m); })
      .map(function (m) { return String(m).trim(); });
    if (mats.length) lines.push('Materials: ' + mats.join('; '));
    var units = site.units || {};
    var used = MACHINES.filter(function (m) { return cards.minutes[m[0]] !== null; }).map(function (m) {
      return m[1] + (blank(units[m[0]]) ? '' : ' ' + String(units[m[0]]).trim()) + ' ' + cards.minutes[m[0]] + ' min';
    });
    if (used.length) lines.push('Equipment: ' + used.join(', '));

    // The whole storm's rows at this site, so an undo filed in the next shift still counts.
    var t = L.siteTimes(siteLog, site.id, shiftId);
    return { text: lines.join('\n'), timeIn: clock(t.start), timeOut: clock(t.finish) };
  }

  return { btNote: btNote, clock: clock };
});
