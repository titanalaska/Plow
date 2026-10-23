// Matt's rule (10/1/26): warn only when NO photo loads at all.
const test = require('node:test');
const assert = require('node:assert');
const { photoUnavailable } = require('../lib/mapview.js');

test('both photos load: no banner', () => assert.strictEqual(photoUnavailable(true, true, true), false));
test('Esri down, MOA fine: MOA is a photo, no banner', () => assert.strictEqual(photoUnavailable(false, true, true), false));
test('Esri fine, MOA down: blurrier, still a photo, no banner', () => assert.strictEqual(photoUnavailable(true, false, true), false));
test('outside MOA, Esri fine: no banner', () => assert.strictEqual(photoUnavailable(true, false, false), false));
test('both down: banner', () => assert.strictEqual(photoUnavailable(false, false, true), true));
test('outside MOA, Esri down: banner', () => assert.strictEqual(photoUnavailable(false, false, false), true));
// A stray MOA "ok" outside its area can't count as a photo: MOA was never asked.
test('outside MOA, Esri down, moaOk somehow true: still banner', () => assert.strictEqual(photoUnavailable(false, true, false), true));

// ---- Plow Command's three kinds (spec, 10/21/26) ----
// Two areas and an arrow, and nothing else: a pile (storage), keep clear (no_touch), and a push arrow, a
// white line with a dark edge. The lot itself has no polygon (the aerial is the lot), and the Shovel crew's
// sidewalk, hand and heated are gone. Key order is the legend's order.
const SnowMap = require('../lib/mapview.js');
// Lot outlines (10/22/26): a fourth kind, the lot itself, last, in Bootprint's plow green (the "match Bootprint" rule).
test('TYPES: storage, no_touch, push, lot, in that order, with their colours and labels', () => {
  assert.deepStrictEqual(SnowMap.TYPES, {
    storage: { color: '#7d5ba6', label: 'Snow storage' },
    no_touch: { color: '#e0218a', label: 'Keep clear' },
    push: { color: '#ffffff', edge: '#1a1a1a', label: 'Push snow this way' },
    lot: { color: '#2d6a2d', label: 'Lot' },
  });
  assert.deepStrictEqual(Object.keys(SnowMap.TYPES), ['storage', 'no_touch', 'push', 'lot']);
});

test('the legend: four rows in TYPES order, the arrow\'s white swatch edged dark so it shows on the white legend', () => {
  const html = SnowMap.legendHtml();
  const labels = [...html.matchAll(/<\/i>([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepStrictEqual(labels, ['Snow storage', 'Keep clear', 'Push snow this way', 'Lot']);
  const swatches = [...html.matchAll(/<i style="([^"]*)"><\/i>/g)].map((m) => m[1]);
  assert.strictEqual(swatches.length, 4);
  assert.match(swatches[0], /background:#7d5ba6/);
  assert.match(swatches[1], /background:#e0218a/);
  assert.match(swatches[2], /background:#ffffff/);
  assert.match(swatches[2], /#1a1a1a/);                 // the edge colour, on the push row only
  assert.match(swatches[3], /background:#2d6a2d/);
  assert.doesNotMatch(swatches[0] + swatches[1] + swatches[3], /#1a1a1a/);
});

test('the colour expression names the four kinds and only them, grey for anything else', () => {
  assert.deepStrictEqual(SnowMap.typeColour('#888888'),
    ['match', ['get', 'type'], 'storage', '#7d5ba6', 'no_touch', '#e0218a', 'push', '#ffffff', 'lot', '#2d6a2d', '#888888']);
});

// ---- the arrow's head ----
// Metres per degree at the tip: dx = cos(lat) x 111,320 per degree of longitude, dy = 110,540 per degree of latitude.
// Worked on paper at the tip's latitude, 61.2 N:
//   cos 61.2 deg = cos 61 cos 0.2 - sin 61 sin 0.2 = 0.4848096202 x 0.9999939077 - 0.8746197071 x 0.0034906514
//                = 0.4848066666 - 0.0030529924 = 0.4817536742
//   dx = 0.4817536742 x 111,320 = 53,628.8190 m per degree;  1/dx = 0.000018646686 deg per metre
//   dy = 110,540 m per degree;                                1/dy = 0.000009046499 deg per metre
// The head is a closed ring [tip, left, right, tip]: tip = the last corner; the base centre sits 4 m back along the last
// leg (from the second-last corner toward the tip); left and right are 2 m either side of it, left being to the left of
// the way the arrow points.
const DX = Math.cos(61.2 * Math.PI / 180) * 111320, DY = 110540;
const TIP = [-149.9, 61.2];
const closeTo = (got, want, tol, what) => {
  assert.strictEqual(got.length, want.length, what + ': ' + JSON.stringify(got));
  got.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - want[i][0]) <= tol && Math.abs(p[1] - want[i][1]) <= tol,
      what + ' corner ' + i + ': got ' + JSON.stringify(p) + ', want ' + JSON.stringify(want[i]));
  });
};

test('arrowHead: an arrow pointing due east, its last leg 10 m long', () => {
  // The previous corner is 10 m due west of the tip: lng -149.9 - 10/dx, the same latitude. The leg points east, so:
  //   base centre = 4 m west of the tip:  lng -149.9 - 4 x 0.000018646686 = -149.9 - 0.000074586744 = -149.900074586744
  //   left  = 2 m NORTH of the base (left of an arrow heading east): lat 61.2 + 2 x 0.000009046499 = 61.200018092998
  //   right = 2 m SOUTH of it:                                       lat 61.2 - 0.000018092998     = 61.199981907002
  // 1e-9 deg is 0.1 mm of latitude: far inside the rounding of these hand figures, far outside any wrong head.
  const prev = [TIP[0] - 10 / DX, TIP[1]];
  const head = SnowMap.arrowHead([[TIP[0] - 30 / DX, TIP[1] + 0.0001], prev, TIP]); // a first corner elsewhere: only the last leg counts
  closeTo(head, [[-149.9, 61.2], [-149.900074586744, 61.200018092998], [-149.900074586744, 61.199981907002], [-149.9, 61.2]], 1e-9, 'east');
  assert.deepStrictEqual(head[0], TIP);                  // the tip IS the last corner, exactly
  assert.deepStrictEqual(head[3], head[0]);              // closed
});

test('arrowHead: an arrow pointing north-east, its last leg 6 m east and 8 m north (10 m)', () => {
  // The previous corner is 6 m west and 8 m south of the tip: lng -149.9 - 6/dx, lat 61.2 - 8/dy. The leg's direction
  // in metres is u = (6, 8) / 10 = (0.6 east, 0.8 north); its left is (-0.8, 0.6).
  //   base centre = tip - 4u            = (-2.4 m east, -3.2 m north) of the tip
  //   left  = base + 2 x (-0.8, 0.6)    = (-4.0 m, -2.0 m): lng -149.9 - 4.0 x 0.000018646686 = -149.900074586744
  //                                                         lat 61.2 - 2.0 x 0.000009046499 = 61.199981907002
  //   right = base - 2 x (-0.8, 0.6)    = (-0.8 m, -4.4 m): lng -149.9 - 0.8 x 0.000018646686 = -149.900014917349
  //                                                         lat 61.2 - 4.4 x 0.000009046499 = 61.199960195404
  // Both offsets are in metres before they become degrees: a head worked in degrees would lean on a map this far north.
  const prev = [TIP[0] - 6 / DX, TIP[1] - 8 / DY];
  const head = SnowMap.arrowHead([prev, TIP]);
  closeTo(head, [[-149.9, 61.2], [-149.900074586744, 61.199981907002], [-149.900014917349, 61.199960195404], [-149.9, 61.2]], 1e-9, 'north-east');
});

test('arrowHead: null when there is no last leg to point along (fewer than 2 corners, or the last two coincide)', () => {
  assert.strictEqual(SnowMap.arrowHead([]), null);
  assert.strictEqual(SnowMap.arrowHead([TIP]), null);
  assert.strictEqual(SnowMap.arrowHead([[-149.91, 61.2], TIP, [TIP[0], TIP[1]]]), null); // a double tap on the last corner
  assert.strictEqual(SnowMap.arrowHead([[TIP[0], TIP[1]], [TIP[0], TIP[1]]]), null);
});

// ---- the zones as GeoJSON ----
// An area is a Polygon (its ring closed); an arrow is a LineString through its corners in order, plus its head as a
// Polygon with its own id (<zone id>:head) and type push_head. A zone of any other type (a hand-edited Sheet row) and a
// ring too short for its kind draw nothing: no feature at all, so nothing can log about it either.
const PILE = { id: 'Z1', type: 'storage', name: 'Pile 1', ring: [[0, 0], [1, 0], [1, 1]] };
const CLEAR = { id: 'Z2', type: 'no_touch', name: 'Ramp', ring: [[2, 2], [3, 2], [3, 3], [2, 3]] };
// An arrow with a bend (fix round 1, 10/21/26): 10 m east, then 8 m north. Three corners, not on one line, so a line
// that kept only some of them, or a head built from any leg but the last, cannot pass.
const PUSH = { id: 'Z3', type: 'push', name: 'Push east then north', ring: [[-149.9 - 10 / DX, 61.2 - 8 / DY], [-149.9, 61.2 - 8 / DY], [-149.9, 61.2]], area_sqft: 0 };
test('featureCollection: a pile and a keep-clear are closed Polygons with only id and type', () => {
  const fc = SnowMap.featureCollection([PILE, CLEAR]);
  assert.strictEqual(fc.type, 'FeatureCollection');
  assert.deepStrictEqual(fc.features, [
    { type: 'Feature', properties: { id: 'Z1', type: 'storage' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    { type: 'Feature', properties: { id: 'Z2', type: 'no_touch' }, geometry: { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]] } },
  ]);
  assert.deepStrictEqual(PILE.ring, [[0, 0], [1, 0], [1, 1]]); // the zone's own ring is not closed in place
});

test('featureCollection: a push is a LineString (not closed) and then its head, a Polygon of arrowHead\'s ring', () => {
  const fc = SnowMap.featureCollection([PILE, PUSH, CLEAR]);
  assert.deepStrictEqual(fc.features.map((f) => [f.properties.id, f.properties.type, f.geometry.type]), [
    ['Z1', 'storage', 'Polygon'], ['Z3', 'push', 'LineString'], ['Z3:head', 'push_head', 'Polygon'], ['Z2', 'no_touch', 'Polygon']]);
  assert.deepStrictEqual(fc.features[1].properties, { id: 'Z3', type: 'push' });
  // The line goes through EVERY corner, in order: all three, the bend included.
  assert.strictEqual(fc.features[1].geometry.coordinates.length, 3);
  assert.deepStrictEqual(fc.features[1].geometry.coordinates, PUSH.ring);
  assert.deepStrictEqual(fc.features[2].properties, { id: 'Z3:head', type: 'push_head' });
  assert.deepStrictEqual(fc.features[2].geometry.coordinates, [SnowMap.arrowHead(PUSH.ring)]);
  // The head is built from the LAST leg, corner 2 -> corner 3, which runs due north (8 m). Worked on paper with the
  // figures above (1/dx = 0.000018646686, 1/dy = 0.000009046499 deg per metre):
  //   tip   = corner 3 = (-149.9, 61.2)
  //   base  = 4 m south of the tip, toward corner 2 (same longitude): lat 61.2 - 4 x 0.000009046499 = 61.199963814004
  //   left  = 2 m WEST of the base (left of an arrow heading north): lng -149.9 - 2 x 0.000018646686 = -149.900037293372
  //   right = 2 m EAST of it:                                         lng -149.9 + 0.000037293372   = -149.899962706628
  // A head built from the first leg (heading east) or from corner 1 to the tip (north-east) would sit elsewhere.
  closeTo(fc.features[2].geometry.coordinates[0],
    [[-149.9, 61.2], [-149.900037293372, 61.199963814004], [-149.899962706628, 61.199963814004], [-149.9, 61.2]], 1e-9, 'last leg');
});

test('featureCollection: a push whose last two corners coincide is its line alone, no head', () => {
  const doubled = { id: 'Z4', type: 'push', name: 'Tapped twice', ring: [[-149.9, 61.199], [-149.9, 61.2], [-149.9, 61.2]] };
  const fc = SnowMap.featureCollection([doubled]);
  assert.deepStrictEqual(fc.features.map((f) => [f.properties.id, f.properties.type, f.geometry.type]), [['Z4', 'push', 'LineString']]);
  assert.deepStrictEqual(fc.features[0].geometry.coordinates, doubled.ring); // all three corners, the doubled one too
});

test('featureCollection: another type, or a ring too short for its kind, draws nothing', () => {
  const zones = [
    { id: 'X1', type: 'sidewalk', ring: [[0, 0], [1, 0], [1, 1]] },   // a Shovel type typed into the Sheet by hand
    { id: 'X2', type: 'heated', ring: [[0, 0], [1, 0], [1, 1]] },
    { id: 'X3', type: 'storage', ring: [[0, 0], [1, 0]] },            // an area needs 3 corners
    { id: 'X4', type: 'push', ring: [[0, 0]] },                       // an arrow needs 2
    { id: 'X5', type: 'no_touch' },                                    // no ring at all
    { id: 'X6', type: 'storage', ring: [[0, 0], [1, 'x'], [1, 1]] },  // a corner that is not a position
    PILE,
  ];
  assert.deepStrictEqual(SnowMap.featureCollection(zones).features.map((f) => f.properties.id), ['Z1']);
});

// ---- a zone's card, on a tap ----
test('sheetHtml: a pile shows its name, kind, note and area, as before', () => {
  const html = SnowMap.sheetHtml({ id: 'Z1', type: 'storage', name: 'Back pile', note: 'Stack it high', area_sqft: 1076.4 });
  assert.match(html, /Back pile/);
  assert.match(html, /Snow storage/);
  assert.match(html, /Stack it high/);
  assert.match(html, /≈ 1,076 sq ft/);
});

test('sheetHtml: a push arrow shows its name and note only: no kind line, no area (an arrow has none)', () => {
  const html = SnowMap.sheetHtml({ id: 'Z3', type: 'push', name: 'Push to the NE corner', note: 'Not past the dumpster', area_sqft: 0, priority: true });
  assert.strictEqual(html, '<h2 data-no-es>Push to the NE corner</h2><div data-no-es>Not past the dumpster</div>');
  assert.strictEqual(SnowMap.sheetHtml({ id: 'Z3', type: 'push', name: 'Push west', note: '', area_sqft: 0 }), '<h2 data-no-es>Push west</h2>');
});

// ---- a tap that reaches more than one zone shows the CLOSEST (Plow Command, 10/21/26: no "Which zone?") ----
// The order a tap picks from: the zones right under the fingertip first, then the rest; within each, smallest
// first, then by name. A zone with no area_sqft goes after those with one. Worked by hand:
//   under = [Z1]; areas Z1 3,229, Z6 394, Z7 394, Z9 (none), Z8 50,000  ->  Z1 | Z6, Z7 (394 each, by name:
//   "Curb - entry" before "Curb - lot"), Z8, Z9  ->  ['Z1', 'Z6', 'Z7', 'Z8', 'Z9']
//   under = [Z8, Z6] (a pile drawn over a curb): Z6 (394) before Z8 (50,000) | then Z7, Z1, Z9
const { pickOrder } = require('../lib/mapview.js');
test('a tap\'s pick order: the zones under the finger first, then the rest, each smallest first', () => {
  const Z = (id, name, area) => ({ id, name, area_sqft: area });
  const near = [Z('Z8', 'Snow pile 1', 50000), Z('Z9', 'Back walk'), Z('Z1', 'Main entry', 3229), Z('Z7', 'Curb - lot', 394), Z('Z6', 'Curb - entry', 394)];
  const ids = (list) => list.map((z) => z.id);
  assert.deepStrictEqual(ids(pickOrder(near, ['Z1'])), ['Z1', 'Z6', 'Z7', 'Z8', 'Z9']);
  assert.deepStrictEqual(ids(pickOrder(near, ['Z8', 'Z6'])), ['Z6', 'Z8', 'Z7', 'Z1', 'Z9']);
  assert.deepStrictEqual(ids(pickOrder(near, [])), ['Z6', 'Z7', 'Z1', 'Z8', 'Z9']); // nothing under it: smallest first
  assert.deepStrictEqual(ids(near), ['Z8', 'Z9', 'Z1', 'Z7', 'Z6']); // the list it was given is not reordered in place
});

// With the distance from the fingertip to each zone (screen pixels), the closer one comes first, whatever its size;
// size and name only break a tie. Worked by hand: nothing under the finger; Big (1,076 sq ft) 7 px away, Small (97) 14 px
// away -> Big first. Without distances (the old call) it is smallest first -> Small. Two at the same distance -> smaller.
test('a tap\'s pick order: the closer zone first when the distances are known; size only breaks a tie', () => {
  const big = { id: 'B', name: 'Big pile', area_sqft: 1076 }, small = { id: 'S', name: 'Small pile', area_sqft: 97 };
  const ids = (list) => list.map((z) => z.id);
  assert.deepStrictEqual(ids(pickOrder([small, big], [], { B: 7, S: 14 })), ['B', 'S']);
  assert.deepStrictEqual(ids(pickOrder([big, small], [], { B: 14, S: 7 })), ['S', 'B']);
  assert.deepStrictEqual(ids(pickOrder([big, small], [])), ['S', 'B']);
  assert.deepStrictEqual(ids(pickOrder([big, small], [], { B: 5, S: 5 })), ['S', 'B']);
  assert.deepStrictEqual(ids(pickOrder([big, small], ['B'], { B: 3, S: 0 })), ['B', 'S']); // under the finger still wins (a line's width)
});

// The distance from a point to a shape in screen pixels: 0 inside a closed outline, else to the nearest edge; an open
// line (an arrow) has no edge from its last corner back to its first. Worked by hand:
//   square (0,0) (10,0) (10,10) (0,10): (5,5) inside -> 0; (13,5) -> 3 to the right edge; (13,14) -> the corner
//   (10,10), sqrt(3^2 + 4^2) = 5.
//   (0,0) (10,0) (10,10) and the point (2,8): as an open line, 8 to either leg; closed, it is a triangle the point is
//   outside of, and the closing edge y = x is |2 - 8| / sqrt 2 = 4.2426 away.
test('pxDistance: inside is 0, else the nearest edge; an open line has no closing edge', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.strictEqual(SnowMap.pxDistance([5, 5], sq, true), 0);
  assert.ok(Math.abs(SnowMap.pxDistance([13, 5], sq, true) - 3) < 1e-9);
  assert.ok(Math.abs(SnowMap.pxDistance([13, 14], sq, true) - 5) < 1e-9);
  const tri = [[0, 0], [10, 0], [10, 10]];
  assert.ok(Math.abs(SnowMap.pxDistance([2, 8], tri, false) - 8) < 1e-9);
  assert.ok(Math.abs(SnowMap.pxDistance([2, 8], tri, true) - 6 / Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(SnowMap.pxDistance([5, 4], [[0, 0], [10, 0]], false) - 4) < 1e-9);
  assert.ok(Math.abs(SnowMap.pxDistance([-3, 4], [[0, 0], [10, 0]], false) - 5) < 1e-9); // past the end: to the corner
});

// ---- the centroid (the forecast point when a site has a drawing and no saved view: lib/weather.js) ----
// R5 (Matt 10/9/26), kept when lib/points.js went (Plow Command has no outlines file): the corners are taken relative
// to the first. The arithmetic before R5 took them as raw lng/lat. At -149.9 / 61.2 each cross product
// p[0]*q[1] - q[0]*p[1] is about 9,000 and a thin ring's whole sum is about 1e-8, so the rounding in the products
// swamps the answer: a thin curb strip came out hundreds of metres from where it is.
//
// Worked on paper (a degree of latitude is 111,195 m on a 6,371 km sphere; a degree of longitude at 61.2 N
// is 111,195 x cos 61.2 deg = 111,195 x 0.4817 = 53,568 m):
//   Strip, 30 m x 1.2 m at the PAC lot's latitude. 30 m = 0.00056 deg of longitude, 1.2 m = 0.000011 deg of latitude.
//   Corners (lng, lat): west -149.9, east -149.9 + 0.00056 = -149.89944; south 61.2, north 61.2 + 0.000011 = 61.200011.
//   The centroid of a rectangle is its centre:
//     lng = -149.9 + 0.00056 / 2 = -149.9 + 0.00028 = -149.89972
//     lat = 61.2 + 0.000011 / 2 = 61.2 + 0.0000055 = 61.2000055
//   Rectangle, 30 m x 10 m at PAC (-149.8885, 61.2177). 30 m = 0.00056 deg of longitude, 10 m = 0.00009 deg of
//   latitude (10 / 111,195). Centre: lng = -149.8885 + 0.00028 = -149.88822; lat = 61.2177 + 0.000045 = 61.217745.
// 1e-9 deg is 0.1 mm of latitude: far inside any rounding of a correct centroid, far outside the old one's error.
function rawCentroid(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], c = p[0] * q[1] - q[0] * p[1];
    a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
  }
  return [x / (3 * a), y / (3 * a)];
}
const STRIP = [[-149.9, 61.2], [-149.89944, 61.2], [-149.89944, 61.200011], [-149.9, 61.200011]];
const STRIP_CENTRE = [-149.89972, 61.2000055];
const RECT = [[-149.8885, 61.2177], [-149.88794, 61.2177], [-149.88794, 61.21779], [-149.8885, 61.21779]];
const RECT_CENTRE = [-149.88822, 61.217745];
const near = (got, want, tol) => Math.abs(got[0] - want[0]) <= tol && Math.abs(got[1] - want[1]) <= tol;

for (const [name, ring, centre] of [['a 30 m x 1.2 m curb strip', STRIP, STRIP_CENTRE], ['a 30 m x 10 m rectangle', RECT, RECT_CENTRE]]) {
  test('SnowMap.centroid: ' + name + ' at 61.2 N comes out at its true centre', () => {
    // The fixture tells the two arithmetics apart: the old one is more than 1e-4 deg (about 5 m) away.
    assert.ok(!near(rawCentroid(ring), centre, 1e-4), 'the raw arithmetic should be off on this ring: ' + JSON.stringify(rawCentroid(ring)));
    const got = SnowMap.centroid(ring);
    assert.ok(near(got, centre, 1e-9), name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(centre));
  });
}
test('SnowMap.centroid: a ring with no area (an arrow\'s two corners) answers its first corner, never NaN', () => {
  assert.deepStrictEqual(SnowMap.centroid([[-149.9, 61.2], [-149.89, 61.2]]), [-149.9, 61.2]);
});

// Plow Command has no MOA outlines (spec 10/21/26): mapview.js stands alone, with no shared points file behind it.
test('lib/mapview.js loads on its own: it requires no other file', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'mapview.js'), 'utf8');
  assert.doesNotMatch(src, /require\(/);
  assert.doesNotMatch(src, /SnowPoints/);
});

// ---- lot outlines (10/22/26) ----
// A lot is a Polygon whose first ring is the lot and the rest its holes (the islands), each closed like the ring. A hole
// the map cannot draw (a hand-edited Sheet row: not an array, or fewer than 3 finite pairs) is left out of the drawing
// and the ring is drawn; the server's number stands. A lot with no holes is one ring, as a pile is.
const LOT = { id: 'L1', type: 'lot', name: 'Main lot', ring: [[0, 0], [10, 0], [10, 10], [0, 10]], area_sqft: 48200 };
const HOLE = [[4, 4], [6, 4], [6, 6], [4, 6]];
test('featureCollection: a lot is a Polygon with its holes closed; a bad hole is left out; a lot with no holes is one ring; two lots are two features', () => {
  const withHoles = SnowMap.featureCollection([Object.assign({}, LOT, { holes: [HOLE, 'junk', [[1, 2]]] })]).features;
  assert.strictEqual(withHoles.length, 1);
  assert.deepStrictEqual(withHoles[0].properties, { id: 'L1', type: 'lot' });
  assert.strictEqual(withHoles[0].geometry.type, 'Polygon');
  assert.strictEqual(withHoles[0].geometry.coordinates.length, 2);
  assert.deepStrictEqual(withHoles[0].geometry.coordinates[0], [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  assert.deepStrictEqual(withHoles[0].geometry.coordinates[1], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]);
  const plain = SnowMap.featureCollection([LOT]).features;
  assert.strictEqual(plain[0].geometry.coordinates.length, 1);
  const two = SnowMap.featureCollection([LOT, Object.assign({}, LOT, { id: 'L2', ring: [[20, 0], [30, 0], [30, 10]] })]).features;
  assert.deepStrictEqual(two.map((f) => [f.properties.id, f.properties.type, f.geometry.coordinates.length]), [['L1', 'lot', 1], ['L2', 'lot', 1]]);
});

// The square footage under a site's address: the sum of its live lot zones' area_sqft (the server's figures), or
// nothing at all when the site has no lot zone. Never a made-up 0; a stored 0 (a hand-edited row) is printed as the
// server's own. Worked by hand: 30,000 + 18,200 = 48,200; "Lot: 48,200 sq ft" with the en-US thousands comma.
test('lotSqft and lotLine: none is null and \'\'; one; two summed; archived skipped; siteIds filter; a bad area counts 0', () => {
  const lot = (over) => Object.assign({ id: 'L', site_id: 'S1', type: 'lot', ring: LOT.ring, area_sqft: 48200 }, over);
  assert.strictEqual(SnowMap.lotSqft([]), null);
  assert.strictEqual(SnowMap.lotLine([]), '');
  assert.strictEqual(SnowMap.lotSqft([lot({})]), 48200);
  assert.strictEqual(SnowMap.lotLine([lot({})]), 'Lot: 48,200 sq ft');
  assert.strictEqual(SnowMap.lotSqft([lot({ area_sqft: 30000 }), lot({ id: 'L2', area_sqft: 18200 })]), 48200);
  assert.strictEqual(SnowMap.lotSqft([lot({ archived: true })]), null);
  assert.strictEqual(SnowMap.lotSqft([lot({ site_id: 'S2' })], ['S1']), null);
  assert.strictEqual(SnowMap.lotSqft([lot({ site_id: 'S2' }), lot({ id: 'L2', site_id: 'S1', area_sqft: 100 })], ['S1']), 100);
  assert.strictEqual(SnowMap.lotSqft([lot({ area_sqft: 'x' })]), 0);
  assert.strictEqual(SnowMap.lotLine([lot({ area_sqft: 'x' })]), 'Lot: 0 sq ft');
  assert.strictEqual(SnowMap.lotSqft([{ id: 'Z1', site_id: 'S1', type: 'storage', ring: LOT.ring, area_sqft: 1076 }]), null);
});

// A tap's distance to a zone, in pixels (toPx maps a corner to [x, y]; here the identity). An arrow as pxDistance has
// it (open); an area 0 inside its ring; a lot 0 inside its ring and outside every hole, and inside a hole the distance
// to that hole's nearest edge, which is where the lot's fill begins again. Worked by hand on a 100 x 100 lot with a
// 20 x 20 hole at its centre (40..60): (20, 20) is in the body -> 0; (50, 50) is the hole's centre, 10 from every
// edge -> 10; (120, 50) is 20 past the lot's east edge -> 20.
test('zoneDistance: a lot is 0 in its body, the hole\'s edge distance inside an island, the edge distance outside', () => {
  const lot = { id: 'L', type: 'lot', ring: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [[[40, 40], [60, 40], [60, 60], [40, 60]]] };
  const id = (c) => [c[0], c[1]];
  assert.strictEqual(SnowMap.zoneDistance([20, 20], lot, id), 0);
  assert.ok(Math.abs(SnowMap.zoneDistance([50, 50], lot, id) - 10) < 1e-9);
  assert.ok(Math.abs(SnowMap.zoneDistance([120, 50], lot, id) - 20) < 1e-9);
  // A pile is as before: 0 inside; an arrow is an open line (its two corners, the point 4 above the middle -> 4).
  assert.strictEqual(SnowMap.zoneDistance([5, 5], { id: 'P', type: 'storage', ring: [[0, 0], [10, 0], [10, 10], [0, 10]] }, id), 0);
  assert.ok(Math.abs(SnowMap.zoneDistance([5, 4], { id: 'A', type: 'push', ring: [[0, 0], [10, 0]] }, id) - 4) < 1e-9);
});
