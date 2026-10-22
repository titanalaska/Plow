// The live view's summary line (live window, Matt 10/6/26): one line that says how the
// night is going, from the same rows the route cards replay. Worked by hand below.
// Plow Command (10/21/26): the lot is the unit. Every site is one Lot, zone_id 'lot', plowed or problem;
// a site is done when its lot's newest standing row is plowed. Zones (piles) are drawings and change nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/livesum.js');

// Five sites. S1 has two piles drawn, the rest nothing: every one is the same one Lot.
// S2 sits on two routes (counted once).
const zones = [
  { id: 'Z1', site_id: 'S1', type: 'storage', ring: [[0, 0], [0, 1], [1, 1]] },
  { id: 'Z2', site_id: 'S1', type: 'storage', ring: [[0, 0], [0, 1], [1, 1]] },
];
const routes = [{ id: 'R1', siteIds: ['S1', 'S2'] }, { id: 'R2', siteIds: ['S2', 'S3'] }, { id: 'R3', siteIds: ['S2'] },
  { id: 'R4', siteIds: ['S4', 'S5'] }];
const ST = 'ST-1';
const row = (seq, site, zone, state, extra) => Object.assign({ id: 'L-' + seq, seq, storm_id: ST, site_id: site, zone_id: zone, state, note: '',
  at: '2026-12-04T19:' + String(seq * 5).padStart(2, '0') + ':00-09:00' }, extra || {});
// 1: S1 plowed (done). 2: a Problem at S2, 3: undone (not a tap, and S2's lot goes back to none).
// 4: a Problem at S3 (open). 5: a depth reading at S3 ('*' row: never a tap).
// 6: S4 plowed (done). 7: S5 plowed, 8: then a Problem at S5 (open, so S5 is NOT done: a problem lot still needs plowing).
const log = [row(1, 'S1', 'lot', 'plowed'), row(2, 'S2', 'lot', 'problem', { note: 'gate locked' }),
  row(3, 'S2', 'lot', 'none', { undoes: 'L-2' }), row(4, 'S3', 'lot', 'problem', { note: 'cars in the lot' }),
  row(5, 'S3', '*', 'depth', { depth_in: 2 }), row(6, 'S4', 'lot', 'plowed'), row(7, 'S5', 'lot', 'plowed'),
  row(8, 'S5', 'lot', 'problem', { note: 'drift at the gate' })];

test('the summary: sites once each, done by a plowed lot, open problems, the newest REAL tap, routes with a real tap', () => {
  const s = L.liveSummary({ routes, zones, log, stormId: ST });
  // Sites S1..S5 once each: 5. Done: S1 and S4 (plowed); S2 back to none; S3 and S5 stand at a Problem: 2.
  // Open problems: S3 and S5: 2. The newest real tap is row 8 at 19:40 (row 5 is a reading, row 3 an undo).
  // R1 started (S1), R2 started (S3), R4 started (S4, S5); R3's only site had its tap undone: 3 of 4.
  assert.deepEqual(s, { sitesDone: 2, sitesTotal: 5, problems: 2, lastTapAt: '2026-12-04T19:40:00-09:00', routesStarted: 3, routesTotal: 4 });
});

test('the summary with no storm: nothing done, nothing open, no tap, but the counts of what there is', () => {
  assert.deepEqual(L.liveSummary({ routes, zones, log, stormId: null }),
    { sitesDone: 0, sitesTotal: 5, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: 4 });
});

test("the summary ignores another storm's rows", () => {
  const old = log.map((r) => Object.assign({}, r, { storm_id: 'ST-0' }));
  assert.deepEqual(L.liveSummary({ routes, zones, log: old, stormId: ST }),
    { sitesDone: 0, sitesTotal: 5, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: 4 });
});

test('the summary takes the states already worked out, when the caller has them', () => {
  const CrewShiftLog = require('../lib/shiftlog.js');
  const states = CrewShiftLog.walkStates(log, ST);
  assert.deepEqual(L.liveSummary({ routes, zones, log, stormId: ST, states }), L.liveSummary({ routes, zones, log, stormId: ST }));
});

test('the summary: a lot is a lot whatever its map holds; piles and zones never count as done or as a walk', () => {
  // The same log with no zones at all, and with S2 given a keep-clear area too: the same answer as above.
  const none = L.liveSummary({ routes, zones: [], log, stormId: ST });
  const more = L.liveSummary({ routes, zones: zones.concat([{ id: 'Z9', site_id: 'S2', type: 'no_touch', ring: [[0, 0], [0, 1], [1, 1]] }]), log, stormId: ST });
  assert.deepEqual(none, L.liveSummary({ routes, zones, log, stormId: ST }));
  assert.deepEqual(more, none);
  // There is no Touched in Plow Command: the summary has no such key.
  assert.equal('sitesTouched' in none, false);
});

test('livesum words: 3 of 5 lots', () => {
  // Three lots plowed of five: "3 of 5 lots". The truck cards and the summary line both read it from here.
  assert.equal(L.lotsWords(3, 5), '3 of 5 lots');
  // Nothing plowed yet, and a truck with one site.
  assert.equal(L.lotsWords(0, 5), '0 of 5 lots');
  assert.equal(L.lotsWords(1, 1), '1 of 1 lots');
  // From the summary above: S1 and S4 plowed of five sites.
  const s = L.liveSummary({ routes, zones, log, stormId: ST });
  assert.equal(L.lotsWords(s.sitesDone, s.sitesTotal), '2 of 5 lots');
});

test('the summary of THIS shift: a night plowed lot is not done on the day; the day\'s own taps alone count (C3)', () => {
  // Final wave C3: a lot is done this shift. The rows above are all the night's ('night-2026-12-04'). The day shift
  // ('day-2026-12-05') adds: 9 S2 plowed at 09:45 (done today), 10 a Problem at S4 "drift back" (open today).
  // Night of 12/4 (shiftId the night): the rows above, as the whole-storm answer: 2 done, 2 problems, last 19:40, 3 of 4 started.
  // Day of 12/5: S2 done (seq 9) -> 1 done; S4's newest DAY row is a Problem -> 1 problem (S3's and S5's are the night's);
  //   last real tap of the day is seq 10 at 10:00; started: R1, R2, R3 (S2 on each) and R4 (S4) -> 4 of 4.
  const night = log.map((r) => Object.assign({ shift_id: 'night-2026-12-04' }, r));
  const day = [
    Object.assign(row(9, 'S2', 'lot', 'plowed'), { shift_id: 'day-2026-12-05', at: '2026-12-05T09:45:00-09:00' }),
    Object.assign(row(10, 'S4', 'lot', 'problem', { note: 'drift back' }), { shift_id: 'day-2026-12-05', at: '2026-12-05T10:00:00-09:00' }),
  ];
  const all = night.concat(day);
  assert.deepEqual(L.liveSummary({ routes, zones, log: all, stormId: ST, shiftId: 'night-2026-12-04' }),
    { sitesDone: 2, sitesTotal: 5, problems: 2, lastTapAt: '2026-12-04T19:40:00-09:00', routesStarted: 3, routesTotal: 4 });
  assert.deepEqual(L.liveSummary({ routes, zones, log: all, stormId: ST, shiftId: 'day-2026-12-05' }),
    { sitesDone: 1, sitesTotal: 5, problems: 1, lastTapAt: '2026-12-05T10:00:00-09:00', routesStarted: 4, routesTotal: 4 });
  // The first minute of a shift nobody has tapped yet: nothing done, nothing open, no tap, no route started.
  assert.deepEqual(L.liveSummary({ routes, zones, log: all, stormId: ST, shiftId: 'night-2026-12-05' }),
    { sitesDone: 0, sitesTotal: 5, problems: 0, lastTapAt: null, routesStarted: 0, routesTotal: 4 });
});
