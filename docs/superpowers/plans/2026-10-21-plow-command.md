# Plow Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second crew app, Plow Command, for the plow trucks: the same site maps showing only piles, keep-clear areas and push arrows, one Plowed/Problem tap per lot, Shovel Command's Board, Post, storms, 8 AM handoff and route-sheet PDFs, plus a storm CSV, on its own Sheet, script and public repo.

**Architecture:** Two new repos are `git clone`s of live Shovel Command (phone `Snow-App-repo` at `af1bd65`, backend `snow-app-script` at `ba22d81`), with every remote removed, then cut down task by task: the sidewalk machinery comes out, the lot goes in, and five new pieces land (push arrows, `plow_note`, the dispatcher mark, Pull from Shovel Command, the storm CSV). Shared files stay byte-identical across the two NEW repos (`geo.js`, `time.js`, `board.js`, `history.js`, `shiftlog.js`, `routesheet.js`, `handoff.js`, new `csv.js`), test-enforced. The originals `Snow-App-repo` and `snow-app-script` are never edited by this plan.

**Tech Stack:** Apps Script JS via clasp (`node --test`, fake Sheet + fake Apps Script in `test/fake-apps-script.js`, `npm run verify-tests` mutations); phone ES5 single `index.html` + `lib/*.js`, `node --test` + Playwright over `file://`; MapLibre; GitHub Pages.

**Spec:** `claudes room/docs/superpowers/specs/2026-10-21-plow-command-design.md` (Task 1 copies it into the new phone repo).

## Global Constraints

- **Never edit `Snow-App-repo` or `snow-app-script`.** All work is in `Plow-Command-repo` and `plow-command-script` beside them in `C:\Users\skull\OneDrive\claudes room`. Both clones have NO remote until Task 20 adds GitHub to the phone repo. The backend never gets a remote.
- **Names:** app `Plow Command`; GitHub repo `titanalaska/Plow`; address `https://titanalaska.github.io/Plow/`; backend `VERSION = 'plow-1'`, phone `EXPECTED_BACKEND: 'plow-1'`; shell `CACHE_VERSION = 'titan-plow-shell-1'` (bumped per phone ship); `SHEETS_FOLDER = 'Plow Route Sheets'`, `SHEETS_WHO = 'Plow Command'`; sign-in position default `Plow driver`.
- **Phone storage keys**, exact: `titan-plow-token`, `titan-plow-editing`, `plow-short-night-until`, `plow-lang` (fallback reads of `snow-lang` then `wolf-lang`, once, when unset). No other key is ever written or removed.
- **Zone types**, exact ids: `storage` `#7d5ba6` "Snow storage", `no_touch` `#e0218a` "Keep clear", `push` fill `#ffffff` edge `#1a1a1a` "Push snow this way". A push has 2+ corners, no area (`area_sqft` 0). Areas keep 3+ corners and the self-intersection check.
- **The lot:** Log rows `zone_id: 'lot'`, `state: 'plowed' | 'problem'`. `walksFor` always answers `[{ zone_id: 'lot', type: 'lot', name: 'Lot' }]`. A problem needs a non-blank note. Done = newest standing row is `plowed`. No `again` rows, no passes, no curbs, no Touched.
- **Site field** `plow_note`: string, trimmed, ≤ 500 chars. **Crew field** `dispatch`: true | false | null; a marked sign-in resolves `role: 'admin'`; nobody sets it on their own record.
- **Ids:** records pulled from Shovel keep `S-…`/`Z-…`; sites and zones made here get `PS-`/`PZ-` + 10 hex of a UUID.
- **CSV** header, exact: `storm_start,shift,route,truck,driver,site,address,customer,plowed_at,state,problem_note,new_snow_in,materials_used,off_route`; file `Plow visits <M-D>.csv`; RFC 4180 quoting; CRLF line ends; `plowed_at` as `YYYY-MM-DD HH:MM` local.
- **Testing rules (CLAUDE.md):** expected values worked on paper in comments; never paste what the code returns into a failing test; every backend guard gets a `verify-tests` mutation (re-point the version-label mutation when VERSION moves); phone guards get hand mutations run from a COMMITTED tree and restored with `git checkout -- <file>`; run suites one at a time; backend `*.js` must be LF (`git ls-files --eol`).
- **The hook:** `.claude/hooks/check-html-js.js` blocks a broken inline script in `index.html`; a passing page load proves nothing.
- **Public repo:** no data files, no real names or phones in fixtures (the fork's fixtures are fake; keep them that way).
- **Model budget (memory):** subagents on Sonnet unless a task says otherwise; Fable/Opus for the map editor task and the Pull task.

## Review Focus

1. **Two phones tap Plowed on the same lot within seconds:** the second lands as its own row (append-only), the site reads Plowed once, no double-send from one phone (busy key `site|lot`). → Task 12 test.
2. **A Problem whose note is spaces:** refused as blank, on the phone before sending and on the server. → Task 6 and Task 12 tests.
3. **A push arrow whose two corners are the same point:** the server refuses `An arrow needs two different corners`; the phone's head maths returns null instead of NaN. → Task 5 and Task 13 tests.
4. **Pull from Shovel when the Snow App Sheet cannot be opened** (wrong id, no access): `{ ok: false, code: 'pull_failed', reason }`, nothing written. → Task 9 test.
5. **A site name with a comma or a quote in the CSV** ("Hickel, East" / `O'Riley's`): quoted per RFC 4180, still one row. → Task 10 test.

---

### Task 1: Clone both repos, strip remotes, bring the spec, prove the clones run

**Files:**
- Create `claudes room/Plow-Command-repo/` (clone of `Snow-App-repo`, at `origin/main` = `af1bd65`).
- Create `claudes room/plow-command-script/` (clone of `snow-app-script`, at `master` = `ba22d81`).
- Create `Plow-Command-repo/docs/superpowers/specs/2026-10-21-plow-command-design.md` and `.../plans/2026-10-21-plow-command.md` (copies of the room-level files).
- Modify `plow-command-script/.clasp.json`: keep it (two backend tests read its `filePushOrder`) and set only `scriptId` to the placeholder `REPLACE-AT-DEPLOY`, so a stray `clasp push` fails instead of landing on the Sidewalk script. (Ruling 10/21 after the first run; the original line said to delete the file.)

**Interfaces (Produces):** two working trees other tasks edit. Backend tests find the phone repo through `PLOW_PHONE_REPO` (Task 11) or the folder `../Plow-Command-repo`.

- [ ] **Step 1:** in `C:/Users/skull/OneDrive/claudes room`: `git clone Snow-App-repo Plow-Command-repo`, then inside it `git checkout -B main af1bd65` (the source's local `main` lags; `af1bd65` is reachable through its `spanish` branch, so the object is in the clone) and `git remote remove origin` (this also drops every copied `origin/*` ref). Verify `git log --oneline -1` prints `af1bd65`, `git branch` prints only `main`, `git remote -v` prints nothing.
- [ ] **Step 2:** `git clone snow-app-script plow-command-script`, inside it `git checkout -B master ba22d81`, `git remote remove origin`; verify HEAD `ba22d81`. In `.clasp.json` change only `scriptId` to `REPLACE-AT-DEPLOY` and commit `chore: .clasp.json kept for its push order; script id is a placeholder until the deploy task`.
- [ ] **Step 3:** `npm ci` in both; `npx playwright --version` works (browsers are installed on this machine).
- [ ] **Step 4:** copy the two room-level docs into `Plow-Command-repo/docs/superpowers/{specs,plans}/`; commit `docs: Plow Command spec and plan`.
- [ ] **Step 5:** prove the fork runs: `cd plow-command-script && npm test` → 458 pass; `cd Plow-Command-repo && npm run test:unit` → 299 pass. Backend identity tests may FAIL because they compare against `../Snow-App-repo` (the shovel phone repo, which they still match at this commit, so they pass); note the count either way. Do not run Playwright yet.
- [ ] **Step 6:** commit nothing further; both trees clean.

### Task 2: The name on screen

**Files:**
- Modify `Plow-Command-repo/index.html:6,13` (title, `<h1>`), `manifest.json` (name, short_name, description), `lib/share.js:18,34`, `lib/app.js:46,164-175,358`, `lib/rosterui.js:155,174`, `lib/boardui.js:391`, `lib/routesheet.js` + `lib/handoff.js` footers ("Made by Sidewalk" → "Made by Plow Command"), `lib/es.js` rows for every changed string.
- Modify `plow-command-script/routesheet.js`, `handoff.js` (same footer edits, byte-identical), `Code.js:532-534` (`SHEETS_FOLDER`, `SHEETS_WHO`), `Code.js:11` `VERSION = 'plow-1'`, `Plow-Command-repo/lib/config.js` `EXPECTED_BACKEND: 'plow-1'`.
- Test: `Plow-Command-repo/test/manifest.test.js`, `test/share.test.js`, `test/es.test.js`, `test/ui.spec.js` ("sign-in title reads in full at 320 px", exists from shell 42 on the `shovel-command` branch; copy that one test in), `plow-command-script/test/reply-action.test.js` (version label), `test-tools/mutation-check.js` (version-label mutation re-pointed to `plow-1`).

**Interfaces (Produces):** the strings every later task's tests assert on: title `Plow Command`; share text `Plow Command, the Titan plow truck app. Open this link on your phone, then Install it …` (same tail as today); request-access screen `This goes to Matt in Titan Inventory. Once he approves it, sign in with your name and this PIN.` with position placeholder and default `Plow driver`; not-on-roster `You're signed in, but not on the plow crew yet. Fill out your card and the dispatcher will add you.`; pending `Your card is in. The dispatcher will add you to the crew.`; board not posted `The dispatcher hasn't posted the trucks yet. Check back, or call your lead.`; map not drawn `This site's map isn't drawn yet. Use the plow note for now.`

- [ ] **Step 1:** write the failing tests: `manifest: own scope, full screen, the name the crew see` expects `m.name === 'Plow Command'` and `short_name === 'Plow Command'`; `share.test.js` message starts `Plow Command, the Titan plow truck app`; `es.test.js` a row per new string (Spanish: `Conductor de quitanieves` for Plow driver, `el despachador` for the dispatcher, `Plow Command` untranslated as a name); backend `reply-action.test.js` expects `version === 'plow-1'`.
- [ ] **Step 2:** run them, see them fail on the old strings.
- [ ] **Step 3:** make the edits listed under Files. In `es.js`, delete the rows whose English no longer renders (`Snow Crew`, `Sidewalk crew`, the three Matt sentences) and add the new ones.
- [ ] **Step 4:** `npm run test:unit` (phone) and `npm test` (backend) green; `node .claude/hooks/check-html-js.js Plow-Command-repo/index.html` clean.
- [ ] **Step 5:** `npm run verify-tests` in the backend: the version-label mutation must read `caught`, not `SKIPPED`.
- [ ] **Step 6:** commit both repos: `feat: Plow Command name on screen, plow-1 labels`.

### Task 3: Own storage keys and own shell cache

**Files:**
- Modify `Plow-Command-repo/lib/api.js:7` (`TOKEN_KEY = 'titan-plow-token'`), `lib/app.js:324` (`EDIT_KEY = 'titan-plow-editing'`), `lib/boardui.js:30` (`SHORT_KEY = 'plow-short-night-until'`), `lib/es.js:11-12` (`KEY = 'plow-lang'`, `FALLBACK_KEYS = ['snow-lang', 'wolf-lang']` read in order, first non-empty wins), `sw.js:9` (`CACHE_VERSION = 'titan-plow-shell-1'`, activate filter prefix `titan-plow-shell-`).
- Create `Plow-Command-repo/test/keys.test.js`.
- Modify `test/sw.spec.js` (prefix assertions), `test/es.test.js` (fallback order).

**Interfaces (Produces):** `SnowEs.FALLBACK_KEYS` exported for the test.

- [ ] **Step 1:** write `test/keys.test.js`: read every `lib/*.js` and `sw.js`; regex every `localStorage.(setItem|removeItem)\(\s*(['"])([^'"]+)\2` and every `[A-Z_]*KEY\s*=\s*['"]([^'"]+)['"]` (that catches `TOKEN_KEY`, `EDIT_KEY`, `SHORT_KEY`, `KEY`); assert each captured name matches `/^(titan-plow-|plow-)/`; assert every `localStorage.getItem('…')` literal is in the allow-list `[the four keys, 'snow-lang', 'wolf-lang']`. Add a sw.spec test: pre-create a cache `titan-snow-shell-41` in the page, activate the worker, assert it still exists and `titan-plow-shell-0` is gone.
- [ ] **Step 2:** run; fails on `titan-snow-token` and friends.
- [ ] **Step 3:** make the edits.
- [ ] **Step 4:** `node --test test/keys.test.js test/es.test.js` green; `npx playwright test test/sw.spec.js` green.
- [ ] **Step 5:** hand mutation: set `TOKEN_KEY` back to `titan-snow-token`, run keys.test → red; `git checkout -- lib/api.js`.
- [ ] **Step 6:** commit `feat: plow-only storage keys and shell cache prefix`.

### Task 4: The icon

**Files:**
- Modify `Plow-Command-repo/scripts/make-icons.py` (copy it first from `git -C ../Snow-App-repo show shovel-command:scripts/make-icons.py`): add `plow(draw, cx, cy, width)` drawing a white angled blade (a parallelogram leaning right with a dark lower lip) over the paler snowflake; option name `plow`.
- Regenerate `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`.
- Test: `test/manifest.test.js` (sizes 192/512/512, PNG, maskable inside the 80 % circle test from the shovel-command branch if present; else assert sizes only).

- [ ] **Step 1:** run `node --test test/manifest.test.js` on the fork: passes with the shovel icons. Add an assertion that the three files' SHA-256 differ from the shovel repo's (`../Snow-App-repo/icon-*.png`) so the fork cannot ship with the shovel icon.
- [ ] **Step 2:** run; fails (same bytes).
- [ ] **Step 3:** `python scripts/make-icons.py plow` writes the three files; eyeball `icon-512.png` with the Read tool.
- [ ] **Step 4:** test green. Commit `feat: plow blade icon`.

### Task 5: Backend zone types: storage, keep clear, push

**Files:**
- Modify `plow-command-script/roster.js:46,185-197` and `Code.js:142,162`.
- Test: `test/roster.test.js`, `test/api.test.js`, `test-tools/mutation-check.js`.

**Interfaces (Produces):** `SNOW_ROSTER.ZONE_TYPES = ['storage', 'no_touch', 'push']`; `validate('zone', rec, ctx)` errors, exact: `Zone type must be storage, no_touch or push`; `An arrow needs at least 2 corners`; `An arrow needs two different corners`; areas keep `A zone needs at least 3 corners` and `That outline crosses itself`. `write_` sets `area_sqft = 0` for a push. New site/zone ids `PS-`/`PZ-`.

- [ ] **Step 1:** tests in `roster.test.js`: `zone types: storage, no_touch and push are accepted; sidewalk, hand and heated are refused with the three named`; `a push arrow: 2 corners ok, 1 refused, two identical corners refused, 5 corners crossing itself is fine (no outline)`; `an area still needs 3 corners and no crossing`. In `api.test.js`: `saveZone of a push stores area_sqft 0` and `a site saved here gets a PS- id, a zone a PZ- id` (fake UUID is deterministic in the fake; assert the prefix).
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement: `ZONE_TYPES` list; in the zone branch `var isArrow = rec.type === 'push'`; min corners 2/3; distinct check for arrows (`ring[0]` vs `ring[1]` lng/lat equal → error); self-intersection only `!isArrow`. `Code.js:162`: `rec.area_sqft = rec.type === 'push' ? 0 : Math.round(...)`. `Code.js:142` prefixes `{ site: 'PS-', route: 'R-', zone: 'PZ-' }`.
- [ ] **Step 4:** `npm test` green.
- [ ] **Step 5:** add mutations: `a sidewalk zone slips through` (ZONE_TYPES with `'sidewalk'`), `a one-corner arrow saves` (min 2 → 1), `a push gets an area` (area line without the ternary), `a plow-made site gets a Shovel id` (`'PS-'` → `'S-'`). `npm run verify-tests` → all caught.
- [ ] **Step 6:** commit `feat(backend): zone types storage, keep clear, push arrow; PS-/PZ- ids`.

### Task 6: Backend shift log: the lot

**Files:**
- Modify `plow-command-script/shiftlog.js` (cut curbs lines 38-128, `zoneWalkId`, passes 210-300 except `undoTarget`, `firstPassWalks`, `siteTouched`, `siteWords`; rewrite `walksFor`, `statesFor`, `checkTap`, `walkDone`, `undoTarget`), `Code.js` (`tapZone_` 350-372: zone id must be `lot`; drop `cleanAgain` 315-333 and its `case`, `BOARD_LEAD`, `WRITES` entries), `auth.js` (LEAD list minus `cleanAgain`).
- Test: rewrite `test/shiftlog.test.js`, `test/shiftlog-api.test.js`, `test/shiftlog-sheet.test.js`; mutations.

**Interfaces (Produces):** `CrewShiftLog.walksFor(siteId, zones)` → `[{ zone_id: 'lot', type: 'lot', name: 'Lot' }]`; `statesFor('lot')` → `['plowed', 'problem']`, any other type `[]`; `checkTap({ zone_id, state, note })` → `null` or one of: `Only the lot can be tapped`, `State must be plowed or problem`, `A problem needs a note`; `walkDone` = state `plowed`; `siteDone`, `routeProgress`, `walkStates`, `undoTarget` (no again branch), `realTaps`, `siteTimes`, `visitTotals`, `snowSince`, `openProblems`, `dayOrder`, `walkCount`, `zoneName`, `stormState`, `shiftFor`, `walkKey` keep their names and shapes. Exports list = exactly those.

- [ ] **Step 1:** tests, each with the expected rows worked on paper: `walksFor: one Lot, with no zones and with three piles`; `statesFor: plowed, problem for the lot; nothing for storage, no_touch, push`; `checkTap: problem with a blank note (spaces) refused; plowed never needs one; zone_id 'Z-1' refused`; `siteDone: newest standing row plowed = done; a later problem = not done; an undone plowed = not done`; `undoTarget: the newest real tap by seq, never an undo row`; API: `tapZone lot plowed appends one Log row with zone_id 'lot'`, `tapZone with zone_id 'whole' is refused`, `cleanAgain is an unknown action`.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement the cuts and rewrites. Delete `CURB_ROLLUP` and every curb function; delete `standingAgains`, `passInfo`, `checkAgain`, `passSegments`, `firstPassWalks`, `siteTouched`, `siteWords`, `zoneWalkId`. `walkStates` no longer honours `again` rows.
- [ ] **Step 4:** `npm test` green (routesheet/handoff tests will break here: that is Task 7; run only the three shiftlog files plus auth/api until then: `node --test test/shiftlog*.test.js test/auth.test.js test/api.test.js`).
- [ ] **Step 5:** mutations: `a problem saves with no note`, `a 'treated' tap is accepted`, `a problem counts as done`, `a tap on a pile is accepted`. Run with `ONLY="shiftlog"`.
- [ ] **Step 6:** commit `feat(backend): the lot is the unit; curbs, passes and Touched removed`.

### Task 7: Backend sheets and handoff for the lot; outlines and points gone

**Files:**
- Modify `plow-command-script/routesheet.js:211-290` (`siteData`: `walks` = one entry for the lot from the newest standing row; no `passes`; `DONE = ['plowed']`; per-site line words `Plowed <time> by <name>` / `Problem: <note> <time> by <name>` / `Not done this shift`; footer `Made by Plow Command from driver taps`), `handoff.js` (`leftoverOf`: `walksDone/walksTotal` → `plowed: boolean`; the line parts `Not plowed` / `Problem: <note>`; no `(pass n)`), `Code.js:66-79,99-105` (bootstrap/getZones: no `slim`, every live zone with its ring; delete `points.js` and its require/concat), `test/geo-identity.test.js` file list minus `points.js`.
- Test: `test/routesheet.test.js`, `test/handoff.test.js`, `test/routesheet-api.test.js`, `test/outlines-api.test.js` (delete), `test/points.test.js` (delete); mutations.

**Interfaces (Produces):** `CrewRouteSheet.sheetData(o, routeId, shiftId).sites[i]` = `{ id, name, start, finish, done, lot: { state, note, by_name, at, off_route }, depth, materials, equipment }` (no `walks`, no `passes`); `CrewHandoff.handoffData(o, h).leftovers[i]` = `{ site_id, name, address, plowed: false, problem: { note } | null, started, done }`. `handoffHtml`/`sheetHtml` signatures unchanged.

- [ ] **Step 1:** rewrite the expected sheets in the test comments for a two-route storm where S1 is plowed 2:14 AM by Alex and S2 is a problem "gate locked" 3:05 AM; assert the HTML contains `Plowed 2:14 AM by Alex Test` and `Problem: gate locked 3:05 AM by Alex Test` and, for an untapped S3, `Not done this shift`; `handoffData: a site with no night tap is a leftover with plowed false; a plowed site is not; a problem site is, with its note`.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement; delete `points.js`, the `slim` branch and the outlines action.
- [ ] **Step 4:** `npm test` green (identity tests now compare with `../Snow-App-repo` and FAIL for shiftlog/routesheet/handoff: expected until Task 11 re-points them; run `node --test` on the other files meanwhile and say so in the commit).
- [ ] **Step 5:** mutations: `an untapped lot prints nothing`, `a problem site counts as done on the sheet`, `a leftover loses its problem note`.
- [ ] **Step 6:** commit `feat(backend): sheets and handoff speak lot; outlines and points removed`.

### Task 8: `plow_note` and the dispatcher mark

**Files:**
- Modify `plow-command-script/roster.js` (`PLOW_NOTE_MAX = 500`; site validate; crew validate `dispatch`), `auth.js:31-33` (`resolveRole`: after the adminNames check, `if (c && c.dispatch === true) return { ok: true, role: 'admin', name, profile_id, crew_id: c.id }`), `Code.js:106-175` (`write_` for kind `crew`: `if (a.crew_id && rec.id === a.crew_id && (rec.dispatch === true) !== (cur && cur.dispatch === true)) return { ok: false, code: 'forbidden', reason: 'You cannot change your own dispatcher mark' }`; site save keeps `plow_note` when left out, trims when sent).
- Test: `test/roster.test.js`, `test/auth.test.js`, `test/api.test.js`; mutations.

**Interfaces (Produces):** site record field `plow_note` (string); crew field `dispatch`; error texts `Plow note must be text of at most 500 characters`, `Dispatch must be yes, no or not set`.

- [ ] **Step 1:** tests: `plow_note: 500 chars saves trimmed, 501 refused, left out keeps the stored note, null clears it`; `dispatch: true/false/null ok, 'yes' refused`; `a crew record with dispatch true signs in as admin; false or unset as crew; archived record never`; `a dispatcher saving their own card with dispatch flipped is forbidden; Matt flipping it is fine; a dispatcher flipping someone else's is fine`; `a dispatcher can End storm and post` (BOARD gates pass for role admin); `dispatch is not in a crew phone's crew list` (publicRow).
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm test` green (minus the identity files, as in Task 7).
- [ ] **Step 5:** mutations: `dispatch grants nothing` (auth line removed), `self-mark allowed`, `plow_note unlimited`, `a crew phone receives dispatch` (PUBLIC_CREW_FIELDS + `'dispatch'`).
- [ ] **Step 6:** commit `feat(backend): plow_note on sites; dispatch mark makes a sign-in admin`.

### Task 9: Pull from Shovel Command (backend)

**Files:**
- Create `plow-command-script/pull.js` (pure: `SNOW_PULL.diff(shovel, plow)`; `module.exports` for node).
- Modify `sheet.js` (`var SHOVEL_SHEET_ID = '(in the room-level plan)'`; `readAllFrom_(bookId, name)`: a cache-free `readAll_` over `SpreadsheetApp.openById(bookId)`), `Code.js` (`case 'pullFromShovel': return pullFromShovel_(a, req)`; `pullFromShovel_`), `auth.js` (ADMIN list + `pullFromShovel`), `test-tools/mutation-check.js` FILES + `pull.js`.
- Test: create `test/pull.test.js` (pure) and `test/pull-api.test.js` (fake with TWO books: the plow Sheet and a `SHOVEL` book whose Sites/Zones hold shovel records including sidewalk zones and an archived site).

**Interfaces (Produces):**
- `SNOW_PULL.SITE_FIELDS = ['name','address','customer','notes','materials_needed','units','day_rank','needs_clearance','map']`, `ZONE_FIELDS = ['site_id','name','note','ring','priority']`, `PULLED_TYPES = ['storage','no_touch']`.
- `SNOW_PULL.diff({ sites, zones }, { sites, zones })` → `{ adds: { sites: [rec], zones: [rec] }, updates: { sites: [{ id, fields }], zones: [{ id, fields }] }, unchanged: { sites: n, zones: n }, shovel_archived: [siteId], skipped: { zones: n } }`. Only live shovel sites and live shovel zones of PULLED_TYPES whose site is live on the shovel side are considered; a zone of another type is `skipped`. Adds carry the Shovel id, the compared fields, `type`, and `rev: 0`. Field equality is deep (`JSON.stringify` of the field).
- Action `pullFromShovel { apply: boolean }` → `{ ok: true, action: 'pullFromShovel', applied: boolean, adds: {sites: n, zones: n}, updates: {...}, unchanged, shovel_archived, skipped, preview: <diff> }` with `preview` only when `apply` is false; on an openById throw `{ ok: false, code: 'pull_failed', reason: String(e.message) }`.
- Apply writes under the script lock: each add via `writeRecord_` with `rev: 1`, `archived: false`, `area_sqft` from the ring (areas), `plow_note: ''` for sites; each update = `Object.assign({}, cur, fields, { rev: cur.rev + 1 })` (so `plow_note`, `archived` and anything else stay). Audit action `pullFromShovel`. Never touches a `push` zone, never archives, never writes the shovel book.

- [ ] **Step 1:** `pull.test.js` with a hand-built shovel set (S-1 live, S-2 archived, S-3 new; zones Z-a storage of S-1, Z-b sidewalk of S-1, Z-c no_touch of S-3, Z-d storage of S-2) against a plow set (S-1 with an older address and a plow_note; Z-a with a moved ring; PZ-x push of S-1): expect adds S-3 + Z-c; updates S-1 {address} + Z-a {ring}; unchanged 0/0; shovel_archived [S-2]; skipped zones 2 (Z-b sidewalk, Z-d on an archived site). `pull-api.test.js`: preview writes nothing (fake records writes); apply writes exactly those four records with the right revs and keeps S-1's `plow_note`; the shovel book has no write; a second apply reports all unchanged; a crew sign-in is forbidden; a dispatcher is allowed; a bad `SHOVEL_SHEET_ID` answers `pull_failed`.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement `pull.js`, `readAllFrom_`, `pullFromShovel_`.
- [ ] **Step 4:** `npm test` green (minus identity).
- [ ] **Step 5:** mutations: `the pull archives` (writes `archived: true` for shovel_archived), `the pull overwrites plow_note` (assign order flipped), `the pull brings sidewalks` (PULLED_TYPES + sidewalk), `the pull writes the shovel book`, `crew may pull` (auth list).
- [ ] **Step 6:** commit `feat(backend): Pull from Shovel Command, preview then upsert by id`.

### Task 10: The storm CSV (backend) and `csv.js`

**Files:**
- Create `plow-command-script/csv.js` (UMD like `routesheet.js`; global `CrewCsv`; node requires `./time`, `./shiftlog`, `./routesheet`).
- Modify `Code.js` (`owedSheets_`/`endJobs_` 711-760: one `{ kind: 'csv', made_for: 'end', for_seq, route_id: '', shift_id: '', label: <fileName>, page }` per End; `makeStormSheets_` 838-880: `if (p.kind === 'csv') file = folder.createFile(row.name, page.text, 'text/csv')`; `retrySheets_` covers kind csv), `test-tools/mutation-check.js` FILES + `csv.js`, `test/geo-identity.test.js` list + `csv.js`.
- Modify `test/fake-apps-script.js:108` (`folder.createFile(nameOrBlob, text?, mime?)` records both forms).
- Test: create `test/csv.test.js`; extend `test/routesheet-drive.test.js`.

**Interfaces (Produces):**
- `CrewCsv.HEADER` (the exact header string); `CrewCsv.stormCsv(o)` → string (`o` is the `sheetData` input shape: `{ storm_id, storms, routes, sites, zones, crew, log, visits, posts, moves, trucks }`); `CrewCsv.fileName(o, updated)` → `Plow visits 12-4.csv` or `Plow visits 12-4 (updated 9-12 AM).csv` (same `updated` stamp as `CrewRouteSheet.fileName`).
- Rows: for every `(route, shift)` pair `CrewRouteSheet.sheetsFor(o)` names, every site in route order → one row from the newest standing lot tap that shift (state `plowed`/`problem`, else `not done` with blank `plowed_at`/`driver`); then every real tap with `off_route === true` that storm, one row each, `route` and `truck` blank. `driver` = the tap's `by_name` (not the Post's lead). `truck` = `CrewRouteSheet` crew/truck for the pair. `new_snow_in` and `materials_used` from `visitTotals` cards joined with `; ` by person (`Alex 2.5`). `off_route` = `yes`/`no`.
- Quoting: a field containing `,`, `"`, CR or LF is wrapped in `"` with `"` doubled.

- [ ] **Step 1:** `csv.test.js` with the Task 7 storm plus an off-route tap on S4 by Jordan: expected text written out in the test, line by line, including the header and a site named `Hickel, East` (quoted) and `O'Riley's` (not quoted). `fileName` for a 12/4 storm = `Plow visits 12-4.csv`. Drive test: End storm's job creates the CSV in the storm folder with mime `text/csv`, a Sheets row `kind: 'csv', status: 'saved'`; a failed createFile → `status: 'failed'` and Retry remakes only it; a second End makes `Plow visits 12-4 (updated …).csv`.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm test` green (minus identity).
- [ ] **Step 5:** mutations: `a comma in a site name splits the row` (quote function returns raw), `an unreached lot is left out`, `off-route taps are left out`, `a failed CSV is never retried`.
- [ ] **Step 6:** commit `feat(backend): one CSV per storm beside the PDFs; csv.js shared`.

### Task 11: Backend tidy: Gear out, identity to the plow phone, verify-tests whole

**Files:**
- Modify `plow-command-script/sheet.js:10-30` (TABS minus Gear; `CACHED_TABS` minus Gear), `Code.js` (`addGear`, `getBoard` gear, bootstrap `boot.gear` removed), `auth.js` (ADMIN minus `addGear`) (`pairing.js` and `board.js` never read gear: no change there), `test/geo-identity.test.js` (`PLOW_PHONE_REPO` env, default `../Plow-Command-repo`; file list `geo, time, board, history, shiftlog, routesheet, handoff, csv`), `test/geo-identity-env.test.js` (env name), `seed.js`/`seed-data.js`/`route-tools/` (delete: the plow Sheet is filled by the Pull; delete `test/seed.test.js`, `test/import-copy.test.js`), `test-tools/mutation-check.js` FILES (minus `points.js`, `route-tools/import-copy.js`, `seed.js`; plus `pull.js`, `csv.js`).
- Test: `test/pairing.test.js`, `test/api.test.js` (no gear).

- [ ] **Step 1:** tests: `addGear is unknown`, `getBoard answers moves, callouts, post and no gear`, `setup makes no Gear tab`; identity test reads `PLOW_PHONE_REPO`.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement the cuts.
- [ ] **Step 4:** `npm test`: everything green EXCEPT the identity tests for files Task 12 has not copied yet (they fail on `../Plow-Command-repo/lib/shiftlog.js` differing): record that, finish Task 12, then re-run.
- [ ] **Step 5:** `git ls-files --eol "*.js"` all `i/lf w/lf`.
- [ ] **Step 6:** commit `chore(backend): Gear out, seed and route-tools out, identity points at Plow-Command-repo`.

### Task 12: Phone shift log: the lot card

**Files:**
- Copy from `plow-command-script/` into `Plow-Command-repo/lib/`: `shiftlog.js`, `routesheet.js`, `handoff.js`, `csv.js` (new), `time.js`, `geo.js`, `board.js`, `history.js`. Delete `lib/points.js`.
- Modify `lib/shiftlogui.js`: `stateLabel` → `{ plowed: 'Plowed', problem: 'Problem', none: 'Not plowed' }`; `walkHtml` → `lotHtml(ctx, site, states)` with two buttons `data-send="<site>|lot|plowed"` / `…|problem` and the status line; delete `passHtml`, `confirmAgain`, Touched/curb words, "Which zone?" code paths; `siteHtml` shows `plow_note`; `tap(ctx, key, state, note)` sends `zone_id: 'lot'`; the Problem button opens the note box and refuses a blank note with `A problem needs a note`.
- Modify `lib/app.js:281-290` (delete `curbLine` and its call at line 277, delete `markMap`), `lib/livesum.js` (words `lots`), `lib/btnote.js` (Copy for BT: `Plowed`/`Problem`), `index.html` script list (`csv.js` after `handoff.js`; `points.js` out), `sw.js` SHELL (same), `lib/es.js` rows (`Plowed` → `Quitado`, `Problem` stays, `Not plowed` → `Sin quitar`, `A problem needs a note` → `Un problema necesita una nota`, `Lot` → `Estacionamiento`).
- Test: (the shared `shiftlog.js` is tested in the backend repo; the phone has no copy of that test and needs none) `test/livesum.test.js`, `test/btnote.test.js`, `test/ui.spec.js` (rewrite the Storm-tab describes: taps, Undo, Retry, off-route, site card, handoff card; the fake backend's zones are piles only and its log rows use `zone_id: 'lot'`), `test/es.test.js`.

**Interfaces (Produces):** `SnowShiftUI.lotHtml`; `data-send` keys `<siteId>|lot|<state>`; busy key per site `<siteId>|lot`.

- [ ] **Step 1:** tests: ui.spec `storm tab: a site card shows Plowed and Problem and the plow note`, `tapping Plowed sends zone_id lot and state plowed, the card reads Plowed 2:14 AM by …`, `Problem asks for a note; blank (spaces) is refused with the message; a note sends`, `two fast taps send once (busy key)`, `Undo`, `an off-route site tapped from Sites lands flagged`, `a plowed site fades`; node: `livesum words: 3 of 5 lots`, `btnote copy for a plowed and a problem site`.
- [ ] **Step 2:** `npx playwright test test/ui.spec.js -g "storm tab"` → fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm run test:unit` green; `npx playwright test test/ui.spec.js -g "storm tab|handoff|live view"` green; backend `npm test` now fully green (identity files match).
- [ ] **Step 5:** hand mutations (commit first): Plowed sends `cleared`; blank-note check removed; busy key removed. Each → a red test; restore with `git checkout`.
- [ ] **Step 6:** commit `feat(phone): the lot card, Plowed and Problem; shared files synced`.

### Task 13: Phone map: three types and push arrows (Fable/Opus)

**Files:**
- Modify `lib/mapview.js`: `TYPES` three entries (+ `push: { color: '#ffffff', edge: '#1a1a1a', label: 'Push snow this way' }`); `featureCollection(zones)` → areas as `Polygon`, push as `LineString` plus a `Polygon` head feature `{ properties: { id: z.id + ':head', type: 'push_head' } }`; new pure `arrowHead(ring)` → a 4-point closed ring (tip = last corner, base 4 m back along the last segment, half-width 2 m) or `null` when the last two corners coincide; layers: `zones-fill`/`zones-line` get `filter: ['in', ['get','type'], ['literal', ['storage','no_touch']]]`, new `push-casing` (line, `#1a1a1a`, width 7), `push-line` (line, `#ffffff`, width 4), `push-head` (fill, `#ffffff`) and `push-head-line` (line, `#1a1a1a`, width 2), both heads filtered on `push_head`; `legendHtml` three rows in TYPES order; delete `drawMarks`, `markFor`, `markOf` and `drawStars` (`priority` stays stored but is not drawn); `sheetHtml(z)` for a push shows name + note only, no area.
- Modify `lib/app.js:344-375` (`openMap`: no outlines, no `snow-outlines`; the lot buttons under the map via `SnowShiftUI.lotHtml`), `lib/api.js` (drop the `outlines` call).
- Test: `test/mapview.test.js` (`arrowHead` maths on paper: tip at [−149.9, 61.2], previous corner 10 m west → base centre 4 m west of the tip, half-width 2 m north/south, exact coordinates computed with `dx = cos(61.2°)·111320`, `dy = 110540` m per degree; coincident corners → null; `featureCollection` emits LineString + head for a push, Polygon for a pile; legend order), `test/ui.spec.js` (`map: a push arrow draws a white line and a head; a pile is purple; no walk marks; the lot's buttons sit under the map`), `test/outlines.spec.js` and `test/outlines.test.js` delete.

**Interfaces (Produces):** `SnowMap.arrowHead(ring)`; `SnowMap.TYPES`; `featureCollection` property `type` values `storage | no_touch | push | push_head`.

- [ ] **Step 1:** write the node tests with the coordinates worked out in comments; the Playwright test checks `map.getSource('zones')._data.features` through `page.evaluate` (the map is exposed on `window.__snowMap` in tests already; keep that hook).
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `node --test test/mapview.test.js` green; `npx playwright test -g "map"` green; no console error on open (the existing "map opens with no console error" test).
- [ ] **Step 5:** hand mutations: head at the first corner; a push emitted as a Polygon; coincident corners returning NaN.
- [ ] **Step 6:** commit `feat(phone): piles, keep clear and push arrows on the map; outlines removed`.

### Task 14: Phone editor: Pile, Keep clear, Push arrow; import piles only (Fable/Opus)

**Files:**
- Modify `lib/mapedit.js`: `BTN = { storage: 'Pile', no_touch: 'Keep clear', push: 'Push arrow' }`; `problem()` → arrows need 2 corners (`An arrow needs at least 2 corners`), areas 3; `outlineData()` draws a LineString + `arrowHead` for a push draft; `onMapClick` on a push zone selects it (hit test the `push-line` layer with a 10 px box: `queryRenderedFeatures([[x-10,y-10],[x+10,y+10]], { layers: ['push-line'] })`); a tap on the LAST corner marker while drawing a push reverses `st.corners` (flip) instead of selecting; `walksAndPiles` → `piles(zones)`; `addImported` summary `N piles` (and `K keep-clear` when present); `readBootprint`/`lib/bpimport.js`: `TYPE_OF = { storage: 'storage' }`; walk, hand, plow, cut-outs all skipped and counted (`skipped.walks`, `skipped.hands`, `skipped.lots`, `skipped.cutouts`); the import summary names them: `Left out: 12 walks, 3 hand, 1 lot`.
- Test: `test/bpimport.test.js` (the ANMC export fixture already in the repo: expect 3 storage zones in, 26 walks/hand out, counts exact), `test/ui.spec.js` (`editor: three buttons; drawing two corners as Push arrow saves type push; one corner refused; tapping the head flips the arrow; a pile needs 3 corners; Import from Bootprint brings piles only and says what it left out`).

- [ ] **Step 1:** tests as above; the editor Playwright tests drive `page.mouse.click` on the map like the existing "Matt's zone editor" tests.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `node --test test/bpimport.test.js` green; `npx playwright test -g "editor"` green.
- [ ] **Step 5:** hand mutations: import maps walk → storage; flip never fires; one-corner arrow saves.
- [ ] **Step 6:** commit `feat(phone): editor draws piles, keep-clear and push arrows; import brings piles only`.

### Task 15: Phone roster: Plow driver, the Dispatcher switch

**Files:**
- Modify `lib/app.js:162-175` (position placeholder/default `Plow driver`), `lib/app.js:377-493` (`openWorker`: a `Dispatcher` row for admins, `editWorker`: a `dispatch` tri-state like `can_drive`, disabled with `(your own card)` when `w.id === S.me.crew_id`), `lib/rosterui.js` (wording from Task 2), `lib/es.js` (`Dispatcher` → `Despachador`).
- Test: `test/ui.spec.js` (`roster: the worker card shows Dispatcher to Matt and to a dispatcher, never to crew; it is disabled on one's own card; saving sends dispatch true`), `test/rosterui.test.js`.

- [ ] **Step 1:** tests; the fake backend's `TOKENS` gains `'tok-dee': 'admin'` for a dispatcher whose `me.crew_id` is `C05`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** `npx playwright test -g "roster"` green.
- [ ] **Step 5:** hand mutation: the own-card guard removed → red. Restore.
- [ ] **Step 6:** commit `feat(phone): Plow driver at sign-in; Dispatcher switch on the worker card`.

### Task 16: Phone sites: `plow_note`, Pull from Shovel Command

**Files:**
- Modify `lib/app.js:262-290` (site card shows `plow_note`; the Sites tab for admins starts with a card `Pull from Shovel Command` → button `Preview`), `lib/app.js:531-559` (`editSite`: a `Plow note for drivers` textarea), new `lib/pull.js` (phone-side dialog: `SnowPullUI.open(ctx)` → calls `pullFromShovel { apply: false }`, renders `Adds: N sites, M piles · Updates: … · Archived on the shovel side: <names>`, button `Pull now` → `apply: true` → toast `Pulled: N added, M updated` → `ctx.refresh()`), `index.html` + `sw.js` (add `lib/pull.js`), `lib/es.js` rows.
- Test: `test/ui.spec.js` (`sites: the plow note shows on the card and the storm tab; the edit box saves it; Pull preview lists the counts and Pull now sends apply true; a crew phone has no Pull card`), `test/api.test.js`-style node test for the dialog text builder (`SnowPullUI.summary(reply)` pure).

- [ ] **Step 1:** tests. **Step 2:** fail. **Step 3:** implement. **Step 4:** green.
- [ ] **Step 5:** hand mutation: `Pull now` sends `apply: false` → red. Restore.
- [ ] **Step 6:** commit `feat(phone): plow note; Pull from Shovel Command with a preview`.

### Task 17: Phone live view: Download CSV, sheets status with CSV, Gear and Log out

**Files:**
- Modify `lib/shiftlogui.js:316-400` (`sheetsStatus` counts `kind: 'csv'` rows as sheets; a `Download CSV` button for admins when a storm is open or was: builds `CrewCsv.stormCsv(o)` from `S` and saves via `Blob` + `<a download="<CrewCsv.fileName(o)>">`), `lib/app.js:204` (admin tabs `storm, routes, sites, board, roster`; the `log` tab and `lib/gear.js` removed; `index.html`/`sw.js` lists), `lib/boardui.js` (no gear section), `lib/es.js` (`Download CSV` → `Descargar CSV`).
- Test: `test/ui.spec.js` (`live view: Download CSV saves a file named Plow visits 10-2.csv whose text equals CrewCsv.stormCsv over the fake rows; crew never see it; the sheets line counts the CSV`), `test/gear.test.js` delete (`test/board.test.js` never touches gear: unchanged).

- [ ] **Step 1:** tests (Playwright `page.waitForEvent('download')`). **Step 2:** fail. **Step 3:** implement. **Step 4:** green.
- [ ] **Step 5:** hand mutation: the download builds from `S.log` of the wrong storm → red. Restore.
- [ ] **Step 6:** commit `feat(phone): Download CSV on the live view; Gear and Log out`.

### Task 18: Spanish trim and the no-data guard

**Files:**
- Modify `lib/es.js` (delete rows for every string no longer rendered: curbs, Touched, Clean again, Which zone?, Sidewalk/Hand work/Heated, outlines lines, Gear; keep and add the rows named in Tasks 2, 12-17), `test/es.test.js`.
- Test: a new node test `every English string rendered by lib/*.js has a row`: extract string literals ≥ 2 words from `innerHTML`/`textContent` assignments in `lib/*.js` (the heuristic the Spanish spec's ledger used; see `docs/superpowers/specs/2026-10-09-spanish-design.md` in the fork) and assert each is a key in `ES` or matches an `ES_RULES` pattern; `test/no-data.test.js` still passes (no data files tracked).

- [ ] **Step 1:** write the coverage test; it lists the missing rows. **Step 2:** fail with the list. **Step 3:** add rows, delete dead ones. **Step 4:** green.
- [ ] **Step 5:** a crew member reads the Storm tab in ES before shipping (assumption A9 in the spec): note it in HANDOFF.md for Matt.
- [ ] **Step 6:** commit `feat(phone): Spanish rows for the plow screens; dead rows out`.

### Task 19: Full phone run, shell list, hand-mutation ledger

**Files:**
- Modify `sw.js` SHELL (every `index.html` script present: the existing `test/sw.spec.js` "every index.html script is in the shell" test enforces it), `HANDOFF.md` (rewrite for Plow Command: state, counts, what is live), `README` if any.

- [ ] **Step 1:** `npm run test:unit` → record the count. `npx playwright test` → record the count (expect roughly 250 node + 330 Playwright after the cuts; the suite is the truth).
- [ ] **Step 2:** `node --test test/no-data.test.js` green; `node .claude/hooks/check-html-js.js index.html` clean.
- [ ] **Step 3:** backend: `npm test` green, `npm run verify-tests` ALONE → every mutation caught, none SKIPPED; record the counts.
- [ ] **Step 4:** write the counts into `HANDOFF.md` and the CLAUDE.md table row for the two new repos (room-level `CLAUDE.md`: add `Plow-Command-repo` and `plow-command-script` rows under "The repos" and "Testing"). Re-copy the room-level spec and plan into `docs/superpowers/` (they carry the rulings made during the build), then SCRUB real employee names from the committed copies and from code comments before the remote exists (ruling 10/21): grep the phone repo for the real employee names (the room-level masters, which stay private, carry the list) and replace with role words ("a driver", "the dispatcher", "the sanding truck's sheet"); fixtures keep their made-up names (Alex Test, Jordan Demo). The room-level masters keep the real names. Commit.
- [ ] **Step 5:** commit both repos `test: full run; handoff notes`.

### Task 20: Deploy: `/plow-deploy`, Matt's editor steps, GitHub, the first Pull

**Files:**
- Create `claudes room/.claude/skills/plow-deploy/SKILL.md` (copy of `sidewalk-deploy/SKILL.md` with: repos `plow-command-script` / `Plow-Command-repo`, branch `main`, GitHub `titanalaska/Plow`, address `https://titanalaska.github.io/Plow/`, env `PLOW_PHONE_REPO`, shell prefix `titan-plow-shell-`, the deployment id filled in at step 5 below, "Deploys made before this skill: none").
- Modify `Plow-Command-repo/lib/config.js` (`SNOW_URL` = the new `/exec` URL), `test/ui.spec.js:6` and `test/no-data.test.js` (`isSnow` matches the new deployment id).
- Create `claudes room/Plow Command QR.png` (the install QR, made the same way as `Sidewalk QR.png`; `pip install segno` if no QR library is present: `segno.make('https://titanalaska.github.io/Plow/').save(..., scale=10)`).

Matt's steps, one at a time, each confirmed by screenshot (CLAUDE.md):
- [ ] **Step 1:** DONE BY MATT 10/21 ~10 AM: the "Plow Command" Google Sheet is (in the room-level plan) (his link carried a sharing-invite parameter: at step 4 confirm the script's account can open BOTH this Sheet and the Snow App Sheet, or the Pull fails `pull_failed`). Set `PLOW_SHEET_ID` in `sheet.js` to it (the rename from `SNOW_SHEET_ID` was done in Task 9; only the VALUE changes here). Add a backend test asserting `PLOW_SHEET_ID !== SHOVEL_SHEET_ID` and that `SHOVEL_SHEET_ID` is the Snow App Sheet id (in the room-level plan), so a slip can never point the pull's writes at the shovel book. Commit.
- [ ] **Step 2:** DONE BY MATT 10/21 9:30 AM: he made the standalone project "Plow Command" in the Apps Script editor; its Script ID is (in the room-level plan). No `clasp create`. Put that id into the EXISTING `plow-command-script/.clasp.json` in place of `REPLACE-AT-DEPLOY`, leave everything else in that file as it is, and commit. clasp login is current (`~/.clasprc.json` has a token, refreshed 10/21 7:31 AM).
- [ ] **Step 3:** `clasp push`.
- [ ] **Step 4:** Matt opens the editor, runs `setup` once, authorizes Sheets, Drive and triggers; screenshot shows the 13 tabs.
- [ ] **Step 5:** Matt: Deploy → New deployment → Web app, execute as me, anyone → copies the `/exec` URL. Paste it into `config.js`, the two test matchers and the skill; `clasp deployments` shows `@1`; describe it `plow-1 <sha>`.
- [ ] **Step 6:** `gh repo create titanalaska/Plow --public --source Plow-Command-repo --push` (branch `main`); `gh api repos/titanalaska/Plow/pages -X POST -f build_type=legacy -f source[branch]=main -f source[path]=/`; wait for the Pages run (`gh run list -R titanalaska/Plow`); `curl -s https://titanalaska.github.io/Plow/sw.js | head -12` shows `titan-plow-shell-1`.
- [ ] **Step 7:** Matt signs in on the laptop pane at `/Plow/` as Matthew; taps Sites → Pull from Shovel Command → Preview shows 60 sites and ~60 piles → Pull now. Screenshot of the Sites list.
- [ ] **Step 8:** A named person is the dispatcher (Matt, 10/21). The dispatcher signs in to Plow Command with their Inventory PIN; with no profile yet they tap "Not on the list? Type your name" (position Plow driver is fine) and Matt approves it in Inventory. Matt then taps Add to crew on the Roster tab and switches on **Dispatcher** on the dispatcher's card. Screenshot of that card with the switch on.
- [ ] **Step 9:** `/plow-deploy dry-run` prints "nothing to deploy". Commit the skill. Update memory `project_plow_command.md`: LIVE, @1, shell 1, counts, dispatcher marked.

---

## Self-review notes (done while writing)

- Spec coverage: §1 → T1-4, T20; §2 → T5-11, T16; §3 → T8, T15; §4 → T12-13; §5 → T13-17; §6 → T7, T10, T17; §7 → T6-7, T11, T18-19; deploy → T20. The iLawn push-arrow mapping sessions are out of scope by the spec.
- Types: `lotHtml` (T12) is what T13's map uses; `arrowHead` (T13) is what T14's draft draws; `CrewCsv.stormCsv/fileName` (T10) is what T17 downloads; `pullFromShovel` reply (T9) is what T16 renders; `dispatch` (T8) is what T15 edits.
- Proportion: the spec is ~250 lines; this plan is about 2.5x, with no function bodies.
