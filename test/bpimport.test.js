// Bootprint -> Plow Command zones (Matt, 10/1/26: trace in Bootprint, import here). Plow Command (10/21/26) brings
// piles and, from 10/22/26, lots: a storage surface becomes a storage zone, the plow surface a lot with its cut-outs as
// holes; walks, hand work and stray cut-outs stay out and are counted.
// Expected values are worked out on paper in the comments, never pasted from a run.
const test = require('node:test');
const assert = require('node:assert');
const BP = require('../lib/bpimport.js');
const G = require('../lib/geo.js');

const DEG = Math.PI / 180, R = 6371000;
const LAT0 = 61.2177, LNG0 = -149.8885; // PAC
// A point x m east and y m north of PAC, as a Bootprint pin.
const pin = (x, y) => ({ lat: LAT0 + y / R / DEG, lng: LNG0 + x / (R * Math.cos(LAT0 * DEG)) / DEG, accuracy: 0 });
const sqm = (ring) => G.calcAreaSqm(G.ringToPins(ring));

const job = (zones, over) => ({ id: 'J1', name: 'PAC', zones, ...over });
const zone = (id, mode, surface, pins, widthFt) => ({ id, name: 'Zone ' + id, mode, surface, pins, widthFt: widthFt == null ? '' : widthFt });
const SQUARE = [pin(0, 0), pin(10, 0), pin(10, 5), pin(0, 5)];

test('a pile area comes across as a storage zone with the same corners', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'storage', SQUARE)]), []);
  assert.strictEqual(r.zones.length, 1);
  const z = r.zones[0];
  assert.strictEqual(z.type, 'storage');
  assert.strictEqual(z.name, 'Zone 1');
  assert.strictEqual(z.from, 'bootprint:J1:1');
  assert.deepStrictEqual(z.ring, SQUARE.map((p) => [p.lng, p.lat]));
  // 10 m x 5 m = 50 m2 (on paper), within 0.5%.
  assert.ok(Math.abs(sqm(z.ring) - 50) < 0.25, sqm(z.ring));
});

test('walks and hand work stay out and are counted apart: they are the Shovel crew\'s, not the plow\'s', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'walk', SQUARE), zone(2, 'area', 'hand', SQUARE), zone(3, 'area', 'walk', SQUARE)]), []);
  assert.deepStrictEqual(r.zones, []);
  // 2 walks (1 and 3), 1 hand (2); nothing else.
  assert.deepStrictEqual(r.skipped, { walks: 2, hands: 1, cutouts: 0, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0, other: 0, onMap: 0 });
});

test('a walk or hand is left out whatever its shape: a run with no width, an unfinished outline', () => {
  // Each is counted by its surface, never by what would have been wrong with its shape: 2 walks, 2 hand, and 0 for
  // noWidth and unfinished (those are a PILE's reasons, which would have come in).
  const r = BP.convertJob(job([zone(1, 'line', 'walk', [pin(0, 0), pin(30, 0)], ''), zone(2, 'area', 'walk', SQUARE.slice(0, 2)),
    zone(3, 'line', 'hand', [pin(0, 0), pin(20, 0), pin(1, 0.5)], '6'), zone(4, 'line', 'hand', [pin(0, 0)], '6')]), []);
  assert.deepStrictEqual(r.zones, []);
  assert.deepStrictEqual(r.skipped, { walks: 2, hands: 2, cutouts: 0, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0, other: 0, onMap: 0 });
});

// Lot outlines (10/22/26): the plow surface comes across as a lot, and a cut-out inside a lot as its island (hole).
test('a plow area and an untyped area come in as lots; a cut-out inside no lot is counted; storage comes in as snow storage', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', SQUARE), zone(2, 'area', 'storage', SQUARE),
    zone(3, 'cut', 'walk', SQUARE), zone(4, 'area', undefined, SQUARE), zone(5, 'cut', 'storage', SQUARE)]), []);
  // In job order: 1 a lot (Matt traces lots as the plow surface), 2 a pile, 4 a lot (a zone with no surface is an older or
  // summer job: Bootprint's default is plow). Neither lot has holes: a cut-out with the lot's own corners is not INSIDE
  // it (every corner sits on its line), so cut-outs 3 and 5 are counted, whatever their surface.
  assert.deepStrictEqual(r.zones.map((z) => [z.from, z.type, 'holes' in z]), [['bootprint:J1:1', 'lot', false], ['bootprint:J1:2', 'storage', false], ['bootprint:J1:4', 'lot', false]]);
  assert.deepStrictEqual(r.skipped, { walks: 0, hands: 0, cutouts: 2, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0, other: 0, onMap: 0 });
  assert.strictEqual(r.islands, 0);
});

// A lot 100 m x 60 m (6,000 m2) with two islands: A 10 x 5 (50 m2) and B 20 x 10 (200 m2): net 5,750 m2 on paper.
const LOT = [pin(0, 0), pin(100, 0), pin(100, 60), pin(0, 60)];
const ISLAND_A = [pin(10, 10), pin(20, 10), pin(20, 15), pin(10, 15)];
const ISLAND_B = [pin(40, 40), pin(60, 40), pin(60, 50), pin(40, 50)];
const OUTSIDE = [pin(200, 0), pin(210, 0), pin(210, 5), pin(200, 5)];           // 100 m east of the lot
const STRADDLES = [pin(95, 10), pin(105, 10), pin(105, 15), pin(95, 15)];       // half in, half out over the east edge
const OVERLAPS_A = [pin(15, 12), pin(25, 12), pin(25, 18), pin(15, 18)];        // its west half lies inside A
const PILE = [pin(70, 10), pin(80, 10), pin(80, 15), pin(70, 15)];
const IN_PILE = [pin(72, 11), pin(74, 11), pin(74, 13), pin(72, 13)];           // inside the pile, and inside the lot too
const ll = (pins) => pins.map((p) => [p.lng, p.lat]);
const Lot = require('../lib/lot.js');

test('a cut-out inside a lot becomes its hole, in job order; two islands; the lot\'s net area is on paper 5,750 m2', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', LOT), zone(2, 'cut', 'plow', ISLAND_A), zone(3, 'cut', 'walk', ISLAND_B)]), []);
  assert.strictEqual(r.zones.length, 1);
  const z = r.zones[0];
  assert.strictEqual(z.type, 'lot');
  assert.deepStrictEqual(z.holes, [ll(ISLAND_A), ll(ISLAND_B)]);   // a cut-out's surface means nothing: it is a hole
  assert.strictEqual(r.islands, 2);
  assert.deepStrictEqual(r.skipped, { walks: 0, hands: 0, cutouts: 0, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0, other: 0, onMap: 0 });
  assert.ok(Math.abs(Lot.areaSqm(z.ring, z.holes) - 5750) < 1, Lot.areaSqm(z.ring, z.holes));
});

test('a cut-out outside, straddling, overlapping a taken island, or inside a pile is counted, never a hole', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', LOT), zone(2, 'cut', 'plow', ISLAND_A), zone(3, 'cut', 'plow', OUTSIDE),
    zone(4, 'cut', 'plow', STRADDLES), zone(5, 'cut', 'plow', OVERLAPS_A), zone(6, 'area', 'storage', PILE), zone(7, 'cut', 'storage', IN_PILE)]), []);
  // The lot keeps A and IN_PILE: IN_PILE sits inside the pile, but inside the lot too, and Bootprint takes a cut-out off
  // every area it lies in, the lot's plow figure included, so the lot's number is net of it here as well (ruling,
  // 10/22/26); the pile itself has no holes and keeps its whole area. OUTSIDE is in no lot; STRADDLES crosses the lot's
  // edge; OVERLAPS_A is inside the lot but not apart from A, already taken. Three counted.
  assert.deepStrictEqual(r.zones.map((z) => [z.type, z.holes]), [['lot', [ll(ISLAND_A), ll(IN_PILE)]], ['storage', undefined]]);
  assert.strictEqual(r.skipped.cutouts, 3);
  assert.strictEqual(r.islands, 2);
});

// A cut-out that crosses itself (a pin tapped out of order) would ride in as a hole the server refuses ("A hole crosses
// itself"), stopping the whole import at the lot. The import asks the same question the server does (SnowLot.holeProblem,
// spec §1) and leaves such a cut-out out, counted; the lot and its sound islands still come in. BOWTIE_A is island A's
// corners in the order SW, NE, SE, NW: its two diagonals cross.
test('a self-crossing cut-out inside the lot is counted, never a hole; the lot and its other island still come in', () => {
  const BOWTIE_A = [ISLAND_A[0], ISLAND_A[2], ISLAND_A[1], ISLAND_A[3]];
  const r = BP.convertJob(job([zone(1, 'area', 'plow', LOT), zone(2, 'cut', 'plow', BOWTIE_A), zone(3, 'cut', 'plow', ISLAND_B)]), []);
  assert.deepStrictEqual(r.zones.map((z) => [z.type, z.holes]), [['lot', [ll(ISLAND_B)]]]);
  assert.strictEqual(r.skipped.cutouts, 1);
  assert.strictEqual(r.islands, 1);
  // Every hole carried is one the server accepts, in its words.
  r.zones[0].holes.forEach((h, i) => assert.strictEqual(Lot.holeProblem(h, r.zones[0].ring, r.zones[0].holes.slice(0, i)), ''));
});

test('a cut-out whose lot was imported before follows it: counted under already, not as a cut-out', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', LOT), zone(2, 'cut', 'plow', ISLAND_A)]), ['bootprint:J1:1']);
  assert.deepStrictEqual(r.zones, []);
  assert.deepStrictEqual(r.skipped, { walks: 0, hands: 0, cutouts: 0, noWidth: 0, tooSharp: 0, already: 1, unfinished: 0, other: 0, onMap: 0 });
  assert.strictEqual(r.islands, 0);
});

test('a plow run with a width is a lot strip; with none it is skipped', () => {
  // A plowed lane drawn as a 50 m line, 24 ft (7.3152 m) wide: 365.76 m2, typed lot, no holes.
  const r = BP.convertJob(job([zone(1, 'line', 'plow', [pin(0, 0), pin(50, 0)], '24')]), []);
  assert.deepStrictEqual(r.zones.map((z) => [z.type, 'holes' in z]), [['lot', false]]);
  assert.ok(Math.abs(sqm(r.zones[0].ring) - 365.76) < 0.5, sqm(r.zones[0].ring));
  const none = BP.convertJob(job([zone(1, 'line', 'plow', [pin(0, 0), pin(50, 0)], '')]), []);
  assert.deepStrictEqual([none.zones, none.skipped.noWidth], [[], 1]);
});

// ANMC (10/4/26, the zone-types spec): one import brought "26 walks/hand zones + 3 piles". The real export is a
// customer site's data and never goes in this PUBLIC repo, so this is a stand-in built here: the kinds Matt's ANMC trace
// holds (walk areas, hand areas, hand runs with a width, pile areas, a walk's and a pile's cut-out), at those counts, on
// made-up corners west of PAC. On paper: 11 walk areas + 6 hand areas + 9 hand runs = 26 walks/hand; 3 pile areas;
// 2 cut-outs. 31 shapes = 3 in + 11 + 15 + 2 out.
const ANMC = () => {
  const zs = [];
  let id = 0;
  const rect = (x) => [pin(x, 0), pin(x + 8, 0), pin(x + 8, 4), pin(x, 4)];
  for (let i = 0; i < 11; i++) zs.push(zone(++id, 'area', 'walk', rect(-400 + 10 * i)));
  for (let i = 0; i < 6; i++) zs.push(zone(++id, 'area', 'hand', rect(-250 + 10 * i)));
  for (let i = 0; i < 9; i++) zs.push(zone(++id, 'line', 'hand', [pin(-180 + 10 * i, 20), pin(-180 + 10 * i, 40)], '4'));
  zs.push(zone(++id, 'cut', 'walk', rect(-400)));
  for (let i = 0; i < 3; i++) zs.push({ ...zone(++id, 'area', 'storage', rect(-60 + 20 * i)), name: 'Snow pile ' + (i + 1) });
  zs.push(zone(++id, 'cut', 'storage', rect(-60)));
  return job(zs, { id: 'ANMC-STANDIN', name: 'ANMC-shaped job' });
};

test('an ANMC-sized job: its 3 piles come in, its 26 walks and hand stay out, every count exact', () => {
  const j = ANMC();
  assert.strictEqual(j.zones.length, 31); // the fixture is what the comment says
  const r = BP.convertJob(j, []);
  // The piles are ids 28, 29, 30 (after 11 + 6 + 9 + 1 cut-out = 27), all storage, in order.
  assert.deepStrictEqual(r.zones.map((z) => [z.name, z.type, z.from]), [
    ['Snow pile 1', 'storage', 'bootprint:ANMC-STANDIN:28'], ['Snow pile 2', 'storage', 'bootprint:ANMC-STANDIN:29'],
    ['Snow pile 3', 'storage', 'bootprint:ANMC-STANDIN:30']]);
  assert.deepStrictEqual(r.skipped, { walks: 11, hands: 15, cutouts: 2, noWidth: 0, tooSharp: 0, already: 0, unfinished: 0, other: 0, onMap: 0 });
  assert.strictEqual(r.skipped.walks + r.skipped.hands, 26);
  // Each pile keeps its corners: 8 m x 4 m = 32 m2.
  r.zones.forEach((z) => assert.ok(Math.abs(sqm(z.ring) - 32) < 0.2, sqm(z.ring)));
});

test('a storage run with a width becomes a storage strip', () => {
  // A pile drawn as a 20 m line, 10 ft wide: a strip like any run, typed storage.
  const r = BP.convertJob(job([zone(1, 'line', 'storage', [pin(0, 0), pin(20, 0)], 10)]), []);
  assert.deepStrictEqual(r.zones.map((z) => z.type), ['storage']);
  // 20 m x 3.048 m = 60.96 m2.
  assert.ok(Math.abs(sqm(r.zones[0].ring) - 60.96) < 0.3, sqm(r.zones[0].ring));
});

test('a pile run with no width is skipped, not given a made-up width', () => {
  const r = BP.convertJob(job([zone(1, 'line', 'storage', [pin(0, 0), pin(30, 0)], '')]), []);
  assert.strictEqual(r.zones.length, 0);
  assert.strictEqual(r.skipped.noWidth, 1);
});

test('a straight pile run becomes a strip of its width', () => {
  // 30 m long, 10 ft (3.048 m) wide: 30 x 3.048 = 91.44 m2 = 984.25 sq ft.
  const r = BP.convertJob(job([zone(1, 'line', 'storage', [pin(0, 0), pin(30, 0)], '10')]), []);
  assert.strictEqual(r.zones.length, 1);
  assert.strictEqual(r.zones[0].ring.length, 4);
  assert.ok(Math.abs(sqm(r.zones[0].ring) - 91.44) < 0.5, sqm(r.zones[0].ring));
});

test('a pile run that turns a corner keeps its full area (mitred corner)', () => {
  // 20 m east then 20 m north, 2 m wide (6.5617 ft). Edges: y=+-1 and x=19/21, mitres at
  // (19,1) and (21,-1): 21 x 2 + 2 x 19 = 80 m2 = centreline 40 m x 2 m.
  const r = BP.convertJob(job([zone(1, 'line', 'storage', [pin(0, 0), pin(20, 0), pin(20, 20)], String(2 / 0.3048))]), []);
  assert.strictEqual(r.zones.length, 1);
  assert.strictEqual(r.zones[0].ring.length, 6);
  assert.ok(Math.abs(sqm(r.zones[0].ring) - 80) < 0.5, sqm(r.zones[0].ring));
  assert.strictEqual(G.isSelfIntersecting(G.ringToPins(r.zones[0].ring)), false);
});

test('a pile run that doubles back on itself is skipped: trace it as an area', () => {
  // 20 m east then straight back 19 m: the two halves of the strip overlap.
  const r = BP.convertJob(job([zone(1, 'line', 'storage', [pin(0, 0), pin(20, 0), pin(1, 0.5)], '6')]), []);
  assert.strictEqual(r.zones.length, 0);
  assert.strictEqual(r.skipped.tooSharp, 1);
});

test('unfinished pile shapes (too few corners) are skipped', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'storage', SQUARE.slice(0, 2)), zone(2, 'line', 'storage', [pin(0, 0)], '6')]), []);
  assert.strictEqual(r.zones.length, 0);
  assert.strictEqual(r.skipped.unfinished, 2);
});

test('importing the same job again adds nothing', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'storage', SQUARE), zone(2, 'area', 'storage', SQUARE)]), ['bootprint:J1:1']);
  assert.deepStrictEqual(r.zones.map((z) => z.from), ['bootprint:J1:2']);
  assert.strictEqual(r.skipped.already, 1);
});

test('the export file is read; anything else is refused with a reason', () => {
  const file = JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [job([zone(1, 'area', 'walk', SQUARE)])],
    current: { jobId: 'J9', zones: [zone(1, 'area', 'walk', SQUARE)] } });
  const p = BP.parseExport(file);
  assert.strictEqual(p.error, undefined);
  // The job open in Bootprint is not filed yet; it comes along too.
  assert.deepStrictEqual(p.jobs.map((j) => j.id), ['J1', 'J9']);
  assert.match(BP.parseExport('{"hello":1}').error, /Bootprint export/);
  assert.match(BP.parseExport('not json').error, /Bootprint export/);
});

test('jobs are listed nearest the site first', () => {
  const far = job([zone(1, 'area', 'walk', SQUARE.map((p) => ({ ...p, lat: p.lat + 0.1 })))], { id: 'FAR', name: 'Far' });
  const near = job([zone(1, 'area', 'walk', SQUARE)], { id: 'NEAR', name: 'Near' });
  const sorted = BP.byDistance([far, near], [LNG0, LAT0]);
  assert.deepStrictEqual(sorted.map((s) => s.job.id), ['NEAR', 'FAR']);
  assert.ok(sorted[0].meters < 20 && sorted[1].meters > 10000); // 0.1 deg of latitude is ~11.1 km
});

// The pulled pile (Blood Bank and VCA, 10/23-24): the Pull from Shovel Command brings a site's piles in WITHOUT a `from`, so
// "already imported" cannot see them and every import of the job added them a second time. convertJob takes a third
// argument, the corners of the site's LIVE piles. A pile of the job whose corners are one of those (SnowLot.sameRing: the
// same corners in the same order, each equal on the 7-decimal grid, lot.test.js in the backend has the arithmetic) IS that
// pile and stays out, counted as onMap. The server answers the same way (it will not write such a pile), so a stale preview
// cannot add it either. Walks, hand work and lots are never matched: only a pile is a pile.
test('a pile whose corners are a pile already on the map stays out and is counted; the lot and the other pile come in', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', LOT), zone(2, 'area', 'storage', PILE), zone(3, 'area', 'storage', ISLAND_B)]), [], [ll(PILE)]);
  assert.deepStrictEqual(r.zones.map((z) => [z.name, z.type]), [['Zone 1', 'lot'], ['Zone 3', 'storage']]);
  assert.strictEqual(r.skipped.onMap, 1);
  assert.strictEqual(r.skipped.already, 0);
});

test('a pulled pile that lost digits beyond the 7th decimal is still that pile; one grid step off is another pile', () => {
  const pins = (pts) => pts.map(([lng, lat]) => ({ lng, lat, accuracy: 0 }));
  const JOB_PILE = pins([[-149.9004, 61.2], [-149.9, 61.2], [-149.9, 61.2002], [-149.9004, 61.2002]]);
  // -149.90040004 x 1e7 = -1,499,004,000.4 -> -1,499,004,000, the grid point of -149.9004; likewise 61.20000004 -> 61.2.
  const PULLED = [[-149.90040004, 61.20000004], [-149.9, 61.2], [-149.9, 61.2002], [-149.9004, 61.2002]];
  const same = BP.convertJob(job([zone(1, 'area', 'storage', JOB_PILE)]), [], [PULLED]);
  assert.deepStrictEqual(same.zones, []);
  assert.strictEqual(same.skipped.onMap, 1);
  // 61.2000001 x 1e7 = 612,000,001, not 612,000,000: a grid step on one corner is another pile.
  const STEP = [[-149.9004, 61.2000001], [-149.9, 61.2], [-149.9, 61.2002], [-149.9004, 61.2002]];
  const other = BP.convertJob(job([zone(1, 'area', 'storage', JOB_PILE)]), [], [STEP]);
  assert.strictEqual(other.zones.length, 1);
  assert.strictEqual(other.skipped.onMap, 0);
});

test('a lot, a walk or a hand shape with a pile\'s corners is not that pile', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', PILE), zone(2, 'area', 'walk', PILE), zone(3, 'area', 'hand', PILE)]), [], [ll(PILE)]);
  assert.deepStrictEqual(r.zones.map((z) => z.type), ['lot']);
  assert.strictEqual(r.skipped.walks, 1);
  assert.strictEqual(r.skipped.hands, 1);
  assert.strictEqual(r.skipped.onMap, 0);
});

test('a pile run is matched by the strip it comes across as: the same run is that pile, another width is another pile', () => {
  const run = (w) => zone(1, 'line', 'storage', [pin(0, 0), pin(30, 0)], w);
  const strip = BP.convertJob(job([run(10)]), []).zones[0].ring;      // what the earlier import stored for a 10 ft run
  const same = BP.convertJob(job([run(10)]), [], [strip]);
  assert.deepStrictEqual(same.zones, []);
  assert.strictEqual(same.skipped.onMap, 1);
  const wider = BP.convertJob(job([run(12)]), [], [strip]);
  assert.strictEqual(wider.zones.length, 1);
  assert.strictEqual(wider.skipped.onMap, 0);
});

test('a pile imported before (its from) is counted as already, not as on the map, even when its corners match too', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'storage', PILE)]), ['bootprint:J1:1'], [ll(PILE)]);
  assert.deepStrictEqual(r.zones, []);
  assert.strictEqual(r.skipped.already, 1);
  assert.strictEqual(r.skipped.onMap, 0);
});

test('a cut-out inside a pile that stays out is still the lot\'s hole: leaving the pile out does not drop the island', () => {
  const r = BP.convertJob(job([zone(1, 'area', 'plow', LOT), zone(2, 'area', 'storage', PILE), zone(3, 'cut', 'plow', IN_PILE)]), [], [ll(PILE)]);
  assert.deepStrictEqual(r.zones.map((z) => [z.type, z.holes]), [['lot', [ll(IN_PILE)]]]);
  assert.strictEqual(r.islands, 1);
  assert.strictEqual(r.skipped.onMap, 1);
  assert.strictEqual(r.skipped.cutouts, 0);
});
