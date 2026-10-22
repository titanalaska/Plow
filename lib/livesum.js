// The live view's summary line (live window, Matt 10/6/26): how the night is going in one
// line, from the same rows the route cards replay. PURE: node tests it directly. Nothing is
// stored; the Storm tab's poll redraws it every 20 s while it is on screen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shiftlog'));
  else root.SnowLiveSum = factory(root.CrewShiftLog);
})(this, function (Log) {
  'use strict';

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }

  // o: { routes: [{id, siteIds}] (live routes, live sites only), zones, log, stormId,
  //      shiftId (the shift running: the summary is THIS shift's, final wave C3; left out, the whole storm),
  //      states (optional: CrewShiftLog.walkStates for that storm and shift, when the caller already has it) }
  // -> { sitesDone, sitesTotal, problems, lastTapAt, routesStarted, routesTotal }
  //   sitesTotal   each site once, however many routes carry it
  //   sitesDone    its lot plowed (CrewShiftLog.siteDone: the newest standing row is plowed), this shift
  //   problems     open Problems (CrewShiftLog.openProblems: a lot whose newest standing row is a Problem), this shift
  //   lastTapAt    the newest REAL tap this shift (never a '*' row, never an undo, never a tap whose undo stands)
  //   routesStarted  routes with a real tap on any of their sites this shift
  // No storm: nothing done, nothing open, no tap; the totals still count what there is.
  function liveSummary(o) {
    var routes = o.routes || [], zones = o.zones || [], stormId = o.stormId || null, shiftId = o.shiftId || null;
    var rows = stormId ? (o.log || []).filter(function (r) { return r.storm_id === stormId && (!shiftId || r.shift_id === shiftId); }) : [];
    var states = o.states || Log.walkStates(o.log || [], stormId, shiftId);
    var siteIds = [], seen = {};
    routes.forEach(function (r) { (r.siteIds || []).forEach(function (id) { if (!seen[id]) { seen[id] = true; siteIds.push(id); } }); });
    var done = stormId ? siteIds.filter(function (id) { return Log.siteDone(id, zones, states); }).length : 0;
    var problems = 0, atSite = {};
    rows.forEach(function (r) { atSite[r.site_id] = true; });
    Object.keys(atSite).forEach(function (id) { problems += Log.openProblems(o.log || [], stormId, id, states).length; });
    var taps = Log.realTaps(rows).slice().sort(bySeq);
    var tapped = {};
    taps.forEach(function (t) { tapped[t.site_id] = true; });
    var started = routes.filter(function (r) { return (r.siteIds || []).some(function (id) { return tapped[id]; }); }).length;
    return { sitesDone: done, sitesTotal: siteIds.length, problems: problems, lastTapAt: taps.length ? taps[taps.length - 1].at : null,
      routesStarted: started, routesTotal: routes.length };
  }

  // The live view's count, in the summary line and on each truck's card: "3 of 5 lots" (lots plowed, of the lots
  // there are). One place for the words, so the two always read alike.
  function lotsWords(done, total) { return done + ' of ' + total + ' lots'; }

  return { liveSummary: liveSummary, lotsWords: lotsWords };
});
