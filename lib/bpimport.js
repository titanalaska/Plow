// Bootprint -> Plow Command zones. PURE: no page, no network. Matt traces a site
// in Bootprint (snow season: walk / hand / plow / storage surfaces) and imports
// its export file here (Matt, 10/1/26). The file is read on this laptop; only
// the outlines that become zones are ever sent.
//
// What comes across (Plow Command, 10/21/26): piles, and from 10/22/26 the lot.
// A storage surface becomes a storage zone, the plow surface (Bootprint's default,
// so an untyped area too) a lot; an area keeps its corners, a run becomes a strip
// of its own width (a run with no width is skipped, never given one). Matt traces
// lots in Bootprint with the islands as cut-outs: a cut-out wholly inside a lot
// becomes that lot's hole, so the lot's square footage is net, as Bootprint
// prints it. Walks and hand work are the Shovel crew's and stay out; so does a
// cut-out inside no lot (a pile has no holes). Each is counted apart, so the
// summary can say what was left out.
var SnowBpImport = (function () {
  'use strict';
  var DEG = Math.PI / 180, R = 6371000, FT = 0.3048;
  // A corner sharper than this (the strip's mitre would reach past 4 half-widths)
  // folds the strip over itself. Such a run is skipped: trace it as an area.
  var SHARPEST = 0.25;
  var Geo = typeof module !== 'undefined' ? require('./geo.js') : null;
  function geo() { return Geo || window.SnowGeo; }
  var Lot = typeof module !== 'undefined' ? require('./lot.js') : null;
  function lot() { return Lot || window.SnowLot; }

  function parseExport(text) {
    var bad = { error: 'That file is not a Bootprint export. Make one at bootprint.app/export.html.' };
    var p;
    try { p = JSON.parse(text); } catch (e) { return bad; }
    if (!p || p.schema !== 'bootprint-library-export' || !Array.isArray(p.jobs)) return bad;
    var jobs = p.jobs.filter(function (j) { return j && Array.isArray(j.zones); });
    // The job open in Bootprint is not filed until it is saved; bring it too.
    var cur = p.current;
    if (cur && Array.isArray(cur.zones) && cur.zones.length && !jobs.some(function (j) { return j.id === cur.jobId; })) {
      jobs.push({ id: cur.jobId || 'open', name: cur.jobName || 'Open in Bootprint (not filed yet)', zones: cur.zones });
    }
    return { jobs: jobs };
  }

  function pinsOf(z) {
    return (z.pins || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
  }

  // Jobs nearest the site first, so the right one is at the top of the list.
  function byDistance(jobs, center) {
    return jobs.map(function (j) {
      var all = [];
      j.zones.forEach(function (z) { all = all.concat(pinsOf(z)); });
      if (!all.length) return { job: j, meters: Infinity };
      var lat = all.reduce(function (s, p) { return s + p.lat; }, 0) / all.length;
      var lng = all.reduce(function (s, p) { return s + p.lng; }, 0) / all.length;
      var dx = (lng - center[0]) * DEG * R * Math.cos(center[1] * DEG), dy = (lat - center[1]) * DEG * R;
      return { job: j, meters: Math.sqrt(dx * dx + dy * dy) };
    }).sort(function (a, b) { return a.meters - b.meters; });
  }

  // A run (centreline + width) as an outline: offset both sides, mitred at
  // each bend so the strip keeps its full area. null when a bend is too sharp
  // or the strip would cross itself.
  function stripRing(pins, widthFt) {
    var lat0 = pins[0].lat, lng0 = pins[0].lng, k = Math.cos(lat0 * DEG);
    var pts = [];
    pins.forEach(function (p) {
      var q = { x: (p.lng - lng0) * DEG * R * k, y: (p.lat - lat0) * DEG * R };
      var last = pts[pts.length - 1];
      if (!last || Math.abs(last.x - q.x) > 1e-6 || Math.abs(last.y - q.y) > 1e-6) pts.push(q);
    });
    if (pts.length < 2) return null;
    var half = widthFt * FT / 2, left = [], right = [];
    function normal(a, b) { var dx = b.x - a.x, dy = b.y - a.y, l = Math.sqrt(dx * dx + dy * dy); return { x: -dy / l, y: dx / l }; }
    for (var i = 0; i < pts.length; i++) {
      var n1 = i > 0 ? normal(pts[i - 1], pts[i]) : null, n2 = i < pts.length - 1 ? normal(pts[i], pts[i + 1]) : null;
      var m, len = half;
      if (n1 && n2) {
        var sx = n1.x + n2.x, sy = n1.y + n2.y, sl = Math.sqrt(sx * sx + sy * sy);
        if (sl < 1e-9) return null;                     // straight back on itself
        m = { x: sx / sl, y: sy / sl };
        var cos = m.x * n1.x + m.y * n1.y;
        if (cos < SHARPEST) return null;
        len = half / cos;
      } else m = n1 || n2;
      left.push({ x: pts[i].x + m.x * len, y: pts[i].y + m.y * len });
      right.push({ x: pts[i].x - m.x * len, y: pts[i].y - m.y * len });
    }
    var ring = left.concat(right.reverse()).map(function (q) {
      return [lng0 + q.x / (R * k) / DEG, lat0 + q.y / R / DEG];
    });
    return geo().isSelfIntersecting(geo().ringToPins(ring)) ? null : ring;
  }

  // Bootprint surface -> zone type: a pile shows the plow where snow goes (Matt, 10/4/26); the plow surface is the
  // lot itself (10/22/26). Walks and hand work never get past the checks below; a surface Bootprint does not have
  // today is counted as another kind.
  var TYPE_OF = { storage: 'storage', plow: 'lot' };
  function ll(pins) { return pins.map(function (p) { return [p.lng, p.lat]; }); }

  // existing: the `from` of zones this site already has, so a second import adds nothing.
  // A walk or hand shape is counted by its surface whatever its shape (an unfinished one, a
  // run with no width): those reasons are a pile's or a lot's, and only those would have come in.
  // piles: the corners of the site's LIVE piles (the Pull from Shovel Command brings piles with no `from`, so `existing`
  // cannot see them). A pile of the job with the same corners (SnowLot.sameRing) is that pile: left out, counted as onMap.
  // The server answers a pile like that with the live one and writes nothing, so a stale preview cannot add it either.
  // -> { zones, skipped, islands }: islands = the holes carried on the zones returned.
  function convertJob(job, existing, piles) {
    var skipped = { walks: 0, hands: 0, cutouts: 0, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0, other: 0, onMap: 0 };
    var zones = [], islands = 0;
    // The lot areas first (plow surface, 3+ corners, job order), each with an empty list of holes. Then every cut-out
    // (3+ corners, job order) joins the FIRST lot the server would accept it as a hole of (lot.js holeProblem, the
    // server's own question: wholly inside the lot, apart from that lot's holes taken before it, not crossing itself);
    // one that fits no lot is counted. A hole follows its lot: in with it, or left with it when the lot was imported
    // before. A cut-out inside a pile that sits inside the lot is the lot's hole, as Bootprint's figure has it.
    var lots = [];
    job.zones.forEach(function (z) {
      if ((z.mode || 'area') === 'area' && TYPE_OF[z.surface || 'plow'] === 'lot' && pinsOf(z).length >= 3) lots.push({ id: z.id, ring: ll(pinsOf(z)), holes: [] });
    });
    job.zones.forEach(function (z) {
      if ((z.mode || 'area') !== 'cut') return;
      var pins = pinsOf(z);
      if (pins.length < 3) { skipped.cutouts++; return; }
      var ring = ll(pins), home = null;
      for (var i = 0; i < lots.length && !home; i++) {
        if (lot().holeProblem(ring, lots[i].ring, lots[i].holes) === '') home = lots[i];
      }
      if (!home) { skipped.cutouts++; return; }
      home.holes.push(ring);
    });
    job.zones.forEach(function (z) {
      var mode = z.mode || 'area', surface = z.surface || 'plow'; // Bootprint's own default surface
      if (mode === 'cut') return;                               // counted above, or carried as a hole
      if (surface === 'walk') { skipped.walks++; return; }
      if (surface === 'hand') { skipped.hands++; return; }
      if (!TYPE_OF[surface]) { skipped.other++; return; }       // a surface Bootprint adds later: not a pile, not a lot
      var from = 'bootprint:' + job.id + ':' + z.id;
      if ((existing || []).indexOf(from) !== -1) { skipped.already++; return; }
      var pins = pinsOf(z), ring;
      if (mode === 'line') {
        if (pins.length < 2) { skipped.unfinished++; return; }
        var w = parseFloat(z.widthFt);
        if (!(w > 0)) { skipped.noWidth++; return; }
        ring = stripRing(pins, w);
        if (!ring) { skipped.tooSharp++; return; }
      } else {
        if (pins.length < 3) { skipped.unfinished++; return; }
        ring = ll(pins);
      }
      if (TYPE_OF[surface] === 'storage' && (piles || []).some(function (p) { return lot().sameRing(p, ring); })) { skipped.onMap++; return; }
      var zone = { name: z.name || 'Zone ' + z.id, type: TYPE_OF[surface], ring: ring, from: from };
      // A lot's holes, when it has any: the key is there only then (a hole-less lot stores as a pile does).
      var mine = mode === 'area' && zone.type === 'lot' ? lots.filter(function (l) { return l.id === z.id; })[0] : null;
      if (mine && mine.holes.length) { zone.holes = mine.holes; islands += mine.holes.length; }
      zones.push(zone);
    });
    return { zones: zones, skipped: skipped, islands: islands };
  }

  return { parseExport: parseExport, byDistance: byDistance, convertJob: convertJob, stripRing: stripRing };
})();
if (typeof module !== 'undefined') module.exports = SnowBpImport;
if (typeof window !== 'undefined') window.SnowBpImport = SnowBpImport;
