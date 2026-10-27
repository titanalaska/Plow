# Plow Command: lot outlines with square footage — design

**Owner:** Matt Walsh. **Status:** design approved in conversation 10/22/26 (the one open question answered); this file awaits his read.
**Repos:** `Plow-Command-repo` (phone, PUBLIC: code only) and `plow-command-script` (Apps Script backend, no remote).
**Builds on:** `2026-10-21-plow-command-design.md` (the app as deployed 10/22/26, backend `plow-1`, shell 1).

## Why

Matt, 10/22/26, after the first Pull from Shovel Command put the 60 sites and their piles on the plow maps:
**"highlight all the parking lot and get square footage."** Today the lot is only the aerial: nothing is drawn for
it and no number exists for it. The drivers see piles and arrows floating on a photo; the dispatcher balancing
routes has no idea which truck carries the most asphalt.

**Success:** Matt traces a lot in Bootprint with its islands as cut-outs, exports, and imports it in Plow Command;
the map shows the lot as a light outline under the piles, with the islands as holes; the site's card reads
`Lot: 48,200 sq ft`, the same whole number Bootprint prints for that job; each route's total shows on the Routes
tab and on the dispatcher's live view; a site with no lot shows nothing (never 0); nothing the drivers tap changes.

## Decisions (Matt, 10/22/26)

| Question | Decision |
|---|---|
| Where the lots are traced | **In Bootprint**, as the `plow` surface, islands as cut-outs; export, then Import in Plow Command. |
| What that means for the number | The import carries the cut-outs as **holes** and the square footage is **net of islands**, as Bootprint prints it. |
| Is a lot tapped | **Never.** Plowed and Problem stay on the site's one lot item. The outline is a drawing with a number. |
| Where the number shows | Sites card, Storm-tab site card (per site); Routes tab and the dispatcher's live view (per route). |
| The PDFs and the CSV | **Unchanged.** Matt did not ask. |

Made without Matt, for his review (the Assumptions table at the end): the colour and weight of the outline, the
hole rules, the wording of the lines.

## 1. Data: a fourth zone type

**`lot`** joins `ZONE_TYPES` in `roster.js`: `['storage', 'no_touch', 'push', 'lot']`. The refusal names all four:
`Zone type must be storage, no_touch, push or lot`. A lot is an **area** like a pile: 3 or more corners, at most
`MAX_CORNERS`, each a map position, never crossing itself. Lots made in Plow Command get `PZ-` ids like every
other zone made here; a lot is never pulled, so a lot never carries a Shovel `Z-` id unless Matt re-types a pulled
pile here (then it is the plow's own, as a push arrow is).

**`holes`** is a new optional field, **lot only**: an array of rings, each `[[lng, lat], ...]`, each an island the
plow never touches (a planting bed, a building, a light-pole base). Validation, in this order, each in its own words:

| Rule | Refusal |
|---|---|
| `holes` on a storage, keep-clear or push zone (a non-empty array) | `Only a lot has holes` |
| `holes` not an array (absent or `[]` is fine) | `Holes must be a list of outlines` |
| a hole with fewer than 3 corners, or a corner that is not a map position | `A hole needs at least 3 corners` / `A hole's corner is not a map position` |
| a hole that crosses itself (`SnowGeo.isSelfIntersecting`) | `A hole crosses itself` |
| a hole not fully inside the lot: a corner outside or on the lot's line, or an edge crossing the lot's edge | `A hole must be inside the lot` |
| a hole overlapping an earlier hole: a corner of one inside the other, or edges crossing | `Holes must not overlap` |

The total corner count (ring plus every hole) must stay under `MAX_CORNERS`: the cell holds about 1000.

**Area.** `area_sqft` stays the server's own arithmetic, never the phone's number:

- storage, no_touch: the ring's area, as today;
- push: 0, as today;
- **lot: the ring's area minus the sum of its holes' areas**, each by `SnowGeo.calcAreaSqm` over its own corners,
  rounded to a whole square foot at the end (`Math.round(sqmToSqft(ring − Σ holes))`).

Worked on paper for the tests: a lot 0.0004° east-west by 0.0002° north-south at 61.2 N (the roster test's SQUARE)
is 21.427 m by 22.239 m = 476.52 m² (5,129 sq ft gross); an island a quarter of each side (0.0001° by 0.00005°)
is 5.357 m by 5.560 m = 29.78 m² (321 sq ft); net 446.74 m² × 10.7639 = 4,808.7 → **4,809 sq ft**. Rounding each
piece first would give 5,129 − 321 = 4,808: wrong by one, which is why the rounding happens once, at the end, and
why the test's expected value is worked in square metres. Bootprint projects each ring at its own first corner and
clips the island exactly, so the two numbers agree to the whole foot; a rare half-foot can round the other way,
and that is the only difference allowed.

**The shared file `lot.js`** (new, byte-identical in both repos, in the identity test's list, in the backend's
`filePushOrder` with the other shared files, in the phone's script list and shell): `SnowLot` with `pointInRing(pt, ring)`,
`ringsCross(a, b)`, `ringWithin(inner, outer)`, `ringsApart(a, b)`, `holeProblem(hole, ring, earlierHoles)`
(the refusal word, or `''`) and `areaSqm(ring, holes)`. `geo.js` is not touched: it is Bootprint's verbatim and
says so. Plain lng/lat arithmetic (containment and crossing are affine questions), the areas through `SnowGeo`.
The server's `validate` and the phone's import and editor all ask `holeProblem`, so the three refuse in the same
words.

**An import lands once** (the Blood Bank double import, 10/23/26: two phones, each with a stale import preview,
each tapped Add, and the phone's own "already imported" check cannot see another phone's preview). A NEW zone (no
id) that carries `from` (the import's mark, `bootprint:<job>:<zone>`) and matches a LIVE zone on the same site IS
that zone: `saveZone` answers the existing record and writes nothing. An archived twin does not count (archive, then
import again, on purpose); a record with an id is an edit and never meets this. No change of shape: VERSION stays.

**A pulled pile is that pile** (Blood Bank and VCA, 10/23-24). The Pull brings a site's piles in under their Shovel
ids and without a `from`, so the rule above cannot see them, and every import of the job added each pile a second
time, for Matt to archive by hand. A NEW pile (storage, no id) that carries `from` and whose outline is a LIVE pile's
on the same site IS that pile: `saveZone` answers the existing record and writes nothing (in `write_`, beside the
twin-by-`from` rule, so a second phone cannot bring it either). "Whose outline is" is `SnowLot.sameRing`, shared in
`lot.js`: 3 or more corners, the same count, the same corners in the same order, each corner's lng and lat equal after
rounding to 7 decimals (a step of about 1 cm: Bootprint keeps a pin's lng/lat exactly, so a re-export of the same pins
meets it to the digit, and the grid only forgives a copy that lost digits in a Sheet or a phone). It is not a
distance, an overlap or a resemblance, and it does not turn or reverse the ring, so a real second pile beside the
first always lands. Only a pile meets it: a lot, a keep-clear outline, an archived pile, another site's pile, a pile
drawn by hand (no `from`) and an edit (a record with an id) never do. The phone asks the same question:
`convertJob(job, existing, piles)` takes the corners of the site's live piles, leaves a matching pile out and counts
it (`skipped.onMap`; `Left out: 2 piles already on the map`), so the preview and the Add button say what will really
land, and a cut-out inside a pile left out is still the lot's hole. No change of shape: VERSION stays, shell 5. Known
limit: a pulled pile whose ring Matt later moves in Shovel Command no longer matches, and the next import brings its
Bootprint outline again.

**The Pull is untouched.** `PULLED_TYPES` stays `['storage', 'no_touch']`; the plow-side type guard already skips
any plow copy whose type is not pulled, so a pulled pile Matt re-types `lot` is left alone from then on, and a
`PZ-` lot has no Shovel twin to match. A test says so in both directions: a lot is never added, updated, listed
under `shovel_archived_zones`, or counted, whatever its id.

**Nothing else reads zones by type.** `shiftlog.js` `walksFor` answers the one lot item without reading zones (its
item type `lot` is the walk's, unrelated to the zone type); the route sheets, handoff, CSV and callouts never
look at zones. They do not change, and the identity test keeps them identical.

## 2. The map

`SnowMap.TYPES` gains a fourth entry, last in legend order: `lot: { color: '#2d6a2d', label: 'Lot' }` (Bootprint's
plow green, the "match Bootprint" rule of 10/4/26). `AREAS` stays the two kinds that share the pile layers; the lot
has its own filter.

> **10/26/26: the lot is orange, `#f57c00`.** Matt, on the AHFC Chugach Manor & View lot over the 2024 aerial: the
> green blends with the landscaping. He chose orange over blue and yellow. The hatch, the 3 px line, the tint (still
> .15), the legend chip, the editor's Lot button and the import preview all carry it; the hatch tile's own RGBA
> (245, 124, 0, 204) changed with it, and a node test now reads the hex back off a pixel and holds it to the table.
> Piles, keep-clear and arrows unchanged. Shell 7.

A lot draws **under** the piles and keep-clear areas, lighter than them: its own layers `lot-fill` (opacity
0.15), `lot-hatch` (a 45° stripe tile, `lotStripes()`, 2 px lines 12 px apart in the same green at 80%, handed to
MapLibre on `styleimagemissing`; Matt, 10/23/26, after the first real lot read too faint for the crew) and `lot-line`
(3 px) before `zones-fill`, so a pile over a lot still reads as a pile. The feature is a
GeoJSON Polygon whose first ring is the lot and the rest its holes, so the islands are unfilled and outlined.
`drawable` is unchanged for the ring; a hole the map cannot draw (hand-edited in the Sheet) is left out of the
drawing and the server's number stands.

A tap on open lot shows the lot's card (`lot-fill` joins `HIT`): name, the green swatch and "Lot", the note, and
`≈ 48,200 sq ft`. A tap on a pile inside the lot still shows the pile: `pickOrder` prefers the smaller area under
the finger, as today. "Inside" for the lot means inside its ring and in none of its holes.

The crew see the legend row "Lot" (the Spanish row exists: `Estacionamiento`).

## 3. Import from Bootprint

`lib/bpimport.js` maps the `plow` surface to `lot` (`TYPE_OF.plow = 'lot'`). Bootprint's default surface is `plow`,
so an area never given a surface is a lot too. A `plow` run with a width becomes a lot strip the way a storage run
does; with no width it is skipped as today.

**Cut-outs** (`mode: 'cut'`, 3+ pins) become holes. Before anything is converted, each cut-out is matched to the
**first** `plow` area of the job, in the job's order, that it is fully inside (`SnowLot.ringWithin`) and whose
earlier holes it is apart from (`ringsApart`). A hole follows its lot: converted with it, or left with it when the
lot was imported before (`already`). A cut-out inside no lot, or overlapping an island already taken, is skipped
and counted under `cutouts`. A cut-out inside a pile that sits inside the lot is still the lot's hole (Bootprint takes
a cut-out off every area it lies in, the lot's plow figure included; ruling 10/22/26); the pile itself has no holes
and keeps its whole area.

`skipped.lots` goes: lots come in now. The result gains `islands`, the holes carried. The summary reads
`2 lots (3 islands) and 4 piles to add`, `Left out: 2 walks, 1 cut-out (outside a lot, over its edge, over another
island, or crossing itself)` (one count, every reason named; 10/23/26); the Add button `Add 2 lots and 4 piles`. The
cut-out loop asks `SnowLot.holeProblem`, the server's own question, so a cut-out the server would refuse (one that
crosses itself) is counted here and the lot and its sound islands still come in (10/23/26). The preview draws lots in their colour with their holes (`previewData` colours from
`typeColour`, so a kind can never be missing from it).

The server validates every imported lot again (section 1) and the import shows its words on a refusal, as it does
for a pile today.

## 4. Matt's map editor

`BTN` gains `lot: 'Lot'`, last, in the legend's order. The "Pick a type" sentence names four. The corner rule is the
area's (3 or more, no crossing). The editor does **not draw holes**: a lot drawn here has none, and a lot edited
here keeps the holes it was imported with (the record is spread into the save, as every field is). Moving a corner
so an island falls outside the lot is refused by the server in its words and shown in the form. Holes are drawn in
Bootprint, which is where Matt traces lots.

## 5. The square-footage lines

One helper on the phone, `SnowMap.lotSqft(zones)` → the sum of `area_sqft` over the live `lot` zones given, or
`null` when there are none, and `SnowMap.lotLine(zones)` → `Lot: 48,200 sq ft` (`toLocaleString('en-US')`), or
`''`. **Blank when a site has no lot zone, never a made-up 0.** With lot zones the number is their sum, the
server's figures as stored, even when a hand-edited row makes it 0: the line never invents a number and never
hides one.

| Where | What | Who sees it |
|---|---|---|
| Sites tab, `siteCard` | a muted line under the address (after the plow note) | everyone |
| Storm tab, `siteHtml` | the same line, same place; fades with the card when plowed | drivers, dispatcher |
| Routes tab, `renderRoutes` | `Lot: 148,200 sq ft` under the route's name, the sum over its live sites' lots; blank when no site on it has a lot | everyone |
| Live view, `liveRouteHtml` | the same route line, under the "who" line | dispatcher, leads |

Spanish: `Lot` has its row; `sq ft` gets one (`pies²`) and leaves `LEFT_ENGLISH` in `es-coverage.test.js`; the map
card's `≈ N sq ft` reads Spanish with it. Numbers and the colon are the engine's own.

## 6. Not changed

The route-sheet PDFs, the storm CSV, the handoff card, Copy for BuilderTrend, the Pull, the shift log, the lot's
Plowed and Problem, the Anchorage snow map, the site card dialog, the Board and the Post.

## 7. Tests

**Backend** (`plow-command-script`, every guard with a `verify-tests` mutation, run alone):
- `ZONE_TYPES` is the four, in order; a lot with the SQUARE ring is accepted; the refusal names four
  (re-point the existing ZONE_TYPES mutations; add "lot dropped" and "a fifth type accepted");
- `lot.js`: `pointInRing` (inside, outside, a corner on the line is outside), `ringsCross` (crossing, apart,
  touching at a corner), `ringWithin`, `ringsApart`, `holeProblem` each word, `areaSqm` with the paper numbers
  above (mutations: holes ignored, a hole added instead of subtracted, the second hole dropped);
- `validate('zone')`: each refusal in section 1's table, in order; holes on a pile refused; `[]` and absent fine;
  corners counted across ring and holes;
- `saveZone` of a lot with one island stores 4,809, and 5,129 with none (mutation: the write ignores holes);
- the Pull never touches a lot (both id prefixes), never lists it, never counts it;
- the identity test's list gains `lot.js`; `filePushOrder` gains it.

**Phone** (`Plow-Command-repo`, hand mutations from a committed tree, restored with `git checkout`):
- `mapview.test.js`: TYPES has four in order; a lot's feature is a Polygon with the hole rings; a bad hole is left
  out and the ring drawn; `lotSqft`/`lotLine` (none → null/'', one, two summed, a 0 lot alone);
- `bpimport.test.js`: `plow` → `lot` (the old "lots are skipped" tests rewritten with paper values); a cut-out inside
  a lot becomes its hole and the lot's `holes` carries it; one inside no lot is counted; one overlapping a taken
  island is counted; a cut-out inside a pile is counted; a hole follows an `already` lot; `islands` counted; a plow
  run with a width becomes a lot strip; the summary words;
- `ui.spec.js`: the Sites card line and its absence; the Storm-tab card line; the Routes tab total and its absence;
  the live view's total; the legend's fourth row; a tap on open lot shows the lot's card with the number; the
  editor's Lot button saves `type: 'lot'` and no holes; an edited imported lot sends its holes back;
- `es.test.js` / `es-coverage`: the `sq ft` row, `LEFT_ENGLISH` entry gone;
- `manifest.test.js` / `sw.spec.js`: `lib/lot.js` in the script list and the shell; shell 2;
- `api-guard.test.js` / config: `EXPECTED_BACKEND` `plow-2`.

## 8. Deploy

`ZONE_TYPES` changes shape, so backend `VERSION` → **`plow-2`**, phone `EXPECTED_BACKEND` → `plow-2` in the same
deploy, `CACHE_VERSION` → `titan-plow-shell-2`. No new tab (no `setup`), no new Google service (no permission step).
Ship with `/plow-deploy`: server first, then the phone from the local `public` branch, never `main`. After it, Matt
traces and imports site by site; the first lot through the real import is the acceptance test.

## Not in this release

- A workload page like the shovel one (sq ft per route and site, Matt's rates kept empty): **ask Matt once lots
  exist**, not before.
- Per-site square footage on the Routes tab's site lines (the Sites tab has it).
- Drawing or editing holes in Plow Command's editor (Bootprint draws them).
- A lot column in the CSV or a line in the PDF header.
- Overlapping islands (Bootprint warns about them; here the second is left out and named).

## Assumptions for Matt's review

| # | Assumption | If wrong |
|---|---|---|
| A1 | Bootprint's plow green, light (15% fill, 2 px line), under the piles. **Wrong, 10/26/26:** the green blended with the landscaping; orange `#f57c00` since shell 7. | A colour or a weight: two numbers in `TYPES` and the layers (and the hatch tile's RGBA, since 10/23/26). |
| A2 | The line reads `Lot: 48,200 sq ft`, under the address, after the plow note. | Words or place: one helper, four call sites. |
| A3 | A route's total is the sum over its live sites' lots; a site on two routes counts in both. | Count once across routes: not a route's number then. |
| A4 | An island must be fully inside the lot; a driveway half in and half out is left out and named. | Exact overlap like Bootprint's: the clipping arithmetic comes across from Bootprint. |
| A5 | A tap on open lot shows the lot's card with its number. | Leave the lot out of `HIT`: taps reach piles and arrows only. |
| A6 | The editor keeps imported holes and draws none of its own. | Hole drawing in the editor: a later release. |
| A7 | A plowed lane traced as a `plow` run with a width is a lot strip. | Skip runs with the plow surface and count them. |
