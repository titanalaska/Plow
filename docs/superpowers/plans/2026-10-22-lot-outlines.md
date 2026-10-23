# Lot Outlines with Square Footage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth zone type `lot`, imported from Bootprint with its islands as holes, drawn light under the piles, with the server's net square footage on the site and route cards.

**Architecture:** A new shared file `lot.js` (byte-identical in both repos, like `csv.js`) holds the hole rules and the net-area arithmetic; the backend's validator and area write call it, and so do the phone's import and map. The phone draws a lot as a GeoJSON polygon with holes on its own two layers and sums the server's `area_sqft` for the lines on four cards. `geo.js` is not touched (it is Bootprint's verbatim).

**Tech Stack:** Apps Script (clasp, node:test + a vm fake sheet, `verify-tests` mutations), single-file PWA (node:test + Playwright over `file://`), MapLibre GL.

**Spec:** `docs/superpowers/specs/2026-10-22-lot-outlines-design.md` (approved by Matt 10/22/26, assumptions A1-A7 included).

## Global Constraints

- Backend repo `plow-command-script` (branch `master`, no remote): **LF** line endings (`.gitattributes` `*.js eol=lf`); never push anywhere but clasp. Phone repo `Plow-Command-repo` (local `main`, never pushed; `/plow-deploy` snapshots it onto `public`): working tree is **CRLF**; never `sed -i` there; edit with the Edit tool; a new file is written with CRLF.
- Shared files are byte-identical across the two repos; `test/geo-identity.test.js` in the backend enforces the list, which gains `lot.js`. Edit a shared file in the backend, then copy it to the phone (`node -e` converting LF to CRLF for the phone copy).
- Expected values are worked on paper in test comments; never paste a run's output into an assertion. Every new backend guard gets a `verify-tests` mutation whose `caughtBy` is a test title; `npm run verify-tests` runs ALONE (it rewrites sources). A `SKIPPED` mutation is a failure.
- Phone hand mutations run from a COMMITTED tree and are restored with `git checkout -- <file>` (a checkout once wiped uncommitted work).
- Refusal words, copied verbatim from the spec: `Zone type must be storage, no_touch, push or lot`, `Only a lot has holes`, `Holes must be a list of outlines`, `A hole needs at least 3 corners`, `A hole's corner is not a map position`, `A hole crosses itself`, `A hole must be inside the lot`, `Holes must not overlap`.
- Colour and label: `lot: { color: '#2d6a2d', label: 'Lot' }`, last in `TYPES`; `lot-fill` opacity `0.15`, `lot-line` width `2`, both drawn before `zones-fill`.
- The square-footage line: `Lot: 48,200 sq ft` (`toLocaleString('en-US')`), `''` when a site has no live lot zone; never a made-up 0.
- Versions, all in the last task: backend `VERSION = 'plow-2'`, phone `EXPECTED_BACKEND: 'plow-2'`, `CACHE_VERSION = 'titan-plow-shell-2'`.
- `holes` is present on a record only when non-empty; a pile and a hole-less lot carry no `holes` key.
- No real employee first names and no Sheet or Script ids in the phone repo (it is public).
- `PULLED_TYPES` stays `['storage', 'no_touch']`; the Pull code is not changed, only tested.

## Review Focus

1. A `holes` value hand-typed wrong in the Zones tab reaches the phone in the bootstrap: the map draws the lot's ring, leaves the bad hole out, and the page logs no error (Task 4).
2. A lot Matt archived stays in the phone's zone list with `archived: true` until the next sign-in: the line never counts it (Task 4's `lotSqft` test, Task 7's cards).
3. A cut-out inside no lot is counted and named, never a hole; one inside a pile that sits inside the lot is the lot's hole (Bootprint's plow figure is net of it) and the pile's own area is unchanged (Task 5; ruling 10/22/26).
4. A lot whose ring plus holes exceed 1000 corners is refused with the total, and nothing is written (Task 3).
5. A site with two lots: the line is their sum and the map draws both polygons (Tasks 4 and 7).

---

### Task 1: the shared `lot.js`

**Files:**
- Create: `plow-command-script/lot.js`; copy to `Plow-Command-repo/lib/lot.js` (CRLF)
- Test: `plow-command-script/test/lot.test.js`
- Modify: `plow-command-script/test/fake-apps-script.js:73` (FILES gains `'lot.js'` after `'geo.js'`), `plow-command-script/.clasp.json` (`filePushOrder` gains `"lot.js"` after `"time.js"`), `plow-command-script/test/geo-identity.test.js` (the list gains `'lot.js'`), `Plow-Command-repo/index.html` (`<script src="lib/lot.js"></script>` right after `lib/geo.js`), `Plow-Command-repo/sw.js` (`SHELL` gains `'lib/lot.js'` after `'lib/geo.js'`)

**Interfaces:**
- Produces `SnowLot` (global in Apps Script and the page; `module.exports` in node), all rings `[[lng, lat], ...]`:
  - `pointInRing(pt, ring) -> boolean` — ray casting; a point on an edge (collinear within 1e-12 and within the edge's bounds) or on a corner is `false`.
  - `ringsCross(a, b) -> boolean` — any edge of `a` properly crosses any edge of `b` (the `ccw` test as in `geo.js`); touching at an endpoint is not a crossing.
  - `ringWithin(inner, outer) -> boolean` — every corner of `inner` is `pointInRing` of `outer` and `!ringsCross(inner, outer)`.
  - `ringsApart(a, b) -> boolean` — no corner of either inside the other and no crossing.
  - `holeProblem(hole, ring, earlier) -> string` — `''` or, in this order: `A hole needs at least 3 corners` (not an array, or fewer than 3), `A hole's corner is not a map position` (a corner that is not `[number, number]`, finite, |lng| ≤ 180, |lat| ≤ 90), `A hole crosses itself` (`SnowGeo.isSelfIntersecting(SnowGeo.ringToPins(hole))`), `A hole must be inside the lot` (`!ringWithin(hole, ring)`), `Holes must not overlap` (some `h` in `earlier` with `!ringsApart(hole, h)`).
  - `areaSqm(ring, holes) -> number` — `SnowGeo.calcAreaSqm(ringToPins(ring)) - Σ SnowGeo.calcAreaSqm(ringToPins(h))` over `holes || []`; square metres, not rounded.
- Reads `SnowGeo` as a global in Apps Script (`var Geo = typeof module !== 'undefined' ? require('./geo.js') : SnowGeo`, the pattern `bpimport.js` uses).

Fixture, worked on paper (the roster test's SQUARE at 61.2 N; cos 61.2° = 0.481754; 1° lat = 111,194.93 m):
```js
const LL = [-149.9004, 61.2000], LR = [-149.9000, 61.2000], UR = [-149.9000, 61.2002], UL = [-149.9004, 61.2002];
const SQUARE = [LL, LR, UR, UL];                 // 21.4274 m x 22.2390 m = 476.52 m2 (5,129 sq ft)
const ISLAND_A = [[-149.9003, 61.20005], [-149.9002, 61.20005], [-149.9002, 61.2001], [-149.9003, 61.2001]]; // a quarter each way: 5.3569 x 5.5597 = 29.78 m2
const ISLAND_B = [[-149.9001, 61.20012], [-149.90005, 61.20012], [-149.90005, 61.20018], [-149.9001, 61.20018]]; // 2.6784 x 6.6717 = 17.87 m2
const OVERLAPS_A = [[-149.90025, 61.20007], [-149.90015, 61.20007], [-149.90015, 61.20012], [-149.90025, 61.20012]]; // its SW corner is inside A
const OUTSIDE = ISLAND_A.map(([x, y]) => [x + 0.0005, y]);          // east of the lot altogether
const STRADDLES = [[-149.90005, 61.2001], [-149.8999, 61.2001], [-149.8999, 61.20015], [-149.90005, 61.20015]]; // crosses the east edge
const ON_LINE = [[-149.9004, 61.2001], [-149.9003, 61.2001], [-149.9003, 61.20015], [-149.9004, 61.20015]]; // its first corner sits ON the west edge (lng -149.9004)
const BOWTIE = [ISLAND_A[0], ISLAND_A[2], ISLAND_A[1], ISLAND_A[3]];
```

- [ ] **Step 1: Write the failing tests** in `test/lot.test.js` (`require('../lot.js')`; `global.SnowGeo = require('../geo.js')` first, as `roster.test.js` does):
  - `pointInRing: the centre is in, a point east is out, a point on the bottom edge and a corner are out` — `[-149.9002, 61.2001]` true; `[-149.8999, 61.2001]` false; `[-149.9002, 61.2]` false; `LL` false.
  - `ringsCross: an island inside crosses nothing; a straddler crosses; two squares touching at one corner do not` — `(SQUARE, ISLAND_A)` false; `(SQUARE, STRADDLES)` true; `(SQUARE, [UR, [-149.8998, 61.2002], [-149.8998, 61.2004], [-149.9, 61.2004]])` false.
  - `ringWithin and ringsApart: A is within SQUARE; OUTSIDE, STRADDLES and ON_LINE are not; A and B are apart; A and OVERLAPS_A are not` — the six booleans.
  - `holeProblem: each word, in order` — `([LL, LR], SQUARE, [])` = `A hole needs at least 3 corners`; `('x', SQUARE, [])` the same; `([[1, 2], [3, 4], ['5', 6]], SQUARE, [])` = `A hole's corner is not a map position`; `(BOWTIE, SQUARE, [])` = `A hole crosses itself`; `(OUTSIDE, SQUARE, [])`, `(STRADDLES, SQUARE, [])`, `(ON_LINE, SQUARE, [])` = `A hole must be inside the lot`; `(OVERLAPS_A, SQUARE, [ISLAND_A])` = `Holes must not overlap`; `(ISLAND_B, SQUARE, [ISLAND_A])` = `''`; `(ISLAND_A, SQUARE, [])` = `''`.
  - `areaSqm: the square, the square less island A, less both; holes undefined is the plain area` — `|areaSqm(SQUARE, []) - 476.52| < 0.05`; `|areaSqm(SQUARE, [ISLAND_A]) - 446.74| < 0.05`; `|areaSqm(SQUARE, [ISLAND_A, ISLAND_B]) - 428.87| < 0.05`; `areaSqm(SQUARE)` equals `areaSqm(SQUARE, [])`.
- [ ] **Step 2: Run** `node --test test/lot.test.js` — Expected: FAIL, cannot find `../lot.js`.
- [ ] **Step 3: Write `lot.js`** with the six functions above, the IIFE + `module.exports` + `window.SnowLot` pattern of `bpimport.js`; header comment: shared, byte-identical, what it decides.
- [ ] **Step 4: Run** `node --test test/lot.test.js` — Expected: PASS (5 tests).
- [ ] **Step 5: Wire it in**: `FILES` in `test/fake-apps-script.js`, `filePushOrder` in `.clasp.json`, the list in `test/geo-identity.test.js`; copy to the phone: `node -e "const fs=require('fs');fs.writeFileSync('../Plow-Command-repo/lib/lot.js', fs.readFileSync('lot.js','utf8').replace(/\r?\n/g,'\r\n'))"` from the backend folder; the `<script>` tag in `index.html` after `lib/geo.js`; `'lib/lot.js'` in `sw.js` SHELL after `'lib/geo.js'`.
- [ ] **Step 6: Run** backend `npm test` (identity test green, 440 + 5) and phone `node --test test/manifest.test.js test/scripts-parse.test.js` — Expected: PASS.
- [ ] **Step 7: Commit both**: backend `feat(shared): lot.js, the hole rules and the net area of a lot`; phone `feat(shared): lot.js in the page and the shell`.

---

### Task 2: the backend validator takes a lot and its holes

**Files:**
- Modify: `plow-command-script/roster.js:51` (ZONE_TYPES), `:194` (the refusal), `:196-203` (the zone block), `plow-command-script/test-tools/mutation-check.js:606, 971, 978` (the three ZONE_TYPES mutations)
- Test: `plow-command-script/test/roster.test.js` (the `zone types` test at `:188`, plus new ones)

**Interfaces:**
- Produces: `R.ZONE_TYPES === ['storage', 'no_touch', 'push', 'lot']`; `validate('zone', rec, ctx)` returns the words above; a lot's corner cap counts `rec.ring.length + Σ rec.holes[i].length` against `MAX_CORNERS` in the existing `Too many corners (N); the most a zone can hold is 1000` sentence.
- Consumes: `SnowLot.holeProblem` (Task 1).

- [ ] **Step 1: Rewrite the `zone types` test** so the list is the four, the refusal names four (`parking_lot`, `sidewalk`, `hand`, `heated`, `undefined` all refused), and a lot with `SQUARE` is accepted with `[]`. Add tests (fixture rings from Task 1, copied into this file):
  - `a lot's holes: absent and [] accepted; a hole inside accepted; each refusal in its own words, in order` — `holes: undefined` `[]`; `holes: []` `[]`; `holes: [ISLAND_A]` `[]`; `holes: 'x'` `['Holes must be a list of outlines']`; `holes: [[LL, LR]]` `['A hole needs at least 3 corners']`; `holes: [BOWTIE]` `['A hole crosses itself']`; `holes: [OUTSIDE]` `['A hole must be inside the lot']`; `holes: [ISLAND_A, OVERLAPS_A]` `['Holes must not overlap']`.
  - `holes on a pile, a keep-clear area or an arrow are refused: only a lot has holes` — `type: 'storage', holes: [ISLAND_A]` → `['Only a lot has holes']`; the same for `no_touch` and `push` (ring `[LL, UR]`); `holes: []` on a pile is fine.
  - `the corner cap counts the ring and every hole` — a lot with a 4-corner ring and 249 four-corner holes (1000 corners) is not refused for the count; 250 holes (1004) → the message with `1004`. (Build the holes as tiny squares in a grid inside SQUARE, 0.000001° apart, so they are inside and apart.)
- [ ] **Step 2: Run** `node --test test/roster.test.js` — Expected: FAIL on the list and the words.
- [ ] **Step 3: Implement** in `roster.js`: `ZONE_TYPES` + `'lot'`; the refusal sentence; after the ring checks, when `rec.holes !== undefined && rec.holes !== null`: not an array → `Holes must be a list of outlines`; non-empty and `rec.type !== 'lot'` → `Only a lot has holes`; else for each hole in order, `SnowLot.holeProblem(h, ring, holes.slice(0, i))`, push the first problem and stop. Count the cap over ring + holes before the per-hole checks.
- [ ] **Step 4: Run** `node --test test/roster.test.js` — Expected: PASS.
- [ ] **Step 5: Mutations** in `mutation-check.js`: re-point the three existing `ZONE_TYPES` finds to the four-item line (`:606` drops `storage` → caught by the `zone types` test; `:971` adds `parking_lot`; `:978` adds `sidewalk`); add `a lot's holes are never checked` (replace the per-hole loop with nothing → caught by `a lot's holes: absent and [] accepted…`), `holes on a pile accepted` (drop the `Only a lot has holes` branch → caught by `holes on a pile…`), `the corner cap forgets the holes` (count the ring only → caught by `the corner cap counts…`).
- [ ] **Step 6: Run** `ONLY="roster" npm run verify-tests` — Expected: every roster mutation caught, none SKIPPED.
- [ ] **Step 7: Commit** `feat(backend): a lot is a zone type; its holes are validated in six words`.

---

### Task 3: the server's net area, the Pull untouched, and `plow-2`

**Files:**
- Modify: `plow-command-script/Code.js:15` (VERSION), `:170` (the area line), `plow-command-script/test-tools/mutation-check.js` (the version-label mutation: find it with `grep -n "plow-1" test-tools/mutation-check.js`)
- Test: `plow-command-script/test/api.test.js` (after `:290`), `plow-command-script/test/pull.test.js`, `plow-command-script/test/reply-action.test.js` and `cache.test.js` if they pin the label (`grep -rn "plow-1" test/`)

**Interfaces:**
- Produces: `saveZone` of a lot stores `area_sqft = Math.round(SnowGeo.sqmToSqft(SnowLot.areaSqm(rec.ring, rec.holes)))`; other types as today. `VERSION = 'plow-2'`.

- [ ] **Step 1: Write the failing tests** in `api.test.js` (its `zone()` helper, `RING` 30 m × 10 m = 3,229 sq ft; add `SQUARE`/`ISLAND_A`/`ISLAND_B` from Task 1 for the paper numbers):
  - `saveZone of a lot stores the net area: 5,129 with no island, 4,809 with one, 4,616 with two; the stored holes are the ones sent` — three saves; `record.area_sqft` exactly `5129`, `4809`, `4616`; the Sheet row's Json has `holes` deep-equal to what was sent on the second and third, and NO `holes` key on the first (sent without).
  - `saveZone refuses a hole outside the lot and holes on a pile, in the server's words, and writes nothing` — `snow.writes.length` unchanged; reasons `A hole must be inside the lot`, `Only a lot has holes`.
  - `saveZone refuses a lot whose ring and holes exceed 1000 corners, naming the total` — reason matches `/Too many corners \(1004\)/`.
  - `a lot type is accepted and the refusal names four` — extend the existing `a zone type outside the three is refused` test: `lot` accepted; the reason is `Zone type must be storage, no_touch, push or lot`.
  - In `pull.test.js`: `a plow lot is never touched by a pull: not updated, not listed, not counted, whatever its id` — plowSet plus `{ id: 'PZ-lot', type: 'lot', site_id: 'S-1', ring: RING_OLD, holes: [], area_sqft: 3229, rev: 1, archived: false }` and a Shovel pile `Z-a` whose plow copy is re-typed `lot`; expected: `updates.zones` `[]`, `skipped.zones` `1` (the re-typed Z-a; PZ-lot is never considered), `shovel_archived_zones` `[]`, and `JSON.stringify(plow)` unchanged by the call.
- [ ] **Step 2: Run** `node --test test/api.test.js test/pull.test.js` — Expected: FAIL (area 5129 stored for the lot with a hole; the refusal still names three).
- [ ] **Step 3: Implement** the area line in `Code.js` (`rec.type === 'push' ? 0 : rec.type === 'lot' ? Math.round(SnowGeo.sqmToSqft(SnowLot.areaSqm(rec.ring, rec.holes))) : <today's expression>`), drop a `holes` key that is `[]` or null before the write (`delete rec.holes`), and `VERSION = 'plow-2'`.
- [ ] **Step 4: Fix the label pins**: every `plow-1` in `test/` becomes `plow-2`; the version-label mutation in `mutation-check.js` is re-pointed to the new line in the same commit (CLAUDE.md: or it goes SKIPPED).
- [ ] **Step 5: Run** `npm test` — Expected: PASS (the identity tests still green).
- [ ] **Step 6: Mutations**: `the write ignores a lot's holes` (the lot branch uses the ring only → caught by `saveZone of a lot stores the net area…`), `an empty holes list is stored` (drop the delete → caught by the same test's "NO holes key" assertion), `the version label moved` (re-pointed).
- [ ] **Step 7: Run** `npm run verify-tests` ALONE, the whole thing — Expected: every mutation caught (530 + the new ones), none SKIPPED.
- [ ] **Step 8: Commit** `feat(backend): a lot's area is net of its holes; VERSION plow-2`.

---

### Task 4: the map draws a lot

**Files:**
- Modify: `Plow-Command-repo/lib/mapview.js:18-23` (TYPES), `:120-135` (featureCollection), `:172` (HIT), `:200-215` (onTap distances), `:290-301` (layers), the export line `:368`
- Test: `Plow-Command-repo/test/mapview.test.js`, `Plow-Command-repo/test/ui.spec.js` (the legend test `:949`, the `crew map draws every zone` test `:991`, new tap test after `:1212`)

**Interfaces:**
- Produces on `SnowMap`: `TYPES.lot`; `featureCollection(zones)` gives a lot a `Polygon` whose `coordinates` are `[closedRing, ...closedHoles]` (a hole kept only when it is an array of 3+ finite pairs); `lotSqft(zones, siteIds?) -> number | null` (live `lot` zones, `!z.archived`, filtered to `siteIds` when given; `null` when none; `area_sqft` not a finite number counts 0); `lotLine(zones, siteIds?) -> string` (`'Lot: ' + Math.round(n).toLocaleString('en-US') + ' sq ft'` or `''`); `zoneDistance(p, z, toPx) -> number` (pixels: an arrow as today; an area 0 inside its ring; a lot 0 inside its ring and outside every hole, else the distance to the nearest hole edge when inside a hole).
- Layers `lot-fill` and `lot-line` (filter `['==', ['get', 'type'], 'lot']`) before `zones-fill`; `HIT = ['lot-fill', 'zones-fill', 'push-line', 'push-head']`.

- [ ] **Step 1: Write the failing node tests** in `mapview.test.js`:
  - Rewrite `TYPES: storage, no_touch, push…` to the four, `lot: { color: '#2d6a2d', label: 'Lot' }` last; the legend test to four rows, the fourth `Lot` with `background:#2d6a2d`.
  - `featureCollection: a lot is a Polygon with its holes closed; a bad hole is left out; a lot with no holes is one ring; two lots are two features` — lot with `holes: [ISLAND_A, 'junk', [[1, 2]]]` → `coordinates.length === 2`, `coordinates[1]` = `ISLAND_A` closed; `holes` absent → length 1; property `type: 'lot'`; two lots on one site → two `lot` features, each its own ring.
  - `lotSqft and lotLine: none is null and ''; one; two summed; archived skipped; siteIds filter; a bad area counts 0` — `[]` → `null`/`''`; `[{type:'lot', area_sqft: 48200}]` → `48200` / `'Lot: 48,200 sq ft'`; `30000 + 18200` → `48200`; an archived lot → `null`; `siteIds: ['S1']` with a lot on `S2` → `null`; `area_sqft: 'x'` → `0` / `'Lot: 0 sq ft'`; a pile alone → `null`.
  - `zoneDistance: a lot is 0 in its body, the hole's edge distance inside an island, the edge distance outside` — `toPx` = identity on a lot `[[0,0],[100,0],[100,100],[0,100]]` with hole `[[40,40],[60,40],[60,60],[40,60]]`: `[20, 20]` → 0; `[50, 50]` → 10; `[120, 50]` → 20.
- [ ] **Step 2: Run** `node --test test/mapview.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** in `mapview.js`: TYPES, `drawableRing(h)`, the polygon with holes, the two layers, HIT, `lotSqft`/`lotLine`, `zoneDistance` (move the per-zone `dist` arithmetic of `onTap` into it; `pxDistance` stays private), and use `zoneDistance` in `onTap`. Export the new names.
- [ ] **Step 4: Run** `node --test test/mapview.test.js` — Expected: PASS.
- [ ] **Step 5: Playwright**: in `ui.spec.js` update the legend expectation to `['Snow storage', 'Keep clear', 'Push snow this way', 'Lot']` (both places) and the editor button expectations stay for Task 6; add `map: a lot draws under the piles as a polygon with its island, and a tap on open lot shows its card with the square footage` — `mapWorld()` plus `{ id: 'L1', site_id: 'S1', type: 'lot', name: 'Main lot', ring: ring(PAC[0] - eastM(40), PAC[1] - northM(30), 80, 60), holes: [ring(PAC[0] - eastM(35), PAC[1] - northM(25), 5, 5)], area_sqft: 51385, rev: 1 }`; `zoneSource` lists `L1` with type `lot`; the zones source feature for `L1` has 2 coordinate rings; a click at `PAC[0] - eastM(30), PAC[1] + northM(20)` (open lot, 10 m clear of every pile) shows `#zonesheet h2` `Main lot` and `#zonesheet` contains `51,385 sq ft`; the layer order: `map.getStyle().layers.map(l => l.id)` has `lot-fill` before `zones-fill`.
- [ ] **Step 6: Run** `npx playwright test test/ui.spec.js -g "map:|legend|every zone"` — Expected: PASS.
- [ ] **Step 7: Commit** `feat(phone): the map draws a lot with its islands under the piles; lotLine`.
- [ ] **Step 8: Hand mutations** (from the committed tree, each restored with `git checkout -- lib/mapview.js`): holes dropped from the polygon → the node test red; `lotSqft` returns 0 for none → red; archived lot summed → red; `lot-fill` out of HIT → the tap test red. Note the four results in the commit message of Task 7 or the report.

---

### Task 5: the import brings lots with their islands

**Files:**
- Modify: `Plow-Command-repo/lib/bpimport.js:86-118` (TYPE_OF, convertJob), `Plow-Command-repo/lib/mapedit.js:433-435` (`piles` → `whatToAdd`), `:444-448` (previewData holes), `:461-474` (summary), `:476-505` (addImported sends holes; the toast)
- Test: `Plow-Command-repo/test/bpimport.test.js`, `Plow-Command-repo/test/ui.spec.js:1901-1975` (the two import tests)

**Interfaces:**
- Produces: `convertJob(job, existing) -> { zones, skipped, islands }`; `skipped` keys are `{ walks, hands, cutouts, noWidth, tooSharp, already, unfinished }` (no `lots`); a lot zone is `{ name, type: 'lot', ring, from, holes? }` with `holes` only when non-empty; `islands` = the holes carried on the zones returned. `TYPE_OF = { storage: 'storage', plow: 'lot' }`.
- `SnowMapEdit` private `whatToAdd(zones, islands) -> string`: `[lots ? plural(lots, 'lot') + (islands ? ' (' + plural(islands, 'island') + ')' : '') : null, piles ? plural(piles, 'pile') : null].filter(Boolean).join(' and ')`; `''` when no zones.
- `addImported` sends `holes: z.holes` only when present; the success toast is `'Added ' + whatToAdd(...) + ' from Bootprint.'`.

Fixture in metres from PAC (the file's `pin(x, y)`): `LOT = [pin(0,0), pin(100,0), pin(100,60), pin(0,60)]` (6,000 m²); `ISLAND_A = [pin(10,10), pin(20,10), pin(20,15), pin(10,15)]` (50 m²); `ISLAND_B = [pin(40,40), pin(60,40), pin(60,50), pin(40,50)]` (200 m²); `OUTSIDE = [pin(200,0), pin(210,0), pin(210,5), pin(200,5)]`; `STRADDLES = [pin(95,10), pin(105,10), pin(105,15), pin(95,15)]`; `OVERLAPS_A = [pin(15,12), pin(25,12), pin(25,18), pin(15,18)]`; `PILE = [pin(70,10), pin(80,10), pin(80,15), pin(70,15)]`; `IN_PILE = [pin(72,11), pin(74,11), pin(74,13), pin(72,13)]`.

- [ ] **Step 1: Write the failing tests** in `bpimport.test.js`:
  - Rewrite `lots and cut-outs are skipped and counted…` as `a plow area and an untyped area come in as lots; a cut-out inside no lot is counted` — zones 1 (`plow`) and 4 (`undefined` surface) → two lots, no `holes` key; cut-outs 3 and 5 (SQUARE, inside no lot, since the lots ARE SQUARE and a ring is not inside an identical ring: every corner is on the line) → `cutouts: 2`; `islands: 0`.
  - `a cut-out inside a lot becomes its hole, in job order; two islands; the lot's net area is on paper 5,750 m2` — job `[zone(1,'area','plow',LOT), zone(2,'cut','plow',ISLAND_A), zone(3,'cut','walk',ISLAND_B)]` → one lot with `holes` `[A, B]` as `[lng, lat]` rings, `islands: 2`, `cutouts: 0`; `|SnowLot.areaSqm(z.ring, z.holes) - 5750| < 1`.
  - `a cut-out outside, straddling, overlapping a taken island, or inside a pile is counted, never a hole` — `OUTSIDE`, `STRADDLES`, `OVERLAPS_A` (after `ISLAND_A`), `IN_PILE` with `PILE` as storage → the lot has `holes` `[A]`, the pile has no `holes`, `cutouts: 4`, `islands: 1`.
  - `a cut-out whose lot was imported before follows it: counted under already, not as a cut-out` — `existing` holds the lot's `from` → `zones` `[]`, `already: 1`, `cutouts: 0`, `islands: 0`.
  - `a plow run with a width is a lot strip; with none it is skipped` — `zone(1,'line','plow',[pin(0,0), pin(50,0)], '24')` → a lot whose ring area is 50 m × 7.3152 m = 365.76 m² (within 0.5); `widthFt ''` → `noWidth: 1`.
  - Update the ANMC stand-in test's expected `skipped` (no `lots` key; its one plow area now a lot in `zones`).
- [ ] **Step 2: Run** `node --test test/bpimport.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `convertJob`: collect `plowAreas` (mode area, surface plow/undefined, 3+ pins, in job order); assign each `cut` (3+ pins, job order) to the first plow area with `SnowLot.ringWithin(cutRing, areaRing)` and every earlier hole `ringsApart`; else `skipped.cutouts++`; then the existing loop with `TYPE_OF.plow = 'lot'`, a lot carrying its holes, `islands` counted on returned zones only. `bpimport.js` reads `SnowLot` like `geo()`.
- [ ] **Step 4: Run** `node --test test/bpimport.test.js` — Expected: PASS.
- [ ] **Step 5: The editor's words** in `mapedit.js`: `whatToAdd`; `previewData` gives a lot `[ring, ...holes]`; the summary bold `whatToAdd(...) + ' to add'` or `Nothing to add`; the `lots` line of "Left out" goes; the Add button `'Add ' + whatToAdd(...)`; `addImported` sends `holes`; the toast. The job buttons' count (`data-bpjob`) uses `whatToAdd` too.
- [ ] **Step 6: Playwright**: update the two import tests to the fixture's own counts: `bpExport()` holds 2 piles + 1 lot + 1 walk, so the job button reads `1 lot and 2 piles`, the bold `1 lot and 2 piles to add`, `Left out: 1 walk`, Add `Add 1 lot and 2 piles`, 3 `saveZone` calls with the lot's record `type: 'lot'` and no `holes` key; the second import `Nothing to add`, `Left out: 1 walk, 3 already imported`; the 19-zone test: `1 lot and 3 piles to add`, `Left out: 12 walks, 3 hand`, preview types `['lot', 'storage', 'storage', 'storage']` (job order), 4 saves, drop `Main lot` from the never-sent regex. Add `import: a lot's islands ride along as holes and reach the server` — a job with `LOT`, `ISLAND_A` as a cut and `OUTSIDE` as a cut (in the page's `mPin` metres): bold `1 lot (1 island) to add`, `Left out: 1 cut-out`, the `saveZone` body has `holes` of length 1, toast `Added 1 lot (1 island) from Bootprint.`
- [ ] **Step 7: Run** `npx playwright test test/ui.spec.js -g "Bootprint|import"` — Expected: PASS.
- [ ] **Step 8: Commit** `feat(phone): Bootprint's plow areas import as lots, cut-outs as their islands`.
- [ ] **Step 9: Hand mutations** (restore with `git checkout -- lib/bpimport.js lib/mapedit.js`): `TYPE_OF.plow` removed → node red; `ringWithin` check dropped (every cut-out taken) → red; `holes` not sent in `addImported` → the Playwright import test red.

---

### Task 6: Matt's editor offers Lot and keeps imported holes

**Files:**
- Modify: `Plow-Command-repo/lib/mapedit.js:13` (BTN), `:186-187` (onMapClick layers), `:303` (the "Pick a type" sentence), `:253` (the draft of a lot being edited: ring only; holes are not drawn in the draft)
- Test: `Plow-Command-repo/test/ui.spec.js` (the editor buttons test `:949`, new tests after `:1320`)

**Interfaces:**
- `BTN = { storage: 'Pile', no_touch: 'Keep clear', push: 'Push arrow', lot: 'Lot' }`; the sentence `Pick a type: Pile, Keep clear, Push arrow or Lot.`; `onMapClick` queries `['lot-fill']` after `['zones-fill']` (a pile over a lot is picked first).

- [ ] **Step 1: Write the failing Playwright tests**: extend the buttons test to four (`lot:Lot`, `--zc` `#2d6a2d`, `--ze` `''`); `editor: Matt draws a lot and it saves as type lot with no holes` — three corners, `[data-ztype="lot"]`, name `Back lot`, save → `lastCall(calls, 'saveZone').body.record` matches `{ type: 'lot', name: 'Back lot' }`, `'holes' in record` false; `editor: an imported lot keeps its islands through an edit, and a tap on open lot opens it` — the Task 4 lot fixture with one hole; tap open lot (same point as Task 4) → `#zoneform` visible with `#z_name` `Main lot`; save unchanged → the record's `holes` deep-equals the fixture's; `editor: the type sentence names four` — save with no type → `#z_err` `Pick a type: Pile, Keep clear, Push arrow or Lot.`; `editor: the server's hole refusal shows in the form and the lot stays open` — `fakeSnow(state, { saveReply: { ok: false, code: 'invalid', reason: 'A hole must be inside the lot' } })` (the option the conflict test at `:1930` uses), tap the imported lot, move nothing, save → `#z_err` `A hole must be inside the lot`, `#zoneform` still visible.
- [ ] **Step 2: Run** `npx playwright test test/ui.spec.js -g "editor:"` — Expected: FAIL.
- [ ] **Step 3: Implement** the three edits in `mapedit.js`.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(phone): the editor's Lot button; imported islands survive an edit`.
- [ ] **Step 6: Hand mutation**: `lot` out of `BTN` → red; `lot-fill` out of `onMapClick` → red. Restore.

---

### Task 7: the square-footage lines on four cards

**Files:**
- Modify: `Plow-Command-repo/lib/app.js:309-316` (renderRoutes), `:366-370` (siteCard), `Plow-Command-repo/lib/shiftlogui.js:614-626` (siteHtml), `:1036-1052` (liveRouteHtml), `Plow-Command-repo/app.css:192` (`.lot-line{margin-top:4px}` beside `.plow-note`), `Plow-Command-repo/lib/es.js:~100` (row `'sq ft': 'pies²'`), `Plow-Command-repo/test/es-coverage.test.js:284` (the `sq ft` LEFT_ENGLISH entry removed)
- Test: `Plow-Command-repo/test/ui.spec.js` (after the Sites tests at `:7035`), `Plow-Command-repo/test/es.test.js:47` (the lot words test), `Plow-Command-repo/test/livesum.test.js` untouched

**Interfaces:**
- Consumes `SnowMap.lotLine(zones, siteIds?)` (Task 4). Each card prints `'<div class="muted lot-line">' + esc(line) + '</div>'` when the line is non-empty, else nothing: `siteCard` after `plowNoteHtml(s)`; `siteHtml` after the plow-note div; `renderRoutes` after the `route-top` div with `siteIds` = the route's live, unarchived site ids; `liveRouteHtml` after the `live-who` div with `r.sites.map(s => s.id)`.

- [ ] **Step 1: Write the failing tests**: in `es.test.js` add to the lot words test `assert.equal(Es.translateString('Lot: 48,200 sq ft'), 'Estacionamiento: 48,200 pies²')` and `'sq ft' in Es.ES`. In `ui.spec.js`: `cards: the lot's square footage sits under the address on the Sites card and the Storm card; none without a lot` — `stormWorld()` + a lot on `S1` (`area_sqft: 48200`) and two lots on `S2` (`30000`, `18200`, so S2 reads the same number by a different path): Jordan's Storm tab `[data-shiftsite="S1"] .lot-line` `Lot: 48,200 sq ft`, `[data-shiftsite="S2"] .lot-line` `Lot: 48,200 sq ft`; Sites tab `siteCardOf(jp, 'S1').locator('.lot-line')` below `div.muted` (the address) and below `.plow-note` when there is one; a third site with piles only → `.lot-line` count 0; `routes: a route's total is the sum over its sites; a route with no lots shows no line` — Routes tab `.route-card[data-route="R1"] .lot-line` `Lot: 96,400 sq ft` when R1 = [S1, S2], a route of the pile-only site → count 0; `live window: each truck's card carries its route's lot total` — `openStorm(page, w, { token: 'tok-matt' })`, `.live-route[data-liveroute="R1"] .lot-line` `Lot: 96,400 sq ft`; `Spanish: the lot line reads Estacionamiento and pies²` — switch to ES, the Storm card's `.lot-line` `Estacionamiento: 48,200 pies²`.
- [ ] **Step 2: Run** `node --test test/es.test.js test/es-coverage.test.js` and `npx playwright test test/ui.spec.js -g "cards:|routes:|live window: each|Spanish: the lot"` — Expected: FAIL.
- [ ] **Step 3: Implement** the four lines, the CSS, the row, the LEFT_ENGLISH removal.
- [ ] **Step 4: Run** the same — Expected: PASS; `es-coverage` names nothing missing and nothing dead.
- [ ] **Step 5: Commit** `feat(phone): Lot: N sq ft on the site and route cards; sq ft reads Spanish`.
- [ ] **Step 6: Hand mutations**: `siteIds` filter dropped in `renderRoutes` (every lot summed on every route) → the routes test red; the Storm-tab line removed → red. Restore.

---

### Task 8: the version, the shell, the gates, and the ship

**Files:**
- Modify: `Plow-Command-repo/lib/config.js:12` (`EXPECTED_BACKEND: 'plow-2'`), `Plow-Command-repo/sw.js:9` (`CACHE_VERSION = 'titan-plow-shell-2'`), `Plow-Command-repo/test/api-guard.test.js:104,107`, `Plow-Command-repo/test/restore.spec.js:23`, `Plow-Command-repo/test/ui.spec.js:30,890` (`plow-2`), `Plow-Command-repo/test/manifest.test.js:85` (`shell-2`), `Plow-Command-repo/test/sw.spec.js:33-60` (open `titan-plow-shell-1` and `-3`… as old ones; the kept cache is `-2`; `-1` is cleaned up)
- Docs: copy this plan and the spec to `claudes room/docs/superpowers/` (the room masters); `CLAUDE.md` test-count rows and `project_plow_command.md` are the deploy's "After" step

- [ ] **Step 1: Bump and re-pin** the six files above in one commit.
- [ ] **Step 2: Backend gates**: `cd plow-command-script && npm test` (expected: all green, count printed), then `npm run verify-tests` ALONE (expected: every mutation caught, 0 SKIPPED), then `git ls-files --eol "*.js"` all `i/lf w/lf`.
- [ ] **Step 3: Phone gates**: `cd Plow-Command-repo && npm test` (node + Playwright, ~7 min; the forecast-hint test may flake once under load and pass alone), `node --test test/no-data.test.js`, `node ../.claude/hooks/check-html-js.js index.html`.
- [ ] **Step 4: Commit** `chore(phone): EXPECTED_BACKEND plow-2, shell titan-plow-shell-2` and copy the docs to the room.
- [ ] **Step 5: Hand-over**: report both HEAD shas, the test counts as printed, and the hand-mutation results of Tasks 4-7 to the parent session. **Matt runs `/plow-deploy`** (a user-only skill): server first (`clasp push`, version `plow-2 <sha>`, deployment updated, GET answers `plow-2`), no `setup` and no new permission (no new tab, no new Google service), then the phone from `public`. He taps Deploy himself.
- [ ] **Step 6: After the deploy** (the skill's own step): update the `plow-command-script` row (`@2 "plow-2 <sha>"`) and the test-count rows in `CLAUDE.md`, and memory `project_plow_command.md`; the first lot through the real import is the acceptance test.
