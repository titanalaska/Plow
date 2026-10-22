# Plow Command: design

**Owner:** Matt Walsh. **Status:** design approved section by section in conversation, 10/21/26; this file awaits his read.
**Repos (new):** `Plow-Command-repo` (phone, PUBLIC: code only, served at titanalaska.github.io/Plow/) and
`plow-command-script` (Apps Script backend via clasp, no remote). Both are forks of live Shovel Command
(phone `af1bd65`, shell 41; backend `ba22d81`, @18 outlines-1) cut down to the lot.
**Home of this file:** `claudes room/docs/superpowers/specs/` until the repos exist; task 1 of the plan copies it
into `Plow-Command-repo/docs/superpowers/specs/` and commits it there.

## Why

The plow trucks run on paper. Each storm day the office posts a card on the Trello Snow Operations board with a PDF
per driver per shift ("Night Route Sheet (driver name) 12.15.25", "Day Route Sheets", "the sanding truck's sheet") and the
drivers' scanned sheets come back the next morning. Shovel Command replaced that for the sidewalk crew. Plow Command
does the same for the trucks: the same 60 site maps, with only the lot and the snow piles on them, one tap per lot,
a day/night handoff, and the office's record made by itself.

**Success:** on the first plow storm, every driver taps lots on their own phone, the dispatcher sees the taps land
live, at 8 AM the day drivers get Left by night, and at End storm one PDF per route per shift and one CSV for the
storm are in Drive with nobody remembering. A pile Matt moves in Shovel Command shows in Plow Command after a Pull.

## Decisions (Matt, 10/21/26)

| Question | Decision |
|---|---|
| Who drives | **Separate people.** The plow drivers are not the shovel crew. Their own roster. |
| What a driver taps at a site | **Plowed and Problem.** The lot is one unit. Sand and salt are a note or the site card, not a state. |
| Shifts | **Day and night, fixed.** Shovel Command's clock. One handoff at the morning swap. |
| Export | **Route sheets to Drive like Shovel, plus a storm spreadsheet** (CSV, one row per site visit). |
| Who runs the plow board | **A named dispatcher** (Matt, 10/21 ~10 AM: one person put in charge of plows). Still a roster mark Matt sets, so it can move; Matt stays admin. |
| Shape | **C: fully separate.** Own Sheet, own script, own repo. Maps and piles copied over (and re-pullable). |
| Sanding routes | A sanding run is a route like any other; its button reads **Plowed** (offered Sanded, declined). |

Matt was shown the drift cost of a separate Sheet and chose it anyway; the Pull in section 2 is the answer to it.

## 1. Shape

- **Fork, then cut.** Both repos start as copies of live Shovel Command so everything proven comes along:
  Inventory sign-in, typed names at sign-in, roster self-service with pictures, the Board, the Post by shift,
  Trucks, storms, the shift log, the 8 AM handoff, route sheets to Drive, the forecast hint, the Anchorage snow map,
  Valley/Anchorage and the short night, Copy for BuilderTrend, Spanish. Then the sidewalk parts come out (section 7).
- **Address** `titanalaska.github.io/Plow/` (GitHub repo `titanalaska/Plow`, Pages). Permanent like `/Sidewalk/`:
  never renamed or redirected (a 301 on `sw.js` freezes every install). Own icon (a plow blade over the snowflake,
  drawn by the same `scripts/make-icons.py`), own install card, own QR.
- **Name on screen:** Plow Command. The page title, the manifest, the share text, the sheet footers.
- **Its own Sheet** ("Plow Command", `PLOW_SHEET_ID`) and its own Apps Script deployment with its own URL.
  It reads Titan Inventory's Sessions and Profiles to trust sign-ins and **never writes Inventory**. It never touches
  the Snow App Sheet except to READ it in the Pull (section 2).
- **Its own saved keys on the phone.** `titanalaska.github.io` carries every Titan app on one origin, so
  `localStorage` and the Cache API are shared. Shovel Command's keys (`titan-snow-token`, `titan-snow-editing`,
  `snow-short-night-until`, `snow-lang`, `snow-outlines`) are never read or written by Plow Command. Its keys are
  `titan-plow-token`, `titan-plow-editing`, `plow-short-night-until`, `plow-lang` (read once from `snow-lang`, then
  `wolf-lang`, when unset). A test asserts every key the app WRITES or removes starts with `titan-plow-` or
  `plow-`, and that the only other keys it ever reads are those two language fallbacks.
- **Its own shell cache prefix** `titan-plow-shell-N`, which only ever deletes its own old versions.
- **Backend `VERSION` `plow-1`**, phone `EXPECTED_BACKEND` `plow-1`, `lib/api.js` keeps the same-version guard
  (a reply that does not name its action is refused).

## 2. Data

**Tabs kept from the fork:** Crew, Sites, Routes, Zones, Moves, Callouts, Posts, Log, Storms, Visits, Trucks, Sheets,
Audit. Same append-only rules, same `seq` ordering, same 10-minute script cache with the same write-drops-its-tab
rule. **Cut:** Gear.

**Sites** are the fork's record (name, address, customer, notes, materials_needed, units, day_rank, needs_clearance,
saved map view) plus **`plow_note`**: the lot instructions a driver reads ("push to the NE corner, never block the
dumpster"). Text, trimmed, at most 500 characters, blank by default.

**Zones, three types only:**

| Type | Colour | Label | Tapped? |
|---|---|---|---|
| `storage` | `#7d5ba6` | Snow storage | never |
| `no_touch` | `#e0218a` | Keep clear | never |
| `push` **new** | white fill, dark edge | Push snow this way | never |

A `push` zone is a **line of two or more corners** (`ring` holds the pins in order), drawn with an arrowhead at the
last corner. It has no area (`area` is 0 and never summed). The server refuses a push with fewer than two corners
and refuses every other type (`sidewalk`, `hand`, `heated` included) with an error naming the three. Flip = the
pins reversed; the editor does it on a second tap of the head.

**The lot is the unit.** Log rows carry `zone_id: 'lot'`, `state: 'plowed' | 'problem'`, `note` (required for
problem), `by_*`, `at`, `off_route`, `undoes`. `walksFor(site)` in the shared `shiftlog.js` always answers one item
`{ zone_id: 'lot', name: 'Lot' }`; no zone type is ever a walk. `statesFor('lot')` = `['plowed', 'problem']`.
A site is done this shift when its newest standing row is `plowed`. No pass numbers, no Clean again, no Touched,
no curb roll-up. Star rows (`zone_id: '*'`) keep one use: `depth` (New snow).

**Visits** (the site card) are the fork's: `depth_in`, `materials_used`, `equipment` minutes.

**Routes** are the fork's: a name and an ordered `site_ids`. Archived routes with Restore.

**Crew** records are the fork's plus **`dispatch`** (true | false | not set; section 3). Not in
`PUBLIC_CREW_FIELDS`, not a self field.

**Trucks** and **Sheets** are the fork's. Sheets rows gain `kind: 'pdf' | 'csv'` (existing rows read as `pdf`) so
Retry covers a failed CSV.

**Pull from Shovel Command.** Admin action `pullFromShovel { apply: boolean }`. With `apply: false` it reads the Snow
App Sheet's live Sites and its live `storage` and `no_touch` Zones and answers `{ adds, updates, unchanged }`: a
site or zone whose id is not in the plow Sheet is an add; one whose name, address, customer, notes,
materials_needed, units, day_rank, needs_clearance, saved map view (sites) or name, note, ring (zones) differ is
an update with the fields that differ. With `apply: true` it writes exactly that list, by id, with the plow Sheet's
own `rev` and one Audit row per record. It **never archives** anything (a site archived on the shovel side is
listed under `unchanged` with `shovel_archived: true` for Matt to decide), never touches `plow_note`, never touches
a `push` zone, never writes the Snow App Sheet. Records pulled keep their Shovel ids (`S-…`, `Z-…`); sites and
zones made in Plow Command get `PS-…` and `PZ-…` ids, so the pull can never land on one of them and a test can tell
the two apart by prefix alone. The first Pull is the initial copy.

**No MOA outlines.** No `outlines` fetch, no `snow-outlines` cache, no `slim` sign-in flag: the bootstrap carries
every live zone outright (three types, about 60 piles, a few hundred corners).

## 3. People

- **Sign-in** is Titan Inventory's, as in Shovel Command: name from the list, PIN, and "Not on the list? Type your
  name", whose position reads **Plow driver**. The request goes to Inventory; **Matt approves it there** (the
  dispatcher cannot approve Inventory profiles); then the dispatcher taps Add to crew in Plow Command.
- **Matt is always admin** (`ADMIN_NAMES`, unchanged).
- **The dispatcher is a roster mark.** A crew record with `dispatch: true` resolves to role `admin` for the whole
  plow app. Only an admin can set or clear it, **never on their own record** (the server refuses). Several people
  can carry it. The Roster worker card shows a **Dispatcher** switch to admins only.
- **Drivers are crew.** Same self-service card: phone, picture, can drive, valid ID, on call, cold-rated, seasons,
  gear, emergency contact (Matt and dispatchers only), Valley or Anchorage.
- **Lead is the Board's call** (Shovel's Part A rule): the driver placed on a truck is that route's lead for the
  shift and reaches the storm switch, Set truck and Hand off now. A rider placed as member taps sites like any
  crew. The roster `is_lead` flag grants nothing by itself.
- **Separate rosters, not policed.** A shovel person opening Plow Command gets "You're signed in, but not on the plow
  crew yet. Ask the dispatcher to add you." The two Crew tabs never read each other.

## 4. The driver's screens

Tabs for crew and leads: **Storm**, **Sites**, **Routes**, **Tonight**.

- **Storm tab:** the forecast hint; the Snowing/Stopped switch for the truck's driver (Board lead); then the sites of
  their posted route in order. One card per site: name, address, `plow_note`, **Plowed** and **Problem**, status
  line ("Plowed 2:14 AM by Alex", Undo, Retry). Problem asks for a note before it saves. A plowed site fades. A site
  tapped off the posted route is flagged `off_route`, as today. The 45 s timeout, cursor polling only on-tab and
  visible, and the save/conflict/double-tap guards are the fork's.
- **Site card:** New snow (in), sand or salt used, loader minutes when the site has a stationed unit.
- **Map** from a site card: the aerial, the piles, the push arrows (with heads), the keep-clear areas, and the lot's
  own Plowed and Problem under the map. No "Which zone?". No walk marks, no done-zone fading on the map (the lot has
  no polygon); the site's status line sits under the map instead.
- **Handoff card** after a handoff, during day shift: "Handoff from Night of 12/4 · 8:00 AM", your day route, then
  Left by night with "Started by Alex 9:12" and "Done 9:40" as taps land. Same rules and tests as the fork.
- **Tonight:** the Post for this shift, your truck and route first, then the others; names and phones only.
- **Sites** and **Routes** are read-only lists for crew, with the map link.

## 5. The dispatcher's screens (Matt and every `dispatch` mark)

- **Roster:** Waiting for approval, Waiting to be added, then the drivers ("Roster N" count in the tab while people
  wait, re-read every 5 min on screen). Worker card: Place, Make lead, Unassign, and the **Dispatcher** switch.
- **Sites:** grouped by customer, plow note on the card, the edit box with `plow_note`. **Edit map** draws
  **Pile** (area), **Keep clear** (area) and **Push arrow** (tap corners; the last tap is the head; a tap on the head
  flips it). Import from Bootprint maps `storage` to storage and keeps everything else out (walk, hand, plow,
  cut-outs), so a shovel-era export cannot bring sidewalks in; its summary counts piles only. **Pull from Shovel
  Command** with its preview sits at the top of Sites. Archived sites with Restore.
- **Routes:** name plus sites in order, same editor, Restore.
- **Board:** trucks (routes) as columns, drivers as tiles, one lead per truck. Warnings kept: lead who cannot drive,
  Valley people on a short night, the pairing rules (rides with, works well with, keep apart). Short-night switch kept.
- **Post** by shift (Night or Day) with the truck per route; Callouts by shift kept.
- **Storm tab, live view:** a card per truck with its sites' states and taps as they land; Start, Snowing/Stopped,
  Hand off now, End storm, Reopen; the summary line; the Anchorage snow map (a dot per site, forecast colour,
  measured depths as labels); the sheet status line with Retry; **Print sheets**; **Download CSV**. From 1000 px the
  Storm tab is the dashboard grid, as today.
- **Push arrows from the old plow maps** are not app code: where a Trello "Plow Map" PDF exists for a site, Claude
  registers it to the aerial in the pane and shows the arrows as a preview; Matt accepts or redraws. Where none
  exists, Matt draws them. One site at a time, after the release.

## 6. Shifts, handoff, export

- **Shifts:** the fork's clock. A night is named by its evening, `SHIFT_CUTOVER_HOUR` 9, `HANDOFF_HOUR` 8.
- **Handoff:** 8:00 AM automatically (booked at Start, Reopen, Night shift on, Snowing, Stopped, Hand off now; one
  trigger ever), plus Hand off now for a Board lead or admin. Night routes are frozen into the handoff row. Close
  storm remakes only a night that changed after its handoff, as the fork does.
- **Route sheets:** one PDF per route per shift, folder **`Plow Route Sheets / <storm start date> storm /`**, named
  `<route> Night of 12-4.pdf` / `<route> Day of 12-5.pdf`. Header: route, shift, storm start, driver (lead), rider
  (members), truck and who set it. Per site in route order: `Plowed 2:14 AM by Alex`, or `Problem: <note> 2:20 AM by
  Alex`, or **Not done this shift**; new snow; sand or salt used; loader minutes by person. Footer: "Made by Plow
  Command from driver taps", when, "(updated)" after a later End. Names only. Made at handoff (nights) and End storm,
  as the fork; `routesheet.js` byte-identical in both plow repos.
- **Storm CSV:** one file per storm, **`Plow visits <storm start date>.csv`**, in the storm's folder, made by the
  same job that makes the End storm PDFs and remade as `... (updated <time>).csv` after a later End; a Sheets row
  with `kind: 'csv'` so the status line and Retry cover it. **One row per site per posted route per shift**, so a lot
  nobody reached is a row with a blank time. Columns, in this order:
  `storm_start, shift, route, truck, driver, site, address, customer, plowed_at, state, problem_note, new_snow_in,
  materials_used, off_route`. `state` is `plowed`, `problem` or `not done`. Times are local wall clock
  (`2026-12-04 02:14`). A site tapped off-route on a shift is a row too, with `off_route` yes and its route blank.
  Built by a new shared **`csv.js`** (pure, byte-identical in both plow repos): `stormCsv(o)` returns the text. The
  phone's **Download CSV** makes the same text from the rows it holds (current or last storm) and saves it with the
  same name.
- **One layout, two places.** The sheet HTML and the CSV come from shared files; identity tests in both repos.

## 7. Cut from the fork, kept, and tests

**Cut:** `sidewalk`, `hand`, `heated` zone types and their colours, the curb roll-up (`curbs-k`), Touched, Clean
again passes and `again` rows, "Which zone?" map taps and zone fading on the map, walk marks, MOA outlines and the
`slim` sign-in, `points.js`, Gear log, crew cards and the leaderboard (never shipped anyway), the "Sidewalk crew"
position text, the shovel icon.

**Kept:** Spanish (dictionary trimmed to the screens that remain; every new English string gets a row before
shipping), Valley and short night, Copy for BuilderTrend, callouts, the snow map, the forecast hint, roster
self-service and pictures (240 px, squeezed under the 30,000-character cap), installable shell, the Back stack,
save/conflict/double-tap guards, the 45 s timeout, the 10-minute script cache, Restore, the reply-action guard.

**Tests, both repos.** The fork's suites come along and are cut with the features. Expected values worked out on
paper in comments; every new backend guard gets a `verify-tests` mutation; phone guards get hand mutations run from
a committed tree and restored with `git checkout`. New:
- lot taps: Plowed and Problem are the only states; Problem without a note is refused; Undo; done = newest standing
  row plowed; a site with piles only still answers one Lot; off-route flag;
- push arrows: fewer than two corners refused; a fourth type refused; no area; never a walk; drawn with a head at
  the last corner; flip reverses the pins; the import keeps walk, hand, plow and cut-outs out and counts piles only;
- dispatch: a marked sign-in resolves admin; unmarked crew does not; setting it on one's own record is refused;
  clearing it makes the sign-in crew again on the next request; not in a crew phone's bootstrap;
- Pull from Shovel: preview lists adds and updates with the differing fields; apply writes exactly the preview;
  `plow_note` and push zones untouched; a shovel-archived site is never archived here; the Snow App Sheet gets no
  write (the fake sheet records every write); ids never collide;
- CSV: one row per site per posted route per shift; blank time and `not done` for an unreached lot; off-route rows;
  problem note carried; column order; "(updated)" name after a second End; a failed CSV writes `status: failed` and
  Retry redoes only it; `csv.js` identical in both repos; the phone's Download CSV equals the server's text for
  the same rows;
- shell: every storage key starts with `titan-plow-` or `plow-`; the cache prefix is `titan-plow-shell-`; the
  activate step never deletes a `titan-snow-shell-` cache; every `index.html` script is in the shell list;
- the sign-in title "Plow Command" reads in full at 320 px; manifest name, icons present.

## Deploy and Matt's editor steps

- **`/plow-deploy`**: a copy of `/sidewalk-deploy` pointed at `plow-command-script` + `Plow-Command-repo`, the new
  deployment id, the `plow-` version labels and the `titan-plow-shell-` bump. Server first, then phone.
- **Matt, one step at a time with a screenshot each:** (1) make a blank Google Sheet named "Plow Command" and paste
  its id; (2) `clasp login` once if needed, Claude runs `clasp create` for a standalone script "Plow Command";
  (3) `clasp push`; (4) run `setup` in the editor and authorize Sheets, Drive and triggers; (5) Deploy, New
  deployment, Web app, execute as you, anyone; (6) paste the `/exec` URL into `lib/config.js`.
- **GitHub:** `gh repo create titanalaska/Plow --public`, push, Pages on from `main`. Verify with `gh`, never guess.
- The Shovel Command backend and Sheet are not touched by any of this. The Pull needs the script (running as Matt)
  to open the Snow App Sheet by id: no new permission beyond Sheets.

## Not in this release

- A Sanded label on sanding routes (a route kind; declined 10/21). Split shifts or a third shift. Sharing a storm
  switch with Shovel Command. Texting or emailing sheets. Posting to BuilderTrend by itself. A dispatcher-only
  companion page. Push arrows drawn by Claude from the iLawn maps (mapping sessions after the release, site by site).

## Assumptions for Matt's review

| # | Assumption | If wrong |
|---|---|---|
| A1 | The plow clock is the shovel clock: night by its evening, day from 9 AM, handoff 8 AM, trucks back at 8. | Two numbers in `time.js` / `Code.js`. |
| A2 | Drivers sign in with Titan Inventory PINs, and Matt approves new ones in Inventory; the dispatcher only adds them to the crew. | A dispatcher who must approve needs Inventory admin, outside this app. |
| A3 | Plow Command runs its own storms; the Snowing/Stopped switch is the plow side's and never Shovel Command's. | Sharing a storm means the two scripts read one Storms tab: not designed. |
| A4 | A sanding run is a route; its button reads Plowed. | A route `kind` flips the label (offered, declined). |
| A5 | The site card keeps New snow, materials used and equipment minutes from the fork. | Cut fields in `Visits` and the card. |
| A6 | The Pull copies `storage` and `no_touch` only; piles are edited in Plow Command afterwards and a later Pull refreshes them by id (a reshaped pile overwrites the plow copy; `plow_note` and arrows survive). | Add a per-zone "keep mine" mark. |
| A7 | Push arrows are white with a dark edge so they read over snow and asphalt alike. | A colour. |
| A8 | The CSV's columns and order are as listed; one row per site per posted route per shift. | Columns are a list in `csv.js`. |
| A9 | Spanish ships on day one with the trimmed dictionary; a crew member reads the Storm tab in ES before the ship, as was owed for Shovel. | Ship EN only, add ES later. |
| A10 | The GitHub repo is `titanalaska/Plow`, so the address is `/Plow/`, permanent. | Pick the name before the first push; after it, never. |
| A11 | Callouts keep the fork's per-shift mechanism and inch thresholds. | Cut Callouts. |
| A12 | Crew phones see drivers' names and phones on the Post (as the shovel crew do). | Names only. |
| A13 | The dispatcher mark makes someone admin for everything in the plow app, including Pull from Shovel and the roster's private fields. | A second, narrower role. |
