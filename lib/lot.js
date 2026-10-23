// Plow Command -- a lot and its islands (lot outlines, 10/22/26). PURE: no Sheet, no page, no network.
// A lot is an outline with holes: the islands (planting beds, buildings, light-pole bases) the plow never
// touches. This file decides whether a hole is a hole, in the server's words, and what a lot's area is net
// of them. The phone's import and editor and the backend's validator all ask here, so the three refuse in
// the same words and show the same number.
//
// The phone app and the Apps Script backend use this SAME file, byte for byte
// (plow-command-script/test/geo-identity.test.js fails if they differ). Apps Script concatenates files into
// one scope, so SnowGeo is a global there; node gets it by require.
//
// Containment and crossing are worked in plain longitude and latitude: whether a point is inside an outline,
// or two edges cross, does not change when one axis is scaled, so no projection is needed. Only the areas go
// through SnowGeo, which projects each ring at its own first corner, as Bootprint does (geo.js is Bootprint's
// verbatim and is not touched here).
var SnowLot = (function () {
  'use strict';
  var Geo = typeof module !== 'undefined' ? require('./geo.js') : null;
  function geo() { return Geo || SnowGeo; }
  // Collinear within this (a cross product of degree differences): a corner exactly on a line, never a near miss.
  var EPS = 1e-12;

  // The server's own test of a corner (roster.js isMapPosition), repeated here so a hole's corners are judged
  // before anything is computed from them.
  function isPosition(p) {
    return Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' &&
      isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  }

  // p lies on the segment a-b: collinear within EPS and inside the segment's bounds.
  function onSegment(p, a, b) {
    var cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) > EPS) return false;
    return p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
      p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
  }

  // Ray casting. A point on an edge or on a corner is NOT inside: a hole whose corner sits on the lot's line
  // is refused, not accepted by a rounding accident.
  function pointInRing(p, ring) {
    var inside = false, n = ring.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var a = ring[i], b = ring[j];
      if (onSegment(p, a, b)) return false;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // A proper crossing of two segments (the ccw test geo.js uses): two edges that only touch at an endpoint,
  // or run along each other, do not cross.
  function ccw(a, b, c) { return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]); }
  function segmentsCross(a1, a2, b1, b2) {
    return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
  }
  function ringsCross(a, b) {
    for (var i = 0; i < a.length; i++) {
      for (var j = 0; j < b.length; j++) {
        if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
      }
    }
    return false;
  }

  // inner sits wholly inside outer: every corner inside, no edge crossing.
  function ringWithin(inner, outer) {
    return inner.every(function (p) { return pointInRing(p, outer); }) && !ringsCross(inner, outer);
  }
  // Two outlines that share no ground: no corner of either inside the other, no edge crossing.
  function ringsApart(a, b) {
    return !a.some(function (p) { return pointInRing(p, b); }) && !b.some(function (p) { return pointInRing(p, a); }) &&
      !ringsCross(a, b);
  }

  // Why `hole` cannot be a hole of the lot `ring`, given the holes already accepted before it (`earlier`), or
  // '' when it can. The words are the server's refusals; the checks run in this order and the first failing
  // one speaks.
  function holeProblem(hole, ring, earlier) {
    if (!Array.isArray(hole) || hole.length < 3) return 'A hole needs at least 3 corners';
    if (!hole.every(isPosition)) return "A hole's corner is not a map position";
    if (geo().isSelfIntersecting(geo().ringToPins(hole))) return 'A hole crosses itself';
    if (!ringWithin(hole, ring)) return 'A hole must be inside the lot';
    for (var i = 0; i < (earlier || []).length; i++) {
      if (!ringsApart(hole, earlier[i])) return 'Holes must not overlap';
    }
    return '';
  }

  // The lot's area in square metres, net of its holes: the ring's area less each hole's, every one by
  // SnowGeo.calcAreaSqm over its own corners. Not rounded here: the caller rounds ONCE, at the end, in square
  // feet (rounding each piece first can land a foot off).
  function areaSqm(ring, holes) {
    var g = geo(), a = g.calcAreaSqm(g.ringToPins(ring));
    (holes || []).forEach(function (h) { a -= g.calcAreaSqm(g.ringToPins(h)); });
    return a;
  }

  return { pointInRing: pointInRing, ringsCross: ringsCross, ringWithin: ringWithin, ringsApart: ringsApart,
    holeProblem: holeProblem, areaSqm: areaSqm };
})();
if (typeof module !== 'undefined') module.exports = SnowLot;
if (typeof window !== 'undefined') window.SnowLot = SnowLot;
