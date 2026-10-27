const { test, expect } = require('@playwright/test');
const path = require('path');
const url = require('url');
const fs = require('fs');

const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const isSnow = (u) => u.href.includes('AKfycbxgdG2uWS4DihnbHUx20AC_thZlmSJ5te4VMAQbWy0eNcMH8OHav6Pd8ane-7q01EzO');
const isInv = (u) => u.href.includes('AKfycbyudFaJ0dsSYMo');

// Inventory: names and status only, like the real getProfiles (no PINs).
const PROFILES = [
  { id: 1, name: 'Matthew', status: 'approved', hasPin: true },
  { id: 3, name: 'Jordan Demo', status: 'approved', hasPin: true },
  { id: 4, name: 'Nina Nursery', status: 'approved', hasPin: true },
  { id: 6, name: 'New Ned', status: 'approved', hasPin: false },
  { id: 9, name: 'Pending Pat', status: 'pending', hasPin: true },
];
// tok-dee: a dispatcher (Plow Command, 10/21/26). A roster record marked `dispatch: true` signs in as an admin WITH a crew
// id (C05, see `me` below); Matt, the code admin, has crew_id null.
const TOKENS = { 'tok-matt': 'admin', 'tok-jordan': 'crew', 'tok-alex': 'lead', 'tok-dee': 'admin' };

// A small fake of the snow backend, with the real reply shapes.
// opts.oldBackend: an older server (curbs-1), which never sent `action` on a reply.
// Plow Command's server has no `slim` and no `points` (plow-command-script Code.js, plow-2): bootstrap and getZones
// always answer every live zone with its ring, and so does this fake.
function fakeSnow(state, opts = {}) {
  return (body) => {
    // Every POST reply carries `action`, the action it answers (outlines-1 on): the phone refuses a reply from its own version that
    // does not (lib/api.js, the not-saved guard). A curbs-1 server (opts.oldBackend) has never sent one.
    const v = { version: opts.version || (opts.oldBackend ? 'curbs-1' : 'plow-2'), ...(opts.oldBackend ? {} : { action: body.action }) };
    if (opts.expired && opts.expired.on) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    // Roster self-service (10/6/26): the real backend's rules for one's own card (snow-app-script
    // saveMyCard_, test/api.test.js). Nina is approved in Inventory and not on the roster: her save
    // makes a pending card (an id past the highest, never the count); until Matt's Add to crew every
    // other action answers pending_card with the self view. Crew and leads edit their own live record.
    // roster-2 (10/7/26): cold_rated and the emergency contact are theirs; smokes is Matt's alone.
    // roster-3 (10/8/26): home_area (valley | anchorage), theirs to say.
    const SELF = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
    const selfView = (c) => ({ id: c.id, name: c.name, pending: c.pending === true, ...Object.fromEntries(SELF.map((k) => [k, c[k] === undefined ? null : c[k]])) });
    const applySelf = (stored, card) => ({ ...stored, ...Object.fromEntries(SELF.filter((k) => card && card[k] !== undefined).map((k) => [k, card[k]])) });
    const refuseCard = (card) => {
      if (typeof card.photo_thumb === 'string' && card.photo_thumb.length > 30000) return 'That picture is too big';
      if (card.seasons != null && !(Number.isInteger(card.seasons) && card.seasons >= 0)) return 'Seasons must be a whole number';
      return null;
    };
    const nina = () => state.crew.find((c) => String(c.profile_id) === '4' && !c.archived);
    if (body.token === 'tok-nina') {
      const mine = nina();
      if (body.action === 'saveMyCard') {
        const card = body.card || {}, why = refuseCard(card);
        if (why) return { ok: false, code: 'invalid', reason: why, ...v };
        if (mine) { Object.assign(mine, applySelf(mine, card), { rev: mine.rev + 1 }); return { ok: true, card: selfView(mine), pending: mine.pending === true, ...v }; }
        const max = state.crew.reduce((m, c) => Math.max(m, Number((/^C(\d+)$/.exec(c.id) || [0, 0])[1])), 0);
        const rec = applySelf({ id: 'C' + String(max + 1).padStart(2, '0'), name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1, archived: false }, card);
        state.crew.push(rec);
        return { ok: true, card: selfView(rec), pending: true, ...v };
      }
      if (mine && mine.pending) return { ok: false, code: 'pending_card', name: 'Nina Nursery', reason: 'Your card is in. The dispatcher will add you to the crew.', card: selfView(mine), ...v };
      if (!mine) return { ok: false, code: 'not_on_roster', name: 'Nina Nursery', reason: "You're signed in, but not on the plow crew yet. Ask the dispatcher to add you.", ...v };
    }
    const role = body.token === 'tok-nina' ? 'crew' : TOKENS[body.token];
    if (!role) return { ok: false, code: 'signin', reason: 'Session expired. Sign in again.', ...v };
    // Matt is not on the roster; Alex (C01) is the lead on the roster, Jordan (C03) crew.
    const me = body.token === 'tok-nina' ? { name: 'Nina Nursery', role: 'crew', crew_id: nina().id }
      : body.token === 'tok-dee' ? { name: 'Dee Dispatch', role: 'admin', crew_id: 'C05' }
      : { name: role === 'admin' ? 'Matthew' : role === 'lead' ? 'Alex Test' : 'Jordan Demo', role, crew_id: role === 'admin' ? null : role === 'lead' ? 'C01' : 'C03' };
    state.moves = state.moves || []; state.callouts = state.callouts || []; state.posts = state.posts || [];
    const own = () => state.crew.find((c) => c.id === me.crew_id) || { id: me.crew_id, name: me.name };
    if (body.action === 'saveMyCard') {
      if (role === 'admin') return { ok: false, code: 'invalid', reason: 'An admin sign-in has no crew card', ...v };
      const card = body.card || {}, why = refuseCard(card);
      if (why) return { ok: false, code: 'invalid', reason: why, ...v };
      const rec = own();
      Object.assign(rec, applySelf(rec, card), { rev: (rec.rev || 0) + 1 });
      return { ok: true, card: selfView(rec), pending: false, ...v };
    }
    if (body.action === 'bootstrap') {
      // Crew and leads never receive a pending card; Matt gets them whole.
      const crew = role === 'admin' ? state.crew : state.crew.filter((c) => c.pending !== true).map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: !!c.is_lead }));
      const out = { ok: true, me, sites: state.sites, routes: state.routes, zones: state.zones || [], crew, post: state.posts.at(-1) || null, ...v };
      if (role === 'admin') Object.assign(out, { moves: state.moves, callouts: state.callouts });
      else out.card = selfView(own());   // one's own card, the self view (never the record)
      return out;
    }
    // Pairings: the real backend's shapes (snow-app-script test/pairing.test.js). Plow Command has no Gear log (Task 11):
    // no Gear tab, no addGear, and bootstrap and getBoard send no `gear`.
    if (['getBoard', 'addMove', 'saveCallout', 'post'].includes(body.action) && role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.', ...v };
    if (body.action === 'getPost') return { ok: true, post: state.posts.at(-1) || null, ...v };
    // The real getCrew (Code.js: SNOW_ROSTER.crewFor): Matt gets every record whole, pending cards included; crew
    // and leads the public fields of the live roster only.
    if (body.action === 'getCrew') {
      return { ok: true, crew: role === 'admin' ? state.crew : state.crew.filter((c) => c.pending !== true && c.archived !== true).map((c) => ({ id: c.id, name: c.name, phone: c.phone, photo_thumb: c.photo_thumb || null, is_lead: !!c.is_lead })), ...v };
    }
    // The real getZones: Matt gets archived zones too, everyone else live ones; site_id narrows it.
    if (body.action === 'getZones') {
      const zones = (state.zones || []).filter((z) => role === 'admin' || z.archived !== true).filter((z) => !body.site_id || z.site_id === body.site_id);
      return { ok: true, zones, ...v };
    }
    if (body.action === 'getBoard') return { ok: true, moves: state.moves, callouts: state.callouts, post: state.posts.at(-1) || null, ...v };
    if (body.action === 'addMove') {
      const rec = { ...body.record, id: 'M' + (state.moves.length + 1), rev: 1 };
      state.moves.push(rec);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'saveCallout') {
      const rec = { ...body.record, id: body.record.shift, rev: (body.record.rev || 0) + 1 };
      state.callouts = state.callouts.filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (body.action === 'post') {
      const B = require('../lib/board.js'), H = require('../lib/history.js');
      const live = state.routes.filter((r) => !r.archived);
      const byId = Object.fromEntries(state.crew.map((c) => [c.id, c]));
      const board = B.boardFrom(state.moves, live, byId);
      const people = Object.fromEntries(state.crew.filter((c) => !c.archived).map((c) => {
        const w = H.shiftsWorked(state.callouts, c.id);
        return [c.id, { name: c.name, phone: c.phone || null, shifts: { night: w.night, day: w.day } }];
      }));
      const rec = { id: 'P' + (state.posts.length + 1), rev: 1, shift: body.shift, posted_at: new Date().toISOString(), people,
        routes: live.map((r) => ({ id: r.id, name: r.name, sites: (r.site_ids || []).map((id) => ({ id, name: (state.sites.find((s) => s.id === id) || {}).name })),
          lead: board.routes[r.id].lead, members: board.routes[r.id].members })) };
      state.posts.push(rec);
      return { ok: true, record: rec, ...v };
    }
    // The shift log: the real backend's reply shapes (snow-app-script test/shiftlog-api.test.js).
    // Rows are only ever appended; seq is the row's place in its tab. Crew and
    // lead rows are allow-listed (no by_profile, undoes null); Matt's are raw
    // (by_profile present, no undoes key on a tap). Refusals are {ok:false, code, reason}.
    // Plow Command (10/21/26): the lot is the unit. A tap names the site's lot (zone_id 'lot'), plowed or problem;
    // there is no Clean again, no curb item and no snowing_warned (plow-command-script Code.js tapZone_).
    if (['getShiftLog', 'tapZone', 'undoTap', 'stormAction', 'saveVisit', 'depthNow', 'handOff'].includes(body.action)) {
      const SL = require('../lib/shiftlog.js');
      state.log = state.log || []; state.storms = state.storms || []; state.visits = state.visits || [];
      const stamp = state.clock || '2026-10-03T07:50:18.445-08:00';
      const view = (row) => {
        if (role !== 'admin') return row;
        const { undoes, ...raw } = row;
        return { ...raw, by_profile: 'P1', ...(undoes ? { undoes } : {}) };
      };
      // Storms rows reach crew and leads through the server's allow-list (snow-app-script roster.js
      // PUBLIC_STORM_FIELDS, publicRow): a missing field is null, so a start row carries shift_id: null and
      // a handoff row loses its truck_seq and by_profile. Matt gets the whole row. The list is
      // test/storm-fields.js, checked against the backend's own by test/storm-fields.test.js.
      const STORM_FIELDS = require('./storm-fields.js');
      const stormView = (row) => (role === 'admin' ? { by_profile: 'P1', ...row } : Object.fromEntries(STORM_FIELDS.map((k) => [k, row[k] === undefined ? null : row[k]])));
      const refuse = (code, reason) => ({ ok: false, code, reason, ...v });
      if (body.action === 'getShiftLog') {
        const out = { ok: true, cursor: {}, reset: {}, ...v };
        // Route sheets (snow-app-script test/routesheet-api.test.js): trucks go to everyone (admin
        // rows are whole rows); the Sheets tab is Matt's only. A non-admin gets [] / cursor 0 / reset false.
        state.trucks = state.trucks || []; state.sheets = state.sheets || [];
        const tview = (row) => (role === 'admin' ? { ...row, by_profile: 'P1', rev: 1, archived: false } : row);
        [['log', state.log], ['storms', state.storms], ['visits', state.visits], ['trucks', state.trucks], ['sheets', role === 'admin' ? state.sheets : []]].forEach(([t, rows]) => {
          const cur = Math.max(0, Math.floor(Number((body.cursor || {})[t]) || 0)), last = (body.last || {})[t];
          let reset = cur > rows.length;
          if (!reset && cur >= 1 && last != null && Number(rows[cur - 1].seq) !== Number(last)) reset = true;
          out[t] = rows.slice(reset ? 0 : cur).map(t === 'trucks' ? tview : t === 'sheets' ? (x) => x : t === 'storms' ? stormView : view);
          out.cursor[t] = rows.length;
          out.reset[t] = reset;
        });
        // Posts (final review I1): Matt's poll carries every Post after his cursor, slimmed to what a sheet's
        // crew line reads (snow-app-script slimPost_): no phones, no shift counts, no site lists. Posts rows
        // have no seq, so only the cursor counts. Everyone else: none, cursor 0.
        if (role === 'admin') {
          const cur = Math.max(0, Math.floor(Number((body.cursor || {}).posts) || 0)), reset = cur > state.posts.length;
          out.posts = state.posts.slice(reset ? 0 : cur).map((p) => ({ id: p.id, shift: p.shift, posted_at: p.posted_at,
            people: Object.fromEntries(Object.entries(p.people || {}).map(([id, x]) => [id, { name: String((x || {}).name || '') }])),
            routes: (p.routes || []).map((r) => ({ id: r.id, lead: r.lead || null, members: (r.members || []).slice(), truck: r.truck === undefined ? null : r.truck })) }));
          out.cursor.posts = state.posts.length; out.reset.posts = reset;
        } else { out.posts = []; out.cursor.posts = 0; out.reset.posts = false; }
        return out;
      }
      const storm = SL.stormState(state.storms);
      if (body.action === 'stormAction') {
        // The server's gates (plow-command-script Code.js, final wave I1): crew stop at the Board's ("a route lead on
        // tonight's Board"); a lead has the Snowing/Stopped switch, and Start, End, Reopen, Night shift on are the dispatcher's.
        if (role === 'crew') return refuse('forbidden', "Only the dispatcher or a route lead on tonight's Board can do that.");
        const kind = body.kind;
        if (!['start', 'end', 'reopen', 'snowing', 'stopped', 'night_on'].includes(kind)) return refuse('invalid', 'Unknown storm control');
        if (['start', 'end', 'reopen', 'night_on'].includes(kind) && role !== 'admin') return refuse('forbidden', 'Only the dispatcher can do that.');
        if (kind === 'start' && storm.open) return refuse('invalid', 'End the storm first');
        if (kind === 'reopen' && storm.open) return refuse('invalid', 'The storm is already open');
        if (kind === 'reopen' && !storm.storm_id) return refuse('invalid', 'There is no storm to reopen');
        if (!['start', 'reopen'].includes(kind) && !storm.open) return refuse('invalid', 'No storm is open');
        const n = state.storms.length + 1, id = 'ST-' + n;
        const row = { id, seq: n, kind, storm_id: kind === 'start' ? id : storm.storm_id, at: stamp, by_name: me.name };
        state.storms.push(row);
        return { ok: true, record: stormView(row), ...v };
      }
      // Hand off now (snow-app-script handOffNow_, 10/5/26): Matt or a Board lead. Refused, in this order:
      // no storm open; the server's own shift is not a night; no real tap that night in this storm (an undo,
      // a tap whose undo stands, a '*' row are not work); this night already handed off. The mark carries the
      // newest seq of Log, Visits and Trucks, and the night's routes frozen (CrewHandoff.nightRouteIds).
      if (body.action === 'handOff') {
        const HO = require('../lib/handoff.js'), RS = require('../lib/routesheet.js');
        if (role === 'crew') return refuse('forbidden', "Only the dispatcher or a route lead on tonight's Board can do that.");
        if (!storm.open) return refuse('invalid', 'No storm is open');
        const shift = SL.shiftFor(stamp, state.storms);
        if (shift.indexOf('night-') !== 0) return refuse('invalid', "It isn't night shift");
        const stormLog = state.log.filter((r) => r.storm_id === storm.storm_id);
        if (!SL.realTaps(stormLog).some((r) => r.shift_id === shift)) return refuse('invalid', 'Nothing to hand off yet');
        const already = HO.newestHandoff(state.storms.filter((r) => r.shift_id === shift), storm.storm_id);
        if (already) return refuse('invalid', 'Already handed off at ' + RS.clock(String(already.at)));
        const top = (rows) => (rows || []).reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0), n = state.storms.length + 1;
        const mark = { id: 'ST-' + n, seq: n, kind: 'handoff', storm_id: storm.storm_id, shift_id: shift, at: stamp, by_name: me.name,
          by_profile: role === 'admin' ? 'P1' : 'P2', log_seq: top(state.log), visit_seq: top(state.visits), truck_seq: top(state.trucks) };
        mark.night_routes = HO.nightRouteIds({ storm_id: storm.storm_id, routes: state.routes, posts: state.posts, storms: state.storms,
          log: stormLog, visits: state.visits, trucks: state.trucks || [] }, mark);
        state.storms.push(mark);
        return { ok: true, record: stormView(mark), ...v };
      }
      if (!storm.open) return refuse('invalid', 'No storm is open');
      // The shift a row files under is the server's, from its own clock (CrewShiftLog.shiftFor, as tapZone_ does): with the
      // default stamp (7:50 AM on 10/3) that is the night of 10/2; a test that sets state.clock to the day gets the day.
      const shiftNow = SL.shiftFor(stamp, state.storms);
      // An undo names only the row (seq); a tap or a card names a site.
      if (body.action !== 'undoTap' && !state.sites.find((s) => s.id === body.site_id && !s.archived)) return refuse('invalid', 'Unknown site');
      if (body.action === 'saveVisit') {
        const n = state.visits.length + 1, eq = { blower: '', snowrator: '', bobcat: '', sweepster: '', ...(body.equipment || {}) };
        // by_key is the crew id, or 'admin' for Matt (who is not on the roster): the server's rule.
        const row = { id: 'V-' + n, seq: n, storm_id: storm.storm_id, shift_id: shiftNow, site_id: body.site_id, by_key: me.crew_id || 'admin', by_name: me.name, at: stamp,
          depth_in: body.depth_in === undefined ? '' : body.depth_in, materials_used: body.materials_used || '', equipment: eq };
        state.visits.push(row);
        return { ok: true, record: view(row), ...v };
      }
      const n = state.log.length + 1;
      // Off route (the server's offRoute_): the site is not on the route the live Board has this person on.
      // Matt covers anywhere, so his taps are never flagged; anyone the Board has on no route is off route.
      const offRoute = (siteId) => {
        if (role === 'admin') return false;
        const B = require('../lib/board.js');
        const live = state.routes.filter((r) => !r.archived);
        const pool = Object.fromEntries(state.crew.filter((c) => c.pending !== true).map((c) => [c.id, c])); // crewPool_
        const where = B.whereIs(B.boardFrom(state.moves, live, pool), me.crew_id);
        const route = where && live.find((r) => r.id === where.route);
        return !route || !(route.site_ids || []).includes(siteId);
      };
      let row;
      if (body.action === 'depthNow') {
        // New snow (Part B2): the server's rules (plow-command-script depthNow_) -- Matt or a lead; a JSON number 0 to 60.
        if (role === 'crew') return refuse('forbidden', "Only the dispatcher or a route lead on tonight's Board can do that.");
        const d = body.depth_in;
        if (typeof d !== 'number' || !isFinite(d) || d < 0 || d > 60) return refuse('invalid', 'Depth is 0 to 60 inches');
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: shiftNow, site_id: body.site_id, zone_id: '*',
          state: 'depth', depth_in: d, note: '', by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: false, undoes: null };
      } else if (body.action === 'tapZone') {
        // The server asks the shared checkTap and nothing else: the lot, plowed or problem, a problem with a note.
        const why = SL.checkTap({ zone_id: body.zone_id, state: body.state, note: body.note });
        if (why) return refuse('invalid', why);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: shiftNow, site_id: body.site_id, zone_id: body.zone_id,
          state: body.state, note: String(body.note || '').trim(), by_key: me.crew_id || 'admin', by_name: me.name, at: stamp,
          off_route: offRoute(body.site_id), undoes: null };
      } else {
        const t = SL.undoTarget(state.log, storm.storm_id, body.seq);
        if (!t.ok) return refuse('conflict', t.reason);
        row = { id: 'L-' + n, seq: n, storm_id: storm.storm_id, shift_id: shiftNow, site_id: t.row.site_id, zone_id: t.row.zone_id,
          state: t.state, note: t.note, by_key: me.crew_id || 'admin', by_name: me.name, at: stamp, off_route: offRoute(t.row.site_id), undoes: t.row.id };
      }
      state.log.push(row);
      return { ok: true, record: view(row), ...v };
    }
    // setTruck and retrySheets: the real reply shapes (snow-app-script reports for tasks 2 and 3).
    // setTruck: the server stamps who and when. The shift (final review C1): Matt names it and it must be one
    // on offer now (CrewTime.shiftChoices), else "Pick a shift"; a lead's is always the server's own shiftFor,
    // whatever is sent. A lead may set only the route the live Board has them leading. Crew never.
    if (body.action === 'setTruck') {
      const SL = require('../lib/shiftlog.js'), B = require('../lib/board.js'), T = require('../lib/time.js');
      if (role === 'crew') return { ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.', ...v };
      const truck = typeof body.truck === 'string' ? body.truck.trim() : '';
      if (truck.length < 1 || truck.length > 20) return { ok: false, code: 'invalid', reason: 'A truck is 1 to 20 characters', ...v };
      const route = state.routes.find((r) => r.id === body.route_id && !r.archived);
      if (!route) return { ok: false, code: 'invalid', reason: 'Unknown route', ...v };
      if (role === 'lead') {
        const board = B.boardFrom(state.moves, state.routes.filter((r) => !r.archived), Object.fromEntries(state.crew.map((c) => [c.id, c])));
        if (board.routes[route.id].lead !== me.crew_id) return { ok: false, code: 'forbidden', reason: "Only the dispatcher or that route's lead can set its truck.", ...v };
      }
      state.trucks = state.trucks || [];
      const stamp = state.clock || '2026-10-03T07:50:18.445-08:00', n = state.trucks.length + 1;
      if (role === 'admin' && !T.shiftChoices(stamp).includes(String(body.shift || ''))) return { ok: false, code: 'invalid', reason: 'Pick a shift', ...v };
      const row = { id: 'T-' + n, seq: n, route_id: route.id, shift_id: role === 'admin' ? body.shift : SL.shiftFor(stamp, state.storms || []), truck,
        by_key: me.crew_id || 'admin', by_name: me.name, at: stamp };
      state.trucks.push(row);
      const record = role === 'admin' ? { ...row, by_profile: 'P1', rev: 1, archived: false } : row;
      return { ok: true, record, ...v };
    }
    if (body.action === 'retrySheets') {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.', ...v };
      return { ...(opts.retryReply || { ok: true, storm_id: body.storm_id, failed: 1, owed: 1, scheduled: true }), ...v };
    }
    // Pull from Shovel Command (plow-command-script Code.js pullFromShovel_, Task 9): admins only (Matt and the dispatcher). The
    // reply's counts, `shovel_archived` ids and `skipped` are canned (opts.pull overrides any of them); `preview` rides only a
    // preview (apply anything but the literal true). opts.pullFail = { reason, on?: 'apply' } answers pull_failed (the shovel
    // Sheet could not be opened), on both calls or on the apply only. opts.onPull(state) runs on an apply: the Sheet changing.
    if (body.action === 'pullFromShovel') {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.', ...v };
      const apply = body.apply === true;
      if (opts.pullFail && (apply || opts.pullFail.on !== 'apply')) return { ok: false, code: 'pull_failed', reason: opts.pullFail.reason, ...v };
      if (apply && opts.onPull) opts.onPull(state);
      const reply = { ok: true, applied: apply, adds: { sites: 2, zones: 3 }, updates: { sites: 1, zones: 4 }, unchanged: { sites: 5, zones: 6 },
        shovel_archived: [], skipped: { zones: 7 }, ...(opts.pull || {}), ...v };
      if (!apply) reply.preview = { adds: { sites: [], zones: [] }, updates: { sites: [], zones: [] }, unchanged: reply.unchanged, shovel_archived: reply.shovel_archived, skipped: reply.skipped };
      return reply;
    }
    if (/^archive/.test(body.action)) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.', ...v };
      const tab = { archiveCrew: 'crew', archiveSite: 'sites', archiveRoute: 'routes', archiveZone: 'zones' }[body.action];
      const cur = (state[tab] || []).find((x) => x.id === body.id);
      if (!cur) return { ok: false, code: 'invalid', reason: 'Nothing to archive.', ...v };
      const rec = { ...cur, archived: true, rev: cur.rev + 1 };
      state[tab] = state[tab].filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    if (/^save/.test(body.action)) {
      if (role !== 'admin') return { ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.', ...v };
      if (opts.saveReply) return { ...opts.saveReply, ...v };
      const tab = { saveCrew: 'crew', saveSite: 'sites', saveRoute: 'routes', saveZone: 'zones' }[body.action];
      state[tab] = state[tab] || [];
      // The real site checks (snow-app-script roster.js validate), word for word, joined with '; '.
      if (tab === 'sites') {
        const r = body.record, errs = [];
        if (r.callout_in != null && !(typeof r.callout_in === 'number' && r.callout_in > 0 && r.callout_in <= 24)) errs.push('Callout depth is inches, more than 0 and at most 24');
        if (r.day_rank != null && !(Number.isInteger(r.day_rank) && r.day_rank >= 1 && r.day_rank <= 99)) errs.push('Day rank is a whole number from 1 to 99');
        if (errs.length) return { ok: false, code: 'invalid', reason: errs.join('; '), ...v };
      }
      // The real saveCrew (plow-command-script Code.js): nobody changes their own dispatcher mark. A dispatcher is an admin, so
      // saveCrew is open to them; this keeps the mark Matt's to give and take back. Matt has no crew id, so he is never caught.
      if (tab === 'crew' && me.crew_id && body.record.id === me.crew_id) {
        const was = state.crew.find((x) => x.id === body.record.id);
        if ((body.record.dispatch === true) !== (was && was.dispatch === true)) return { ok: false, code: 'forbidden', reason: 'You cannot change your own dispatcher mark', ...v };
      }
      const rec = { ...body.record, rev: (body.record.rev || 0) + 1 };
      // The real saveSite: a site is saved with both unit keys (missing = blank, trimmed, text).
      if (tab === 'sites') rec.units = { bobcat: String(((body.record.units || {}).bobcat) || '').trim(), snowrator: String(((body.record.units || {}).snowrator) || '').trim() };
      // A fresh id per new record, as the real backend does (one fixed id let a
      // second new zone overwrite the first and hid nothing until the import test).
      if (!rec.id) rec.id = (tab === 'crew' ? 'C' : 'X') + (90 + (state._made = (state._made || 0) + 1));
      state[tab] = state[tab].filter((x) => x.id !== rec.id).concat([rec]);
      return { ok: true, record: rec, ...v };
    }
    return { ok: false, code: 'error', reason: 'unknown action', ...v };
  };
}
const world = () => ({
  crew: [{ id: 'C01', name: 'Alex Test', phone: '555-0101', is_lead: true, rev: 1, profile_id: '2', weaknesses: 'slow starter' },
    { id: 'C03', name: 'Jordan Demo', phone: '555-0103', is_lead: false, rev: 1, profile_id: '3' }],
  sites: [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 }],
  routes: [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }],
});

// delay: { action: ms } holds that action's reply; abortIf(body) drops a call
// the way a lost signal does (the call is still recorded first); hangIf(body)
// never answers it at all (Apps Script stuck, or a dead zone that never errors).
// invDelay(p): ms to hold an Inventory reply. The reply is worked out when the call ARRIVES (what the server read
// then), and only sent after the wait: a slow reply carries old news. calls.invAnswered counts the replies sent.
async function open(page, { token, snow, inv, abortSnow, clockAt, delay, abortIf, hangIf, invDelay } = {}) {
  const calls = [];
  calls.inv = [];   // Inventory calls, apart (approve / reject carry Matt's token)
  // Shift choices depend on the wall clock: pin it, never trust the test's hour.
  if (clockAt) await page.clock.install({ time: new Date(clockAt) });
  await page.route(isSnow, async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ body, contentType: req.headers()['content-type'], method: req.method() });
    if (abortSnow || (abortIf && abortIf(body))) return route.abort();
    if (hangIf && hangIf(body)) return; // never fulfilled: only the page's own timeout ends it
    if (delay && delay[body.action]) await new Promise((r) => setTimeout(r, delay[body.action]));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snow(body)) });
  });
  await page.route(isInv, async (route) => {
    const p = Object.fromEntries(new URL(route.request().url()).searchParams);
    calls.inv.push(p);
    const out = inv ? inv(p) : p.action === 'getProfiles' ? { profiles: PROFILES } : {};
    const body = JSON.stringify(out);
    const wait = invDelay ? invDelay(p) : 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    await route.fulfill({ contentType: 'application/json', body });
    calls.invAnswered = (calls.invAnswered || 0) + 1;
  });
  if (token) await page.addInitScript((t) => localStorage.setItem('titan-plow-token', t), token);
  await page.goto(PAGE);
  return calls;
}

// ---------- Share (Matt, 10/5/26: text the app to future workers) ----------
// The page here is file://…/index.html, nowhere near the real address: whatever is
// shared must still be exactly https://titanalaska.github.io/Plow/ (Plow Command's own path, never Sidewalk's).
const APP_URL = 'https://titanalaska.github.io/Plow/';
// sheet: 'ok' | 'cancel' | 'refuse' | null (no share sheet); clip: true | false (clipboard works) | null (none)
async function stubShare(page, sheet, clip) {
  await page.addInitScript(([sheet, clip]) => {
    window.__shared = []; window.__copied = [];
    const def = (k, v) => Object.defineProperty(navigator, k, { value: v, configurable: true });
    def('share', sheet === null ? undefined : async (d) => {
      window.__shared.push(d);
      if (sheet === 'cancel') throw new DOMException('cancelled', 'AbortError');
      if (sheet === 'refuse') throw new DOMException('no', 'NotAllowedError');
    });
    def('clipboard', clip === null ? undefined : { writeText: async (t) => { if (!clip) throw new Error('blocked'); window.__copied.push(t); } });
  }, [sheet, clip]);
}

test('Share is on the sign-in screen and sends the fixed app address, never this page', async ({ page }) => {
  await stubShare(page, 'ok', true);
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#share')).toBeVisible();
  await page.click('#share');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const d = await page.evaluate(() => window.__shared[0]);
  expect(d.url).toBe(APP_URL);
  expect(d.title).toBe('Plow Command');
  expect(d.text.startsWith('Plow Command, the Titan plow truck app. ')).toBe(true);
  expect(d.text).toContain('Type your name');
  expect(await page.evaluate(() => window.__copied.length)).toBe(0); // the sheet took it: nothing copied
});

test('Share is in the top bar once signed in, for crew and for Matt', async ({ page }) => {
  await stubShare(page, 'ok', true);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('#who')).toContainText('Jordan');
  await expect(page.locator('#share')).toBeVisible();
  await page.click('#share');
  await expect.poll(() => page.evaluate(() => window.__shared.map((d) => d.url))).toEqual([APP_URL]);
});

test('backing out of the share sheet copies nothing and says nothing', async ({ page }) => {
  await stubShare(page, 'cancel', true);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  await page.waitForTimeout(200); // a wrong fallback would copy right after the sheet's reply
  expect(await page.evaluate(() => window.__copied.length)).toBe(0);
  await expect(page.locator('#toast')).toBeHidden();
});

test('no share sheet: the message and the fixed address are copied, and it says so', async ({ page }) => {
  await stubShare(page, null, true);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Link copied');
  const c = await page.evaluate(() => window.__copied);
  expect(c).toHaveLength(1);
  expect(c[0].endsWith(' ' + APP_URL)).toBe(true);
});

test('nothing to share or copy with: the link shows on screen to copy by hand', async ({ page }) => {
  await stubShare(page, null, false);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect(page.locator('#sharetext')).toBeVisible();
  await expect(page.locator('#dlgIn h2')).toHaveText('Share Plow Command');
  expect(await page.locator('#sharetext').inputValue()).toContain(APP_URL);
  expect(await page.locator('#sharetext').inputValue()).toContain('Plow Command, the Titan plow truck app.');
  await page.click('#dlgClose');
  await expect(page.locator('#sharetext')).toBeHidden();
});

test('the top bar still fits a small phone with Share in it (Matt signed in, the longest badge)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('#signout')).toBeVisible();
  for (const id of ['#share', '#signout']) {
    const b = await page.locator(id).boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(360); // on screen, not pushed off the right edge
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

// Named Plow Command (Matt, 10/21/26). Signed in on a phone, the name badge takes the title's place; signed out, the
// title is all the top bar says, so on the narrowest phone in use (320 px) it must read in full beside EN/ES and Share.
// (Shovel Command's 14 letters were the longer of the two; this guards the bar's rules, not just this name.)
test('sign-in screen at 320 px: "Plow Command" reads in full and the top bar stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  const h1 = page.locator('header h1');
  await expect(h1).toBeVisible();
  await expect(h1).toHaveText('Plow Command');
  const fit = await h1.evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
  expect(fit.scroll, 'title cut short with an ellipsis').toBeLessThanOrEqual(fit.client);
  const hdr = await page.locator('header > *').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().right)));
  for (const r of hdr) expect(r).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('signed out shows the sign-in screen; pending people can find their name', async ({ page }) => {
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  const names = await page.locator('#si_who option').allTextContents();
  expect(names).toEqual(['Choose your name', 'Jordan Demo', 'Matthew', 'New Ned', 'Nina Nursery', 'Pending Pat (waiting for approval)']);
});

test('a good PIN signs in, stores the token and lands on Tonight', async ({ page }) => {
  const calls = await open(page, { snow: fakeSnow(world()),
    inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : p.action === 'verifyPin' && p.id === '3' && p.pin === '3333' ? { valid: true, success: true, id: 3, name: 'Jordan Demo', status: 'approved', token: 'tok-jordan' } : { valid: false, attemptsLeft: 4 } });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '3333');
  await page.click('#si_go');
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toContainText('PAC');
  expect(await page.evaluate(() => localStorage.getItem('titan-plow-token'))).toBe('tok-jordan');
  const boot = calls.find((c) => c.body.action === 'bootstrap');
  expect(boot.method).toBe('POST');
  expect(boot.contentType).toMatch(/^text\/plain/);
  expect(boot.body.token).toBe('tok-jordan');
});

test('a wrong PIN says how many tries are left', async ({ page }) => {
  await open(page, { snow: fakeSnow(world()), inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : { valid: false, attemptsLeft: 4 } });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '0000');
  await page.click('#si_go');
  await expect(page.locator('#si_err')).toHaveText('Wrong PIN. 4 tries left.');
});

test('approved in Inventory but not on the snow roster gets its own screen, with the card to fill out', async ({ page }) => {
  await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await expect(page.locator('#notroster')).toContainText('Nina Nursery');
  await expect(page.locator('#notroster')).toContainText("You're signed in, but not on the plow crew yet. Fill out your card and the dispatcher will add you.");
  await expect(page.locator('#notroster')).not.toContainText('Matt will add you');
  await expect(page.locator('#fillCard')).toBeVisible();
  await expect(page.locator('#tabs')).toBeHidden();
});

test('an expired session goes back to sign-in and forgets the token', async ({ page }) => {
  await open(page, { token: 'tok-old', snow: fakeSnow(world()) });
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
  expect(await page.evaluate(() => localStorage.getItem('titan-plow-token'))).toBeNull();
});

test('a backend version mismatch warns', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world(), { version: 'foundation-0' }) });
  // Visible, not just present: the banner's text is in the page even while hidden.
  await expect(page.locator('#verwarn')).toBeVisible();
  await expect(page.locator('#verwarn')).toContainText('Backend out of date');
});

test('a matching backend version shows no warning', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card')).toHaveCount(1);
  await expect(page.locator('#verwarn')).toBeHidden();
});

test('no network on load is said plainly, with a retry', async ({ page }) => {
  await open(page, { token: 'tok-jordan', abortSnow: true });
  // The card comes after the load's three tries and their waits (1500 + 4000 ms, 10/24/26): about 5.6 s.
  await expect(page.locator('main')).toContainText("Couldn't reach the server", { timeout: 20000 });
  await expect(page.locator('#retry')).toBeVisible();
});

test('crew see routes and sites but no roster or edit buttons', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="roster"]')).toHaveCount(0);
  await expect(page.locator('[data-edit]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('slow starter');
});

test('admin sees roster, sites and routes, with the private fields', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="roster"]')).toBeVisible();
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C01"]');
  await expect(page.locator('#dlg')).toContainText('slow starter');
});

test('an admin save sends the revision and shows the saved record', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.fill('#f_phone', '555-0199');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const save = calls.find((c) => c.body.action === 'saveCrew');
  expect(save.body.record).toMatchObject({ id: 'C03', rev: 1, phone: '555-0199' });
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg')).toContainText('555-0199');
});

test('a conflict says reload and does not show the edit as saved', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { saveReply: { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.' } }) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.fill('#f_phone', '555-0199');
  await page.click('#f_save');
  await expect(page.locator('#f_err')).toContainText('Someone changed this');
  await page.keyboard.press('Escape');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg')).toContainText('555-0103');
  await expect(page.locator('#dlg')).not.toContainText('555-0199');
});

test('the sign-in picker on a roster record lists approved Inventory names', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  const opts = await page.locator('#f_profile option').allTextContents();
  expect(opts).toEqual(['No sign-in yet', 'Jordan Demo', 'Matthew', 'New Ned', 'Nina Nursery']);
  expect(await page.locator('#f_profile').inputValue()).toBe('3');
});

test('a photo becomes a small thumbnail in the record', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 1200, 900); return c.toDataURL('image/png').split(',')[1]; });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.locator('#f_photo').setInputFiles({ name: 'j.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#f_photo_msg')).toContainText('Photo ready');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const thumb = calls.find((c) => c.body.action === 'saveCrew').body.record.photo_thumb;
  expect(thumb.slice(0, 15)).toBe('data:image/jpeg');
  expect(thumb.length).toBeLessThan(30000);
});

test('the route editor orders sites and saves the order', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="routes"]');
  await page.click('[data-edit="route:R1"]');
  await page.selectOption('#r_add', 'S2');
  await page.click('#r_addbtn');
  await page.click('[data-up="1"]');
  await page.click('#r_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveRoute').body.record).toMatchObject({ id: 'R1', rev: 1, site_ids: ['S2', 'S1'] });
});

test('a refused save from a non-admin is shown, not swallowed', async ({ page }) => {
  // Defence in depth: even if an edit button leaked to a crew screen, the refusal must show.
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  const r = await page.evaluate(() => SnowApi.call('saveSite', { record: { id: 'S1', name: 'x', rev: 1 } }));
  expect(r).toMatchObject({ ok: false, code: 'forbidden' });
});

// ---------------- final review fixes ----------------
test('editing a worker keeps a sign-in link the picker cannot show', async ({ page }) => {
  // I1. Alex is linked to Inventory profile 2, which is not in the approved list
  // (pending, rejected, or the list failed to load). A phone-number fix must not unlink him.
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C01"]');
  await page.click('#w_edit');
  expect(await page.locator('#f_profile').inputValue()).toBe('2');
  await page.fill('#f_phone', '555-0111');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveCrew').body.record.profile_id).toBe('2');
});

test('if the names cannot load, the sign-in link is left alone', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: () => ({ nope: true }) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await expect(page.locator('#f_profile')).toBeDisabled();
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.find((c) => c.body.action === 'saveCrew').body.record.profile_id).toBe('3');
});

test('a double tap on Save sends one save', async ({ page }) => {
  // I2. Apps Script takes a second or two; the second tap must not create a duplicate.
  const calls = [];
  const snow = fakeSnow(world());
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    if (body.action === 'saveSite') await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(snow(body)) });
  });
  await page.route(isInv, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profiles: PROFILES }) }));
  await page.addInitScript(() => localStorage.setItem('titan-plow-token', 'tok-matt'));
  await page.goto(PAGE);
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:"]');
  await page.fill('#s_name', 'New Lot');
  await page.evaluate(() => { const b = document.getElementById('s_save'); b.click(); b.click(); });
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.action === 'saveSite')).toHaveLength(1);
});

test('a first sign-in with no PIN yet claims one instead of spending a try', async ({ page }) => {
  // I3. New Ned is approved but has never set a PIN: verifyPin would count a failure.
  const invCalls = [];
  await open(page, { snow: fakeSnow(world()), inv: (p) => { invCalls.push(p.action);
    if (p.action === 'getProfiles') return { profiles: PROFILES };
    if (p.action === 'claimPin' && p.id === '6' && p.pin === '6666') return { valid: true, success: true, id: 6, name: 'New Ned', status: 'approved', token: 'tok-jordan' };
    return { valid: false, attemptsLeft: 5 }; } });
  await page.selectOption('#si_who', '6');
  await expect(page.locator('#signin')).toContainText('Choose a 4-digit PIN');
  await page.fill('#si_pin', '6666');
  await page.click('#si_go');
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible(); // crew land on Tonight (pairings, 10/1/26)
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.route-card[data-route="R1"]')).toBeVisible();
  expect(invCalls).not.toContain('verifyPin');
});

// ---------- a new person types their name (Matt, 10/20/26) ----------
// First snow, four on the roster: a new crew member who has never used Titan Inventory is not on the name list.
// They type their name (first AND last, Matt 10/20/26) and choose a PIN. That is Inventory's own requestProfile,
// the endpoint the Inventory app's new hires use: it adds one 'pending' row, and the snow backend is never asked
// (it never writes Inventory's Sheet). The request is one of Matt's Roster count, he taps Approve, and they sign
// in with that name and PIN. Matt kept the name list for everyone already set up.
// An Inventory fake that does what the real requestProfile does (titan-inventory-script Code.js): a name that
// matches a row ignoring case and the ends' spaces is a duplicate, answered with that row's status; otherwise the
// new row gets the highest id + 1, pending. The PIN is kept for verifyPin, never sent back by getProfiles.
function invWithSignup(list) {
  const pins = {};
  return (p) => {
    if (p.action === 'getProfiles') return { profiles: list.map((x) => ({ ...x })) };
    if (p.action === 'requestProfile') {
      const name = (p.name || '').trim();
      const hit = list.find((x) => String(x.name).trim().toLowerCase() === name.toLowerCase());
      if (hit) return { duplicate: true, id: hit.id, name: hit.name, status: hit.status, hasPin: hit.hasPin };
      const id = Math.max(...list.map((x) => Number(x.id))) + 1;
      list.push({ id, name, status: 'pending', hasPin: true });
      pins[id] = p.pin;
      return { id, name, position: p.position, status: 'pending' };
    }
    if (p.action === 'approveProfile') { const hit = list.find((x) => String(x.id) === p.id); if (hit) hit.status = 'approved'; return { success: !!hit }; }
    if (p.action === 'verifyPin') {
      const hit = list.find((x) => String(x.id) === p.id);
      return hit && hit.status === 'approved' && pins[p.id] === p.pin ? { valid: true, success: true, id: hit.id, name: hit.name, status: 'approved', token: 'tok-nina' } : { valid: false, attemptsLeft: 4 };
    }
    return {};
  };
}
const requests = (calls) => calls.inv.filter((c) => c.action === 'requestProfile');
const ALREADY = "That name is already on the list. If it's you, go back and pick it. If not, add your second last name or a middle initial.";

test('new person: types a first and last name and a PIN; Inventory gets one pending request; Matt counts it, approves it, and they sign in with it', async ({ page, browser }) => {
  const list = PROFILES.map((p) => ({ ...p }));
  const calls = await open(page, { snow: fakeSnow(world()), inv: invWithSignup(list) });
  // The sign-in screen no longer tells a new person they need a Titan Inventory account.
  await expect(page.locator('#si_who option')).toHaveCount(6);
  await expect(page.locator('#signin')).not.toContainText('Same name and PIN as Titan Inventory');
  await expect(page.locator('#signin')).toContainText('Not on the list?');
  await expect(page.locator('#si_req')).toHaveText('Type your name');
  await page.click('#si_req');
  await expect(page.locator('#request h2')).toHaveText('Type your name');
  await expect(page.locator('#request')).toContainText('This goes to Matt. Once he approves it, sign in here with your name and this PIN.');
  // The crew are never sent to another app: the request screen does not name Titan Inventory (10/20 guard, restored 10/21).
  await expect(page.locator('#request')).not.toContainText('Titan Inventory');
  await expect(page.locator('#request')).not.toContainText('Sidewalk');
  await expect(page.locator('#rq_pos')).toHaveAttribute('placeholder', 'Plow driver');
  // Spaces at the ends and doubled inside are the phone keyboard's, not the name: "Rosa Mendez" is what is sent.
  await page.fill('#rq_name', '  Rosa   Mendez ');
  await page.fill('#rq_pin', '4821');
  await page.click('#rq_go');
  await expect(page.locator('#reqsent h2')).toHaveText('Request sent');
  await expect(page.locator('#reqsent')).toContainText('Once Matt approves it, sign in here.');
  await expect(page.locator('#reqsent')).not.toContainText('Titan Inventory');
  await expect(page.locator('#reqsent')).not.toContainText('Sidewalk');
  expect(requests(calls)).toEqual([{ action: 'requestProfile', name: 'Rosa Mendez', position: 'Plow driver', pin: '4821' }]);
  expect(calls.length).toBe(0); // the snow backend was never asked
  // Back on the list they find their own name, waiting. The new row: ids 1, 3, 4, 6, 9 -> highest 9 + 1 = 10.
  await page.click('#rq_back');
  await expect(page.locator('#si_who option[value="10"]')).toHaveText('Rosa Mendez (waiting for approval)');
  // Matt's phone: Pending Pat (9) + Rosa (10) = Roster 2. Approve Rosa.
  const matt = await (await browser.newContext()).newPage(); // his own phone: his token never reaches Rosa's
  const mc = await open(matt, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithSignup(list) });
  await expect(matt.locator('#tabs [data-tab="roster"]')).toHaveText('Roster 2');
  await matt.click('nav [data-tab="roster"]');
  await matt.click('[data-approve="10"]');
  await expect(matt.locator('#toast')).toHaveText('Rosa Mendez can sign in now');
  expect(mc.inv.find((x) => x.action === 'approveProfile')).toMatchObject({ id: '10', token: 'tok-matt' });
  // Rosa signs in with her name and the PIN she chose: verifyPin, never claimPin (her PIN is set).
  await page.goto(PAGE);
  await page.selectOption('#si_who', '10');
  await page.fill('#si_pin', '4821');
  await page.click('#si_go');
  await expect(page.locator('#notroster')).toBeVisible(); // signed in; next is her own card (roster self-service)
  expect(calls.inv.filter((c) => c.action === 'verifyPin' || c.action === 'claimPin').map((c) => [c.action, c.id, c.pin])).toEqual([['verifyPin', '10', '4821']]);
});

test('new person: a first name alone, a number for a last name, or nothing is refused on the phone, and nothing is sent', async ({ page }) => {
  const calls = await open(page, { snow: fakeSnow(world()), inv: invWithSignup(PROFILES.map((p) => ({ ...p }))) });
  await page.click('#si_req');
  await page.fill('#rq_pin', '4821');
  for (const [typed, said] of [['', 'Name is required.'], ['   ', 'Name is required.'], ['Rosa', 'Type your first and last name.'],
    ['  Rosa  ', 'Type your first and last name.'], ['Rosa 2', 'Type your first and last name.']]) {
    await page.fill('#rq_name', typed);
    await page.click('#rq_go');
    await expect(page.locator('#rq_err')).toHaveText(said);
  }
  // An initial is a name: "Rosa M." passes the name rule (the PIN rule comes next, and stops it here).
  await page.fill('#rq_name', 'Rosa M.');
  await page.fill('#rq_pin', '12');
  await page.click('#rq_go');
  await expect(page.locator('#rq_err')).toHaveText('PIN is 4 digits.');
  expect(requests(calls)).toEqual([]);
});

test('new person: a name already on the list is caught on the phone, any case or spacing, approved or waiting', async ({ page }) => {
  const calls = await open(page, { snow: fakeSnow(world()), inv: invWithSignup(PROFILES.map((p) => ({ ...p }))) });
  await expect(page.locator('#si_who option')).toHaveCount(6); // the list is in: the phone checks against it
  await page.click('#si_req');
  await page.fill('#rq_pin', '4821');
  for (const typed of ['jordan  demo', ' PENDING PAT ']) { // approved (3), waiting (9)
    await page.fill('#rq_name', typed);
    await page.click('#rq_go');
    await expect(page.locator('#rq_err')).toHaveText(ALREADY);
  }
  expect(requests(calls)).toEqual([]);
});

test("new person: Inventory's own duplicate answer reads right for a name the phone could not see", async ({ page }) => {
  // The phone's list leaves rejected people out (lib/api.js profiles), and a name can arrive after the list was read.
  // Inventory still refuses both: a rejected name is not this person's to take; an approved or waiting one is on the list.
  const inv = (p) => p.action === 'getProfiles' ? { profiles: PROFILES }
    : p.name === 'Rex Rejected' ? { duplicate: true, id: 12, name: 'Rex Rejected', status: 'rejected' }
    : p.name === 'Late Larry' ? { duplicate: true, id: 13, name: 'Late Larry', status: 'approved' }
    : p.name === 'Late Lou' ? { duplicate: true, id: 14, name: 'Late Lou', status: 'pending' } : {};
  await open(page, { snow: fakeSnow(world()), inv });
  await page.click('#si_req');
  await page.fill('#rq_pin', '4821');
  for (const [typed, said] of [['Rex Rejected', 'That name was not approved. Talk to Matt.'], ['Late Larry', ALREADY], ['Late Lou', ALREADY]]) {
    await page.fill('#rq_name', typed);
    await page.click('#rq_go');
    await expect(page.locator('#rq_err')).toHaveText(said);
  }
});

test('new person: Send request is off while the request is on its way; a double tap sends one', async ({ page }) => {
  const calls = await open(page, { snow: fakeSnow(world()), inv: invWithSignup(PROFILES.map((p) => ({ ...p }))),
    invDelay: (p) => (p.action === 'requestProfile' ? 1500 : 0) });
  await page.click('#si_req');
  await page.fill('#rq_name', 'Rosa Mendez');
  await page.fill('#rq_pin', '4821');
  await page.click('#rq_go');
  await expect(page.locator('#rq_go')).toBeDisabled();
  await page.locator('#rq_go').click({ force: true });
  await expect(page.locator('#reqsent')).toBeVisible();
  expect(requests(calls)).toHaveLength(1);
});

test('new person: no signal on Send request says so, and the button comes back for another try', async ({ page }) => {
  // Inventory unreachable: lib/api.js inv() gets nothing readable -> "Couldn't reach the server. Try again."
  await open(page, { snow: fakeSnow(world()), inv: (p) => p.action === 'getProfiles' ? { profiles: PROFILES } : null });
  await page.click('#si_req');
  await page.fill('#rq_name', 'Rosa Mendez');
  await page.fill('#rq_pin', '4821');
  await page.click('#rq_go');
  await expect(page.locator('#rq_err')).toHaveText("Couldn't reach the server. Try again.");
  await expect(page.locator('#rq_go')).toBeEnabled();
});

test('a pending person is told they are waiting, without spending a try', async ({ page }) => {
  const invCalls = [];
  await open(page, { snow: fakeSnow(world()), inv: (p) => { invCalls.push(p.action); return p.action === 'getProfiles' ? { profiles: PROFILES } : { valid: false, attemptsLeft: 5 }; } });
  await page.selectOption('#si_who', '9');
  await page.fill('#si_pin', '9999');
  await page.click('#si_go');
  await expect(page.locator('#si_err')).toContainText('waiting for Matt');
  expect(invCalls).not.toContain('verifyPin');
});

test('a session that expires during a save says sign in again', async ({ page }) => {
  // M6, raised to Important. The token died while the dialog was open.
  await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { saveReply: { ok: false, code: 'signin', reason: 'Session expired. Sign in again.' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
});

test('after a conflict the app reloads the latest, so the retry can save', async ({ page }) => {
  // M7, raised to Important. Someone else saved S1 (now rev 2). Our first save
  // conflicts; the retry must carry rev 2 and show their change.
  const state = world();
  let first = true;
  const base = fakeSnow(state);
  const calls = await open(page, { token: 'tok-matt', snow: (b) => {
    if (b.action === 'saveSite' && first) {
      first = false;
      state.sites = state.sites.map((s) => (s.id === 'S1' ? { ...s, rev: 2, notes: 'theirs' } : s));
      return { ok: false, code: 'conflict', reason: 'Someone changed this since you opened it. Reload and try again.', version: 'plow-2', action: b.action };
    }
    return base(b);
  } });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#s_err')).toContainText('Someone changed this');
  await page.keyboard.press('Escape');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_notes')).toHaveValue('theirs');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.rev).toBe(2);
});

// ---------------- site maps: crew view ----------------
// A 30 m x 10 m walk near PAC at 61.2177 N: 300 m2 = 3,229 sq ft (worked by hand).
const DEGR = Math.PI / 180, RE = 6371000;
const ring = (lng, lat, eastM, northM) => {
  const e = eastM / (RE * Math.cos(lat * DEGR)) / DEGR, n = northM / RE / DEGR;
  return [[lng, lat], [lng + e, lat], [lng + e, lat + n], [lng, lat + n]];
};
const PAC = [-149.8885, 61.2177];
// Plow Command (10/21/26): the map draws three kinds, storage (a pile), no_touch (keep clear) and push (an arrow). The
// fork's zones keep their names, places and areas; Z1 and Z2 were a sidewalk and a heated walk, both areas, and are
// piles now, so every editor test below still finds the same outlines where it always did.
const mapWorld = () => {
  const w = world();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, map: { center: PAC, zoom: 18 }, materials_needed: '4-5 bags IceMelt' } : s));
  w.zones = [
    { id: 'Z1', site_id: 'S1', type: 'storage', name: 'Main entry', priority: true, note: 'ADA ramp first', ring: ring(PAC[0], PAC[1], 30, 10), area_sqft: 3229, rev: 1 },
    { id: 'Z2', site_id: 'S1', type: 'storage', name: 'Heated walk', priority: false, note: '', ring: ring(PAC[0], PAC[1] + 0.0003, 20, 5), area_sqft: 1076, rev: 1 },
    { id: 'Z3', site_id: 'S1', type: 'no_touch', name: 'Ski trail', priority: false, note: 'Do not gravel', ring: ring(PAC[0] + 0.0006, PAC[1], 10, 30), area_sqft: 3229, rev: 1 },
  ];
  return w;
};
// Metres east and north of a point, in degrees at PAC's latitude (the ring() helper's arithmetic).
const eastM = (m) => m / (RE * Math.cos(PAC[1] * DEGR)) / DEGR, northM = (m) => m / RE / DEGR;
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function tiles(page, fail) {
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) =>
    fail ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'image/png', body: PNG1 }));
}
async function openMap(page, token, state, fail) {
  await tiles(page, fail);
  const calls = await open(page, { token, snow: fakeSnow(state) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  return calls;
}
const zoneSource = (page) => page.evaluate(() => new Promise((res) => {
  const go = () => { const s = window.SnowMapView && window.SnowMapView.getSource('zones'); if (s && s._data) res(s._data.features.map((f) => ({ id: f.properties.id, type: f.properties.type }))); else setTimeout(go, 100); };
  go();
}));
// The zones the open map holds (SnowMap.setZones' list), drawn or not: a kind the map does not draw is still on it.
const mapZoneIds = (page) => page.evaluate(() => window.SnowMapView._snow.zones.map((z) => z.id));

// Plow Command (10/21/26): the legend reads the three kinds the map draws, in TYPES order, and the editor offers the
// same three as buttons (Task 14): Pile, Keep clear, Push arrow. Each button's swatch is its kind's colour from the
// map's own table (storage #7d5ba6, no_touch #e0218a, push #ffffff, lot #f57c00 since 10/26/26); the white arrow's
// carries its dark edge (#1a1a1a) as well, or it would vanish on a white card.
test('editor: three buttons, Pile, Keep clear and Push arrow, coloured from the map\'s table; the legend lists the same three', async ({ page }) => {
  await adminMap(page, mapWorld());
  expect(await page.locator('#maplegend span').allTextContents()).toEqual(
    ['Snow storage', 'Keep clear', 'Push snow this way', 'Lot']);   // the lot's row (10/22/26) last
  await page.click('#mapedit');
  await page.click('#ed_new');
  expect(await page.locator('[data-ztype]').evaluateAll((els) => els.map((e) => e.dataset.ztype + ':' + e.textContent))).toEqual(
    ['storage:Pile', 'no_touch:Keep clear', 'push:Push arrow', 'lot:Lot']);   // Lot (10/22/26) last, as in the legend
  expect(await page.locator('[data-ztype]').evaluateAll((els) => els.map((e) => [e.style.getPropertyValue('--zc'), e.style.getPropertyValue('--ze')]))).toEqual(
    [['#7d5ba6', ''], ['#e0218a', ''], ['#ffffff', '#1a1a1a'], ['#f57c00', '']]);   // the Lot button is the map's orange
  // Pressed, the arrow's button does not vanish: its fill differs from the card under it.
  await page.click('[data-ztype="push"]');
  await expect(page.locator('[data-ztype="push"]')).toHaveAttribute('aria-pressed', 'true');
  const look = await page.locator('[data-ztype="push"]').evaluate((b) => {
    const cs = getComputedStyle(b), card = getComputedStyle(document.getElementById('zoneform'));
    return { bg: cs.backgroundColor, card: card.backgroundColor, fg: cs.color };
  });
  expect(look.bg).not.toBe(look.card);
  expect(look.fg).not.toBe(look.bg);
});

// 10/4/26: the photo switch asked the map about the city photo layer right
// after new Map(), before the style is built. MapLibre logs "non-existing
// layer moa" as a console error on every map open (six in one session in
// Claude's pane). The real library, no patches: five opens, no errors, and the
// switch still reads the city photo.
test('opening site maps logs no errors, and the photo switch reads the city photo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await openMap(page, 'tok-jordan', mapWorld());
  for (let i = 0; i < 5; i++) {
    await zoneSource(page);
    await expect(page.locator('#photoswitch')).toHaveText('Photo: City 2024');
    if (i < 4) { await page.click('nav [data-tab="sites"]'); await page.click('[data-map="S1"]'); }
  }
  expect(errors.filter((e) => /layer|maplibre|Style/i.test(e))).toEqual([]);
});

test('the crew map draws every zone with its type and a legend', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  expect(await zoneSource(page)).toEqual([{ id: 'Z1', type: 'storage' }, { id: 'Z2', type: 'storage' }, { id: 'Z3', type: 'no_touch' }]);
  await expect(page.locator('#maplegend')).toContainText('Snow storage');
  await expect(page.locator('#maplegend')).toContainText('Keep clear');
  await expect(page.locator('#maplegend')).toContainText('Lot');
  await expect(page.locator('#mapsite')).toContainText('4-5 bags IceMelt');
  // Tiles load here, so no outage banner (gives the tile probe time to answer).
  await page.waitForTimeout(1500);
  await expect(page.locator('#mapwarn')).toBeHidden();
});

test('tapping a zone shows its details and area', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  const pt = await page.evaluate(([lng, lat]) => { const p = window.SnowMapView.project([lng, lat]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    [PAC[0] + 0.00025, PAC[1] + 0.00004]);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#zonesheet')).toContainText('Main entry');
  await expect(page.locator('#zonesheet')).toContainText('ADA ramp first');
  await expect(page.locator('#zonesheet')).toContainText('3,229 sq ft');
  await expect(page.locator('#zonesheet')).toContainText('Priority');
});

test('a site with no zones says the map is not drawn yet', async ({ page }) => {
  const w = mapWorld(); w.zones = [];
  await openMap(page, 'tok-jordan', w);
  await expect(page.locator('main')).toContainText('Map not drawn yet');
  await expect(page.locator('main')).toContainText("This site's map isn't drawn yet. Use the plow note for now.");
  await expect(page.locator('main')).not.toContainText("Matt hasn't drawn");
  expect(await page.evaluate(() => !!window.SnowMapView)).toBe(false);
});

// A site whose only zones are ones the map cannot draw (a Shovel kind typed into the Sheet, an arrow of one corner,
// a pile of two) is as undrawn to the crew as one with none: the same words, and no empty map.
test('a crew site whose only zones the map cannot draw says the map is not drawn yet', async ({ page }) => {
  const w = mapWorld();
  w.zones = [
    { id: 'Z9', site_id: 'S1', type: 'sidewalk', name: 'Typed in the Sheet', ring: ring(PAC[0], PAC[1], 10, 2), area_sqft: 215, rev: 1 },
    { id: 'Z8', site_id: 'S1', type: 'push', name: 'One corner', ring: [[PAC[0], PAC[1]]], area_sqft: 0, rev: 1 },
    { id: 'Z7', site_id: 'S1', type: 'storage', name: 'Two corners', ring: ring(PAC[0], PAC[1], 5, 5).slice(0, 2), area_sqft: 0, rev: 1 },
  ];
  await openMap(page, 'tok-jordan', w);
  await expect(page.locator('main')).toContainText('Map not drawn yet');
  await expect(page.locator('main')).toContainText("This site's map isn't drawn yet. Use the plow note for now.");
  expect(await page.evaluate(() => !!window.SnowMapView)).toBe(false);
  await expect(page.locator('#mapbox')).toHaveCount(0);
});

test('if the aerial photo fails, the zones still show', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld(), true);
  expect((await zoneSource(page)).length).toBe(3);
  // Visible, not just present: the banner's text is in the page even while hidden.
  await expect(page.locator('#mapwarn')).toBeVisible();
  await expect(page.locator('#mapwarn')).toContainText('Aerial photo unavailable');
});

test('crew have no edit-map button', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#mapedit')).toHaveCount(0);
});

// ---------- the plow map: piles, keep clear, push arrows, and the lot under it (Plow Command, 10/21/26) ----------
// The lot has no polygon (the aerial is the lot). On it Matt draws piles (storage), keep-clear areas (no_touch) and
// push arrows: a line of 2+ corners, white with a dark edge, and a head at its LAST corner. Read straight off the open
// map (window.SnowMapView): its zones source's features, and its layers by id, filter and paint.
const zoneFeatures = (page) => page.evaluate(() => new Promise((res) => {
  const go = () => { const s = window.SnowMapView && window.SnowMapView.getSource('zones'); if (s && s._data) res(s._data.features.map((f) => [f.properties.id, f.properties.type, f.geometry.type])); else setTimeout(go, 100); };
  go();
}));
// A pile and an arrow at PAC, which now has a saved view so its map opens framed. The arrow runs 15 m due east,
// 10 m south of PAC, clear of the pile (which starts at PAC and runs north-east).
const ARROW = [[PAC[0] - eastM(25), PAC[1] - northM(10)], [PAC[0] - eastM(10), PAC[1] - northM(10)]];
const plowMapWorld = () => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, map: { center: PAC, zoom: 18 } } : s));
  w.zones = [
    { id: 'Z5', site_id: 'S1', type: 'storage', name: 'Snow pile 1', priority: true, note: 'Stack it high', ring: ring(PAC[0], PAC[1], 10, 10), area_sqft: 1076, rev: 1 },
    { id: 'Z7', site_id: 'S1', type: 'push', name: 'Push to the NE corner', priority: false, note: 'Not past the dumpster', ring: ARROW, area_sqft: 0, rev: 1 },
  ];
  return w;
};

test('map: a push arrow draws a white line and a head; a pile is purple; no walk marks; the lot\'s buttons sit under the map', async ({ page }) => {
  // Jordan is on N1 (PAC). He opens PAC's map from its card on the Storm tab.
  await tiles(page);
  const calls = await openStorm(page, plowMapWorld());
  await page.click('[data-shiftsite="S1"] [data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  // The pile is one Polygon; the arrow is its LineString and then its head, a Polygon with the id Z7:head.
  expect(await zoneFeatures(page)).toEqual([['Z5', 'storage', 'Polygon'], ['Z7', 'push', 'LineString'], ['Z7:head', 'push_head', 'Polygon']]);
  const style = await page.evaluate(() => {
    const m = window.SnowMapView, ids = ['zones-fill', 'zones-line', 'push-casing', 'push-line', 'push-head', 'push-head-line'];
    const paint = { 'zones-fill': ['fill-color'], 'zones-line': ['line-color'], 'push-casing': ['line-color', 'line-width'], 'push-line': ['line-color', 'line-width'],
      'push-head': ['fill-color'], 'push-head-line': ['line-color', 'line-width'] };
    return {
      order: m.getStyle().layers.map((l) => l.id),
      layers: Object.fromEntries(ids.map((id) => [id, { type: m.getLayer(id).type, filter: m.getFilter(id),
        paint: Object.fromEntries(paint[id].map((p) => [p, m.getPaintProperty(id, p)])) }])),
    };
  });
  // The lot first (10/22/26, light, under everything), then the areas, then the arrow: its dark casing, the white line on
  // it, the head's fill and the head's dark edge.
  expect(style.order).toEqual(['bg', 'esri', 'moa', 'lot-fill', 'lot-hatch', 'lot-line', 'zones-fill', 'zones-line', 'push-casing', 'push-line', 'push-head', 'push-head-line']);
  const AREAS = ['in', ['get', 'type'], ['literal', ['storage', 'no_touch']]];
  // The areas' colour is the kinds' own table: a pile (storage) is purple, #7d5ba6; anything else falls to grey.
  const TABLE = ['match', ['get', 'type'], 'storage', '#7d5ba6', 'no_touch', '#e0218a', 'push', '#ffffff', 'lot', '#f57c00', '#888888'];
  expect(style.layers['zones-fill']).toEqual({ type: 'fill', filter: AREAS, paint: { 'fill-color': TABLE } });
  expect(style.layers['zones-line']).toEqual({ type: 'line', filter: AREAS, paint: { 'line-color': TABLE } });
  expect(style.layers['push-casing']).toEqual({ type: 'line', filter: ['==', ['get', 'type'], 'push'], paint: { 'line-color': '#1a1a1a', 'line-width': 7 } });
  expect(style.layers['push-line']).toEqual({ type: 'line', filter: ['==', ['get', 'type'], 'push'], paint: { 'line-color': '#ffffff', 'line-width': 4 } });
  expect(style.layers['push-head']).toEqual({ type: 'fill', filter: ['==', ['get', 'type'], 'push_head'], paint: { 'fill-color': '#ffffff' } });
  expect(style.layers['push-head-line']).toEqual({ type: 'line', filter: ['==', ['get', 'type'], 'push_head'], paint: { 'line-color': '#1a1a1a', 'line-width': 2 } });
  // No walk marks, and no star for the priority pile: nothing is drawn over the map as a page element.
  await expect(page.locator('#mapbox .maplibregl-marker')).toHaveCount(0);
  await expect(page.locator('.zone-mark, .zone-star')).toHaveCount(0);
  // The lot sits under the map: its two buttons, below the map's bottom edge.
  const lot = page.locator('#maplot');
  await expect(lot.locator('[data-send]')).toHaveCount(2);
  expect(await lot.locator('[data-send]').evaluateAll((els) => els.map((e) => e.dataset.send))).toEqual(['S1|lot|plowed', 'S1|lot|problem']);
  const mapBox = await page.locator('#mapbox').boundingBox(), btn = await lot.locator('[data-send="S1|lot|plowed"]').boundingBox();
  expect(btn.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height);
  // A tap there is the Storm tab's own tap: one tapZone, and the status line comes up under the map.
  await lot.locator('[data-send="S1|lot|plowed"]').click();
  await expect(lot.locator('.lot-line')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  expect(tapCalls(calls)).toHaveLength(1);
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S1', zone_id: 'lot', state: 'plowed', note: '' });
  await expect(lot.locator('[data-send="S1|lot|plowed"]')).toHaveAttribute('aria-pressed', 'true');
  // Back on the Storm tab, the site's card says the same.
  await page.click('#mapback');
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
});

test('map: a Problem from under the map asks for its note there, and saves it', async ({ page }) => {
  await tiles(page);
  const calls = await openStorm(page, plowMapWorld());
  await page.click('[data-shiftsite="S1"] [data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  const lot = page.locator('#maplot');
  await lot.locator('[data-send="S1|lot|problem"]').click();
  const box = lot.locator('[data-note="S1|lot"]');
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  await lot.locator('[data-savenote="S1|lot"]').click();      // nothing typed
  await expect(lot.locator('.note-err')).toHaveText('A problem needs a note');
  await box.fill('gate locked');
  await lot.locator('[data-savenote="S1|lot"]').click();
  await expect(lot.locator('.lot-line')).toHaveText('Problem 7:50 AM by Jordan Demo');
  await expect(lot.locator('.walk-note')).toHaveText('— gate locked');
  expect(tapCalls(calls).map((c) => [c.body.state, c.body.note])).toEqual([['problem', 'gate locked']]);
});

test('map: from the Sites tab (a read-only list) the map carries no lot', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#maplot')).toHaveCount(0);
  await expect(page.locator('[data-send]')).toHaveCount(0);
});

// "The map opens with no console error": with piles only, with arrows only, and with no zones (Matt's: a crew phone
// shows "Map not drawn yet" instead). Every console error and page error counts, not just MapLibre's: a bad filter
// expression or a LineString MapLibre can't read is logged as a plain console error. The piles-only site also has a
// hand-edited Sheet row of a Shovel type, which draws nothing and logs nothing.
for (const [label, zones, want] of [
  ['piles only, and a hand-edited sidewalk row', [
    { id: 'Z1', site_id: 'S1', type: 'storage', name: 'Pile 1', ring: ring(PAC[0], PAC[1], 10, 10), area_sqft: 1076, rev: 1 },
    { id: 'Z3', site_id: 'S1', type: 'no_touch', name: 'Ramp', ring: ring(PAC[0] + eastM(15), PAC[1], 5, 5), area_sqft: 269, rev: 1 },
    { id: 'Z9', site_id: 'S1', type: 'sidewalk', name: 'Typed in the Sheet', ring: ring(PAC[0] - eastM(20), PAC[1], 10, 2), area_sqft: 215, rev: 1 }],
   [['Z1', 'storage', 'Polygon'], ['Z3', 'no_touch', 'Polygon']]],
  ['arrows only', [
    { id: 'P1', site_id: 'S1', type: 'push', name: 'East', ring: ARROW, area_sqft: 0, rev: 1 },
    { id: 'P2', site_id: 'S1', type: 'push', name: 'North, three corners', ring: [[PAC[0], PAC[1]], [PAC[0] + eastM(5), PAC[1] + northM(5)], [PAC[0] + eastM(5), PAC[1] + northM(15)]], area_sqft: 0, rev: 1 }],
   [['P1', 'push', 'LineString'], ['P1:head', 'push_head', 'Polygon'], ['P2', 'push', 'LineString'], ['P2:head', 'push_head', 'Polygon']]],
  ['no zones', [], []],
]) {
  test('map: opens with no console error with ' + label, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const w = mapWorld(); w.zones = zones;
    await adminMap(page, w);
    await page.waitForFunction(() => window.SnowMapView.isSourceLoaded('zones'));
    expect(await zoneFeatures(page)).toEqual(want);
    // Each arrow's line goes through every one of its corners, in order: P1 its 2, P2 its 3 (the bend included).
    const lines = await page.evaluate(() => window.SnowMapView.getSource('zones')._data.features
      .filter((f) => f.geometry.type === 'LineString').map((f) => [f.properties.id, f.geometry.coordinates]));
    expect(lines.map(([id, c]) => [id, c.length])).toEqual(zones.filter((z) => z.type === 'push').map((z) => [z.id, z.ring.length]));
    expect(lines).toEqual(zones.filter((z) => z.type === 'push').map((z) => [z.id, z.ring]));
    await page.waitForTimeout(500); // a style or a layer that MapLibre refuses is logged as it renders
    expect(errors).toEqual([]);
  });
}

// Ruling (10/21/26): a tap that reaches more than one zone shows the CLOSEST, with no "Which zone?" list. Two piles
// side by side with a 3 m gap: Big (10 m x 10 m, 1,076 sq ft) to the west, Small (3 m x 3 m, 97 sq ft) to the east.
// At zoom 18 and 61.2 N a pixel is 40,075,017 x cos 61.2177 / (512 x 2^18) = 40,075,017 x 0.48174 / 134,217,728
// = 0.1438 m, so the gap is 3 / 0.1438 = about 21 px. The tap goes in the gap, 35% of the way from Big to Small:
// about 7 px from Big and 14 px from Small, both inside the tap's 20 px reach, neither under the finger. Smallest
// first (the fork's order) would show Small; the closer is Big.
test('map: a tap that reaches two piles shows the closer one', async ({ page }) => {
  const w = mapWorld();
  const big = ring(PAC[0] - eastM(10), PAC[1] - northM(5), 10, 10), small = ring(PAC[0] + eastM(3), PAC[1] - northM(1.5), 3, 3);
  w.zones = [
    { id: 'ZB', site_id: 'S1', type: 'storage', name: 'Big pile', note: 'west', ring: big, area_sqft: 1076, rev: 1 },
    { id: 'ZS', site_id: 'S1', type: 'storage', name: 'Small pile', note: 'east', ring: small, area_sqft: 97, rev: 1 },
  ];
  await openMap(page, 'tok-jordan', w);
  await zoneSource(page);
  await page.waitForFunction(() => window.SnowMapView.isSourceLoaded('zones'));
  // Big's east edge is its second corner (south-east), Small's west edge its first (south-west); the tap is on PAC's
  // own latitude, which both piles span.
  const px = await page.evaluate(([bigSE, smallSW, mid]) => {
    const m = window.SnowMapView, r = m.getCanvas().getBoundingClientRect();
    const a = m.project(bigSE), b = m.project(smallSW), c = m.project(mid);
    return { left: r.left, top: r.top, a: a.x, b: b.x, y: c.y };
  }, [big[1], small[0], PAC]);
  const gap = px.b - px.a;
  expect(gap).toBeGreaterThan(12);   // the fixture is what the comment says: a gap of about 21 px,
  expect(gap).toBeLessThan(30);      // so 65% of it is still inside the 20 px reach
  await page.mouse.click(px.left + px.a + 0.35 * gap, px.top + px.y);
  await expect(page.locator('#zonesheet')).toBeVisible();
  await expect(page.locator('#zonesheet h2')).toHaveText('Big pile');
});

test('map: tapping a push arrow shows its name and note, and no area', async ({ page }) => {
  const w = mapWorld();
  w.zones = w.zones.concat([{ id: 'Z7', site_id: 'S1', type: 'push', name: 'Push to the NE corner', note: 'Not past the dumpster', ring: ARROW, area_sqft: 0, rev: 1 }]);
  await openMap(page, 'tok-jordan', w);
  await zoneSource(page);
  await page.waitForFunction(() => window.SnowMapView.isSourceLoaded('zones'));
  // The middle of the arrow: 17.5 m west and 10 m south of PAC, 10 m clear of every area.
  const pt = await page.evaluate(([lng, lat]) => { const p = window.SnowMapView.project([lng, lat]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    [(ARROW[0][0] + ARROW[1][0]) / 2, ARROW[0][1]]);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#zonesheet h2')).toHaveText('Push to the NE corner');
  await expect(page.locator('#zonesheet')).toContainText('Not past the dumpster');
  await expect(page.locator('#zonesheet')).not.toContainText('sq ft');
  await expect(page.locator('#zonesheet')).not.toContainText('Push snow this way');
});

// Lot outlines (10/22/26): a lot (80 m x 60 m around PAC, one 5 m x 5 m island in its south-west corner) draws as one
// polygon with its island, on its own two layers UNDER the piles' (lot-fill, lot-line before zones-fill), and a tap on
// open lot (18 m west and 20 m north of PAC: 20 m or more from every pile, and on the canvas, which at this zoom spans
// about 25 m each side of its centre) shows its card with the server's square footage. On paper: 4,800 - 25 =
// 4,775 m2 x 10.7639 = 51,398 sq ft (the fake serves the number as stored).
test('map: a lot draws under the piles as a polygon with its island, and a tap on open lot shows its card with the square footage', async ({ page }) => {
  const w = mapWorld();
  w.zones = w.zones.concat([{ id: 'L1', site_id: 'S1', type: 'lot', name: 'Main lot', note: '', ring: ring(PAC[0] - eastM(40), PAC[1] - northM(30), 80, 60),
    holes: [ring(PAC[0] - eastM(35), PAC[1] - northM(25), 5, 5)], area_sqft: 51398, rev: 1 }]);
  await openMap(page, 'tok-jordan', w);
  expect(await zoneSource(page)).toEqual([{ id: 'Z1', type: 'storage' }, { id: 'Z2', type: 'storage' }, { id: 'Z3', type: 'no_touch' }, { id: 'L1', type: 'lot' }]);
  await page.waitForFunction(() => window.SnowMapView.isSourceLoaded('zones'));
  const drawn = await page.evaluate(() => {
    const m = window.SnowMapView, f = m.getSource('zones')._data.features.find((x) => x.properties.id === 'L1');
    const ids = m.getStyle().layers.map((l) => l.id);
    return { rings: f.geometry.coordinates.length, lotFill: ids.indexOf('lot-fill'), lotHatch: ids.indexOf('lot-hatch'), lotLine: ids.indexOf('lot-line'), zonesFill: ids.indexOf('zones-fill'),
      pattern: m.getPaintProperty('lot-hatch', 'fill-pattern'), lineWidth: m.getPaintProperty('lot-line', 'line-width'), hasStripes: m.hasImage('lot-stripes'),
      lineColour: m.getPaintProperty('lot-line', 'line-color'), fillColour: m.getPaintProperty('lot-fill', 'fill-color'), fillOpacity: m.getPaintProperty('lot-fill', 'fill-opacity') };
  });
  expect(drawn.rings).toBe(2);                       // the lot and its island
  expect(drawn.lotFill).toBeGreaterThan(-1);
  expect(drawn.lotFill).toBeLessThan(drawn.lotHatch);  // the tint, then the stripes (Matt, 10/23/26), then the line
  expect(drawn.lotHatch).toBeLessThan(drawn.lotLine);
  expect(drawn.lotLine).toBeLessThan(drawn.zonesFill); // all of it under the piles
  expect(drawn.pattern).toBe('lot-stripes');
  expect(drawn.lineWidth).toBe(3);
  expect(drawn.hasStripes).toBe(true);                 // the tile was handed over when the style asked for it
  // The lot is orange since 10/26/26 (Matt: the green blended with the landscaping on the 2024 aerial): the 3 px line
  // and the tint under the stripes both wear the table's #f57c00, the tint at the same .15 as before.
  expect(drawn.lineColour).toBe('#f57c00');
  expect(drawn.fillColour).toBe('#f57c00');
  expect(drawn.fillOpacity).toBe(0.15);
  await expect(page.locator('#maplegend')).toContainText('Lot');
  const pt = await page.evaluate(([lng, lat]) => { const p = window.SnowMapView.project([lng, lat]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    [PAC[0] - eastM(18), PAC[1] + northM(20)]);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#zonesheet h2')).toHaveText('Main lot');
  await expect(page.locator('#zonesheet')).toContainText('Lot');
  await expect(page.locator('#zonesheet')).toContainText('51,398 sq ft');
});

// ---------- site maps: Matt's zone editor ----------
// Corners are clicked at whole pixels; the expected lng/lat is the map's own
// unproject of that same pixel, so the check is exact (1e-6 deg is ~0.1 m).
async function adminMap(page, state) {
  await tiles(page);
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(state) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  return calls;
}
// Pixel offsets from the canvas CENTRE (which is PAC), all west of it: every
// zone in mapWorld starts at PAC's longitude and runs east, so this ground is
// clear at any map height (the map shrinks when the old-map sheet is open).
const CORNERS = [[-150, -60], [-40, -60], [-40, 20], [-150, 20]];
// A person scrolls the map into view before tapping it; so does the test.
const mapInView = (page) => page.locator('#mapbox').evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
async function tapCorners(page, px) {
  const out = [];
  for (const [x, y] of px) {
    await mapInView(page);
    const r = await page.evaluate(() => { const b = window.SnowMapView.getCanvas().getBoundingClientRect(); return { l: b.left + b.width / 2, t: b.top + b.height / 2 }; });
    const cx = Math.round(r.l + x), cy = Math.round(r.t + y);
    await page.mouse.click(cx, cy);
    out.push(await page.evaluate(([a, b]) => { const c = window.SnowMapView.getCanvas().getBoundingClientRect(); const ll = window.SnowMapView.unproject([a - c.left, b - c.top]); return [ll.lng, ll.lat]; }, [cx, cy]));
  }
  return out;
}
const lastCall = (calls, action) => calls.filter((c) => c.body.action === action).at(-1);

// Plow Command: a pile (storage) rather than the fork's heated walk, which the map no longer draws. A priority is
// still saved with the zone, and no longer starred on the map (Task 13).
test('Matt draws a priority pile and it saves with its corners', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.click('[data-ztype="storage"]');
  await page.check('#z_priority');
  await page.fill('#z_name', 'Back steps');
  await page.fill('#z_note', 'Check the drain');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ site_id: 'S1', type: 'storage', priority: true, name: 'Back steps', note: 'Check the drain', rev: 0 });
  expect(rec.id).toBeFalsy();
  expect(rec.ring.length).toBe(4);
  rec.ring.forEach((p, i) => { expect(Math.abs(p[0] - want[i][0])).toBeLessThan(1e-6); expect(Math.abs(p[1] - want[i][1])).toBeLessThan(1e-6); });
  expect(await zoneSource(page)).toHaveLength(4); // the new zone is on the map now: mapWorld's three areas and this one
});

// Plow Command: a keep-clear area (the fork drew a sidewalk here, a kind the editor no longer offers).
test('undo takes back the last corner', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await page.click('#z_undo');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.click('[data-ztype="no_touch"]');
  await page.fill('#z_name', 'Three corners');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec.type).toBe('no_touch');
  expect(rec.ring.length).toBe(3);
  expect(Math.abs(rec.ring[2][0] - want[2][0])).toBeLessThan(1e-6);
});

// An area is 3 corners or more (the server's rule, in the server's words: plow-command-script roster.js validate).
test('editor: a pile needs 3 corners: two are blocked before they are sent', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await page.click('[data-ztype="storage"]');
  await page.fill('#z_name', 'Too small');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toHaveText('A zone needs at least 3 corners');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
  // A third corner and it goes.
  await tapCorners(page, CORNERS.slice(2, 3));
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  expect(lastCall(calls, 'saveZone').body.record).toMatchObject({ type: 'storage', name: 'Too small' });
  expect(lastCall(calls, 'saveZone').body.record.ring).toHaveLength(3);
});

// ---------- the editor's Lot (lot outlines, 10/22/26) ----------
// The fourth button. A lot drawn here has no holes (islands are traced in Bootprint); one imported with an island keeps
// it through an edit (the record is spread into the save); a tap on open lot opens it for editing (the editor asks the
// lot's layer after the piles', so a pile over the lot is picked first). The server's refusal shows in the form.
const lotWorld = () => {
  const w = mapWorld();
  w.zones = w.zones.concat([{ id: 'L1', site_id: 'S1', type: 'lot', name: 'Main lot', note: '', priority: false, ring: ring(PAC[0] - eastM(40), PAC[1] - northM(30), 80, 60),
    holes: [ring(PAC[0] - eastM(35), PAC[1] - northM(25), 5, 5)], area_sqft: 51398, rev: 1 }]);
  return w;
};
const OPEN_LOT = [PAC[0] - eastM(18), PAC[1] + northM(20)]; // 18 m west, 20 m north of PAC: 20 m from every pile, on the canvas
async function clickLngLat(page, lngLat) {
  await mapInView(page);
  const pt = await page.evaluate(([lng, lat]) => { const p = window.SnowMapView.project([lng, lat]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, lngLat);
  await page.mouse.click(pt.x, pt.y);
}

test('editor: Matt draws a lot and it saves as type lot with no holes', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.click('[data-ztype="lot"]');
  await page.fill('#z_name', 'Back lot');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ type: 'lot', name: 'Back lot', rev: 0 });
  expect('holes' in rec).toBe(false);
  expect(rec.ring).toHaveLength(3);
});

test('editor: the type sentence names four', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.fill('#z_name', 'No kind yet');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toHaveText('Pick a type: Pile, Keep clear, Push arrow or Lot.');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
});

test('editor: an imported lot keeps its islands through an edit, and a tap on open lot opens it', async ({ page }) => {
  const w = lotWorld();
  const calls = await adminMap(page, w);
  await page.click('#mapedit');
  await page.waitForFunction(() => window.SnowMapView.isSourceLoaded('zones'));
  await clickLngLat(page, OPEN_LOT);
  await expect(page.locator('#zoneform')).toBeVisible();
  await expect(page.locator('#z_name')).toHaveValue('Main lot');
  await expect(page.locator('[data-ztype="lot"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ id: 'L1', type: 'lot', name: 'Main lot', rev: 1 });
  expect(rec.holes).toEqual(w.zones.find((z) => z.id === 'L1').holes);
  expect('area_sqft' in rec).toBe(false); // the server works it out
});

test("editor: the server's hole refusal shows in the form and the lot stays open", async ({ page }) => {
  await tiles(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(lotWorld(), { saveReply: { ok: false, code: 'invalid', reason: 'A hole must be inside the lot' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await page.click('#mapedit');
  await page.waitForFunction(() => window.SnowMapView.isSourceLoaded('zones'));
  await clickLngLat(page, OPEN_LOT);
  await expect(page.locator('#z_name')).toHaveValue('Main lot');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toHaveText('A hole must be inside the lot');
  await expect(page.locator('#zoneform')).toBeVisible();
});

// ---------- the editor's push arrows (Task 14, 10/21/26) ----------
// An arrow is a line of 2 or more corners, its head at the LAST one (SnowMap.arrowHead). The draft draws as the saved
// arrow will: its corners as a LineString in order, then its head as a Polygon (SnowMap.featureCollection's shapes).
const draftData = (page) => page.evaluate(() => {
  const s = window.SnowMapView.getSource('draft'), d = s && s._data;
  if (!d) return null;
  const fs = d.type === 'FeatureCollection' ? d.features : [d];
  return fs.map((f) => ({ type: f.properties.type || '', geom: f.geometry.type, coords: f.geometry.coordinates }));
});
// Two corners 110 px apart, west to east, on clear ground west of PAC (CORNERS' first two).
async function drawArrow(page) {
  await page.click('#mapedit');
  await page.click('#ed_new');
  await page.click('[data-ztype="push"]');
  return tapCorners(page, CORNERS.slice(0, 2));
}
const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

test('editor: drawing two corners as Push arrow saves type push, drawn as the saved arrow will be', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  const want = await drawArrow(page);
  await expect(page.locator('.zone-corner')).toHaveCount(2);
  // The draft: the line through A and B, then the head at B (the last corner) -- SnowMap.arrowHead of the same corners.
  const draft = await draftData(page);
  expect(draft.map((f) => [f.type, f.geom])).toEqual([['push', 'LineString'], ['push_head', 'Polygon']]);
  expect(draft[0].coords).toHaveLength(2);
  draft[0].coords.forEach((c, i) => expect(near(c, want[i])).toBe(true));
  const head = await page.evaluate((ring) => window.SnowMap.arrowHead(ring), draft[0].coords);
  expect(draft[1].coords).toEqual([head]);
  expect(near(draft[1].coords[0][0], want[1])).toBe(true); // the tip is B
  await page.fill('#z_name', 'Push to the east');
  await page.fill('#z_note', 'Not past the dumpster');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ site_id: 'S1', type: 'push', name: 'Push to the east', note: 'Not past the dumpster', rev: 0 });
  expect('area_sqft' in rec).toBe(false); // the server works it out (0 for an arrow)
  expect(rec.ring).toHaveLength(2);
  rec.ring.forEach((p, i) => expect(near(p, want[i])).toBe(true)); // A then B, in the order tapped
  // On the map now as an arrow: mapWorld's three areas, then its line and its head (the fake's first new id is X91).
  await expect.poll(() => zoneFeatures(page)).toEqual([['Z1', 'storage', 'Polygon'], ['Z2', 'storage', 'Polygon'], ['Z3', 'no_touch', 'Polygon'],
    ['X91', 'push', 'LineString'], ['X91:head', 'push_head', 'Polygon']]);
});

test('editor: one corner refused: an arrow needs at least 2 corners, in the server\'s words', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await page.click('[data-ztype="push"]');
  await tapCorners(page, CORNERS.slice(0, 1));
  await page.fill('#z_name', 'Half an arrow');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toHaveText('An arrow needs at least 2 corners');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
  expect(await draftData(page)).toEqual([]); // one corner draws no line and no head
  // The corner rules, as the editor reads them, for what a tap cannot make: the LAST two corners on the same spot (the head is
  // drawn from the last leg: final wave M3, spec amended). The server's words (roster.js validate); its check is exact equality
  // of both numbers, and so is this one. Worked: [] and one corner -> too few; A,A -> the same; A,A,B -> the last leg A-B is
  // real -> ''; A,B,B -> the last leg is no leg -> the same; A and A a hair north -> ''; areas as before.
  const rules = await page.evaluate(() => {
    const p = window.SnowMapEdit.cornerProblem;
    return [p('push', []), p('push', [[-149.9, 61.2]]), p('push', [[-149.9, 61.2], [-149.9, 61.2]]),
      p('push', [[-149.9, 61.2], [-149.9, 61.2], [-149.8, 61.2]]), p('push', [[-149.9, 61.2], [-149.8, 61.2], [-149.8, 61.2]]),
      p('push', [[-149.9, 61.2], [-149.9, 61.2000001]]),
      p('storage', [[-149.9, 61.2], [-149.8, 61.2]]), p('no_touch', [[-149.9, 61.2], [-149.8, 61.2], [-149.8, 61.3]])];
  });
  expect(rules).toEqual(['An arrow needs at least 2 corners', 'An arrow needs at least 2 corners', 'An arrow needs two different corners',
    '', 'An arrow needs two different corners', '', 'A zone needs at least 3 corners', '']);
});

// The arrow's head is at its last corner. While drawing a push, a tap on that LAST corner's marker turns the arrow
// around (its corners reversed: the head goes to the other end); a tap on any other corner chooses it for Delete
// corner, as on any zone. Undo takes a turn back.
test('editor: tapping the head flips the arrow; Undo turns it back; any other corner is chosen as before', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  const [a, b] = await drawArrow(page);
  // The first corner (the tail): chosen, not flipped.
  await page.locator('.zone-corner').nth(0).click();
  await expect(page.locator('.zone-corner.sel')).toHaveCount(1);
  await expect(page.locator('#z_delcorner')).toBeEnabled();
  let draft = await draftData(page);
  expect(near(draft[0].coords[0], a) && near(draft[0].coords[1], b)).toBe(true);
  await page.locator('.zone-corner').nth(0).click(); // let it go
  await expect(page.locator('.zone-corner.sel')).toHaveCount(0);
  // The last corner (the head): flipped. The line now runs B to A, and the head sits at A.
  await page.locator('.zone-corner').nth(1).click();
  await expect(page.locator('.zone-corner')).toHaveCount(2);
  await expect(page.locator('.zone-corner.sel')).toHaveCount(0); // a flip chooses nothing
  await expect.poll(async () => { const d = await draftData(page); return near(d[0].coords[0], b) && near(d[0].coords[1], a); }).toBe(true);
  draft = await draftData(page);
  expect(near(draft[1].coords[0][0], a)).toBe(true); // the head's tip is A now
  // Undo turns it back: A to B, the head at B.
  await page.click('#z_undo');
  await expect.poll(async () => { const d = await draftData(page); return near(d[0].coords[0], a) && near(d[0].coords[1], b); }).toBe(true);
  await expect(page.locator('.zone-corner')).toHaveCount(2);
  // Flip again (the head is B's marker, the last one again) and save: the ring goes B, A.
  await page.locator('.zone-corner').nth(1).click();
  await page.fill('#z_name', 'Push west');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const ringSaved = lastCall(calls, 'saveZone').body.record.ring;
  expect(ringSaved).toHaveLength(2);
  expect(near(ringSaved[0], b) && near(ringSaved[1], a)).toBe(true);
});

test('editor: on a pile, the last corner is chosen like any other: no flip', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await page.click('[data-ztype="storage"]');
  const want = await tapCorners(page, CORNERS);
  await page.locator('.zone-corner').nth(3).click();
  await expect(page.locator('.zone-corner.sel')).toHaveCount(1);
  await page.click('#z_delcorner');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.fill('#z_name', 'Pile, three left');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const r = lastCall(calls, 'saveZone').body.record.ring;
  expect(r).toHaveLength(3);
  r.forEach((p, i) => expect(near(p, want[i])).toBe(true)); // A, B, C in order: the fourth went, nothing turned round
});

// A saved arrow is a thin line: a tap within 10 px of it (or on its head) opens it to edit, as a tap inside an area does.
test('editor: a saved push arrow opens to edit from a tap beside its line or on its head', async ({ page }) => {
  const w = mapWorld();
  w.zones = w.zones.concat([{ id: 'Z7', site_id: 'S1', type: 'push', name: 'Push to the NE corner', priority: false, note: 'Not past the dumpster', ring: ARROW, area_sqft: 0, rev: 1 }]);
  const calls = await adminMap(page, w);
  await page.click('#mapedit');
  await page.waitForFunction(() => window.SnowMapView.isSourceLoaded('zones'));
  const at = (lngLat, dy) => page.evaluate(([ll, d]) => { const p = window.SnowMapView.project(ll); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y + d }; }, [lngLat, dy]);
  // 7 px below the middle of the line: off its 4 px white stroke (and its 7 px casing), inside the 10 px box.
  await mapInView(page);
  let pt = await at([(ARROW[0][0] + ARROW[1][0]) / 2, ARROW[0][1]], 7);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#z_name')).toHaveValue('Push to the NE corner');
  await expect(page.locator('[data-ztype="push"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.zone-corner')).toHaveCount(2);
  await page.click('#z_cancel');
  await expect(page.locator('#zoneform')).toBeHidden();
  // On the head, away from the line: zoomed to 20 on the tip (a pixel is 0.1438 / 4 = 0.036 m), a point 3 m back from
  // the tip (the arrow points due east) and 1.2 m south. The head there is 2 x 3/4 = 1.5 m each side of the line, so the
  // point is inside it; 1.2 m is 33 px from the line, past the 10 px box: only the head can answer this tap.
  await page.evaluate((c) => window.SnowMapView.jumpTo({ center: c, zoom: 20 }), ARROW[1]);
  await page.waitForTimeout(300);
  await mapInView(page);
  pt = await at([ARROW[1][0] - eastM(3), ARROW[1][1] - northM(1.2)], 0);
  const onLine = await page.evaluate(({ x, y }) => { const r = window.SnowMapView.getCanvas().getBoundingClientRect();
    return window.SnowMapView.queryRenderedFeatures([[x - r.left - 10, y - r.top - 10], [x - r.left + 10, y - r.top + 10]], { layers: ['push-line'] }).length; }, pt);
  expect(onLine).toBe(0); // the fixture is what the comment says: the line is out of reach
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#z_name')).toHaveValue('Push to the NE corner');
  // Saved as it was: its id, rev and type, its two corners in their order.
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ id: 'Z7', rev: 1, type: 'push', name: 'Push to the NE corner' });
  expect(rec.ring).toEqual(ARROW);
});

test('a zone with no type picked is not sent', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.fill('#z_name', 'No type');
  await page.click('#z_save');
  await expect(page.locator('#z_err')).toContainText('Pick a type');
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
});

test('Save view stores the map centre and zoom on the site, keeping its other fields', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.evaluate(() => window.SnowMapView.jumpTo({ center: [-149.9, 61.22], zoom: 17.5 }));
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  const rec = lastCall(calls, 'saveSite').body.record;
  expect(rec.id).toBe('S1');
  expect(rec.name).toBe('PAC');
  expect(rec.materials_needed).toBe('4-5 bags IceMelt');
  expect(rec.map.zoom).toBeCloseTo(17.5, 6);
  expect(rec.map.center[0]).toBeCloseTo(-149.9, 6);
  expect(rec.map.center[1]).toBeCloseTo(61.22, 6);
});

test('the old-map picture shows beside the map and is never sent or stored', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  // After Edit map, which stores its own on/off flag: from here, nothing new may be kept. Every key, not one carved
  // out: Plow Command keeps no outlines (the fork's R13 let the kept-outlines key change here; that key is gone).
  const others = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  const before = await others();
  await page.setInputFiles('#ed_reffile', { name: 'Night 1 - PAC.png', mimeType: 'image/png', buffer: PNG1 });
  await expect(page.locator('#refpanel img')).toBeVisible();
  expect(await page.locator('#refpanel img').getAttribute('src')).toMatch(/^blob:/);
  // Work with the picture open: draw a zone and save the view.
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.click('[data-ztype="storage"]');
  await page.fill('#z_name', 'Traced');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  for (const c of calls) {
    const s = JSON.stringify(c.body);
    expect(s).not.toContain('data:image');
    expect(s).not.toContain('Night 1 - PAC');
    expect(s).not.toContain('blob:');
  }
  expect(await others()).toBe(before);
  await page.click('#ref_close');
  await expect(page.locator('#refpanel')).toBeHidden();
});

test('editing a zone keeps its id and rev; Archive takes it off the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await zoneSource(page);
  await page.click('#mapedit');
  const tapZone = async (lng, lat) => {
    await mapInView(page);
    const pt = await page.evaluate(([a, b]) => { const p = window.SnowMapView.project([a, b]); const r = window.SnowMapView.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lng, lat]);
    await page.mouse.click(pt.x, pt.y);
  };
  await tapZone(PAC[0] + 0.00025, PAC[1] + 0.00004); // Z1, Main entry
  await expect(page.locator('#z_name')).toHaveValue('Main entry');
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await expect(page.locator('#zonesheet')).toBeHidden(); // editing, not the crew sheet
  await page.fill('#z_name', 'Main entry + ramp');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ id: 'Z1', rev: 1, name: 'Main entry + ramp', type: 'storage', priority: true, note: 'ADA ramp first' }); // Z1 is a pile in mapWorld now

  // Z3 is ~240 px east of PAC at z18 (MapLibre zooms are 512 px tiles): off a
  // phone-width map. Pan to it first, as Matt would.
  await page.evaluate(([a, b]) => window.SnowMapView.jumpTo({ center: [a, b] }), [PAC[0] + 0.00065, PAC[1] + 0.0001]);
  await tapZone(PAC[0] + 0.0006 + 0.00005, PAC[1] + 0.0001); // Z3, Ski trail
  await expect(page.locator('#z_name')).toHaveValue('Ski trail');
  await page.click('#z_archive');
  await expect(page.locator('#zoneform')).toBeHidden();
  expect(lastCall(calls, 'archiveZone').body).toMatchObject({ id: 'Z3', rev: 1 });
  expect((await zoneSource(page)).map((z) => z.id)).toEqual(['Z1', 'Z2']);
});

test('Matt gets a map to draw on even before a site has zones', async ({ page }) => {
  const w = mapWorld(); w.zones = [];
  await adminMap(page, w);
  await expect(page.locator('#mapedit')).toBeVisible();
});

test('tapping a corner that is already there does not add another', async ({ page }) => {
  // Found in review: MapLibre fires the map click for a tap on a marker, so a
  // tap to grab corner 2 made A,B,C,D,B -- a spike that encloses only BCD.
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.locator('.zone-corner').nth(1).click();
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.click('[data-ztype="storage"]'); // a pile (the fork drew a sidewalk, a kind the editor no longer offers)
  await page.fill('#z_name', 'Four');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  expect(lastCall(calls, 'saveZone').body.record.ring.length).toBe(4);
});

// Found in review: a save still in flight when Matt taps Done or Back was
// stored by the server but never shown, so he would draw it again.
async function slowZoneSaves(page) {
  await page.route(isSnow, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'saveZone') await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
}
async function drawAndSave(page) {
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS);
  await page.click('[data-ztype="storage"]'); // a pile: a kind the map draws (the tests below count it on the map)
  await page.fill('#z_name', 'Slow one');
  await page.click('#z_save');
}

test('a zone saved while Done is tapped still shows on the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#ed_done');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await expect.poll(async () => (await zoneSource(page)).length, { timeout: 5000 }).toBe(4);
});

test('a zone saved while Back is tapped is there when the map is reopened', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#mapback');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await page.waitForTimeout(1600); // the slow reply lands after Back
  await page.click('[data-map="S1"]');
  expect(await zoneSource(page)).toHaveLength(4);
});

test('a slow save never draws its zone onto another site opened meanwhile', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page);
  await drawAndSave(page);
  await page.click('#mapback');
  await page.click('[data-map="S2"]'); // TUDOR-TRANSIT: no zones
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  await page.waitForTimeout(1600); // the PAC zone's reply lands now
  expect(await zoneSource(page)).toEqual([]);
});

test('leads have no edit-map button either', async ({ page }) => {
  await openMap(page, 'tok-alex', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#mapedit')).toHaveCount(0);
});

// ---------- the phone's Back button ----------
// Matt, 10/1/26: Back closed the whole app and he had to start over. The app is
// one page, so Back must undo one step at a time: an open box, then the map.
const phoneBack = (page) => page.evaluate(() => history.back());

test('Back on a map returns to the list, not out of the app', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await phoneBack(page);
  await expect(page.locator('.site-card')).toHaveCount(2);
  await expect(page.locator('#mapbox')).toHaveCount(0);
  expect(await page.evaluate(() => window.SnowMapView)).toBeFalsy();
});

test('Back with an edit box open closes the box and stays on the screen', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await phoneBack(page);
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('.site-card')).toHaveCount(2);
});

test('a box closed with Cancel leaves no extra Back step behind', async ({ page }) => {
  await tiles(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  // Straight after Cancel: no step left for a dead box (else the next Back does nothing).
  await expect.poll(() => page.evaluate(() => ((history.state && history.state.snow) || []).length)).toBe(0);
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView);
  await phoneBack(page); // one Back: off the map. Not a ghost step for the closed box.
  await expect(page.locator('.site-card')).toHaveCount(2);
  await expect(page.locator('#mapbox')).toHaveCount(0);
});

test('the in-app ‹ Back and the phone Back agree', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await page.click('#mapback');
  await expect(page.locator('.site-card')).toHaveCount(2);
  // Nothing left to undo (history moves a moment later, so wait for it).
  await expect.poll(() => page.evaluate(() => (history.state && history.state.snow) || []).then((s) => s.length)).toBe(0);
});

test('Back while drawing a zone cancels the drawing and keeps the map', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await phoneBack(page);
  await expect(page.locator('#zoneform')).toBeHidden();
  await expect(page.locator('.zone-corner')).toHaveCount(0);
  await expect(page.locator('#mapbox')).toBeVisible();
  expect(calls.filter((c) => c.body.action === 'saveZone')).toHaveLength(0);
  await phoneBack(page); // and the next Back leaves the map
  await expect(page.locator('.site-card')).toHaveCount(2);
});

test('switching zones while drawing does not lose the map on the next Back', async ({ page }) => {
  await adminMap(page, mapWorld());
  await zoneSource(page);
  await page.click('#mapedit');
  await page.click('#ed_new');
  // Cancel and start again in the same instant, before the history has answered the
  // Cancel: the late answer must not cancel the new drawing.
  await page.evaluate(() => { document.getElementById('z_cancel').click(); document.getElementById('ed_new').click(); });
  await expect(page.locator('#zoneform')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#zoneform')).toBeVisible(); // still drawing once the history settled
  await phoneBack(page);
  await expect(page.locator('#zoneform')).toBeHidden();
  await expect(page.locator('#mapbox')).toBeVisible();
});

// ---------- polish from the site-maps review (10/1/26) ----------
test('the route edit box says where sites are renamed', async ({ page }) => {
  // Matt, 10/1: tried to rename JBER sites inside the route box, where names are plain text.
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('[data-edit="route:R1"]');
  await expect(page.locator('#r_hint')).toBeVisible();
  await expect(page.locator('#r_hint')).toContainText('Sites tab');
});

test('materials needed can be typed on a site and is sent with it', async ({ page }) => {
  const w = world();
  w.sites[0] = { ...w.sites[0], materials_needed: '2-4 bags IceMelt' };
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_mat')).toHaveValue('2-4 bags IceMelt');
  await page.fill('#s_mat', '3-5 bags IceMelt, gravel at the ramp');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.materials_needed).toBe('3-5 bags IceMelt, gravel at the ramp');
});

test('signing out from the map editor clears the map and the old-map picture', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.setInputFiles('#ed_reffile', { name: 'Night 1 - PAC.png', mimeType: 'image/png', buffer: PNG1 });
  await expect(page.locator('#refpanel')).toBeVisible();
  await page.click('#signout');
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#refpanel')).toHaveCount(0);
  expect(await page.evaluate(() => window.SnowMapView)).toBeFalsy();
});

test('a refused Save view says so, even while a zone is being drawn', async ({ page }) => {
  await tiles(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld(), { saveReply: { ok: false, code: 'invalid', reason: 'Test refusal: not saved' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
  await page.click('#mapedit');
  await page.click('#ed_new'); // drawing: the editor's message line is hidden now
  await page.click('#ed_view');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Test refusal: not saved');
});

// Matt, 10/1/26, tracing PAC: tall buildings lean over the walks in the city's
// photo. A different flight leans differently, so one tap flips the photo.
test('the photo switch flips between the city photo and Esri', async ({ page }) => {
  await openMap(page, 'tok-jordan', mapWorld()); // crew get it too: the lean hides walks from them as well
  await zoneSource(page);
  const moa = () => page.evaluate(() => window.SnowMapView.getLayoutProperty('moa', 'visibility') || 'visible');
  await expect(page.locator('#photoswitch')).toContainText('City 2024');
  expect(await moa()).toBe('visible');
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toContainText('Esri');
  expect(await moa()).toBe('none');
  expect(await page.evaluate(() => window.SnowMapView.getLayoutProperty('esri', 'visibility') || 'visible')).toBe('visible');
  await page.click('#photoswitch');
  await expect(page.locator('#photoswitch')).toContainText('City 2024');
  expect(await moa()).toBe('visible');
  expect(await zoneSource(page)).toHaveLength(3); // the zones never move
});

// Matt, 10/1/26, first real trace: "I'm trying to move the map. It places a dot.
// I can't delete them. And I'm trying to spin the map."
test('in Move map mode a tap adds no corner; switching back adds again', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 2));
  await expect(page.locator('#z_mode')).toContainText('Adding corners');
  await page.click('#z_mode');
  await expect(page.locator('#z_mode')).toContainText('Moving map');
  await tapCorners(page, CORNERS.slice(2, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(2);
  await page.click('#z_mode');
  await tapCorners(page, CORNERS.slice(2, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(3);
});

test('a tapped corner can be deleted, and Undo brings it back', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  const want = await tapCorners(page, CORNERS);
  await expect(page.locator('#z_delcorner')).toBeDisabled(); // nothing chosen yet
  await page.locator('.zone-corner').nth(1).click();
  await expect(page.locator('.zone-corner.sel')).toHaveCount(1);
  await page.click('#z_delcorner');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await page.click('#z_undo');
  await expect(page.locator('.zone-corner')).toHaveCount(4);
  await page.locator('.zone-corner').nth(1).click();
  await page.click('#z_delcorner');
  await page.click('[data-ztype="no_touch"]'); // keep clear (the fork drew a sidewalk, a kind the editor no longer offers)
  await page.fill('#z_name', 'Three left');
  await page.click('#z_save');
  await expect(page.locator('#zoneform')).toBeHidden();
  const ring = lastCall(calls, 'saveZone').body.record.ring;
  expect(ring.length).toBe(3);
  [want[0], want[2], want[3]].forEach((w, i) => { expect(Math.abs(ring[i][0] - w[0])).toBeLessThan(1e-6); expect(Math.abs(ring[i][1] - w[1])).toBeLessThan(1e-6); });
});

test('the map turns with buttons and the compass turns it back to north', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  const bearing = () => page.evaluate(() => window.SnowMapView.getBearing());
  await page.click('#ed_rotr');
  await expect.poll(bearing).toBeCloseTo(15, 3);
  await page.click('#ed_rotl');
  await page.click('#ed_rotl');
  await expect.poll(bearing).toBeCloseTo(-15, 3);
  await page.click('.maplibregl-ctrl-compass');
  await expect.poll(bearing).toBeCloseTo(0, 3);
});

// Matt, 10/1/26: "is rotating it gone because I saved it" -- Save view kept the
// spot and zoom but dropped the turn. The turn is part of the view.
test('Save view keeps the turn, and the map reopens turned', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_rotr');
  await page.click('#ed_rotr'); // 30 degrees
  await expect.poll(() => page.evaluate(() => window.SnowMapView.getBearing())).toBeCloseTo(30, 3);
  await page.click('#ed_view');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  expect(lastCall(calls, 'saveSite').body.record.map.bearing).toBeCloseTo(30, 3);
  await page.click('#mapback');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView);
  expect(await page.evaluate(() => window.SnowMapView.getBearing())).toBeCloseTo(30, 3);
});

// Matt, 10/1/26: drew all the way round PAC tapping New zone between walks,
// thinking each was banked. Every New zone silently threw the last one away.
test('New zone never throws away a zone in progress', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.click('#ed_new');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await expect(page.locator('#toast')).toContainText('Save or Cancel this zone first');
});

test('Done never throws away a zone in progress', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.click('#ed_new');
  await tapCorners(page, CORNERS.slice(0, 3));
  await page.click('#ed_done');
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  await expect(page.locator('#zoneform')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Save or Cancel this zone first');
});

// ---------- import from Bootprint (Matt, 10/1/26: trace in Bootprint, bring it here) ----------
const mPin = (x, y) => ({ lat: PAC[1] + y / RE / DEGR, lng: PAC[0] + x / (RE * Math.cos(PAC[1] * DEGR)) / DEGR, accuracy: 0 });
const bpRect = (x, y) => [mPin(x, y), mPin(x + 10, y), mPin(x + 10, y + 5), mPin(x, y + 5)];
// Plow Command (Task 14, 10/21/26): the import brings piles, and from 10/22/26 the lot. The near job has two piles (an
// area, and a 6 ft run that comes across as a strip), a walk and a lot: 1 lot and 2 piles in; 1 walk left out, and said so.
const bpExport = () => Buffer.from(JSON.stringify({
  schema: 'bootprint-library-export', version: 1, exportedAt: '2026-10-01T18:00:00Z',
  jobs: [
    { id: 'FARJOB', name: 'FAR-SECRET-JOB', zones: [{ id: 1, name: 'Far pile', mode: 'area', surface: 'storage', pins: bpRect(0, 20000), widthFt: '' }] },
    { id: 'NEAR', name: 'Near PAC', zones: [
      { id: 1, name: 'Pile west', mode: 'area', surface: 'storage', pins: bpRect(-80, -20), widthFt: '' },
      { id: 2, name: 'Lot', mode: 'area', surface: 'plow', pins: bpRect(-80, -60), widthFt: '' },
      { id: 3, name: 'Back run', mode: 'line', surface: 'storage', pins: [mPin(-80, -30), mPin(-50, -30)], widthFt: '6' },
      { id: 4, name: 'WALK-NEVER-SENT', mode: 'area', surface: 'walk', pins: bpRect(-80, -45), widthFt: '' },
    ] },
  ],
  prefs: { snowTerms: 'PREF-SECRET' },
}));
async function importFile(page, buf) {
  await page.setInputFiles('#ed_bpfile', { name: 'bootprint-library-2026-10-01.json', mimeType: 'application/json', buffer: buf });
}

test('a Bootprint job imports its piles as storage zones, and nothing else leaves the laptop', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('Near PAC'); // nearest the site first
  // Lot outlines (10/22/26): the job's "Lot" (plow surface) comes in as a lot too, in job order between the piles.
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('1 lot and 2 piles');
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum b')).toHaveText('1 lot and 2 piles to add');
  await expect(page.locator('#bp_sum .muted')).toHaveText('Left out: 1 walk'); // one: singular
  await expect(page.locator('#bp_add')).toHaveText('Add 1 lot and 2 piles');
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(3);
  const recs = calls.filter((c) => c.body.action === 'saveZone').map((c) => c.body.record);
  expect(recs.map((r) => [r.name, r.type, r.site_id, r.from])).toEqual([
    ['Pile west', 'storage', 'S1', 'bootprint:NEAR:1'], ['Lot', 'lot', 'S1', 'bootprint:NEAR:2'], ['Back run', 'storage', 'S1', 'bootprint:NEAR:3']]);
  expect(recs[2].ring.length).toBe(4); // the run came across as a strip
  expect('holes' in recs[1]).toBe(false); // a lot traced without islands carries no holes key
  // All three reached the open map and are drawn on it: mapWorld's three areas, the two piles and the lot.
  await expect.poll(() => mapZoneIds(page)).toEqual(['Z1', 'Z2', 'Z3', 'X91', 'X92', 'X93']); // the fake's new ids: X + (90 + n)
  await expect.poll(() => zoneSource(page)).toEqual([{ id: 'Z1', type: 'storage' }, { id: 'Z2', type: 'storage' }, { id: 'Z3', type: 'no_touch' },
    { id: 'X91', type: 'storage' }, { id: 'X92', type: 'lot' }, { id: 'X93', type: 'storage' }]);
  await expect(page.locator('#toast')).toContainText('Added 1 lot and 2 piles from Bootprint');
  for (const c of calls) {
    const s = JSON.stringify(c.body);
    expect(s).not.toContain('FAR-SECRET-JOB');
    expect(s).not.toContain('PREF-SECRET');
    expect(s).not.toContain('bootprint-library-2026');
    expect(s).not.toContain('WALK-NEVER-SENT');
  }
});

// Plow Command (Task 14, 10/21/26): walks and hand work are the Shovel crew's; parking lots are the plow's own and are
// never drawn (the aerial is the lot). Only piles come in, and the summary names the rest. The job, on paper: 12 walks
// (9 areas + 3 runs with a width), 3 hand (2 areas + 1 run), 1 lot, 3 pile areas = 19 shapes; 3 in, 16 out.
test('editor: Import from Bootprint brings piles only and says what it left out', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  const zs = [];
  let id = 0;
  for (let i = 0; i < 9; i++) zs.push({ id: ++id, name: 'Walk ' + id, mode: 'area', surface: 'walk', pins: bpRect(-200 + 12 * i, -100), widthFt: '' });
  for (let i = 0; i < 3; i++) zs.push({ id: ++id, name: 'Walk run ' + id, mode: 'line', surface: 'walk', pins: [mPin(-200, -110 - 4 * i), mPin(-150, -110 - 4 * i)], widthFt: '6' });
  for (let i = 0; i < 2; i++) zs.push({ id: ++id, name: 'Curb ' + id, mode: 'area', surface: 'hand', pins: bpRect(-200 + 12 * i, -130), widthFt: '' });
  zs.push({ id: ++id, name: 'Curb run ' + id, mode: 'line', surface: 'hand', pins: [mPin(-200, -140), mPin(-150, -140)], widthFt: '4' });
  zs.push({ id: ++id, name: 'Main lot', mode: 'area', surface: 'plow', pins: bpRect(-200, -160), widthFt: '' });
  for (let i = 0; i < 3; i++) zs.push({ id: ++id, name: 'Snow pile ' + (i + 1), mode: 'area', surface: 'storage', pins: bpRect(-80 + 15 * i, -20), widthFt: '' });
  expect(zs).toHaveLength(19); // the job is what the comment says
  await importFile(page, Buffer.from(JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [{ id: 'NEAR', name: 'Near PAC', zones: zs }] })));
  // Lot outlines (10/22/26): the job's one plow area, "Main lot", comes in as a lot now, before the piles (job order).
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('1 lot and 3 piles');
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum b')).toHaveText('1 lot and 3 piles to add');
  await expect(page.locator('#bp_sum .muted')).toHaveText('Left out: 12 walks, 3 hand');
  await expect(page.locator('#bp_add')).toHaveText('Add 1 lot and 3 piles');
  // The preview shows the lot and the three piles and nothing else, each as its kind.
  await expect.poll(() => page.evaluate(() => window.SnowMapView.getSource('draft')._data.features.map((f) => f.properties.type)))
    .toEqual(['lot', 'storage', 'storage', 'storage']);
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(4);
  expect(calls.filter((c) => c.body.action === 'saveZone').map((c) => [c.body.record.name, c.body.record.type, c.body.record.from, 'holes' in c.body.record])).toEqual([
    ['Main lot', 'lot', 'bootprint:NEAR:16', false],
    ['Snow pile 1', 'storage', 'bootprint:NEAR:17', false], ['Snow pile 2', 'storage', 'bootprint:NEAR:18', false], ['Snow pile 3', 'storage', 'bootprint:NEAR:19', false]]);
  await expect(page.locator('#toast')).toContainText('Added 1 lot and 3 piles from Bootprint');
  for (const c of calls) expect(JSON.stringify(c.body)).not.toMatch(/Walk|Curb/);
});

test('importing the same Bootprint job twice adds nothing the second time', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(3);   // 2 piles + the lot (10/22/26)
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum b')).toHaveText('Nothing to add');
  await expect(page.locator('#bp_sum .muted')).toHaveText('Left out: 1 walk, 3 already imported');
  await expect(page.locator('#bp_add')).toBeDisabled();
});

// The pulled pile (Blood Bank and VCA, 10/23-24): the Pull from Shovel Command brings a site's piles without a `from`, so "already
// imported" cannot see them and every import re-added them. mapWorld's Z1 and Z2 are such piles (storage, no from) and Z3 is a
// keep-clear outline. The job, on paper: Z1's corners as a pile and Z2's corners as a pile (both are on the map: left out, 2),
// Z3's corners as a pile (a keep-clear outline is not a pile: it comes in), a new pile and a lot. In: pile 3, pile 4, the lot =
// 1 lot and 2 piles, in job order; only those three reach the server.
test('import: a pile already on the map (no from) is left out and named; a pile with a keep-clear outline\'s corners comes in', async ({ page }) => {
  const world = mapWorld();
  const calls = await adminMap(page, world);
  await page.click('#mapedit');
  const pinsOf = (id) => world.zones.find((z) => z.id === id).ring.map(([lng, lat]) => ({ lng, lat, accuracy: 0 }));
  const zs = [
    { id: 1, name: 'Main pile', mode: 'area', surface: 'storage', pins: pinsOf('Z1'), widthFt: '' },
    { id: 2, name: 'Walk pile', mode: 'area', surface: 'storage', pins: pinsOf('Z2'), widthFt: '' },
    { id: 3, name: 'Ski pile', mode: 'area', surface: 'storage', pins: pinsOf('Z3'), widthFt: '' },
    { id: 4, name: 'New pile', mode: 'area', surface: 'storage', pins: bpRect(-80, -20), widthFt: '' },
    { id: 5, name: 'Lot', mode: 'area', surface: 'plow', pins: bpRect(-80, -60), widthFt: '' },
  ];
  await importFile(page, Buffer.from(JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [{ id: 'NEAR', name: 'Near PAC', zones: zs }] })));
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum b')).toHaveText('1 lot and 2 piles to add');
  await expect(page.locator('#bp_sum .muted')).toHaveText('Left out: 2 piles already on the map');
  await expect(page.locator('#bp_add')).toHaveText('Add 1 lot and 2 piles');
  // The preview draws only what will come in.
  await expect.poll(() => page.evaluate(() => window.SnowMapView.getSource('draft')._data.features.map((f) => f.properties.type)))
    .toEqual(['storage', 'storage', 'lot']);
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(3);
  expect(calls.filter((c) => c.body.action === 'saveZone').map((c) => [c.body.record.name, c.body.record.type, c.body.record.from])).toEqual([
    ['Ski pile', 'storage', 'bootprint:NEAR:3'], ['New pile', 'storage', 'bootprint:NEAR:4'], ['Lot', 'lot', 'bootprint:NEAR:5']]);
  await expect(page.locator('#toast')).toContainText('Added 1 lot and 2 piles from Bootprint');
});

test('import: when every pile of the job is already on the map there is nothing to add, and it says one pile', async ({ page }) => {
  const world = mapWorld();
  await adminMap(page, world);
  await page.click('#mapedit');
  const pins = world.zones.find((z) => z.id === 'Z1').ring.map(([lng, lat]) => ({ lng, lat, accuracy: 0 }));
  await importFile(page, Buffer.from(JSON.stringify({ schema: 'bootprint-library-export', version: 1,
    jobs: [{ id: 'NEAR', name: 'Near PAC', zones: [{ id: 1, name: 'Main pile', mode: 'area', surface: 'storage', pins, widthFt: '' }] }] })));
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum b')).toHaveText('Nothing to add');
  await expect(page.locator('#bp_sum .muted')).toHaveText('Left out: 1 pile already on the map');
  await expect(page.locator('#bp_add')).toBeDisabled();
});

// Lot outlines (10/22/26): a lot traced in Bootprint with an island as a cut-out comes in with that island as its hole,
// which reaches the server in the record; a cut-out inside no lot is left out and named. The job (in metres from PAC):
// a 100 m x 60 m lot, a 10 m x 5 m island inside it, and a cut-out 100 m east of the lot.
test('import: a lot\'s islands ride along as holes and reach the server; a stray cut-out is left out', async ({ page }) => {
  const calls = await adminMap(page, mapWorld());
  await page.click('#mapedit');
  const zs = [
    { id: 1, name: 'Main lot', mode: 'area', surface: 'plow', pins: [mPin(-50, -30), mPin(50, -30), mPin(50, 30), mPin(-50, 30)], widthFt: '' },
    { id: 2, name: 'Planter', mode: 'cut', surface: 'plow', pins: [mPin(-40, -20), mPin(-30, -20), mPin(-30, -15), mPin(-40, -15)], widthFt: '' },
    { id: 3, name: 'Stray', mode: 'cut', surface: 'plow', pins: [mPin(150, -30), mPin(160, -30), mPin(160, -25), mPin(150, -25)], widthFt: '' },
  ];
  await importFile(page, Buffer.from(JSON.stringify({ schema: 'bootprint-library-export', version: 1, jobs: [{ id: 'LOTJOB', name: 'Lot job', zones: zs }] })));
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toContainText('1 lot (1 island)');
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum b')).toHaveText('1 lot (1 island) to add');
  await expect(page.locator('#bp_sum .muted')).toHaveText('Left out: 1 cut-out (outside a lot, over its edge, over another island, or crossing itself)');
  // The preview's lot carries its island as a second ring.
  await expect.poll(() => page.evaluate(() => window.SnowMapView.getSource('draft')._data.features.map((f) => [f.properties.type, f.geometry.coordinates.length])))
    .toEqual([['lot', 2]]);
  await page.click('#bp_add');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveZone').length).toBe(1);
  const rec = lastCall(calls, 'saveZone').body.record;
  expect(rec).toMatchObject({ name: 'Main lot', type: 'lot', from: 'bootprint:LOTJOB:1' });
  expect(rec.holes).toHaveLength(1);
  expect(rec.holes[0]).toHaveLength(4);
  await expect(page.locator('#toast')).toContainText('Added 1 lot (1 island) from Bootprint');
  for (const c of calls) expect(JSON.stringify(c.body)).not.toMatch(/Stray/);
});

// Matt's imports, 10/4/26: the job list rendered off screen, ~1 zone per 2-3 s
// saved with no word on screen, and Done mid-way stopped it ("Added 2 of 5").
test('the Bootprint job list is brought onto the screen when the file is read', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await page.evaluate(() => window.scrollTo(0, 0)); // where Matt was: the map buttons at the top
  await importFile(page, bpExport());
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toBeVisible();
  // toBeVisible passes off screen; the list's top must be inside the window.
  await expect.poll(() => page.locator('#bp_jobs').evaluate((el) => {
    const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight;
  })).toBe(true);
});

async function importSlowly(page) {
  const calls = await adminMap(page, mapWorld());
  await slowZoneSaves(page); // 1.2 s per zone; bpExport's near job has 3 (2 piles and, from 10/22/26, its lot)
  await page.click('#mapedit');
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await page.click('#bp_add');
  await expect(page.locator('#bp_add')).toHaveText('Adding 1 of 3…');
  return calls;
}
const zoneSaves = (calls) => calls.filter((c) => c.body.action === 'saveZone').length;

test('an import says "Adding n of N…" and locks its panel until it is done', async ({ page }) => {
  const calls = await importSlowly(page);
  await expect(page.locator('#bp_add')).toBeDisabled();
  await expect(page.locator('#bp_cancel')).toBeDisabled();
  await expect(page.locator('#bp_jobs [data-bpjob]').first()).toBeDisabled();
  await expect(page.locator('#bp_add')).toHaveText('Adding 3 of 3…', { timeout: 4000 });
  await expect(page.locator('#toast')).toContainText('Added 1 lot and 2 piles from Bootprint');
  expect(zoneSaves(calls)).toBe(3);
  await expect(page.locator('#bpimport')).toBeHidden();
});

test('Done, New zone and a tab mid-import are refused with a word, and every zone still saves', async ({ page }) => {
  const calls = await importSlowly(page);
  for (const sel of ['#ed_done', '#ed_new', 'nav [data-tab="routes"]']) {
    await page.evaluate(() => { document.getElementById('toast').style.display = 'none'; }); // the next toast must be a new one
    await page.click(sel);
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).not.toContainText('Added');
  }
  await expect(page.locator('#zoneform')).toBeHidden();   // New zone did not start a drawing
  await expect(page.locator('#bpimport')).toBeVisible();  // Done did not close the editor
  await expect(page.locator('#toast')).toContainText('Added 1 lot and 2 piles from Bootprint', { timeout: 5000 });
  expect(zoneSaves(calls)).toBe(3);
  await expect(page.locator('#ed_new')).toBeVisible();    // still in the editor, on the map
});

// A file that arrives mid-import without the label's click (a change event dispatched by hand, as a script or an odd
// browser could) is refused by readBootprint in the busy words: a new panel then would count only the zones landed so
// far as imported and add the rest again. (10/23/26; the label's own click was refused already, the test above.)
test('a file arriving mid-import without the label is refused with the busy word, and nothing is added twice', async ({ page }) => {
  const calls = await importSlowly(page);
  await page.evaluate(() => { document.getElementById('toast').style.display = 'none'; }); // the next toast must be a new one
  await page.evaluate((json) => {
    const input = document.getElementById('ed_bpfile'), dt = new DataTransfer();
    dt.items.add(new File([json], 'bootprint-library-again.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, bpExport().toString());
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Still adding zones');
  await expect(page.locator('#bp_add')).toHaveText(/Adding \d of 3…/);   // the running import's panel is untouched
  await expect(page.locator('#toast')).toContainText('Added 1 lot and 2 piles from Bootprint', { timeout: 6000 });
  expect(zoneSaves(calls)).toBe(3);
  // Afterwards the same file reads as already imported, every zone.
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum b')).toHaveText('Nothing to add');
  await expect(page.locator('#bp_sum .muted')).toHaveText('Left out: 1 walk, 3 already imported');
  expect(zoneSaves(calls)).toBe(3);
});

test('the phone\'s Back and ‹ Back mid-import leave the map open, and the import finishes', async ({ page }) => {
  const calls = await importSlowly(page);
  for (const press of [() => phoneBack(page), () => page.click('#mapback')]) {
    await page.evaluate(() => { document.getElementById('toast').style.display = 'none'; }); // the next toast must be a new one
    await press();
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#toast')).not.toContainText('Added'); // Matt was told why, before the end
    await expect(page.locator('#mapbox')).toBeVisible();
  }
  await expect(page.locator('#toast')).toContainText('Added 1 lot and 2 piles from Bootprint', { timeout: 5000 });
  expect(zoneSaves(calls)).toBe(3);
  // All three landed on the map that stayed open, and are drawn on it: mapWorld's 3 + the 2 piles + the lot.
  await expect.poll(async () => (await mapZoneIds(page)).length).toBe(6);
  await expect.poll(async () => (await zoneSource(page)).length).toBe(6);
  // Once done, Back works as before: it closes the map.
  await phoneBack(page);
  await expect(page.locator('#mapbox')).toHaveCount(0);
});

test('the file pickers do not open mid-import', async ({ page }) => {
  await importSlowly(page);
  let opened = 0;
  page.on('filechooser', () => { opened++; });
  await page.click('label.filebtn:has(#ed_bpfile)');
  await page.click('label.filebtn:has(#ed_reffile)');
  await page.waitForTimeout(400);
  expect(opened).toBe(0);
  await expect(page.locator('#toast')).toBeVisible();
});

// Matt 10/4/26: mapping site after site, the editor dropped back to view after
// every Back and every reload. Edit map now stays on until Done.
const inEditor = (page) => expect(page.locator('#ed_new')).toBeVisible();
async function reopenS1(page) {
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-map="S1"]');
  await page.waitForFunction(() => window.SnowMapView && window.SnowMapView.getSource('zones'));
}

test('Edit map stays on after ‹ Back, the phone\'s Back and a reload, until Done', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await inEditor(page);
  await page.click('#mapback');
  await page.click('[data-map="S2"]'); // another site: still in the editor
  await inEditor(page);
  await expect(page.locator('#mapedit')).toBeHidden();
  await phoneBack(page);
  await expect(page.locator('#mapbox')).toHaveCount(0);
  await page.reload();
  await reopenS1(page);
  await inEditor(page);
  await page.click('#ed_done');
  await expect(page.locator('#ed_new')).toHaveCount(0);
  await page.click('#mapback');
  await reopenS1(page);
  await expect(page.locator('#mapedit')).toBeVisible(); // Done ended it: the map opens to view
  await expect(page.locator('#ed_new')).toHaveCount(0);
});

test('signing out ends Edit map: the next map opens to view', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await inEditor(page);
  await page.click('#signout');
  expect(await page.evaluate(() => localStorage.getItem('titan-plow-editing'))).toBeNull();
});

test('a crew phone never opens a map in the editor, whatever this device remembers', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('titan-plow-editing', '1'));
  await openMap(page, 'tok-jordan', mapWorld());
  await zoneSource(page);
  await expect(page.locator('#ed_new')).toHaveCount(0);
  await expect(page.locator('#edbar')).toHaveCount(0);
});

// 10/9/26, Fire Station #10 (14861 Mountain Air Dr): MapLibre parses an inline style on
// the NEXT ANIMATION FRAME, and frames stop while the page is off screen (the phone's
// screen off, the app behind another; the desktop pane's window hidden). SnowMap.open
// still hands the map over after its 8 s fallback, so Edit map came on over a map whose
// style was not parsed yet: the editor's addSource('draft') threw "Style is not done
// loading", the bar never came, and with Edit map remembered the map said it couldn't
// load. The aerial tiles are held open as well, as they were that night: the editor
// must never wait for the photo, which may never come.
// Frames are held from the tap on the site until the test lets them go; MapLibre looks
// requestAnimationFrame up on each call, so the page's own copy is what it gets. The stub
// stays in place and passes frames through once released: Playwright's own in-page script
// keeps a bound copy of whatever it first found there, and polls its waits with it.
const tilesHang = (page) => page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), () => { /* never answered */ });
const holdFrames = (page) => page.evaluate(() => {
  const real = window.requestAnimationFrame.bind(window), held = [];
  let holding = true;
  window.requestAnimationFrame = (cb) => (holding ? (held.push(cb), 0) : real(cb));
  window.__frames = { release: () => { holding = false; held.splice(0).forEach((cb) => real(cb)); } };
});
const releaseFrames = (page) => page.evaluate(() => window.__frames.release());
const draftFeatures = (page) => page.evaluate(() => {
  const s = window.SnowMapView.getSource('draft'), d = s && s._data;
  return !d ? -1 : d.type === 'FeatureCollection' ? d.features.length : 1;
});
async function unparsedMap(page, errors) {
  page.on('pageerror', (e) => errors.push(String(e)));
  await tilesHang(page);
  await open(page, { token: 'tok-matt', snow: fakeSnow(mapWorld()) });
  await page.click('nav [data-tab="sites"]');
  await holdFrames(page);
  await page.click('[data-map="S1"]');
  // The 8 s fallback hands the map over with its style still unparsed (no zones source yet).
  await expect(page.locator('#mapedit')).toBeEnabled({ timeout: 12000 });
  expect(await page.evaluate(() => !!window.SnowMapView.getSource('zones'))).toBe(false);
}

test('Edit map on a map whose style is still unparsed: the bar comes, and the import previews once the style parses', async ({ page }) => {
  const errors = [];
  await unparsedMap(page, errors);
  await page.click('#mapedit');
  await expect(page.locator('#ed_new')).toBeVisible();
  await expect(page.locator('#ed_bpfile')).toHaveCount(1);
  await expect(page.locator('#ed_reffile')).toHaveCount(1);
  // The file can be picked and the job chosen before the style is there; the preview waits for it.
  await importFile(page, bpExport());
  await page.locator('#bp_jobs [data-bpjob]').first().click();
  await expect(page.locator('#bp_sum')).toContainText('1 lot and 2 piles to add');
  expect(await draftFeatures(page)).toBe(-1);
  await releaseFrames(page);
  await page.waitForFunction(() => window.SnowMapView.getSource('zones'));
  await expect.poll(() => draftFeatures(page)).toBe(3);
  // The photo never came (its tiles are still held): the preview did not wait for it.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.SnowMapView.isStyleLoaded())).toBe(false);
  expect(errors).toEqual([]);
});

test('with Edit map remembered, a map whose style is still unparsed opens in the editor, and a zone can be started', async ({ page }) => {
  const errors = [];
  await page.addInitScript(() => localStorage.setItem('titan-plow-editing', '1'));
  await unparsedMap(page, errors);
  await expect(page.locator('#ed_new')).toBeVisible();
  await expect(page.locator('#mapwarn')).not.toContainText("couldn't load");
  await page.click('#ed_new');
  await expect(page.locator('#zoneform')).toBeVisible();
  // Corners tapped before the style is there are kept (the markers are the page's own);
  // their outline is drawn the moment the draft arrives with the style.
  await tapCorners(page, CORNERS.slice(0, 3));
  await expect(page.locator('.zone-corner')).toHaveCount(3);
  expect(await draftFeatures(page)).toBe(-1);
  await releaseFrames(page);
  await page.waitForFunction(() => window.SnowMapView.getSource('zones'));
  await expect.poll(() => draftFeatures(page)).toBe(1); // the outline, drawn on the draft that arrived with the style
  expect(await page.evaluate(() => window.SnowMapView.getSource('draft')._data.geometry.type)).toBe('Polygon');
  expect(errors).toEqual([]);
});

test('a file that is not a Bootprint export is refused with a reason', async ({ page }) => {
  await adminMap(page, mapWorld());
  await page.click('#mapedit');
  await importFile(page, Buffer.from('{"hello": 1}'));
  await expect(page.locator('#toast')).toContainText('not a Bootprint export');
  await expect(page.locator('#bp_jobs')).toHaveCount(0);
});

// ---------- pairings (sub-project 4, 10/1/26) ----------
test('the roster card edits the Crew Board fields and sends them', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.selectOption('#f_rides_with', 'C01');
  await page.selectOption('#f_gear', 'needs_issued');
  await page.check('input[data-list="keep_apart_from"][value="C01"]');
  await page.fill('#f_seasons', '2');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  expect([r.rides_with, r.gear, r.keep_apart_from, r.works_well_with, r.seasons]).toEqual(['C01', 'needs_issued', ['C01'], [], 2]);
});

test('a site can be marked as needing a clearance', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.fill('#s_clear', 'JBER');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.needs_clearance).toBe('JBER');
});

test('a blank clearance and blank seasons are sent as empty, never invented', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'saveSite').at(-1).body.record.needs_clearance).toBe(null);
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  expect([r.seasons, r.rides_with, r.gear]).toEqual([null, null, null]);
});

test('Matt places a lead and a member; one move per tap', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(2);
  expect(calls.filter((c) => c.body.action === 'addMove').map((c) => [c.body.record.worker, c.body.record.role])).toEqual([['C01', 'lead'], ['C03', 'member']]);
});

test('a route warns, never blocks: no driver on a crew of one', async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => ({ ...c, can_drive: false }));
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .warns')).toContainText('Nobody on this route can drive');
});

test("a lead who can't drive is placed anyway, and the route names them (Matt, 10/7/26 field test)", async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => ({ ...c, can_drive: c.id === 'C03' }));   // Alex can't, Jordan can
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(2);                 // placed, not blocked
  await expect(page.locator('[data-route="R1"] .warns [data-rule="lead-no-licence"]')).toHaveText("Alex Test leads but can't drive");
  await expect(page.locator('[data-route="R1"] .warns')).not.toContainText('Nobody on this route can drive');   // Jordan drives
});

test('a site with no clearance set never warns about clearance', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await expect(page.locator('[data-route="R1"] .warns li[data-rule^="clearance"]')).toHaveCount(0);
});

test('a site that needs a clearance warns about who lacks it', async ({ page }) => {
  const w = world(); w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, needs_clearance: 'JBER' } : s));
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C03"]');
  await page.click('[data-place="R1"][data-role="member"]');
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="clearance"]')).toContainText('Jordan Demo: no JBER clearance');
});

test('an archived worker never shows on the board', async ({ page }) => {
  const w = world(); w.crew.push({ id: 'C09', name: 'Gone Worker', archived: true, rev: 1 });
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C09', to_route: 'R1', role: 'lead' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-route="R1"]')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Gone Worker');
});

// Plow Command has no Gear log (Task 17): the card keeps the placements and the shifts worked, and has no "Gear on hand" row.
// (The card's own `gear` field, own or needs issued, is a roster field and stays: it is on the card below the table.)
test('the person card shows placed routes and shifts worked, and no gear on hand', async ({ page }) => {
  const w = world();
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' }];
  w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 1 }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-act="card"]');
  await expect(page.locator('#dlgIn')).toContainText('N1 from 10/1');
  await expect(page.locator('#dlgIn')).toContainText('1 night · 0 days');
  await expect(page.locator('#dlgIn')).not.toContainText('Gear on hand');
  await expect(page.locator('#dlgIn')).not.toContainText('none logged');
  await expect(page.locator('#dlgIn')).toContainText('slow starter'); // Matt's own card: private fields show
});

test('crew and leads have no Board tab', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="routes"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="board"]')).toHaveCount(0);
});

test('Post offers the shifts around now with none picked: 8:59 AM', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-02T08:59:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#post');
  await expect(page.locator('[data-shift]')).toHaveText(['Night of 10/1', 'Day of 10/2', 'Night of 10/2']);
  await expect(page.locator('[data-shift][aria-pressed="true"]')).toHaveCount(0);
});

test('Post at 9:00 AM offers today and tonight', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-02T09:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#post');
  await expect(page.locator('[data-shift]')).toHaveText(['Day of 10/2', 'Night of 10/2']);
});

test('posting sends the chosen shift and clears "Changed since post"', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T16:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#crewsees')).toContainText('Not posted');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('#changed')).toBeVisible();
  await page.click('#post');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect.poll(() => calls.filter((c) => c.body.action === 'post').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'post')[0].body.shift).toBe('night-2026-10-01');
  await expect(page.locator('#changed')).toBeHidden();
  await expect(page.locator('#crewsees')).toContainText('Night of 10/1');
});

test('Post waits for a move that is still saving', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T16:00:00-08:00' });
  await page.route(isSnow, async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.action === 'addMove') await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('#post')).toBeDisabled();
  await expect(page.locator('#post')).toBeEnabled({ timeout: 5000 });
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(1);
});

test('Callout saves the board for the chosen shift', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), clockAt: '2026-10-01T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('.chip[data-worker="C01"]');
  await page.click('[data-place="R1"][data-role="lead"]');
  await expect(page.locator('[data-route="R1"] .chip')).toHaveCount(1);
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({ shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, rev: 0 });
});

const POST = { id: 'P1', rev: 1, shift: 'night-2026-10-01', posted_at: '2026-10-02T00:12:00.000Z',
  routes: [{ id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: 'C01', members: [] },
           { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'] }],
  people: { C01: { name: 'Alex Test', phone: '555-0101', shifts: { night: 3, day: 1 } },
            C03: { name: 'Jordan Demo', phone: '555-0103', shifts: { night: 2, day: 0 } } } };

test('crew see their own route first, partners and sites', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('.tonight-route').first()).toContainText('N1');
  await expect(page.locator('.tonight-route').first()).toContainText('Alex Test');
  await expect(page.locator('.tonight-route').first().locator('[data-map="S1"]')).toBeVisible();
  await expect(page.locator('.tonight-route').first().locator('a[href="tel:555-0101"]')).toHaveCount(1);
  await expect(page.locator('#tonight-head')).toContainText('Night of 10/1');
});

test('a crew member not on the post is told so and sees the whole board', async ({ page }) => {
  const w = world(); w.posts = [{ ...POST, routes: POST.routes.map((r) => ({ ...r, members: [] })) }];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText("You're not on a route this shift");
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

test('a stale post shows no old routes', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-02T10:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
  await expect(page.locator('main')).toContainText("The dispatcher hasn't posted the trucks yet. Check back, or call your lead.");
  await expect(page.locator('main')).not.toContainText("Matt hasn't posted");
  await expect(page.locator('.tonight-route')).toHaveCount(0);
});

test('a morning post for tonight is shown, not stale', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T08:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

test('shifts worked show for everyone, night and day', async ({ page }) => {
  const w = world(); w.posts = [POST];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('#shifts-worked')).toContainText('Alex Test');
  await expect(page.locator('#shifts-worked')).toContainText('3 nights · 1 day');
  await expect(page.locator('#shifts-worked')).toContainText('2 nights · 0 days');
});

test('nothing posted yet is said plainly', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
});

// Plow Command (Task 17): no Gear log, so no Log tab, no log entry and no gear warning. A person whose card says
// 'needs issued' used to put a 'gear needs issuing' line on the Board until an issued parka was logged; there is
// nothing left to clear it by, so the line is gone for good.
test('the cold-gear warning is gone: a person whose card says needs issued puts no gear line on the Board', async ({ page }) => {
  const w = world(); w.crew = w.crew.map((c) => (c.id === 'C03' ? { ...c, gear: 'needs_issued' } : c));
  w.moves = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C03"]')).toBeVisible();   // Jordan is on N1: the Board drew his route
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="gear"]')).toHaveCount(0);
  await expect(page.locator('[data-route="R1"]')).not.toContainText('gear needs issuing');
});

// Review 10/1/26: Android keeps the app in memory. Opened at 4 PM, switched
// back to at 8 PM after Matt posted: Tonight must show the post, not "Not
// posted yet", without the crew knowing to tap the tab again.
test('Tonight picks up a new post when the app comes back on screen', async ({ page }) => {
  const w = world();
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('main')).toContainText('Not posted yet for this shift');
  w.posts.push(POST);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.tonight-route')).toHaveCount(2);
  await expect(page.locator('main')).not.toContainText('Not posted yet');
});

test('Tonight has a Refresh button that fetches the newest post', async ({ page }) => {
  const w = world();
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-01T18:00:00-08:00' });
  await expect(page.locator('#refreshPost')).toBeVisible();
  w.posts.push(POST);
  await page.click('#refreshPost');
  await expect(page.locator('.tonight-route')).toHaveCount(2);
});

// Review 10/1/26: a callout is who ACTUALLY went out. Someone placed who never
// showed must not get a night under "Shifts worked", which every crew phone sees.
const PLACED = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' },
  { id: 'M2', at: '2026-10-01T17:01:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];

test('a callout can mark a no-show: left off the roster, listed, with a note', async ({ page }) => {
  const w = world(); w.moves = PLACED.slice();
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('[data-noshow="C03"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#co_note', 'Jordan no call no show');
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({
    shift: 'night-2026-10-01', roster: { R1: { lead: 'C01', members: [] } }, no_shows: ['C03'], note: 'Jordan no call no show' });
});

test('reopening a saved callout keeps its no-shows and note', async ({ page }) => {
  const w = world(); w.moves = PLACED.slice();
  w.callouts = [{ id: 'night-2026-10-01', shift: 'night-2026-10-01', started_at: '2026-10-01T20:00:00.000-08:00', note: 'short a truck',
    roster: { R1: { lead: 'C01', members: [] } }, no_shows: ['C03'], rev: 1 }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-01T22:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await page.click('#callout');
  await page.click('[data-shift="night-2026-10-01"]');
  await expect(page.locator('[data-noshow="C03"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#co_note')).toHaveValue('short a truck');
  await page.click('[data-noshow="C03"]'); // he turned up late after all
  await page.click('#co_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveCallout').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'saveCallout')[0].body.record).toMatchObject({
    roster: { R1: { lead: 'C01', members: ['C03'] } }, no_shows: [], note: 'short a truck', rev: 1 });
});

// ---------------- the Storm tab: the lot card (Plow Command, 10/21/26) ----------------
// Fixture, worked by hand. Clock 7:30 AM on 10/3 is before the 9 AM cutover, so
// the shift on offer is still "night-2026-10-02", and the post below is that
// night's: not stale. The post lists R2 (S2) first, then R1 (S1) with Jordan
// (C03) as a member, so Jordan's own route is N1 = the PAC site.
// The lot is the unit: every site is one Lot (zone_id 'lot'), tapped Plowed or Problem.
// PAC has two snow piles drawn and a plow note; TUDOR-TRANSIT has nothing drawn.
// Both answer the same one Lot: a pile is a drawing, never a walk.
// The fake stamps every row at 7:50:18 AM Alaska time (-08:00 on 10/3).
const STORM_CLOCK = '2026-10-03T07:30:00-08:00';
const START_ROW = { id: 'ST-1', seq: 1, kind: 'start', storm_id: 'ST-1', at: '2026-10-03T06:00:00.000-08:00', by_name: 'Matthew' };
const PLOW_NOTE = 'Push to the NE corner, never block the dumpster';
const stormWorld = () => {
  const w = world();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, plow_note: PLOW_NOTE } : s));
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  w.zones = [
    { id: 'Z5', site_id: 'S1', type: 'storage', name: 'Snow pile 1', rev: 1 },
    { id: 'Z6', site_id: 'S1', type: 'storage', name: 'Snow pile 2', rev: 1 },
  ];
  w.posts = [{ ...POST, shift: 'night-2026-10-02' }];
  w.storms = [START_ROW];
  return w;
};
const logRow = (n, siteId, zoneId, state, by, extra = {}) => ({ id: 'L-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02',
  site_id: siteId, zone_id: zoneId, state, note: '', by_key: 'C01', by_name: by, at: '2026-10-03T06:30:00.000-08:00',
  off_route: false, undoes: null, ...extra });
async function openStorm(page, w, o = {}) {
  const calls = await open(page, { token: o.token || 'tok-jordan', snow: fakeSnow(w, o.fake), clockAt: o.clockAt || STORM_CLOCK, delay: o.delay, abortIf: o.abortIf, hangIf: o.hangIf });
  await page.click('nav [data-tab="storm"]');
  return calls;
}
const shiftCalls = (calls) => calls.filter((c) => c.body.action === 'getShiftLog');
const tapCalls = (calls) => calls.filter((c) => c.body.action === 'tapZone');
// A site's lot: its row (the busy key '<site>|lot'), its status line, and its two buttons ('<site>|lot|<state>').
const lotRow = (page, siteId) => page.locator('[data-walkrow="' + siteId + '|lot"]');
const lotLine = (page, siteId) => lotRow(page, siteId).locator('.lot-line');
const lotBtn = (page, siteId, state) => page.locator('[data-send="' + siteId + '|lot|' + state + '"]');
const phoneState = (page) => page.evaluate(() => SnowShiftUI.state());
// Another visibilitychange = the app coming back on screen = one poll now.
const pollNow = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
// The app mirrors what is open onto the browser history (the phone's Back button) and pops it
// with history.go(), which answers later. Before a second page.goto in one test, wait for that
// pop to land: with nothing open, the app's own stack is empty.
const backSettled = (page) => page.waitForFunction(() => !((history.state && history.state.snow) || []).length);
// Matt and the leads land on the live view; tapping a route opens it as the crew see it.
const openRoute = async (page, id) => { await page.locator('[data-openroute="' + id + '"]').click(); await expect(page.locator('#liveBack')).toBeVisible(); };

// ---- the lot card (Plow Command, 10/21/26): name, address, plow note, Plowed and Problem, the status line ----
test('storm tab: a site card shows Plowed and Problem and the plow note', async ({ page }) => {
  // Jordan's own route N1 is PAC alone. PAC has two piles drawn and still one Lot: two buttons, Plowed then Problem
  // (CrewShiftLog.statesFor('lot') order). The plow note sits under the address; TUDOR-TRANSIT has none, so no line.
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, address: '4001 TUDOR CENTRE' } : s));
  await openStorm(page, w);
  const site = page.locator('[data-shiftsite="S1"]');
  await expect(site.locator('.site-name')).toContainText('PAC');
  await expect(site.locator('.site-addr')).toHaveText('4001 TUDOR CENTRE');
  await expect(site.locator('.plow-note')).toHaveText(PLOW_NOTE);
  expect((await site.locator('.plow-note').boundingBox()).y).toBeGreaterThan((await site.locator('.site-addr').boundingBox()).y);
  expect(await idsOf(page, 'data-walkrow')).toEqual(['S1|lot']);   // one lot, the piles are not walks
  expect(await site.locator('[data-send]').evaluateAll((els) => els.map((e) => [e.dataset.send, e.textContent])))
    .toEqual([['S1|lot|plowed', 'Plowed'], ['S1|lot|problem', 'Problem']]);
  await expect(lotLine(page, 'S1')).toHaveCount(0);                 // nothing tapped: no status line
  await page.click('#otherRoutes');
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible();         // a site with nothing drawn: the same Lot
  await expect(page.locator('[data-shiftsite="S2"] .plow-note')).toHaveCount(0);
});

test('storm tab: tapping Plowed sends zone_id lot and state plowed, the card reads Plowed 7:50 AM by Jordan Demo', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await lotBtn(page, 'S1', 'plowed').click();
  // The fake stamps the row 7:50 AM (07:50:18 Alaska): the line is the state, the time, then who.
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  expect(tapCalls(calls)).toHaveLength(1);
  const body = tapCalls(calls)[0].body;
  expect(body).toMatchObject({ action: 'tapZone', site_id: 'S1', zone_id: 'lot', state: 'plowed', note: '' });
  // The server knows who and when and which shift: the phone sends none of it.
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'shift_id', 'storm_id', 'seq']) expect(body).not.toHaveProperty(k);
  await expect(lotBtn(page, 'S1', 'plowed')).toHaveAttribute('aria-pressed', 'true');
  await expect(lotBtn(page, 'S1', 'problem')).toHaveAttribute('aria-pressed', 'false');
  await expect(lotRow(page, 'S1').locator('[data-undo="1"]')).toBeVisible();
});

test('storm tab: Problem asks for a note; blank (spaces) is refused with the message; a note sends', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await lotBtn(page, 'S1', 'problem').click();
  const box = page.locator('[data-note="S1|lot"]'), err = lotRow(page, 'S1').locator('.note-err');
  await expect(box).toBeVisible();
  expect(tapCalls(calls)).toHaveLength(0);                 // opening the box sent nothing
  await page.click('[data-savenote="S1|lot"]');            // nothing typed
  await expect(err).toHaveText('A problem needs a note');
  await box.fill('   ');                                    // spaces are blank too
  await expect(err).toHaveCount(0);                        // typing takes the old message away
  await page.click('[data-savenote="S1|lot"]');
  await expect(err).toHaveText('A problem needs a note');
  await expect(box).toBeVisible();                         // the box stays open for the note
  await page.waitForTimeout(300);
  expect(tapCalls(calls)).toHaveLength(0);                 // refused on the phone: nothing went
  await box.fill('gate locked');
  await page.click('[data-savenote="S1|lot"]');
  await expect(lotLine(page, 'S1')).toHaveText('Problem 7:50 AM by Jordan Demo');
  await expect(lotRow(page, 'S1').locator('.walk-note')).toHaveText('— gate locked');
  expect(tapCalls(calls)).toHaveLength(1);
  expect(tapCalls(calls)[0].body).toMatchObject({ site_id: 'S1', zone_id: 'lot', state: 'problem', note: 'gate locked' });
  await expect(box).toHaveCount(0);                        // the box closes once it is saved
  await expect(err).toHaveCount(0);
  await expect(lotBtn(page, 'S1', 'problem')).toHaveAttribute('aria-pressed', 'true');
});

test('storm tab: two fast taps send once (busy key)', async ({ page }) => {
  // Apps Script takes a second or two. The busy key is the site's lot ('S1|lot'): a second tap on PAC while the first
  // is on its way sends nothing, whichever button; a tap on another site is not held up by it.
  const calls = await openStorm(page, stormWorld(), { delay: { tapZone: 700 } });
  await page.click('#otherRoutes');
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible();
  await page.evaluate(() => {
    const b = document.querySelector('[data-send="S1|lot|plowed"]');
    b.click(); b.click();
    document.querySelector('[data-send="S2|lot|plowed"]').click();
  });
  await expect(lotRow(page, 'S1')).toHaveAttribute('aria-busy', 'true');
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await expect(lotLine(page, 'S2')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  // One for PAC, one for TUDOR-TRANSIT: three taps, two sends, two rows.
  expect(tapCalls(calls).map((c) => c.body.site_id).sort()).toEqual(['S1', 'S2']);
  expect((await phoneState(page)).log).toHaveLength(2);
});

test('storm tab: Undo sends the seq and the lot goes back to what the row before it said', async ({ page }) => {
  // Alex plowed PAC (seq 1, 6:30). Jordan then marked a Problem, "gate locked" (seq 2, 6:40). Undoing seq 2 gives back
  // what row 1 said: plowed, no note. The fake writes that as a NEW row (seq 3, by Jordan, who undid it, at 7:50).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test'),
    logRow(2, 'S1', 'lot', 'problem', 'Jordan Demo', { by_key: 'C03', note: 'gate locked', at: '2026-10-03T06:40:00.000-08:00' })];
  const calls = await openStorm(page, w);
  await expect(lotLine(page, 'S1')).toHaveText('Problem 6:40 AM by Jordan Demo');
  await expect(page.locator('[data-undo]')).toHaveCount(1);       // only the newest row on the lot
  await page.click('[data-undo="2"]');
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await expect(lotRow(page, 'S1').locator('.walk-note')).toHaveCount(0);
  const undo = calls.filter((c) => c.body.action === 'undoTap');
  expect(undo.map((c) => c.body.seq)).toEqual([2]);
  expect(w.log.map((r) => [r.seq, r.zone_id, r.state, r.note, r.undoes])).toEqual([[1, 'lot', 'plowed', '', null], [2, 'lot', 'problem', 'gate locked', null], [3, 'lot', 'plowed', '', 'L-2']]);
  await expect(page.locator('[data-undo="3"]')).toBeVisible();  // the new newest row can be undone in turn
  await expect(page.locator('[data-undo="2"]')).toHaveCount(0);
});

test('storm tab: an off-route site tapped from Other routes lands flagged', async ({ page }) => {
  // The live Board has Jordan on N1 (PAC), as the post does. He plows PAC (his route: not flagged), then opens Other
  // routes and plows TUDOR-TRANSIT (N2's: off route). The server flags it and saves it, never refuses it; Matt's
  // live view then names who tapped off route, beside that site only.
  const w = stormWorld();
  w.moves = [{ id: 'M1', at: '2026-10-02T17:00:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];
  const calls = await openStorm(page, w);
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await page.click('#otherRoutes');
  await lotBtn(page, 'S2', 'plowed').click();
  await expect(lotLine(page, 'S2')).toHaveText('Plowed 7:50 AM by Jordan Demo');   // saved, not refused
  expect(tapCalls(calls)).toHaveLength(2);
  expect(w.log.map((r) => [r.site_id, r.state, r.off_route])).toEqual([['S1', 'plowed', false], ['S2', 'plowed', true]]);
  const matt = await page.context().newPage();
  await openStorm(matt, w, { token: 'tok-matt' });
  await expect(matt.locator('[data-livesite="S2"] .offroute')).toHaveText('off-route');
  await expect(matt.locator('[data-livesite="S2"]')).toContainText('off-route Jordan Demo');
  await expect(matt.locator('[data-livesite="S1"] .offroute')).toHaveCount(0);
});

test('storm tab: a plowed site fades', async ({ page }) => {
  // PAC untapped: full strength. Plowed: the card fades (class done), but only its words: the name, the plow note
  // and the status line. Everything a driver may still need to press or read stays full strength: Plowed, Problem,
  // Undo, and a Problem box opened on the plowed lot, its refusal line included (ruling, fix round 1). A Problem
  // after it: not done (a problem lot still needs plowing), so full strength again.
  // seen(): the opacity the eye gets, the element's own times every ancestor's (CSS opacity multiplies down).
  const seen = (loc) => loc.evaluate((e) => { let o = 1; for (let n = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; });
  await openStorm(page, stormWorld());
  const site = page.locator('[data-shiftsite="S1"]');
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  await expect(site).not.toHaveClass(/(^|\s)done(\s|$)/);
  expect(await seen(site.locator('.site-name'))).toBe(1);
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(site).toHaveClass(/(^|\s)done(\s|$)/);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  expect(await seen(site.locator('.site-name'))).toBeLessThan(1);
  expect(await seen(site.locator('.plow-note'))).toBeLessThan(1);
  expect(await seen(lotLine(page, 'S1'))).toBeLessThan(1);
  for (const loc of [lotBtn(page, 'S1', 'plowed'), lotBtn(page, 'S1', 'problem'), site.locator('[data-undo]')]) expect(await seen(loc)).toBe(1);
  // The Problem box on the plowed lot, and its refusal: full strength.
  await lotBtn(page, 'S1', 'problem').click();
  await page.click('[data-savenote="S1|lot"]');
  await expect(site.locator('.note-err')).toHaveText('A problem needs a note');
  await expect(site).toHaveClass(/(^|\s)done(\s|$)/);             // still plowed: the box is open on a faded card
  for (const sel of ['[data-note="S1|lot"]', '.note-err', '[data-savenote="S1|lot"]', '[data-cancelnote="S1|lot"]']) expect(await seen(site.locator(sel)), sel).toBe(1);
  await page.fill('[data-note="S1|lot"]', 'cars in the lot');
  await page.click('[data-savenote="S1|lot"]');
  await expect(lotLine(page, 'S1')).toHaveText('Problem 7:50 AM by Jordan Demo');
  await expect(site).not.toHaveClass(/(^|\s)done(\s|$)/);
  expect(await seen(site.locator('.site-name'))).toBe(1);
  expect(await seen(lotLine(page, 'S1'))).toBe(1);
});

// Review fix round 1: a driver taps Plowed by mistake and, while it is still sending, taps Problem, types and saves.
// The lot is busy (its key is in flight), so the Problem cannot go yet: it must not vanish either.
test('storm tab: a Problem saved while Plowed is still sending is kept: the box says so, keeps the note, and Save sends it after', async ({ page }) => {
  // The Plowed reply is held 2 s (the brief's 700 ms, made roomier so a slow machine still fits the three steps in it).
  // Save inside that window: nothing is sent (one tapZone, the Plowed), the box stays with "gate locked" and says why.
  // Plowed lands (the card reads Plowed, 7:50 by Jordan): the box and its note are still there, the message gone with
  // the tap it was about. Save again: the Problem goes, with its note, and only then the box closes.
  const calls = await openStorm(page, stormWorld(), { delay: { tapZone: 2000 } });
  const box = page.locator('[data-note="S1|lot"]'), msg = lotRow(page, 'S1').locator('.note-err');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotRow(page, 'S1')).toHaveAttribute('aria-busy', 'true');
  await lotBtn(page, 'S1', 'problem').click();
  await box.fill('gate locked');
  await page.click('[data-savenote="S1|lot"]');
  await expect(msg).toHaveText('Still sending the last tap. Save again in a moment.');
  await expect(lotRow(page, 'S1')).toHaveAttribute('aria-busy', 'true'); // the message came while Plowed was still out
  expect(tapCalls(calls).map((c) => c.body.state)).toEqual(['plowed']);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await expect(box).toHaveValue('gate locked');
  await expect(msg).toHaveCount(0);
  expect(tapCalls(calls).map((c) => c.body.state)).toEqual(['plowed']); // still nothing more sent
  await page.click('[data-savenote="S1|lot"]');
  await expect(lotLine(page, 'S1')).toHaveText('Problem 7:50 AM by Jordan Demo');
  await expect(lotRow(page, 'S1').locator('.walk-note')).toHaveText('— gate locked');
  expect(tapCalls(calls).map((c) => [c.body.state, c.body.note])).toEqual([['plowed', ''], ['problem', 'gate locked']]);
  await expect(box).toHaveCount(0);
});

// Part A (Matt, 10/4/26): tonight's posted Board decides what a phone offers;
// the server's live Board stays the authority.
const boardPost = (r1, r2) => ({ ...POST, shift: 'night-2026-10-02', routes: [
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: null, members: [], ...r2 },
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: null, members: [], ...r1 }] });

test('off the posted Board: the Storm tab is read-only and says why', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ lead: 'C01' }, {})]; // Jordan is not on it
  w.log = [logRow(2, 'S1', 'lot', 'plowed', 'Alex Test')];
  await openStorm(page, w);
  await expect(page.locator('main')).toContainText("You're not on tonight's posted Board.");
  await expect(page.locator('main')).toContainText('You can see the routes, but not mark lots. If you were just added to the crew, ask the dispatcher to Post again.');
  await expect(page.locator('main')).not.toContainText('mark walks'); // Plow Command has lots, not walks (Matt, 10/21/26)
  await expect(page.locator('main')).not.toContainText('If Matt just added you');
  await expect(page.locator('main')).not.toContainText('sign out and back in'); // signing out cannot put a person on a Post
  await page.click('#otherRoutes');
  await expect(page.locator('main')).toContainText('PAC');
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 6:30 AM by Alex Test'); // who did what still shows
  await expect(page.locator('[data-send]')).toHaveCount(0);
  await expect(page.locator('[data-undo]')).toHaveCount(0);
  await expect(page.locator('[data-card]')).toHaveCount(0);
});

test('no post yet: the crew still get the lot buttons, and the server decides', async ({ page }) => {
  const w = stormWorld();
  w.posts = [];
  await openStorm(page, w);
  await page.click('#otherRoutes');
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
});

test('a Board lead who is crew on the roster gets the driver\'s storm switch, in Matt\'s words, and no Close storm', async ({ page }) => {
  // Final wave I1 (spec sections 4 and 5): the truck's driver has the Snowing/Stopped switch; Close storm is the dispatcher's.
  // M7: the Stopped button reads "Snow stopped", nothing more.
  const w = stormWorld();
  w.posts = [boardPost({ lead: 'C03' }, {})]; // Jordan (is_lead false) leads N1 tonight
  await openStorm(page, w);
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('[data-storm="stopped"]')).toHaveText('Snow stopped');
  await expect(page.locator('[data-storm="snowing"]')).toHaveText('Snowing');
  await expect(page.locator('[data-storm="end"]')).toHaveCount(0);
  await expect(page.locator('[data-storm="night_on"]')).toHaveCount(0);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
});

test('a roster lead who is not on the posted Board gets no storm controls', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ members: ['C03'] }, {})]; // Alex (is_lead true) is on no route tonight
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  await expect(page.locator('main')).toContainText("You're not on tonight's posted Board.");
});

// Review fix (10/4/26): Matt posts Jordan as N1's lead while Jordan has the Storm tab open.
// The 60 s post check redraws the tab, and the controls follow the new post, no reopen needed.
test('a new post that makes you lead brings the storm controls without reopening the tab', async ({ page }) => {
  const w = stormWorld();
  w.posts = [boardPost({ members: ['C03'] }, {})]; // Jordan rides N1
  await openStorm(page, w);
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  w.posts = [{ ...boardPost({ lead: 'C03' }, {}), id: 'P2', posted_at: '2026-10-03T15:30:00.000Z' }];
  await page.clock.runFor(60000); // three 20 s ticks: the third re-reads the post
  await expect(page.locator('#stormctl')).toBeVisible();
});


// Matt 10/4/26: short site codes ("PH", "PG") are unreadable, even to Matt. Every list shows the
// address beside the code; the name itself stays the code the crew know.
test('short site names show their address on the Routes tab, in the route editor and on the Storm tab', async ({ page }) => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => ({ ...s, address: s.id === 'S1' ? '4001 TUDOR CENTRE' : '3600 MLK' }));
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: [] }];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="routes"]');
  await expect(page.locator('.sitelist li').first()).toContainText('PAC');
  await expect(page.locator('.sitelist li').first()).toContainText('4001 TUDOR CENTRE');
  await page.click('[data-edit="route:R2"]');
  await expect(page.locator('#r_add option[value="S1"]')).toHaveText('PAC · 4001 TUDOR CENTRE');
  await page.click('#dlgClose');
  // Closing the editor pops its Back step with history.go(-1), which lands later; a goto
  // started before it lands is cancelled (net::ERR_ABORTED, 10/9/26). Wait for the stack to settle.
  await backSettled(page);
  await openStorm(page, w);
  await expect(page.locator('.shift-site').first()).toContainText('4001 TUDOR CENTRE');
});

// Matt 10/4/26: the Sites tab groups by customer so the hospital sites sit together. A site with
// no customer yet goes last, under its own heading; nothing is guessed.
test('the Sites tab groups sites by customer, and the site form edits it', async ({ page }) => {
  const w = world();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1, customer: 'ANTHC' }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 },
    { id: 'S3', name: 'APMB', rev: 1, customer: 'ANTHC' }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="sites"]');
  expect(await page.locator('.site-group').allTextContents()).toEqual(['ANTHC', 'No customer yet']);
  expect(await page.locator('.site-card').evaluateAll((els) => els.map((e) => e.dataset.site))).toEqual(['S3', 'S1', 'S2']);
  await page.click('[data-edit="site:S2"]');
  await expect(page.locator('#s_cust')).toHaveValue('');
  await page.fill('#s_cust', 'MOA');
  await page.click('#s_save');
  await expect.poll(() => calls.filter((c) => c.body.action === 'saveSite').length).toBe(1);
  expect(calls.find((c) => c.body.action === 'saveSite').body.record.customer).toBe('MOA');
});

// Callouts and day ranking (Part B2, Matt 10/4/26): two numbers Matt decides per site, so they ship
// blank and blank is sent as null, never 0. PAC (S1) is a site saved before this work: it has no
// callout_in or day_rank key at all, and its boxes must read empty, never "undefined".
test('the site form sets a callout depth and a day rank, sent as numbers; blank sends null', async ({ page }) => {
  const w = world();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'CALLOUT-TEST', rev: 1, callout_in: 1.5, day_rank: 3 }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  const saves = () => calls.filter((c) => c.body.action === 'saveSite');
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('label[for="s_callout"]')).toHaveText('Callout depth (inches), blank = no nudge');
  await expect(page.locator('label[for="s_rank"]')).toHaveText('Day rank (1 = first on day shift), blank = by choice');
  await expect(page.locator('#s_callout')).toHaveValue('');
  await expect(page.locator('#s_rank')).toHaveValue('');
  await page.fill('#s_callout', '1');
  await page.fill('#s_rank', '2');
  await page.click('#s_save');
  await expect.poll(() => saves().length).toBe(1);
  expect(saves()[0].body.record.callout_in).toBe(1);   // the number 1, never the text '1'
  expect(saves()[0].body.record.day_rank).toBe(2);
  // Reopened: the stored values are in the boxes. Cleared: both are sent as null (the key is there).
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_callout')).toHaveValue('1');
  await expect(page.locator('#s_rank')).toHaveValue('2');
  await page.fill('#s_callout', '');
  await page.fill('#s_rank', '');
  await page.click('#s_save');
  await expect.poll(() => saves().length).toBe(2);
  expect(saves()[1].body.record).toHaveProperty('callout_in', null);
  expect(saves()[1].body.record).toHaveProperty('day_rank', null);
  await page.click('[data-edit="site:S2"]');
  await expect(page.locator('#s_callout')).toHaveValue('1.5');
  await expect(page.locator('#s_rank')).toHaveValue('3');
  // Something that is not a number is sent as typed: the server refuses it in its own words.
  await page.fill('#s_callout', 'abc');
  await page.fill('#s_rank', '2.5');
  await page.click('#s_save');
  await expect.poll(() => saves().length).toBe(3);
  expect(saves()[2].body.record.callout_in).toBe('abc');
  expect(saves()[2].body.record.day_rank).toBe(2.5);
  await expect(page.locator('#s_err')).toHaveText('Callout depth is inches, more than 0 and at most 24; Day rank is a whole number from 1 to 99');
});

test('crew see their own route\'s lot first and other routes behind a button', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  // Own route N1 only: PAC, one Lot (its two piles are drawings, never walks).
  await expect(page.locator('.shift-site')).toHaveCount(1);
  await expect(page.locator('.shift-site')).toContainText('PAC');
  expect(await idsOf(page, 'data-walkrow')).toEqual(['S1|lot']);
  await expect(page.locator('[data-send^="S2|"]')).toHaveCount(0);   // N2 is not Jordan's
  await expect(page.locator('main')).not.toContainText('TUDOR-TRANSIT');
  await page.click('#otherRoutes');
  await expect(page.locator('main')).toContainText('TUDOR-TRANSIT');
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible();
});

test('no signal: the lot says not saved and Retry sends it', async ({ page }) => {
  const net = { down: true };
  const calls = await openStorm(page, stormWorld(), { abortIf: (b) => net.down && b.action === 'tapZone' });
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotRow(page, 'S1')).toContainText('Not saved: no signal');
  await expect(page.locator('[data-retry="S1|lot"]')).toBeVisible();
  await expect(lotLine(page, 'S1')).toHaveCount(0); // nothing is shown as plowed
  await expect(page.locator('[data-shiftsite="S1"]')).not.toHaveClass(/(^|\s)done(\s|$)/);
  net.down = false;
  await page.click('[data-retry="S1|lot"]');
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await expect(page.locator('[data-retry]')).toHaveCount(0);
  // The first try and the retry are the same tap.
  expect(tapCalls(calls)).toHaveLength(2);
  expect(tapCalls(calls)[1].body).toMatchObject({ site_id: 'S1', zone_id: 'lot', state: 'plowed', note: '' });
});

test('no signal on a Problem: Retry sends the same note', async ({ page }) => {
  // The note goes with the Retry: the failed request is kept whole, not rebuilt from a box that has closed.
  const net = { down: true };
  const calls = await openStorm(page, stormWorld(), { abortIf: (b) => net.down && b.action === 'tapZone' });
  await lotBtn(page, 'S1', 'problem').click();
  await page.fill('[data-note="S1|lot"]', 'gate locked');
  await page.click('[data-savenote="S1|lot"]');
  await expect(lotRow(page, 'S1')).toContainText('Not saved: no signal');
  net.down = false;
  await page.click('[data-retry="S1|lot"]');
  await expect(lotLine(page, 'S1')).toHaveText('Problem 7:50 AM by Jordan Demo');
  expect(tapCalls(calls).map((c) => [c.body.state, c.body.note])).toEqual([['problem', 'gate locked'], ['problem', 'gate locked']]);
});

// Part A review minor (10/6/26): a tap refused because the person is not on tonight's Board was
// offered Retry, which can only be refused again. The reason shows; Retry does not.
test("a tap refused as not allowed shows why, with no Retry", async ({ page }) => {
  const fake = fakeSnow(stormWorld());
  const NOT_ON = "You're not on tonight's Board. Ask the dispatcher to add you.";
  await open(page, { token: 'tok-jordan', clockAt: STORM_CLOCK,
    snow: (b) => b.action === 'tapZone' ? { ok: false, code: 'forbidden', reason: NOT_ON, version: 'handoff-1' } : fake(b) });
  await page.click('nav [data-tab="storm"]');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotRow(page, 'S1')).toContainText('Not saved: ' + NOT_ON);
  await expect(page.locator('[data-retry]')).toHaveCount(0);
});

test('with no storm open the tap is refused and says so', async ({ page }) => {
  // Matt ends the storm while Jordan's screen is open: the phone has not heard yet.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotRow(page, 'S1')).toContainText('Not saved: No storm is open');
  await expect(lotLine(page, 'S1')).toHaveCount(0);
  expect(w.log || []).toHaveLength(0); // nothing was written
  // The refusal also makes the phone ask again, so the banner catches up.
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  expect(shiftCalls(calls).length).toBeGreaterThanOrEqual(2);
});

test('a poll and a tap carrying the same row show it once', async ({ page }) => {
  // Jordan taps (the fake writes L-1, seq 1) before his phone's cursor moves, so
  // the next poll (cursor 0) carries L-1 again. Then Alex marks a Problem on the same lot
  // (L-2, seq 2) and the next poll carries only that. Worked by hand:
  // rows after the tap [L-1]; after poll 2 still [L-1]; after poll 3 [L-1, L-2].
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // first poll answered
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(1); // poll 2 has been merged
  const s = await phoneState(page);
  expect(shiftCalls(calls)[1].body.cursor.log).toBe(0);      // it did ask from 0, so it was handed L-1 again
  expect(s.log.map((r) => r.id)).toEqual(['L-1']);          // once
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  w.log.push(logRow(2, 'S1', 'lot', 'problem', 'Alex Test', { note: 'cars in the lot' }));
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(2);
  expect((await phoneState(page)).log.map((r) => r.id)).toEqual(['L-1', 'L-2']);
  await expect(lotLine(page, 'S1')).toHaveText('Problem 6:30 AM by Alex Test');
  expect(w.log).toHaveLength(2);
});

test('the phone asks only for rows after its cursor', async ({ page }) => {
  // The fake holds 2 log rows and 1 storm row, no visits. First ask: from zero.
  // The reply says how many rows each tab has (2, 1, 0); the second ask carries
  // that back, plus the seq of the last row it got per tab (2, 1, none).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test'), logRow(2, 'S2', 'lot', 'plowed', 'Alex Test')];
  const calls = await openStorm(page, w);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 6:30 AM by Alex Test');
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  const [first, second] = shiftCalls(calls).map((c) => c.body);
  // Trucks and Sheets (route sheets) are two more tabs on the same cursor; this fake has none of either.
  // Posts ride the cursor too (Matt's only: Jordan's poll gets none, cursor 0); they have no seq, so no `last`.
  expect(first.cursor).toEqual({ log: 0, storms: 0, visits: 0, trucks: 0, sheets: 0, posts: 0 });
  expect(second.cursor).toEqual({ log: 2, storms: 1, visits: 0, trucks: 0, sheets: 0, posts: 0 });
  expect(second.last).toEqual({ log: 2, storms: 1, visits: null, trucks: null, sheets: null });
  await expect.poll(async () => (await phoneState(page)).cursor.log).toBe(2);
  expect((await phoneState(page)).log.map((r) => r.id)).toEqual(['L-1', 'L-2']); // nothing came twice
});

test('rows kept out of seq order in the Sheet do not make every poll reset', async ({ page }) => {
  // Matt hand-sorted the Log tab: the sheet holds [L-2, L-1] in that physical
  // order. The server checks the row at the cursor POSITION (the 2nd row, L-1),
  // so after the first poll the phone must say last = 1 (the last row it was
  // handed, in the order it was handed), not 2 (the highest seq). Saying 2
  // would mismatch row 2's seq 1: reset:true with the whole tab, every 20 s.
  const w = stormWorld();
  w.log = [logRow(2, 'S1', 'lot', 'problem', 'Alex Test', { note: 'gate locked' }), logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];
  const replies = [];
  page.on('response', async (res) => {
    if (!isSnow(new URL(res.url()))) return;
    try { const j = await res.json(); if (j.reset) replies.push(j); } catch (e) { /* not ours */ }
  });
  const calls = await openStorm(page, w);
  await expect(lotLine(page, 'S1')).toHaveText('Problem 6:30 AM by Alex Test'); // seq 2 is the newest row, wherever it sits
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  expect(shiftCalls(calls)[1].body.cursor.log).toBe(2);
  expect(shiftCalls(calls)[1].body.last.log).toBe(1);
  await expect.poll(() => replies.length).toBe(2);
  expect(replies[1].reset.log).toBe(false);
  expect(replies[1].log).toEqual([]);
});

test('polling runs only on the Storm tab, and only while the page is visible', async ({ page }) => {
  const calls = await openStorm(page, stormWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(shiftCalls(calls)).toHaveLength(1);
  // Another tab: the timer is gone. Three ticks' worth of time asks nothing.
  await page.click('nav [data-tab="tonight"]');
  await page.clock.runFor(60000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(1);
  // Back on Storm: one poll at once, and the timer runs again (one tick = one more).
  await page.click('nav [data-tab="storm"]');
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  // Page hidden (phone locked): the timer ticks but asks nothing.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(60000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(2);
  // Visible again: exactly one poll, straight away.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => shiftCalls(calls).length).toBe(3);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(3);
});

test('polling stops on an expired session and shows sign-in', async ({ page }) => {
  const expired = { on: false };
  const calls = await openStorm(page, stormWorld(), { fake: { expired } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expired.on = true;
  await page.clock.runFor(20000); // the 20 s timer fires one poll; the server says the session is gone
  await expect(page.locator('#signin')).toBeVisible();
  await expect(page.locator('#si_err')).toContainText('Sign in again');
  const before = shiftCalls(calls).length; // the first poll plus the one that was refused: 2
  expect(before).toBe(2);
  await page.clock.runFor(60000);          // three more timer ticks' worth of time
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(before);
});

test('a reset reply replaces the phone\'s rows', async ({ page }) => {
  // The phone has seen 3 rows (cursor 3). Then rows are deleted by hand in the
  // Sheet: only L-1 is left. The cursor (3) is past the tab (1 row), so the
  // server answers every row with reset: true. PAC's Problem (L-2) and
  // TUDOR-TRANSIT's plowed row (L-3) must go from the phone; PAC's plowed row (L-1) stays.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test'), logRow(2, 'S1', 'lot', 'problem', 'Alex Test', { note: 'gate locked', at: '2026-10-03T06:40:00.000-08:00' }),
    logRow(3, 'S2', 'lot', 'plowed', 'Alex Test')];
  await openStorm(page, w);
  await expect(lotLine(page, 'S1')).toHaveText('Problem 6:40 AM by Alex Test');
  expect((await phoneState(page)).cursor.log).toBe(3);
  w.log = [w.log[0]];
  await pollNow(page);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 6:30 AM by Alex Test');
  const s = await phoneState(page);
  expect(s.log.map((r) => r.id)).toEqual(['L-1']);
  expect(s.cursor.log).toBe(1);
});

test('the banner says whether it is snowing, or that no storm is open', async ({ page }) => {
  const w = stormWorld();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'snowing', storm_id: 'ST-1', at: '2026-10-03T06:10:00.000-08:00', by_name: 'Matthew' });
  await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
});

test('with no storm row at all the banner says no storm is open', async ({ page }) => {
  const w = stormWorld(); w.storms = [];
  await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
});

test('Matt lands on the live view, and opens any route to tap its lots', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  // The live view shows no lot buttons: a route opens on tap (Task 6).
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  await expect(page.locator('[data-send]')).toHaveCount(0);
  await openRoute(page, 'R2');
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible();
  await expect(lotBtn(page, 'S1', 'plowed')).toHaveCount(0); // that route only
  await expect(page.locator('#otherRoutes')).toHaveCount(0);
  await lotBtn(page, 'S2', 'plowed').click();
  await expect(lotLine(page, 'S2')).toHaveText('Plowed 7:50 AM by Matthew');
  expect(tapCalls(calls)).toHaveLength(1);
  expect(w.log[0].off_route).toBe(false); // Matt covers anywhere: never flagged
  // Back to the live view: N2's one lot is plowed, and the site says so.
  await page.click('#liveBack');
  await expect(page.locator('[data-liveroute="R2"] .live-count')).toHaveText('1 of 1 lots');
  await expect(page.locator('[data-livesite="S2"] .live-status')).toHaveText('Plowed');
  await expect(page.locator('[data-send]')).toHaveCount(0);
});

test('crew still land on Tonight, with a Storm tab beside it', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible();
  await expect(page.locator('nav [data-tab="storm"]')).toBeVisible();
});

// ---------------- the Storm tab: the site card ----------------
// Replaces the paper route sheet's per-site fields: depth, materials used,
// equipment minutes. Start and finish are never typed: they are the first and
// last tap at the site this shift (CrewShiftLog.siteTimes). Same 7:30 AM clock
// as above, so the shift is "night-2026-10-02" and the fake files cards there.
const EQUIP = ['blower', 'snowrator', 'bobcat', 'sweepster'];
const visitRow = (n, siteId, byKey, byName, extra = {}) => ({ id: 'V-' + n, seq: n, storm_id: 'ST-1', shift_id: 'night-2026-10-02',
  site_id: siteId, by_key: byKey, by_name: byName, at: '2026-10-03T06:45:00.000-08:00', depth_in: '', materials_used: '',
  equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '' }, ...extra });
const cardBtn = (page, id) => page.locator('[data-card="' + id + '"]');
const visitCalls = (calls) => calls.filter((c) => c.body.action === 'saveVisit');
const openCard = async (page, id) => { await cardBtn(page, id).click(); await expect(page.locator('#dlg')).toBeVisible(); };

// Copy for BT (Matt, 10/3/26): the lead copies the text and posts it in BuilderTrend
// as themselves. The app never talks to BT; this only fills the clipboard.
const stubClipboard = (page) => page.addInitScript(() => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
});
test('the lead copies a site\'s BT note and sees the times to type', async ({ page }) => {
  // PAC: a Problem "cars in the lot" at 6:30 AM, then plowed at 6:45 AM, both this shift (night of 10/2, clock 7:30 AM).
  // The lot stands at plowed: "Plowed." Time in 6:30 AM (the first tap), out 6:45 AM (the last).
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'problem', 'Alex Test', { note: 'cars in the lot', at: '2026-10-03T06:30:00.000-08:00' }),
    logRow(2, 'S1', 'lot', 'plowed', 'Alex Test', { at: '2026-10-03T06:45:00.000-08:00' })];
  await stubClipboard(page);
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  // The lead's Storm tab is the driver's (final wave I1): his posted route, PAC on it, with no live view to open it from.
  await page.locator('[data-bt="S1"]').click();
  await expect(page.locator('#bt_in')).toHaveText('6:30 AM');
  await expect(page.locator('#bt_out')).toHaveText('6:45 AM');
  await expect(page.locator('#bt_text')).toHaveValue('Plowed.');
  await page.click('#bt_copy');
  await expect(page.locator('#toast')).toContainText('Copied');
  expect(await page.evaluate(() => window.__copied)).toEqual(['Plowed.']);
  // Nothing is sent anywhere: copying makes no server call.
  expect(calls.filter((c) => !['bootstrap', 'getShiftLog', 'getPost', 'getZones'].includes(c.body.action))).toEqual([]);
});
test('crew have no Copy for BT button; Matt does', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(lotRow(page, 'S1')).toBeVisible();
  await expect(page.locator('[data-bt]')).toHaveCount(0);
});
test('Matt sees Copy for BT on a route he opens', async ({ page }) => {
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await expect(page.locator('[data-bt="S1"]')).toBeVisible();
});

// The site card's machines are the units stationed at the site (final wave M7, spec section 4): PAC carries a Snowrator and a
// Bobcat in these tests, so its card asks for those two, in card order, and never a Blower or a Sweepster.
const stationed = (w) => { w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, units: { bobcat: 'B-7', snowrator: 'SR-2' } } : s)); return w; };
test('the site card sends depth, materials and ticked equipment minutes only', async ({ page }) => {
  const w = stationed(stormWorld());
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  expect(await page.locator('[data-eq]').evaluateAll((els) => els.map((e) => e.dataset.eq))).toEqual(['snowrator', 'bobcat']);
  // Minutes cannot be typed until the machine is ticked.
  await expect(page.locator('[data-eqmin="bobcat"]')).toBeDisabled();
  await page.fill('#vc_depth', '3.5');
  await page.fill('#vc_mat', 'salt, 2 bags');
  await page.check('[data-eq="bobcat"]');
  await expect(page.locator('[data-eqmin="bobcat"]')).toBeEnabled();
  await page.fill('[data-eqmin="bobcat"]', '45');
  // Ticked, typed, then unticked: the minutes are not sent.
  await page.check('[data-eq="snowrator"]');
  await page.fill('[data-eqmin="snowrator"]', '99');
  await page.uncheck('[data-eq="snowrator"]');
  await expect(page.locator('[data-eqmin="snowrator"]')).toBeDisabled();
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  const body = visitCalls(calls)[0].body;
  // Worked out: 3.5 in; the text as typed; bobcat 45; snowrator unticked = blank; blower and sweepster not on the card = blank.
  expect(body).toMatchObject({ action: 'saveVisit', site_id: 'S1', depth_in: 3.5, materials_used: 'salt, 2 bags',
    equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' } });
  expect(Object.keys(body.equipment).sort()).toEqual([...EQUIP].sort());
  // The server knows who, when and which shift: the phone sends none of it, nor start/finish.
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'shift_id', 'storm_id', 'seq', 'start', 'finish']) expect(body).not.toHaveProperty(k);
  expect(w.visits).toHaveLength(1);
  expect((await phoneState(page)).visits.map((r) => r.id)).toEqual(['V-1']);
});

test('blank fields are sent blank, never 0', async ({ page }) => {
  const w = stationed(stormWorld());
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  // Nothing typed, nothing ticked: depth, materials and every machine go as ''.
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const first = visitCalls(calls)[0].body;
  expect(first.depth_in).toBe('');
  expect(first.materials_used).toBe('');
  expect(first.equipment).toEqual({ blower: '', snowrator: '', bobcat: '', sweepster: '' });
  // A typed zero is a real answer and is sent as 0.
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '0');
  await page.check('[data-eq="snowrator"]');
  await page.fill('[data-eqmin="snowrator"]', '0');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const second = visitCalls(calls)[1].body;
  expect(second.depth_in).toBe(0);
  expect(second.equipment).toEqual({ blower: '', snowrator: 0, bobcat: '', sweepster: '' });
  expect(second.materials_used).toBe('');
});

test('a ticked machine needs minutes before it saves', async ({ page }) => {
  // Ticking says "this machine was used"; saved blank, the tick would be lost on reopening.
  // Snowrator ticked with no minutes, Bobcat also ticked with none: the first (Snowrator, in card order) is named.
  const w = stationed(stormWorld());
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  await page.check('[data-eq="bobcat"]');
  await page.check('[data-eq="snowrator"]');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('Add minutes for Snowrator, or untick it');
  await expect(page.locator('#dlg')).toBeVisible();
  expect(visitCalls(calls)).toHaveLength(0);
  expect(w.visits || []).toHaveLength(0);
  // Snowrator filled in: now Bobcat is the one named, still nothing sent.
  await page.fill('[data-eqmin="snowrator"]', '30');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toHaveText('Add minutes for Bobcat, or untick it');
  expect(visitCalls(calls)).toHaveLength(0);
  // Untick it (unticked machines go as ''), and Save sends the minutes typed.
  await page.uncheck('[data-eq="bobcat"]');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  expect(visitCalls(calls)[0].body.equipment).toEqual({ blower: '', snowrator: 30, bobcat: '', sweepster: '' });
});

test('M7: the card asks minutes only for the units stationed at the site; a site with none asks for none; never a Blower or a Sweepster', async ({ page }) => {
  // Spec section 4: "loader minutes when the site has a stationed unit". PAC carries a Bobcat (B-7) and no Snowrator: Bobcat
  // alone. TUDOR-TRANSIT carries no unit: no equipment line at all. Bobcat 40 goes; the rest go blank.
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, units: { bobcat: 'B-7', snowrator: '  ' } } : s));
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  expect(await page.locator('[data-eq]').evaluateAll((els) => els.map((e) => e.dataset.eq))).toEqual(['bobcat']);
  await expect(page.locator('#dlgIn')).not.toContainText('Blower');
  await expect(page.locator('#dlgIn')).not.toContainText('Sweepster');
  await page.check('[data-eq="bobcat"]');
  await page.fill('[data-eqmin="bobcat"]', '40');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)[0].body.equipment).toEqual({ blower: '', snowrator: '', bobcat: 40, sweepster: '' });
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await expect(page.locator('[data-eq]')).toHaveCount(0);
  await expect(page.locator('#dlgIn')).not.toContainText('Equipment');
});

test('materials needed is printed beside materials used', async ({ page }) => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, materials_needed: '4-5 bags <b>IceMelt</b>' } : s));
  await openStorm(page, w);
  await openCard(page, 'S1');
  // Same row as the input, shown as text (the markup is not run).
  await expect(page.locator('.vc-matrow #vc_mat')).toHaveCount(1);
  await expect(page.locator('.vc-matrow #vc_needed')).toHaveText('Needed: 4-5 bags <b>IceMelt</b>');
  await expect(page.locator('#vc_needed b')).toHaveCount(0);
  // The typed box starts empty: the needed list is a hint, not an answer.
  await expect(page.locator('#vc_mat')).toHaveValue('');
  await page.click('#dlgClose');
  // A site with none listed prints no "Needed".
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await expect(page.locator('#vc_needed')).toHaveCount(0);
});

test('start and finish come from the first and last tap, not typed', async ({ page }) => {
  // Seeded taps at S1 this shift: 6:30 AM (L-1) and 7:10 AM (L-2). Not counted: a tap at
  // S1 on another shift (L-3, 1:00 AM 10/1). S2 has none.
  // The fake stamps Jordan's own tap at 7:50:18 AM: finish moves to 7:50 AM, start stays 6:30 AM.
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'problem', 'Alex Test', { note: 'cars in the lot', at: '2026-10-03T06:30:00.000-08:00' }),
    logRow(2, 'S1', 'lot', 'plowed', 'Alex Test', { at: '2026-10-03T07:10:00.000-08:00' }),
    logRow(3, 'S1', 'lot', 'plowed', 'Alex Test', { storm_id: 'ST-0', shift_id: 'day-2026-10-01', at: '2026-10-01T01:00:00.000-08:00' })];
  const calls = await openStorm(page, w);
  await openCard(page, 'S1');
  await expect(page.locator('#vc_start')).toHaveText('6:30 AM');
  await expect(page.locator('#vc_finish')).toHaveText('7:10 AM');
  // Read-only: not form fields.
  expect(await page.locator('#vc_start, #vc_finish').evaluateAll((els) => els.map((e) => e.tagName))).not.toContain('INPUT');
  await page.click('#dlgClose');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await openCard(page, 'S1');
  await expect(page.locator('#vc_start')).toHaveText('6:30 AM');
  await expect(page.locator('#vc_finish')).toHaveText('7:50 AM');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  for (const k of ['start', 'finish']) expect(visitCalls(calls)[0].body).not.toHaveProperty(k);
  // A site nobody has tapped yet shows a dash, not a time.
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await expect(page.locator('#vc_start')).toHaveText('—');
  await expect(page.locator('#vc_finish')).toHaveText('—');
});

test('reopening the card shows your own last save, not someone else\'s', async ({ page }) => {
  // S1, this shift (night-2026-10-02). Jordan (C03) saved V-1; Alex (C01) saved V-2
  // and then V-5, so the newest card on the site is Alex's, and Jordan must still see V-1.
  // Not Jordan's: V-3 (S1 on an earlier shift) and V-4 (another site).
  // PAC's stationed units (M7): a Snowrator and a Bobcat. Jordan's V-1: snowrator 20, bobcat 0; Alex's V-2: bobcat 45.
  const w = stationed(stormWorld());
  w.visits = [
    visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 2, materials_used: 'salt', equipment: { blower: '', snowrator: 20, bobcat: 0, sweepster: '' } }),
    visitRow(2, 'S1', 'C01', 'Alex Test', { depth_in: 9, materials_used: 'sand', equipment: { blower: '', snowrator: 45, bobcat: '', sweepster: '' } }),
    visitRow(3, 'S1', 'C03', 'Jordan Demo', { storm_id: 'ST-0', shift_id: 'day-2026-10-01', depth_in: 7, materials_used: 'old shift' }),
    visitRow(4, 'S2', 'C03', 'Jordan Demo', { depth_in: 5, materials_used: 'other site' }),
    visitRow(5, 'S1', 'C01', 'Alex Test', { depth_in: 11, materials_used: 'alex again' })];
  const calls = await openStorm(page, w);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('2');
  await expect(page.locator('#vc_mat')).toHaveValue('salt');
  await expect(page.locator('[data-eq="snowrator"]')).toBeChecked();
  await expect(page.locator('[data-eqmin="snowrator"]')).toHaveValue('20');  // Jordan's 20, never Alex's 45
  await expect(page.locator('[data-eq="bobcat"]')).toBeChecked();      // a saved 0 is a real answer: ticked, shows 0
  await expect(page.locator('[data-eqmin="bobcat"]')).toHaveValue('0');
  // Change the depth and save: that re-save is Jordan's newest card (V-6).
  await page.fill('#vc_depth', '4');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)[0].body).toMatchObject({ depth_in: 4, materials_used: 'salt', equipment: { blower: '', snowrator: 20, bobcat: 0, sweepster: '' } });
  expect(w.visits).toHaveLength(6);
  expect(w.visits[5]).toMatchObject({ by_key: 'C03', depth_in: 4 });
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('4');
  await expect(page.locator('#vc_mat')).toHaveValue('salt');
});

test('Matt\'s card starts blank when only crew have saved one', async ({ page }) => {
  const w = stationed(stormWorld());
  w.visits = [visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 2, materials_used: 'salt', equipment: { blower: '', snowrator: 20, bobcat: '', sweepster: '' } })];
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openRoute(page, 'R1'); // Matt lands on the live view; the card is on the route's page
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('');
  await expect(page.locator('#vc_mat')).toHaveValue('');
  await expect(page.locator('[data-eq="snowrator"]')).not.toBeChecked();
  await page.fill('#vc_depth', '1');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(w.visits[1]).toMatchObject({ by_key: 'admin', depth_in: 1 });
  await openCard(page, 'S1');
  await expect(page.locator('#vc_depth')).toHaveValue('1'); // his own now
  expect(visitCalls(calls)).toHaveLength(1);
});

test('a card refused for no open storm says so and stays open; a double tap on Save sends one', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { delay: { saveVisit: 600 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '2');
  await page.evaluate(() => { const b = document.querySelector('#vc_save'); b.click(); b.click(); });
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(1);
  expect(w.visits).toHaveLength(1);
  // Matt ends the storm while the card is open: the refusal shows on the card and nothing is saved.
  await openCard(page, 'S1');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toHaveText('No storm is open');
  await expect(page.locator('#dlg')).toBeVisible();
  expect(w.visits).toHaveLength(1);
  await expect(page.locator('#vc_save')).toBeEnabled(); // can try again once the busy lock is released
});

// ---------------- the Storm tab: the live view and storm controls (Matt and leads) ----------------
// Matt and the leads land on the live view: Problems in red on top, then every
// route with how far along it is. Tapping a route opens it as the crew see it.
// Crew never get the live view or the controls (the server refuses them too).
const stormCalls = (calls) => calls.filter((c) => c.body.action === 'stormAction');
const at = (hhmm) => '2026-10-03T' + hhmm + ':00.000-08:00';
const ctl = (page, kind) => page.locator('[data-storm="' + kind + '"]');

test('problems show first, in red, with the note and who', async ({ page }) => {
  // The newest standing row per lot in storm ST-1, worked by hand:
  //   S1  L1 problem (Alex, 6:30, "gate locked"), then L2 plowed (Jordan, 6:40)     -> plowed: NOT a problem
  //   S2  L3 problem (Jordan, 6:50, "cars in the lot")                              -> a problem
  //   S3  L4 problem (Alex, 6:55, "drift at the dumpster")                          -> a problem
  // Newest first by seq: L4 (EXTRA) then L3 (TUDOR-TRANSIT). Each line names the lot as "Lot".
  const w = stormWorld();
  w.sites = [...w.sites, { id: 'S3', name: 'EXTRA', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S3'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  w.log = [logRow(1, 'S1', 'lot', 'problem', 'Alex Test', { note: 'gate locked', at: at('06:30') }),
    logRow(2, 'S1', 'lot', 'plowed', 'Jordan Demo', { by_key: 'C03', at: at('06:40') }),
    logRow(3, 'S2', 'lot', 'problem', 'Jordan Demo', { note: 'cars in the lot', by_key: 'C03', at: at('06:50') }),
    logRow(4, 'S3', 'lot', 'problem', 'Alex Test', { note: 'drift at the dumpster', at: at('06:55') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#problems h2')).toHaveText('Problems (2)');
  expect(await idsOf(page, 'data-problem')).toEqual(['S3|lot', 'S2|lot']);
  const first = page.locator('[data-problem="S3|lot"]'), second = page.locator('[data-problem="S2|lot"]');
  for (const t of ['EXTRA · Lot', 'drift at the dumpster', 'Alex Test', '6:55 AM']) await expect(first).toContainText(t);
  for (const t of ['TUDOR-TRANSIT · Lot', 'cars in the lot', 'Jordan Demo', '6:50 AM']) await expect(second).toContainText(t);
  await expect(page.locator('#problems')).not.toContainText('gate locked'); // a problem since plowed is not one
  // Red (--warn, #b3261e in the light theme), and above every route.
  expect(await page.locator('#problems h2').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(179, 38, 30)');
  const problemsY = (await page.locator('#problems').boundingBox()).y, routeY = (await page.locator('[data-liveroute]').first().boundingBox()).y;
  expect(problemsY).toBeLessThan(routeY);
  // Each site on the trucks' cards says its lot's word: S1 Plowed (green), S2 and S3 Problem (red).
  await expect(page.locator('[data-livesite="S1"] .live-status')).toHaveText('Plowed');
  await expect(page.locator('[data-livesite="S1"] .live-status')).toHaveClass(/\bdone\b/);
  await expect(page.locator('[data-livesite="S2"] .live-status')).toHaveText('Problem');
  await expect(page.locator('[data-livesite="S2"] .live-status')).toHaveClass(/\bbad\b/);
});

// Routes N1 (PAC, EXTRA), N10 (NEWSITE), N2 (TUDOR-TRANSIT), stored in that order.
const liveWorld = () => {
  const w = stormWorld();
  w.sites = [...w.sites, { id: 'S3', name: 'EXTRA', rev: 1 }, { id: 'S4', name: 'NEWSITE', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S3'] }, { id: 'R3', name: 'N10', rev: 1, site_ids: ['S4'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  return w;
};

// Matt, 10/3/26: with no current Post, his live view shows who the Board has on
// each route, marked as not posted. Leads never get the Board, so they keep
// seeing "Not posted" until he posts.
const boardMoves = () => [
  { id: 'M1', at: '2026-10-02T17:00:00.000-08:00', worker: 'C01', to_route: 'R1', role: 'lead' },
  { id: 'M2', at: '2026-10-02T17:01:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' },
];
test('with no current post, Matt sees the Board on each route, marked not posted', async ({ page }) => {
  // No post at all. The Board: Alex leads N1, Jordan on N1; N2 and N10 empty.
  const w = liveWorld(); w.posts = []; w.moves = boardMoves();
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toBeVisible();
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Board, not posted yet: Alex Test (lead), Jordan Demo');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Not posted'); // nobody on the Board either
});
test('a stale post gives way to the Board; a current post wins over it', async ({ page }) => {
  // The post is for night-2026-09-30: stale at the storm clock. The Board moved Jordan to N2 since.
  const w = liveWorld(); w.posts = [{ ...POST, shift: 'night-2026-09-30' }];
  w.moves = [...boardMoves(), { id: 'M3', at: '2026-10-02T18:00:00.000-08:00', worker: 'C03', to_route: 'R2', role: 'member' }];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Board, not posted yet: Alex Test (lead)');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Board, not posted yet: Jordan Demo');
});
test('a current post is shown even when the Board has changed since', async ({ page }) => {
  // stormWorld's post is for the current shift (Alex leads N1, Jordan on N1). The Board says Jordan moved to N2.
  const w = liveWorld();
  w.moves = [...boardMoves(), { id: 'M3', at: '2026-10-02T18:00:00.000-08:00', worker: 'C03', to_route: 'R2', role: 'member' }];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Alex Test (lead), Jordan Demo');
});
// Part A (Matt, 10/4/26, Q5): the live view and storm controls come from LEADING a route on
// tonight's posted Board, not the roster flag. With no post yet, a roster lead gets the crew
// view: the walk buttons (the server's live Board decides), no live view, no controls.
test('a roster lead with no current post gets the crew view, never the Board', async ({ page }) => {
  const w = liveWorld(); w.posts = []; w.moves = boardMoves();
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(0);
  await expect(page.locator('#stormctl')).toHaveCount(0);
});

test('live view: a card per truck counts its lots plowed and says each site\'s lot', async ({ page }) => {
  // N1 = PAC (plowed by Alex 6:30, then a Problem "gate locked" by Jordan 6:40, then plowed again by Jordan 6:45:
  // its newest standing row is plowed -> plowed) + EXTRA (untapped -> Not plowed): 1 of 2 lots. Last tap 6:45.
  // N2 = TUDOR-TRANSIT untapped: 0 of 1 lots, no taps yet. N10 = NEWSITE untapped: 0 of 1 lots.
  // Numeric order is N1, N2, N10 (not N1, N10, N2). The post names Alex (lead) and Jordan on N1.
  const w = liveWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') }),
    logRow(2, 'S1', 'lot', 'problem', 'Jordan Demo', { by_key: 'C03', note: 'gate locked', at: at('06:40') }),
    logRow(3, 'S1', 'lot', 'plowed', 'Jordan Demo', { by_key: 'C03', at: at('06:45') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  expect(await page.locator('[data-liveroute]').evaluateAll((els) => els.map((e) => e.dataset.liveroute))).toEqual(['R1', 'R2', 'R3']);
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('1 of 2 lots');
  await expect(page.locator('[data-liveroute="R1"] progress')).toHaveAttribute('value', '1');
  await expect(page.locator('[data-liveroute="R1"] progress')).toHaveAttribute('max', '2');
  await expect(page.locator('[data-liveroute="R1"] .live-who')).toHaveText('Alex Test (lead), Jordan Demo');
  await expect(page.locator('[data-liveroute="R1"] .live-last')).toHaveText('Last tap 6:45 AM');
  await expect(page.locator('[data-livesite="S1"] .live-status')).toHaveText('Plowed');
  await expect(page.locator('[data-livesite="S3"] .live-status')).toHaveText('Not plowed');
  await expect(page.locator('[data-livesite="S3"] .live-status')).not.toHaveClass(/\b(done|bad)\b/);
  await expect(page.locator('[data-liveroute="R2"] .live-count')).toHaveText('0 of 1 lots');
  await expect(page.locator('[data-liveroute="R2"] progress')).toHaveAttribute('value', '0');
  await expect(page.locator('[data-liveroute="R2"] .live-last')).toHaveText('No taps yet');
  await expect(page.locator('[data-liveroute="R2"] .live-who')).toHaveText('Alex Test (lead)');
  await expect(page.locator('[data-liveroute="R3"] .live-count')).toHaveText('0 of 1 lots');
  await expect(page.locator('[data-liveroute="R3"] .live-who')).toHaveText('Not posted'); // N10 is not on the post
  // A Problem lands on the next poll (seq 4): PAC is no longer plowed, so N1 is 0 of 2.
  w.log.push(logRow(4, 'S1', 'lot', 'problem', 'Alex Test', { note: 'cars in the lot', at: at('06:55') }));
  await pollNow(page);
  await expect(page.locator('[data-livesite="S1"] .live-status')).toHaveText('Problem');
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('0 of 2 lots');
  // Site totals under each site: Jordan's and Alex's cards at PAC, shift night-2026-10-02 (the fake's shift).
  w.visits = [visitRow(1, 'S1', 'C03', 'Jordan Demo', { depth_in: 3.5, materials_used: 'salt', equipment: { blower: 30, snowrator: '', bobcat: '', sweepster: '' } }),
    visitRow(2, 'S1', 'C01', 'Alex Test', { depth_in: 2, materials_used: 'sand', equipment: { blower: 15, snowrator: '', bobcat: 45, sweepster: '' } })];
  await pollNow(page);
  // Worked out: blower 30 + 15 = 45, bobcat 45, nothing logged for the others; depth per person.
  const totals = page.locator('[data-livesite="S1"] .live-totals');
  await expect(totals).toContainText('Blower 45 min');
  await expect(totals).toContainText('Bobcat 45 min');
  await expect(totals).not.toContainText('Snowrator');
  await expect(totals).toContainText('Jordan Demo 3.5 in');
  await expect(totals).toContainText('Alex Test 2 in');
  await expect(page.locator('[data-livesite="S3"] .live-totals')).toHaveCount(0);
});

test('an off-route tap is marked in the live view', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') }),
    logRow(2, 'S2', 'lot', 'plowed', 'Jordan Demo', { by_key: 'C03', off_route: true, at: at('06:50') })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-livesite="S2"] .offroute')).toBeVisible();
  await expect(page.locator('[data-livesite="S2"] .offroute')).toContainText('off-route');
  await expect(page.locator('[data-livesite="S2"]')).toContainText('Jordan Demo');
  await expect(page.locator('[data-livesite="S1"] .offroute')).toHaveCount(0); // Alex's tap was on his route
});

test('crew see no storm controls and no live view', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'problem', 'Alex Test', { note: 'gate locked', at: at('06:30') })];
  await openStorm(page, w); // Jordan
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible(); // the crew view is there
  await expect(page.locator('#stormctl')).toBeHidden();
  await expect(page.locator('#problems')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-storm]')).toHaveCount(0);
  await expect(page.locator('[data-liveroute]')).toHaveCount(0);
  await expect(page.locator('[data-openroute]')).toHaveCount(0);
  // Matt ends the storm: still no Start / Reopen for crew.
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('07:40'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('#stormctl')).toBeHidden();
  await expect(page.locator('[data-storm]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Start|End|Reopen) storm$/ })).toHaveCount(0);
});

// Start, End, Reopen and Night shift on are the dispatcher's (final wave I1, spec section 5): Matt here.
test('the dispatcher can start a storm; End asks first', async ({ page }) => {
  const w = stormWorld(); w.storms = [];
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  // No storm yet: only Start. (Reopen needs a storm to reopen; the rest need one open.)
  await expect(ctl(page, 'start')).toHaveText('Start storm');
  for (const k of ['reopen', 'end', 'snowing', 'stopped', 'night_on']) await expect(ctl(page, k)).toHaveCount(0);
  // Start asks first; Cancel sends nothing.
  await ctl(page, 'start').click();
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn')).toContainText('Are you sure?');
  expect(stormCalls(calls)).toHaveLength(0);
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(stormCalls(calls)).toHaveLength(0);
  await ctl(page, 'start').click();
  await page.click('#sc_yes');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(stormCalls(calls)[0].body).toMatchObject({ action: 'stormAction', kind: 'start' });
  for (const k of ['by_name', 'by_key', 'by_profile', 'at', 'storm_id', 'seq']) expect(stormCalls(calls)[0].body).not.toHaveProperty(k);
  expect(w.storms.map((r) => [r.kind, r.by_name])).toEqual([['start', 'Matthew']]); // who comes from the token
  // Open: End, the Snowing|Stopped switch and Night shift on; no Start, no Reopen.
  for (const k of ['end', 'snowing', 'stopped', 'night_on']) await expect(ctl(page, k)).toBeVisible();
  for (const k of ['start', 'reopen']) await expect(ctl(page, k)).toHaveCount(0);
  await expect(ctl(page, 'stopped')).toHaveAttribute('aria-pressed', 'true');
  // End asks first.
  await ctl(page, 'end').click();
  await expect(page.locator('#dlgIn')).toContainText('Are you sure?');
  expect(stormCalls(calls)).toHaveLength(1);
  await page.click('#sc_yes');
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  expect(stormCalls(calls)).toHaveLength(2);
  expect(stormCalls(calls)[1].body).toMatchObject({ kind: 'end' });
  // Ended: Start and Reopen are on offer, End is gone.
  await expect(ctl(page, 'start')).toBeVisible();
  await expect(ctl(page, 'reopen')).toBeVisible();
  await expect(ctl(page, 'end')).toHaveCount(0);
  // Reopen and the switch do not ask.
  await ctl(page, 'reopen').click();
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#dlg')).toBeHidden();
  await ctl(page, 'snowing').click();
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  await expect(ctl(page, 'snowing')).toHaveAttribute('aria-pressed', 'true');
  expect(w.storms.map((r) => r.kind)).toEqual(['start', 'end', 'reopen', 'snowing']);
  expect(stormCalls(calls).map((c) => c.body.kind)).toEqual(['start', 'end', 'reopen', 'snowing']);
});

test('a refused storm control says why and the phone catches up', async ({ page }) => {
  // Another lead started a storm a moment ago: this phone has not heard yet. The
  // fake's reasons are the backend's ("End the storm first").
  const w = stormWorld(); w.storms = [];
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(ctl(page, 'start')).toBeVisible();
  w.storms.push(START_ROW);
  await ctl(page, 'start').click();
  await page.click('#sc_yes');
  await expect(page.locator('#stormerr')).toHaveText('Not saved: End the storm first');
  expect(w.storms).toHaveLength(1); // nothing was written
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // caught up
  expect(stormCalls(calls)).toHaveLength(1);
});

test('a double tap on a storm control sends one', async ({ page }) => {
  const w = stormWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt', delay: { stormAction: 600 } });
  await expect(ctl(page, 'snowing')).toBeVisible();
  await page.evaluate(() => { const b = document.querySelector('[data-storm="snowing"]'); b.click(); b.click(); });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(w.storms.filter((r) => r.kind === 'snowing')).toHaveLength(1);
});

test('night shift on is sent and shown', async ({ page }) => {
  // 7 PM on 10/3, no night_on yet: the day shift carries on (day-2026-10-03). The fake stamps the
  // night_on row 7 PM; at or after 9 AM the same date and already happened -> night-2026-10-03.
  const w = stormWorld(); w.clock = at('19:00');
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: at('19:00') });
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  await expect(ctl(page, 'night_on')).toHaveText('Night shift on');
  await expect(ctl(page, 'night_on')).toHaveAttribute('aria-pressed', 'false');
  await ctl(page, 'night_on').click();
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  expect(stormCalls(calls)).toHaveLength(1);
  expect(stormCalls(calls)[0].body).toMatchObject({ action: 'stormAction', kind: 'night_on' });
  expect(w.storms.at(-1)).toMatchObject({ kind: 'night_on', by_name: 'Matthew', at: at('19:00') });
  await expect(ctl(page, 'night_on')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // the weather is untouched
});

// Matt, 10/1/26: Back closed the whole app mid-job. A route opened from the live
// view is one more step on the Back stack, so Back returns to the live view.
const backSteps = (page) => page.evaluate(() => (history.state && history.state.snow) || []);
const problemWorld = () => {
  const w = stormWorld();
  w.log = [logRow(1, 'S2', 'lot', 'problem', 'Jordan Demo', { note: 'drain blocked', by_key: 'C03', at: at('06:50') })];
  return w;
};

test('Back on a route opened from the live view returns to the live view', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-matt' });
  await expect(page.locator('#problems')).toBeVisible();
  await openRoute(page, 'R2');
  await expect(page.locator('#problems')).toBeHidden(); // the route's own page
  await expect.poll(() => backSteps(page)).toEqual(['route']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  expect(page.url()).toContain('index.html'); // still in the app, not gone back past it
  expect(await backSteps(page)).toEqual([]);
});

test('the in-app ‹ Live view and the phone Back agree', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-dee' }); // a dispatcher (a crew card with the mark) gets the same
  await openRoute(page, 'R2');
  await page.click('#liveBack');
  await expect(page.locator('#problems')).toBeVisible();
  // Nothing left to undo: the in-app button takes its Back step with it.
  await expect.poll(() => backSteps(page)).toEqual([]);
  // Open again: one Back returns to the live view (a stale step would eat the first Back).
  await openRoute(page, 'R2');
  await page.goBack();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#liveBack')).toBeHidden();
  expect(page.url()).toContain('index.html');
});

test('Back with a site card open closes the card, then the next Back leaves the route', async ({ page }) => {
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await openCard(page, 'S1');
  await expect.poll(() => backSteps(page)).toEqual(['route', 'dlg']);
  await page.goBack();
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeVisible(); // still on the route
  await page.goBack();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
});

test('a route left open on the Storm tab is not still open when you come back', async ({ page }) => {
  await openStorm(page, problemWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R2');
  await page.click('nav [data-tab="board"]');
  await expect.poll(() => backSteps(page)).toEqual([]); // the route's step went with it
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
});

// ---------------- the Storm tab: forecast hint and walk marks on the map ----------------
// The hint is the National Weather Service's, and only a hint: the Snowing/Stopped
// switch is what counts. A made-up point: -149.5149, 61.3351 (lng, lat as the map
// saves it) goes out as /points/61.34,-149.51, rounded to two decimals (~1 km).
// Clock 7:30 AM Alaska. The fixture's hours start at 7 AM (the current hour):
// Light Snow, Snow, Snow Showers, then Mostly Cloudy. The run of snow ends at the
// 10 AM period: "Snow until 10 AM".
const NWS_POINT = [-149.5149, 61.3351];
const NWS_POINTS = 'https://api.weather.gov/points/61.34,-149.51';
const NWS_HOURLY = 'https://api.weather.gov/gridpoints/ZZZ/1,1/forecast/hourly';
const NWS_GRID = 'https://api.weather.gov/gridpoints/ZZZ/1,1';
const NWS_PERIODS = ['Light Snow', 'Snow', 'Snow Showers', ...Array(9).fill('Mostly Cloudy')].map((t, i) => ({
  startTime: '2026-10-03T' + String(7 + i).padStart(2, '0') + ':00:00-08:00', shortForecast: t }));
async function nws(page, o = {}) {
  const seen = [];
  const cors = { 'access-control-allow-origin': '*' };
  const pointsUrl = o.points || NWS_POINTS; // the one point the NWS answers; any other is a 404
  await page.route((u) => u.hostname === 'api.weather.gov', (route) => {
    const u = route.request().url();
    seen.push(u);
    if (o.fail) return route.abort();
    if (u === pointsUrl) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { forecastHourly: NWS_HOURLY, forecastGridData: NWS_GRID } }) });
    if (u === NWS_GRID) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { snowfallAmount: { uom: 'wmoUnit:mm', values: o.grid || [] } } }) });
    if (u === NWS_HOURLY) return route.fulfill({ contentType: 'application/geo+json', headers: cors, body: JSON.stringify({ properties: { periods: NWS_PERIODS } }) });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  return seen;
}
const withView = (w, id, center) => { w.sites = w.sites.map((s) => (s.id === id ? { ...s, map: { center, zoom: 18 } } : s)); return w; };

test('the forecast shows as a hint', async ({ page }) => {
  const seen = await nws(page);
  const calls = await openStorm(page, withView(stormWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  await expect(page.locator('#stormhead + #stormhint')).toHaveCount(1); // right under the header, once
  expect(seen).toEqual([NWS_POINTS, NWS_HOURLY]);                       // the rounded point, never the saved one
  // Not on every poll: three more polls, and the tab left and re-entered inside 15 minutes.
  for (let i = 1; i <= 3; i++) { // one at a time: a poll already running swallows the next
    const before = shiftCalls(calls).length;
    await pollNow(page);
    await expect.poll(() => shiftCalls(calls).length).toBe(before + 1);
    await page.waitForTimeout(300); // let the reply land
  }
  await page.click('nav [data-tab="tonight"]');
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toHaveLength(2);
  // Once 15 minutes have gone by the next redraw asks again.
  await page.clock.fastForward('16:00');
  await expect.poll(() => seen.length).toBe(4);
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
});

test("the hint comes from the first site with a point (Matt's live view)", async ({ page }) => {
  // PAC (S1, N1) has no saved view and its zones have no outline: no point. TUDOR-TRANSIT
  // (S2, N2) has one: the live view's hint is from it.
  const seen = await nws(page);
  await openStorm(page, withView(stormWorld(), 'S2', NWS_POINT), { token: 'tok-matt' });
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toEqual([NWS_POINTS, NWS_HOURLY]);
  await expect(page.locator('#stormhead + #stormhint')).toHaveCount(1);
});

test('a crew member with no mapped site on their route gets no hint and no request', async ({ page }) => {
  const seen = await nws(page);
  await openStorm(page, withView(stormWorld(), 'S2', NWS_POINT)); // Jordan's route is N1 (S1): no point
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#stormhint')).toHaveCount(0);
  expect(seen).toEqual([]);
});

test('a forecast failure shows no hint and taps still work', async ({ page }) => {
  const seen = await nws(page, { fail: true });
  const calls = await openStorm(page, withView(stormWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect.poll(() => seen.length).toBeGreaterThanOrEqual(1); // it did try
  await expect(page.locator('#stormhint')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Snow until');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  expect(tapCalls(calls)).toHaveLength(1);
  await pollNow(page);
  await expect(page.locator('#stormhint')).toHaveCount(0);
  expect(seen).toHaveLength(1); // no hammering a failing service
});

// ---------------- The forecast point from a drawing (Plow Command, 10/21/26: no MOA outlines, no slim sign-in) ----------------
// The sign-in carries every live zone with its ring (plow-command-script Code.js, plow-2: no `slim`, no `points`), so a
// site with a drawing and no saved view gets its forecast point from its first live zone's centroid (SnowWeather.point).
//
// Snow pile 1 (Z1 at PAC) drawn as a 2-thousandth square around (-149.8761, 61.2049), so its centroid IS that point,
// with no saved view on PAC. Paper, two decimals as the NWS is asked:
// 61.2049 * 100 = 6120.49 -> 6120 -> 61.2; -149.8761 * 100 = -14987.61 -> -14988 -> -149.88.
const PILE_RING = [[-149.8771, 61.2039], [-149.8751, 61.2039], [-149.8751, 61.2059], [-149.8771, 61.2059]];
const PILE_POINTS = 'https://api.weather.gov/points/61.2,-149.88';
const pileWorld = () => {
  const w = stormWorld();
  w.zones = [{ id: 'Z1', site_id: 'S1', type: 'storage', name: 'Snow pile 1', rev: 1, ring: PILE_RING }];
  return w;
};

test('the forecast point is a drawing\'s centroid when the site has no saved view: the sign-in carries the ring, asked plainly', async ({ page }) => {
  const seen = await nws(page, { points: PILE_POINTS });
  const calls = await openStorm(page, pileWorld());
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toEqual([PILE_POINTS, NWS_HOURLY]); // the pile's centroid, rounded
  // The sign-in asked for the zones as they are: no `slim` (the plow server has none to answer).
  expect(calls.filter((c) => c.body.action === 'bootstrap').map((c) => 'slim' in c.body)).toEqual([false]);
  // The lot is one Lot whatever the map holds.
  expect(await idsOf(page, 'data-walkrow')).toEqual(['S1|lot']);
});

test('the saved view beats a drawing\'s centroid', async ({ page }) => {
  // PAC has a saved view at NWS_POINT and Snow pile 1 drawn elsewhere: the view is the point.
  const seen = await nws(page);
  await openStorm(page, withView(pileWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM');
  expect(seen).toEqual([NWS_POINTS, NWS_HOURLY]);
});

// ---------------- Callouts: new snow since the last cleaning (Part B2, Matt 10/4/26) ----------------
// Worked on paper. Clock 7:30 AM Alaska on 10/3: night shift (before the 9 AM cutover); the storm
// started 6:00 AM. Both sites have the same saved view, so the same rounded point and ONE fetch.
//   PAC (S1, N1): its lot plowed 6:30 AM by Alex, so its new snow is counted from 6:30.
//   CALLOUT-TEST (S2, N2): nothing tapped, so from the storm's start, 6:00. (S2 is renamed to a
//   made-up name wherever a callout or rank sits on it: the repo is public, and TUDOR TRANSIT is a
//   real site. PAC is not a real site code.)
// The gridpoint has one period, 6:30-7:30 AM (14:30Z for 1 h), 30 mm. Both spans cover all of it:
// 30 / 25.4 = 1.18 -> shown 1.2, which meets a callout of 1 and not one of 2. CALLOUT-TEST's span
// starts 6:00 but the series only starts 6:30: its line says "since 6:30 AM", never the storm start.
const GRID_30MM = [{ validTime: '2026-10-03T14:30:00+00:00/PT1H', value: 30 }];
const gridHits = (seen) => seen.filter((u) => u === NWS_GRID).length;
const fakeS2 = (s) => (s.id === 'S2' ? { ...s, name: 'CALLOUT-TEST' } : s);
const calloutWorld = (callout = 1) => {
  const w = withView(withView(stormWorld(), 'S1', NWS_POINT), 'S2', NWS_POINT);
  w.sites = w.sites.map((s) => ({ ...fakeS2(s), callout_in: callout }));
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];
  return w;
};
const depthRow = (n, siteId, inches, at) => ({ ...logRow(n, siteId, '*', 'depth', 'Alex Test', { at }), depth_in: inches });

test('Callouts: the NWS estimate lists sites whose new snow meets the callout, each a line with nothing to press', async ({ page }) => {
  // Plow Command (10/21/26): no Clean again. Plowing the lot again is the next Plowed tap, on the site card.
  const seen = await nws(page, { grid: GRID_30MM });
  await openStorm(page, calloutWorld(1), { token: 'tok-matt' });
  const box = page.locator('#callouts');
  await expect(box).toBeVisible();
  await expect(box.locator('h2')).toHaveText('Callouts (2)');
  await expect(box.locator('[data-callout="S1"]')).toHaveText('PAC · ~1.2" since 6:30 AM (estimate) · callout 1"');
  await expect(box.locator('[data-callout="S2"]')).toHaveText('CALLOUT-TEST · ~1.2" since 6:30 AM (estimate) · callout 1"');
  await expect(box.locator('button')).toHaveCount(0);
  expect(gridHits(seen)).toBe(1);                                 // one point, one fetch, two sites
});

test('Callouts: an estimate under the callout is not listed', async ({ page }) => {
  // 1.2 meets CALLOUT-TEST's 1 and not PAC's 2: one line, and PAC's is hidden.
  const seen = await nws(page, { grid: GRID_30MM });
  const w = calloutWorld(1);
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 2 } : s));
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-callout="S2"]')).toBeVisible();
  await expect(page.locator('#callouts h2')).toHaveText('Callouts (1)');
  await expect(page.locator('[data-callout="S1"]')).toBeHidden();
  expect(gridHits(seen)).toBe(1);
});

test('Callouts: with every callout above the estimate the box is hidden', async ({ page }) => {
  const seen = await nws(page, { grid: GRID_30MM });
  await openStorm(page, calloutWorld(2), { token: 'tok-matt' });
  await expect.poll(() => gridHits(seen)).toBe(1);
  // A positive signal, never a fixed wait: the point's answer is in (one period), and the redraw that
  // follows it runs in the same step, so the box below is the box drawn from the estimate.
  await expect.poll(() => phoneState(page).then((s) => s.snowfall['61.34,-149.51'])).toEqual({ busy: false, periods: 1 });
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('#callouts')).toBeHidden();
});

test('Callouts: a lead measures new snow; the depth goes as a number and the line says measured', async ({ page, browser }) => {
  // PAC has a callout but no saved view and no outline: no point, so no estimate and no fetch.
  // TUDOR-TRANSIT has no callout: no New snow button.
  // Alex leads N1 and N2 on the post: his Storm tab is the driver's (final wave I1), both his routes on it, the storm switch
  // above them; the Callouts box is the live view's (the dispatcher's), so the measured line is read on Matt's phone below.
  const seen = await nws(page);
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  const depthCalls = () => calls.filter((c) => c.body.action === 'depthNow');
  await expect(page.locator('#stormctl')).toBeVisible();
  await expect(page.locator('#callouts')).toBeHidden();
  await expect(page.locator('[data-shiftsite="S2"]')).toBeVisible();
  expect(await idsOf(page, 'data-depth')).toEqual(['S1']); // PAC's alone: TUDOR-TRANSIT has no callout
  // A refusal shows its reason on the site, under its name.
  await page.click('[data-depth="S1"]');
  await expect(page.locator('#dlgIn h2')).toHaveText('New snow at PAC');
  await expect(page.locator('label[for="dn_in"]')).toHaveText('Inches since the last plow'); // a plow truck's word (Matt, 10/21/26)
  await page.fill('#dn_in', '61');
  await page.click('#dn_save');
  await expect(page.locator('[data-shiftsite="S1"]')).toContainText('Not saved: Depth is 0 to 60 inches');
  await expect(page.locator('[data-depth="S1"]')).toHaveText('New snow');
  await page.click('[data-depth="S1"]');
  await page.fill('#dn_in', '2');
  await page.click('#dn_save');
  await expect.poll(() => depthCalls().length).toBe(2);
  expect(depthCalls()[1].body.site_id).toBe('S1');
  expect(depthCalls()[1].body.depth_in).toBe(2); // the number 2: the server refuses the text '2'
  await expect(page.locator('[data-shiftsite="S1"]')).not.toContainText('Not saved');
  const mattCtx = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const matt = await mattCtx.newPage();
    await nws(matt);
    await openStorm(matt, w, { token: 'tok-matt' });
    await expect(matt.locator('#callouts')).toBeVisible();
    await expect(matt.locator('#callouts [data-callout="S1"]')).toContainText('PAC · 2" measured 7:50 AM by Alex Test · callout 1"');
  } finally { await mattCtx.close(); }
  expect(gridHits(seen)).toBe(0);
});

test('Callouts: a crew member never sees the box or New snow, and never asks the NWS for snowfall', async ({ page }) => {
  const seen = await nws(page, { grid: GRID_30MM });
  const w = calloutWorld(1);
  w.log.push(depthRow(2, 'S1', 3, '2026-10-03T07:00:00.000-08:00'));
  await openStorm(page, w); // Jordan, a member of N1
  await expect(page.locator('#stormhint')).toHaveText('Snow until 10 AM'); // the hint still comes: PAC has a point
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  await page.click('#otherRoutes');
  await expect(page.locator('[data-shiftsite="S2"]')).toBeVisible();
  await pollNow(page);
  await page.waitForTimeout(500);
  await expect(page.locator('#callouts')).toHaveCount(0);
  await expect(page.locator('[data-depth]')).toHaveCount(0);
  expect(gridHits(seen)).toBe(0);
});

test('Callouts: with the NWS down there is no estimate and no error; a measured depth still lists', async ({ page }) => {
  // CALLOUT-TEST: 1.5" measured at 7:05 AM, nothing tapped. A depth row is not a tap.
  const seen = await nws(page, { fail: true });
  const w = calloutWorld(1);
  w.log.push(depthRow(2, 'S2', 1.5, '2026-10-03T07:05:00.000-08:00'));
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#callouts')).toBeVisible();
  await expect(page.locator('#callouts h2')).toHaveText('Callouts (1)');
  await expect(page.locator('[data-callout="S2"]')).toContainText('CALLOUT-TEST · 1.5" measured 7:05 AM by Alex Test · callout 1"');
  await expect(page.locator('[data-callout="S1"]')).toHaveCount(0);
  await expect(page.locator('main .err')).toHaveCount(0);
  // Asked once (the hint and the snowfall each ask for the point), and a failure is kept: a poll asks nothing.
  await expect.poll(() => seen.filter((u) => u === NWS_POINTS).length).toBe(2);
  const before = shiftCalls(calls).length;
  await pollNow(page);
  await expect.poll(() => shiftCalls(calls).length).toBe(before + 1);
  await page.waitForTimeout(300);
  expect(seen.filter((u) => u === NWS_POINTS)).toHaveLength(2);
  await expect(page.locator('[data-callout="S2"]')).toBeVisible();
});

test('Callouts: the next Plowed tap retires the old reading; a reading after it lists again', async ({ page }) => {
  // PAC: plowed 6:30 (seq 1), 3" measured at 7:00 (seq 2). No point, so no estimate. Matt plows it again from the
  // route (seq 3, stamped 7:50 by the fake): "since" moves past the reading, off the list. New snow 1" (seq 4) after
  // it: back on. (Plow Command has no Clean again: the next Plowed tap is the new start.)
  const seen = await nws(page);
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test'), depthRow(2, 'S1', 3, '2026-10-03T07:00:00.000-08:00')];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-callout="S1"]')).toHaveText('PAC · 3" measured 7:00 AM by Alex Test · callout 1"');
  await openRoute(page, 'R1');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Matthew');
  await page.click('#liveBack');
  await expect(page.locator('#callouts')).toBeHidden();
  await openRoute(page, 'R1');
  await page.click('[data-depth="S1"]');
  await page.fill('#dn_in', '1');
  await page.click('#dn_save');
  await expect.poll(() => w.log.length).toBe(4);
  await page.click('#liveBack');
  await expect(page.locator('[data-callout="S1"]')).toHaveText('PAC · 1" measured 7:50 AM by Matthew · callout 1"');
  expect(gridHits(seen)).toBe(0);
});

// A New snow refused on the rows the phone had (B1 review minor, 10/6/26, first written for Clean again) stays under
// its site only until a newer row AT THAT SITE comes in: a poll that brings only another site's row leaves it.
test('a refused New snow stays until a newer row at that site comes in', async ({ page }) => {
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  await openStorm(page, w, { token: 'tok-alex' }); // Alex leads N1 on the post: his route is on his Storm tab (I1)
  await page.click('[data-depth="S1"]');
  await page.fill('#dn_in', '61');
  await page.click('#dn_save');
  const site = page.locator('[data-shiftsite="S1"]');
  await expect(site).toContainText('Not saved: Depth is 0 to 60 inches');
  // Someone on N2 plows the other site: the phone has the row, the refusal stays.
  w.log.push(logRow(1, 'S2', 'lot', 'plowed', 'Jordan Demo', { by_key: 'C03' }));
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).log.length).toBe(1);
  await expect(site).toContainText('Not saved: Depth is 0 to 60 inches');
  // Jordan plows PAC on his own phone: the refusal is out of date and goes.
  w.log.push(logRow(2, 'S1', 'lot', 'plowed', 'Jordan Demo', { by_key: 'C03' }));
  await pollNow(page);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 6:30 AM by Jordan Demo');
  await expect(site).not.toContainText('Depth is 0 to 60 inches');
  await expect(site.locator('[role="alert"]')).toHaveCount(0);
});

// A New snow that never reached the server gets Retry, as the lot does (B2 review), and keeps it after someone taps
// the site: unlike a refusal, it is still wanted.
test('no signal: a New snow says not saved, and Retry sends it', async ({ page }) => {
  const net = { down: true }, w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  const calls = await openStorm(page, w, { token: 'tok-alex', abortIf: (b) => net.down && b.action === 'depthNow' });
  await page.click('[data-depth="S1"]');
  await page.fill('#dn_in', '2');
  await page.click('#dn_save');
  const site = page.locator('[data-shiftsite="S1"]');
  await expect(site).toContainText('Not saved: no signal');
  w.log.push(logRow(1, 'S1', 'lot', 'plowed', 'Jordan Demo', { by_key: 'C03' }));
  await pollNow(page);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 6:30 AM by Jordan Demo');
  await expect(site).toContainText('Not saved: no signal');
  net.down = false;
  await page.click('[data-retry="S1|*"]');
  await expect(site).not.toContainText('Not saved');
  expect(calls.filter((c) => c.body.action === 'depthNow').map((c) => [c.body.site_id, c.body.depth_in])).toEqual([['S1', 2], ['S1', 2]]);
  expect(w.log.map((r) => [r.zone_id, r.state])).toEqual([['lot', 'plowed'], ['*', 'depth']]);
});

test('Callouts: a site on two routes is listed once', async ({ page }) => {
  // On paper: the live view sorts routes by name, N1 then N2. N1 = [S2]; N2 = [S1, S2]. First
  // appearances: S2 (N1), then S1 (N2); the second S2 is dropped. So [S2, S1], unlike the Sites
  // list order [S1, S2]. Night shift (7:30 AM) and no ranks: no re-ordering.
  const seen = await nws(page);
  const w = stormWorld();
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S2'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S1', 'S2'] }];
  w.sites = w.sites.map((s) => ({ ...fakeS2(s), callout_in: 1 }));
  w.log = [depthRow(1, 'S1', 2, '2026-10-03T07:00:00.000-08:00'), depthRow(2, 'S2', 2, '2026-10-03T07:05:00.000-08:00')];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#callouts h2')).toHaveText('Callouts (2)');
  expect(await page.locator('[data-callout]').evaluateAll((els) => els.map((e) => e.dataset.callout))).toEqual(['S2', 'S1']);
  expect(gridHits(seen)).toBe(0);
});

test('Callouts: polls inside 30 minutes fetch the snowfall once; after 30 minutes it is asked again', async ({ page }) => {
  const seen = await nws(page, { grid: GRID_30MM });
  const calls = await openStorm(page, calloutWorld(1), { token: 'tok-matt' });
  await expect(page.locator('[data-callout="S1"]')).toBeVisible();
  for (let i = 1; i <= 2; i++) { // one at a time: a poll already running swallows the next
    const before = shiftCalls(calls).length;
    await pollNow(page);
    await expect.poll(() => shiftCalls(calls).length).toBe(before + 1);
    await page.waitForTimeout(300);
  }
  expect(gridHits(seen)).toBe(1);
  await page.clock.fastForward('16:00'); // the hint asks again after 15 minutes; the snowfall does not
  await expect.poll(() => seen.filter((u) => u === NWS_HOURLY).length).toBe(2);
  expect(gridHits(seen)).toBe(1);
  await page.clock.fastForward('15:00'); // 31 minutes
  await expect.poll(() => gridHits(seen)).toBe(2);
  await expect(page.locator('[data-callout="S1"]')).toBeVisible();
});

// ---- Day ranking (Part B2, Matt 10/4/26) ----
// Route N1 drives PAC (S1), RANK-TEST-2 (S2), RANK-TEST (S3). The ranked ones have made-up names: the
// repo is public, so no rank ever sits on a real site code. Ranks: RANK-TEST 1, RANK-TEST-2 2, PAC none
// (no key at all, as an old site). Day: RANK-TEST, RANK-TEST-2, PAC (ranked first by rank, then the
// unranked in route order). Night: route order, PAC, RANK-TEST-2, RANK-TEST.
const rankWorld = (shift) => {
  const w = stormWorld();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'RANK-TEST-2', rev: 1, day_rank: 2 }, { id: 'S3', name: 'RANK-TEST', rev: 1, day_rank: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2', 'S3'] }];
  w.posts = [{ ...POST, shift, routes: [{ id: 'R1', name: 'N1', lead: 'C01', members: ['C03'],
    sites: [{ id: 'S1', name: 'PAC' }, { id: 'S2', name: 'RANK-TEST-2' }, { id: 'S3', name: 'RANK-TEST' }] }] }];
  return w;
};
const idsOf = (page, attr) => page.locator('[' + attr + ']').evaluateAll((els, a) => els.map((e) => e.getAttribute(a)), attr);
const tonightIds = (page) => page.locator('.tonight-route [data-map]').evaluateAll((els) => els.map((e) => e.dataset.map));
const DAY_ORDER = ['S3', 'S2', 'S1'], ROUTE_ORDER = ['S1', 'S2', 'S3'];

test('day shift: ranked sites lead Tonight and the Storm tab', async ({ page }) => {
  await open(page, { token: 'tok-jordan', snow: fakeSnow(rankWorld('day-2026-10-03')), clockAt: '2026-10-03T10:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(1);
  expect(await tonightIds(page)).toEqual(DAY_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-shiftsite')).toEqual(DAY_ORDER);
});

test('night shift: Tonight and the Storm tab keep route order', async ({ page }) => {
  const w = rankWorld('night-2026-10-03');
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'night_on', storm_id: 'ST-1', at: '2026-10-03T18:00:00.000-08:00', by_name: 'Matthew' }];
  await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: '2026-10-03T22:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(1);
  expect(await tonightIds(page)).toEqual(ROUTE_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-shiftsite')).toEqual(ROUTE_ORDER);
});

test("Tonight orders by the post's own shift: tonight's post read at 4 PM keeps route order", async ({ page }) => {
  // 4 PM is day by the clock (no night_on), so the Storm tab ranks; the post is for tonight, so Tonight does not.
  await open(page, { token: 'tok-jordan', snow: fakeSnow(rankWorld('night-2026-10-03')), clockAt: '2026-10-03T16:00:00-08:00' });
  await expect(page.locator('.tonight-route')).toHaveCount(1);
  expect(await tonightIds(page)).toEqual(ROUTE_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-shiftsite')).toEqual(DAY_ORDER);
});

test("9 AM cutover: Matt's live view re-orders into day rank on the next draw, no reload", async ({ page }) => {
  await openStorm(page, rankWorld('night-2026-10-02'), { token: 'tok-matt', clockAt: '2026-10-03T08:58:00-08:00' });
  await expect(page.locator('[data-livesite]')).toHaveCount(3);
  expect(await idsOf(page, 'data-livesite')).toEqual(ROUTE_ORDER);
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await page.clock.fastForward('03:00'); // 9:01 AM: the 20 s poll redraws
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  expect(await idsOf(page, 'data-livesite')).toEqual(DAY_ORDER);
  await openRoute(page, 'R1');
  expect(await idsOf(page, 'data-shiftsite')).toEqual(DAY_ORDER);
});

// A phone that gets the new index.html but not lib/callout.js (a cut-off load, an old cached copy
// missing) must still show every route: route order and no Callouts box, never a broken tab.
test('without lib/callout.js, Tonight and the Storm tab still show their routes, in route order', async ({ page }) => {
  await page.route((u) => u.href.endsWith('/lib/callout.js'), (r) => r.abort());
  await open(page, { token: 'tok-jordan', snow: fakeSnow(rankWorld('day-2026-10-03')), clockAt: '2026-10-03T10:00:00-08:00' });
  expect(await page.evaluate(() => typeof SnowCallout)).toBe('undefined'); // the block really held
  await expect(page.locator('.tonight-route')).toBeVisible();
  expect(await tonightIds(page)).toEqual(ROUTE_ORDER);
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
  expect(await idsOf(page, 'data-shiftsite')).toEqual(ROUTE_ORDER);
});

test("without lib/callout.js, Matt's live view still shows its routes, with no Callouts box", async ({ page }) => {
  await page.route((u) => u.href.endsWith('/lib/callout.js'), (r) => r.abort());
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test'), depthRow(2, 'S1', 3, '2026-10-03T07:00:00.000-08:00')];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(page.locator('[data-liveroute="R2"]')).toBeVisible();
  await expect(page.locator('#callouts')).toHaveCount(0);
});

test('"Last tap" counts lot taps only, never a depth row', async ({ page }) => {
  // PAC: plowed 6:30, a Problem 6:40; then depth readings at 7:20 (PAC) and 7:25 (TUDOR-TRANSIT). The last TAP on N1
  // is 6:40; N2 has a reading and no tap.
  const t = (hhmm) => '2026-10-03T' + hhmm + ':00.000-08:00';
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: t('06:30') }), logRow(2, 'S1', 'lot', 'problem', 'Alex Test', { note: 'cars', at: t('06:40') }),
    depthRow(4, 'S1', 1, t('07:20')), depthRow(5, 'S2', 2, t('07:25'))];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-liveroute="R1"] .live-last')).toHaveText('Last tap 6:40 AM');
  await expect(page.locator('[data-liveroute="R2"] .live-last')).toHaveText('No taps yet');
});

// ---------------- final review fixes (10/3/26) ----------------
// A post with Jordan (C03) as the member of one route only (Alex leads both, as in POST).
const postWith = (id, shift, jordanOn) => ({ ...POST, id, shift, posted_at: '2026-10-03T15:00:00.000Z',
  routes: POST.routes.map((r) => ({ ...r, members: r.id === jordanOn ? ['C03'] : [] })) });
const getPosts = (calls) => calls.filter((c) => c.body.action === 'getPost');

// F1: the Storm tab used to read the post only from bootstrap (or a visit to Tonight).
test('the Storm tab picks up a re-post: on entering the tab, every third poll, and back on screen', async ({ page }) => {
  // Bootstrap's post P1 has Jordan on N1 (PAC). Each re-post is read by a different trigger:
  //   P2 (Jordan on N2) lands while he is on Tonight   -> tapping Storm fetches it at once;
  //   P3 (Jordan on N1) lands on the Storm tab          -> ticks 1 and 2 (20 s, 40 s) do not fetch it,
  //                                                        tick 3 (60 s) does: one getPost more;
  //   P4 (Jordan on N2)                                 -> the app coming back on screen fetches it.
  // His own route is drawn open; the other one is behind "Other routes" (not opened here).
  const w = stormWorld();
  w.posts = [postWith('P1', 'night-2026-10-02', 'R1')];
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await expect(page.locator('nav [data-tab="tonight"][aria-current="page"]')).toBeVisible();
  w.posts.push(postWith('P2', 'night-2026-10-02', 'R2'));
  await page.click('nav [data-tab="storm"]');
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible();
  await expect(lotRow(page, 'S1')).toHaveCount(0);
  const before = getPosts(calls).length;
  w.posts.push(postWith('P3', 'night-2026-10-02', 'R1'));
  await page.clock.runFor(40000);
  await page.waitForTimeout(300);
  expect(getPosts(calls)).toHaveLength(before);
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible(); // still P2
  await page.clock.runFor(20000);
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  await expect(lotRow(page, 'S2')).toHaveCount(0);
  expect(getPosts(calls)).toHaveLength(before + 1);
  w.posts.push(postWith('P4', 'night-2026-10-02', 'R2'));
  await pollNow(page);
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible();
  await expect(lotRow(page, 'S1')).toHaveCount(0);
});

test('after 9 AM a new day post shows the day route without visiting Tonight', async ({ page }) => {
  // 8:59:30 AM: the night post (night-2026-10-02) has Jordan on N1. Matt posts the day shift
  // (day-2026-10-03) with Jordan on N2. Ticks at about 8:59:50, 9:00:10, 9:00:30; the third reads the
  // post. From 9:00 the night post is stale, so without that read Jordan would be told he is on no
  // route until he happened to open Tonight. The 9 AM rule itself is unchanged.
  const w = stormWorld();
  w.posts = [postWith('P1', 'night-2026-10-02', 'R1')];
  await openStorm(page, w, { clockAt: '2026-10-03T08:59:30-08:00' });
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  w.posts.push(postWith('P2', 'day-2026-10-03', 'R2'));
  await page.clock.runFor(60000);
  await expect(lotBtn(page, 'S2', 'plowed')).toBeVisible();
  await expect(page.locator('h2.shift-route', { hasText: 'Your route' })).toContainText('N2');
  await expect(page.locator('main')).not.toContainText("You're not on a route this shift");
  await expect(page.locator('nav [data-tab="storm"][aria-current="page"]')).toBeVisible(); // never left Storm
});

// F2: a request that never answers used to hang the lot (and the polling) for good.
test('a tap the server never answers says not saved after 45 s, with Retry', async ({ page }) => {
  // Apps Script waits up to 25 s for its lock, so 45 s with no answer means it is not coming.
  const net = { hang: true };
  const calls = await openStorm(page, stormWorld(), { hangIf: (b) => net.hang && b.action === 'tapZone' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotRow(page, 'S1')).toHaveAttribute('aria-busy', 'true');
  await page.clock.runFor(44000);
  await page.waitForTimeout(300);
  await expect(lotRow(page, 'S1')).toHaveAttribute('aria-busy', 'true'); // 44 s: still waiting
  await expect(page.locator('[data-retry="S1|lot"]')).toHaveCount(0);
  await page.clock.runFor(1000);
  const fail = lotRow(page, 'S1').locator('.walk-fail');
  await expect(fail).toBeVisible();
  await expect(fail).toContainText('Not saved: no signal');
  await expect(page.locator('[data-retry="S1|lot"]')).toBeVisible();
  await expect(lotRow(page, 'S1')).not.toHaveAttribute('aria-busy', 'true');
  await expect(lotLine(page, 'S1')).toHaveCount(0); // nothing shown as plowed
  net.hang = false;
  await page.click('[data-retry="S1|lot"]');
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  expect(tapCalls(calls)).toHaveLength(2);
});

test('a poll the server never answers does not stop the polls after it', async ({ page }) => {
  // Poll 1 answers (entering the tab). Poll 2 (the 20 s tick) never answers. The ticks at 40 s and
  // 60 s find it still running and ask nothing. Its 45 s timeout ends it at 65 s; the 80 s tick asks
  // again (poll 3) and brings Alex's tap.
  const net = { hang: false };
  const w = stormWorld();
  const calls = await openStorm(page, w, { hangIf: (b) => net.hang && b.action === 'getShiftLog' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  expect(shiftCalls(calls)).toHaveLength(1);
  net.hang = true;
  await page.clock.runFor(20000);
  await expect.poll(() => shiftCalls(calls).length).toBe(2);
  net.hang = false;
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];
  await page.clock.runFor(40000);
  await page.waitForTimeout(300);
  expect(shiftCalls(calls)).toHaveLength(2);
  await page.clock.runFor(20000);
  await expect.poll(() => shiftCalls(calls).length).toBe(3);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 6:30 AM by Alex Test');
});

test('coming back on screen reloads the zones; the lot stays the one Lot', async ({ page }) => {
  // Matt archives Snow pile 1 (Z5) at PAC while Jordan's phone is in his pocket. Back on screen the phone reads the
  // zones once more. The lot never depended on them: PAC is still one Lot with its two buttons.
  const w = stormWorld();
  const calls = await openStorm(page, w);
  await expect(lotRow(page, 'S1')).toBeVisible();
  w.zones = w.zones.map((z) => (z.id === 'Z5' ? { ...z, archived: true, rev: 2 } : z));
  await pollNow(page);
  await expect.poll(() => calls.filter((c) => c.body.action === 'getZones').length).toBe(1);
  // Asked plainly: every zone of every site, rings and all (no `slim`, no site named; the plow server has no slim).
  expect(calls.filter((c) => c.body.action === 'getZones').map((c) => [c.body.slim, c.body.site_id])).toEqual([[undefined, undefined]]);
  expect(await idsOf(page, 'data-walkrow')).toEqual(['S1|lot']);
  await expect(lotBtn(page, 'S1', 'problem')).toBeVisible();
});

// F5: the card's save answered into whatever dialog was open by then.
test('a slow card save, cancelled, never closes or writes into the next card', async ({ page }) => {
  // Card A (PAC) saves slowly; Jordan cancels it, opens card B (TUDOR-TRANSIT), types, and taps Save
  // while A is still on its way: B says so and sends nothing. Then A lands: B stays open with its
  // typing and no word from A in it (a toast about A is fine only if it names PAC). Then B saves.
  const w = stormWorld();
  const calls = await openStorm(page, w, { delay: { saveVisit: 2000 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '2');
  await page.click('#vc_save');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await page.fill('#vc_depth', '7');
  await page.fill('#vc_mat', 'sand, 1 bag');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('Still saving the last card… try again in a moment');
  expect(visitCalls(calls)).toHaveLength(1);
  // A lands.
  await expect.poll(async () => (await phoneState(page)).visits.map((r) => r.id)).toEqual(['V-1']);
  await page.waitForTimeout(300);
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn h2')).toHaveText('Site card: TUDOR-TRANSIT');
  await expect(page.locator('#vc_depth')).toHaveValue('7');
  await expect(page.locator('#vc_mat')).toHaveValue('sand, 1 bag');
  await expect(page.locator('#vc_err')).toHaveText(''); // the "still saving" note is gone, and A wrote nothing here
  if (await page.locator('#toast').isVisible()) await expect(page.locator('#toast')).toContainText('PAC');
  await page.click('#vc_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(visitCalls(calls)).toHaveLength(2);
  expect(visitCalls(calls)[1].body).toMatchObject({ site_id: 'S2', depth_in: 7, materials_used: 'sand, 1 bag' });
  expect(w.visits.map((v) => v.site_id)).toEqual(['S1', 'S2']);
});

test('a cancelled card whose save fails says so by name, not inside the next card', async ({ page }) => {
  // Same sequence, but Matt ends the storm before A lands: A is refused. B must not show A's
  // refusal; the toast names PAC.
  const w = stormWorld();
  await openStorm(page, w, { delay: { saveVisit: 2000 } });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await openCard(page, 'S1');
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T07:40:00.000-08:00', by_name: 'Matthew' });
  await page.click('#vc_save');
  await page.click('#dlgClose');
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await page.fill('#vc_depth', '7');
  await expect(page.locator('#toast')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#toast')).toContainText('PAC');
  await expect(page.locator('#toast')).toContainText('No storm is open');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#vc_err')).toHaveText('');
  await expect(page.locator('#vc_depth')).toHaveValue('7');
});

// ---------------- route sheets (sub-project 5, 10/3/26) ----------------
// A truck per route and shift (newest row wins), unit numbers on a site, the Print
// view (every sheet, one per page) and the Sheets status line.
// The storm clock above (7:30 AM on 10/3) is still the night of 10/2, and the fake
// files every row there, so a truck set in these tests belongs to this shift.
const SHIFT = 'night-2026-10-02';
const truckRow = (n, routeId, truck, by = 'Matthew', byKey = 'admin') => ({ id: 'T-' + n, seq: n, route_id: routeId, shift_id: SHIFT, truck, by_key: byKey, by_name: by, at: at('06:10') });
const truckCalls = (calls) => calls.filter((c) => c.body.action === 'setTruck');
// The post of this shift: N1 led by Alex (C01) with Jordan, N2 led by Alex. `o.R1` / `o.R2` override a route's fields.
const postOf = (o = {}) => ({ ...POST, shift: SHIFT, routes: [
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }], lead: 'C01', members: ['C03'], truck: null, ...(o.R1 || {}) },
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: 'C01', members: [], truck: null, ...(o.R2 || {}) }] });
// The window's print dialog is not opened in a test: count the asks instead.
const stubPrint = (page) => page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });

test("Matt sets a route's truck on the Board and it is sent", async ({ page }) => {
  // The storm clock (7:30 AM on 10/3) has the post for the night of 10/2 current, but the day and night of
  // 10/3 are on offer too, so the Board asks (10/4/26); Matt picks the night of 10/2, the post's own.
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
  // Blank until someone sets it: never a made-up truck.
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('');
  await page.fill('[data-truckinput="R1"]', ' T-14 ');
  await page.click('[data-settruck="R1"]');
  await page.click('[data-shift="' + SHIFT + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/2');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  // The phone names the route, the truck and the shift (the current post's); the server stamps who and when.
  expect(Object.keys(truckCalls(calls)[0].body).sort()).toEqual(['action', 'route_id', 'shift', 'token', 'truck']);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: SHIFT }); // trimmed
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  // Any route: N2 too, and N1 keeps its own.
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: SHIFT });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('T-9');
});

// Final review C1. 4 PM on 10/3, no storm, no night_on: the shift running is the DAY of 10/3. Matt posted
// the night of 10/3 at 3:30 and sets N1's truck for it. Worked by hand: the Board sends shift
// night-2026-10-03 (the current post's), the server files it there, and every screen shows that
// shift's truck: the Board box keeps T-14 after the save, and Matt's live view says "Truck: T-14".
// (Shown for the running day shift instead, both would be blank: the bug.)
const NIGHT3 = 'night-2026-10-03';
const AT_4PM = '2026-10-03T16:00:00-08:00';
test('a truck set at 4 PM for the posted night is sent with that shift and shown after the save', async ({ page }) => {
  const w = stormWorld();
  w.storms = [];
  w.clock = '2026-10-03T16:00:30.000-08:00';
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: '2026-10-03T15:30:00.000-08:00' }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  await expect(page.locator('#dlg')).toBeHidden();                       // a current post: nothing to ask
  expect(w.trucks.map((t) => [t.route_id, t.shift_id, t.truck])).toEqual([['R1', NIGHT3, 'T-14']]);
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await page.click('nav [data-tab="storm"]');
  await expect(page.locator('[data-liveroute="R1"] [data-truckrow="R1"]')).toHaveText('Truck: T-14');
  await expect(page.locator('[data-liveroute="R2"] [data-truckrow="R2"]')).toHaveText('Truck: —');
});

test('with no current post, the Board asks once which shift its trucks are for', async ({ page }) => {
  // 4 PM on 10/3, nothing posted. The first Save asks (the shifts on offer at 4 PM: Day of 10/3, Night of
  // 10/3, none picked); Matt picks the night. The second route's Save does not ask again.
  const w = stormWorld();
  w.storms = []; w.posts = [];
  w.clock = '2026-10-03T16:00:30.000-08:00';
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: nothing is posted, so Save asks which shift');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('.shiftpick [data-shift]')).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);
  expect(truckCalls(calls)).toHaveLength(0);                             // nothing is sent before the pick
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('T-9');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
});

// Truck shift fix (10/4/26). In the afternoon the DAY post is still current, but Matt is planning TONIGHT:
// filing his trucks under the post's shift put them on the day sheet and left tonight's blank. So when a
// later shift is on offer, the Board asks Day or Night (from the post's shift on; none pre-picked), and
// Change re-opens the same question. The pick lasts until reload, never stored.
const DAY3 = 'day-2026-10-03';
const dayPostWorld = (clock) => {
  const w = stormWorld();
  w.storms = [];
  w.clock = clock;
  w.posts = [{ ...postOf(), shift: DAY3, posted_at: '2026-10-03T09:30:00.000-08:00' }];
  return w;
};
const pickerLabels = (page) => page.locator('.shiftpick [data-shift]');

test('a day post at 4 PM: Save asks Day or Night and Night files the truck under tonight', async ({ page }) => {
  // 4:00 PM on 10/3. Day post of 10/3 current. Shifts on offer: Day of 10/3, Night of 10/3 (both at or after
  // the post's day). Night is LATER than the post's shift, so Save must ask, offering exactly those two.
  const w = dayPostWorld('2026-10-03T16:00:30.000-08:00');
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);   // none pre-picked
  expect(truckCalls(calls)).toHaveLength(0);                                       // nothing sent before the pick
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
  expect(w.trucks.map((t) => [t.route_id, t.shift_id, t.truck])).toEqual([['R1', NIGHT3, 'T-14']]);
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
  // A second Save does not ask again.
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
  // The pick is never stored: after a reload the Board asks again.
  await page.reload();
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks: Save asks which shift');
});

test('a night post at 20:00 never asks', async ({ page }) => {
  // 8:00 PM on 10/3: shifts on offer are Day of 10/3 and Night of 10/3. The night post is the last shift
  // on offer, nothing is later, so its shift is sent with no picker.
  const w = stormWorld();
  w.storms = [];
  w.clock = at('20:00');
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: at('19:30') }];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: at('20:00') });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  await expect(page.locator('#dlg')).toBeHidden();
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: NIGHT3 });
});

test("Change switches the Board's truck shift", async ({ page }) => {
  // 4 PM, day post current. Change opens the same Day/Night question; Day is picked, the label follows and
  // the next Save sends the day; Change again to Night and the label and the next Save follow that.
  const w = dayPostWorld('2026-10-03T16:00:30.000-08:00');
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: AT_4PM });
  await page.click('nav [data-tab="board"]');
  await page.click('#truckchange');
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
  await expect(page.locator('.shiftpick [aria-pressed="true"]')).toHaveCount(0);
  await page.click('[data-shift="' + DAY3 + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Day of 10/3');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  await expect(page.locator('#dlg')).toBeHidden();                                 // Change answered it: no second question
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: DAY3 });
  await page.click('#truckchange');
  await page.click('[data-shift="' + NIGHT3 + '"]');
  await expect(page.locator('#truckshift')).toHaveText('Trucks for Night of 10/3');
  await page.fill('[data-truckinput="R2"]', 'T-9');
  await page.click('[data-settruck="R2"]');
  await expect.poll(() => truckCalls(calls).length).toBe(2);
  expect(truckCalls(calls)[1].body).toMatchObject({ route_id: 'R2', truck: 'T-9', shift: NIGHT3 });
});

test("Change offers nothing earlier than the post's shift", async ({ page }) => {
  // 7:30 AM on 10/3 the shifts on offer are Night of 10/2, Day of 10/3, Night of 10/3. The post is the DAY
  // of 10/3, so the night of 10/2 (already over) is not offered.
  const w = dayPostWorld('2026-10-03T07:50:18.445-08:00');
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await page.click('#truckchange');
  await expect(pickerLabels(page)).toHaveText(['Day of 10/3', 'Night of 10/3']);
});

test('the Board loads the trucks a lead set', async ({ page }) => {
  // Alex set N1's truck from his phone this shift (the night of 10/2). Matt opens the app and goes straight
  // to the Board, never the Storm tab: the Board reads the trucks itself.
  const w = stormWorld();
  w.trucks = [truckRow(1, 'R1', 'T-22', 'Alex Test', 'C01')];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveValue('');
  expect(shiftCalls(calls).length).toBeGreaterThanOrEqual(1);
});

test('Enter in a Board truck box saves it, before the Storm tab was ever opened', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(stormWorld()), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="board"]');
  await page.fill('[data-truckinput="R1"]', 'T-14');
  await page.press('[data-truckinput="R1"]', 'Enter');
  // 7:30 AM: later shifts are on offer, so Enter asks (10/4/26). The same Enter must not pick for him:
  // the picker's first button takes focus, and the key's own keypress used to click it.
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(pickerLabels(page)).toHaveText(['Night of 10/2', 'Day of 10/3', 'Night of 10/3']);
  expect(truckCalls(calls)).toHaveLength(0);
  await page.click('[data-shift="' + SHIFT + '"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-14', shift: SHIFT });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-14');
});

test("a lead sees the posted night's truck read-only until that night is running", async ({ page }) => {
  // 4 PM on 10/3: the day shift is running, and the post (Alex leads N1) is for the night of 10/3, with
  // Matt's truck T-14 set for it. Alex's save would be filed under the DAY (a lead's truck is always the
  // shift running), so his screen shows the night's truck read-only: no box until the night is on.
  const w = stormWorld();
  w.storms = [];
  w.moves = boardMoves();
  w.posts = [{ ...postOf(), shift: NIGHT3, posted_at: '2026-10-03T15:30:00.000-08:00' }];
  w.trucks = [{ ...truckRow(1, 'R1', 'T-14'), shift_id: NIGHT3 }];
  await openStorm(page, w, { token: 'tok-alex', clockAt: AT_4PM });
  await expect(page.locator('[data-truckrow="R1"]')).toHaveText('Truck: T-14');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
});

test("a lead changes their own route's truck from the Storm tab", async ({ page }) => {
  // The Board has Alex (C01) leading N1 only. The post says Alex leads N1 and Jordan (C03) leads N2.
  // Matt set N1's truck to T-9 at 6:10 AM; Alex changes it to T-22. N2 is not his: read-only.
  const w = stormWorld();
  w.moves = boardMoves();
  w.posts = [postOf({ R2: { lead: 'C03', members: [] } })];
  w.trucks = [truckRow(1, 'R1', 'T-9')];
  // His Storm tab is the driver's (final wave I1): his route N1 with its truck box; N2 (Jordan's) under Other routes, read-only.
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-9');
  await page.click('#otherRoutes');
  await expect(page.locator('[data-truckinput="R2"]')).toHaveCount(0);
  await expect(page.locator('[data-truckrow="R2"]')).toHaveText('Truck: —');
  await expect(page.locator('[data-settruck="R2"]')).toHaveCount(0);
  await page.fill('[data-truckinput="R1"]', 'T-22');
  await page.click('[data-settruck="R1"]');
  await expect.poll(() => truckCalls(calls).length).toBe(1);
  expect(truckCalls(calls)[0].body).toMatchObject({ route_id: 'R1', truck: 'T-22' });
  expect(truckCalls(calls)[0].body.shift).toBeUndefined(); // a lead's truck is the shift running: the server's, never the phone's
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-22'); // the newest row wins over Matt's T-9
  await expect(page.locator('[data-liveroute]')).toHaveCount(0); // no live view for a lead
});

test('a refused truck says why and keeps what was typed; a blank one is not sent', async ({ page }) => {
  // The post names Alex as N1's lead, but the Board does not: the server refuses and says so.
  const w = stormWorld();
  w.moves = [];
  w.posts = [postOf()];
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('[data-truckrow="R1"] .err')).toHaveText('Type the truck first');
  expect(truckCalls(calls)).toHaveLength(0);
  await page.fill('[data-truckinput="R1"]', 'T-5');
  await page.click('[data-settruck="R1"]');
  await expect(page.locator('[data-truckrow="R1"] .err')).toContainText("Only the dispatcher or that route's lead can set its truck.");
  await expect(page.locator('[data-truckinput="R1"]')).toHaveValue('T-5');
  expect(truckCalls(calls)).toHaveLength(1);
});

test('crew see the truck but cannot change it', async ({ page }) => {
  // Jordan rides N1 as a MEMBER (Trucks row: T-9): no box, since only the route's lead on
  // tonight's Board sets its truck (Part A, 10/4/26). N2 has no Trucks row but the post carries T-4.
  const w = stormWorld();
  w.posts = [postOf({ R1: { lead: null, members: ['C03'] }, R2: { truck: 'T-4' } })];
  w.trucks = [truckRow(1, 'R1', 'T-9')];
  await openStorm(page, w); // Jordan, crew
  await expect(page.locator('[data-truckrow="R1"]')).toHaveText('Truck: T-9');
  await page.click('#otherRoutes');
  await expect(page.locator('[data-truckrow="R2"]')).toHaveText('Truck: T-4');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
  await expect(page.locator('[data-settruck]')).toHaveCount(0);
  // Crew print nothing and see no Sheets line.
  await expect(page.locator('#printSheets')).toHaveCount(0);
  await expect(page.locator('#sheetsstatus')).toHaveCount(0);
  // Tonight shows the same two trucks.
  await page.click('nav [data-tab="tonight"]');
  await expect(page.locator('.tonight-route.mine')).toContainText('Truck: T-9');
  await expect(page.locator('.tonight-route:not(.mine)')).toContainText('Truck: T-4');
  await expect(page.locator('[data-truckinput]')).toHaveCount(0);
});

test('site units are typed in the site box and sent, blank by default', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const saves = () => calls.filter((c) => c.body.action === 'saveSite');
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_bobcat')).toHaveValue('');
  await expect(page.locator('#s_snowrator')).toHaveValue('');
  await page.click('#s_save'); // nothing typed: both fields still go, blank
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[0].body.record.units).toEqual({ bobcat: '', snowrator: '' });
  await page.click('[data-edit="site:S1"]');
  await page.fill('#s_bobcat', ' B-2 ');
  await page.fill('#s_snowrator', 'SR-1');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[1].body.record.units).toEqual({ bobcat: 'B-2', snowrator: 'SR-1' });
  // They come back; clearing one on purpose is sent as blank, and the other stays.
  await page.click('[data-edit="site:S1"]');
  await expect(page.locator('#s_bobcat')).toHaveValue('B-2');
  await expect(page.locator('#s_snowrator')).toHaveValue('SR-1');
  await page.fill('#s_bobcat', '');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[2].body.record.units).toEqual({ bobcat: '', snowrator: 'SR-1' });
  // A new site sends both too.
  await page.click('[data-edit="site:"]');
  await page.fill('#s_name', 'New Lot');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves()[3].body.record.units).toEqual({ bobcat: '', snowrator: '' });
});

test('Print sheets shows one page per route and shift, with not-done sites', async ({ page }) => {
  // liveWorld: N1 = PAC + EXTRA, N10 = NEWSITE, N2 = TUDOR-TRANSIT. One tap this shift: Alex plowed PAC's lot at 6:30.
  // The post puts Alex and Jordan on N1 and Alex on N2; it does not list N10.
  // Sheets (one per route with a tap or a posted crew), in route order: N1, N2. N10 has neither: no sheet.
  //   N1: PAC prints its one line, "Plowed 6:30 AM by Alex Test"; EXTRA has no tap at all: "Not done this shift".
  //   N2: nobody tapped, but a crew was posted: TUDOR-TRANSIT "Not done this shift".
  const w = liveWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') })];
  w.posts = [postOf()];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0)).toContainText('Route N1');
  await expect(sheets.nth(0)).toContainText('Night of 10/2');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'PAC' }).locator('.lot')).toHaveText('Plowed 6:30 AM by Alex Test');
  await expect(sheets.nth(0).locator('.site').filter({ hasText: 'EXTRA' })).toContainText('Not done this shift');
  await expect(sheets.nth(1)).toContainText('Route N2');
  await expect(sheets.nth(1).locator('.site').filter({ hasText: 'TUDOR-TRANSIT' })).toContainText('Not done this shift');
  await expect(page.locator('#printsheets')).not.toContainText('NEWSITE');
  await expect(sheets.nth(0).locator('footer')).toContainText('Made by Plow Command from driver taps');
  // One page each: a break after every sheet but the last.
  expect(await sheets.nth(0).evaluate((e) => getComputedStyle(e).breakAfter)).toBe('page');
  expect(await sheets.nth(1).evaluate((e) => getComputedStyle(e).breakAfter)).toBe('auto');
  // The print dialog is asked for once, and again from the Print button.
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  await page.click('#printNow');
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(2);
  // The sheet's own style does not leak into the app (its body rule would restyle the whole page).
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('header h1')).fontFamily)).not.toMatch(/Arial/);
});

test('Back closes the print view', async ({ page }) => {
  await stubPrint(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual(['print']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#printview')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2); // the live view, still in the app
  expect(page.url()).toContain('index.html');
  expect(await backSteps(page)).toEqual([]);
  // The in-app Back takes its step with it, so the next phone Back is not eaten by a stale one.
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await page.click('#printBack');
  await expect(page.locator('#printview')).toBeHidden();
  await expect.poll(() => backSteps(page)).toEqual([]);
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#printview')).toBeHidden();
  expect(page.url()).toContain('index.html');
});

test('the sheets status shows saved, failed with Retry, and making', async ({ page }) => {
  // Storm ST-1: Start (seq 1), End (2), Reopen (3), End again (4). The newest End is seq 4, so only
  // Sheets rows with end_seq 4 count, and the newest row per route and shift wins.
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' },
    { id: 'ST-3', seq: 3, kind: 'reopen', storm_id: 'ST-1', at: at('09:00'), by_name: 'Matthew' },
    { id: 'ST-4', seq: 4, kind: 'end', storm_id: 'ST-1', at: at('10:00'), by_name: 'Matthew' }];
  const sh = (n, route, endSeq, status) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', route_id: route, shift_id: SHIFT, end_seq: endSeq,
    file_id: status === 'saved' ? 'f' + n : '', url: status === 'saved' ? 'https://drive.example/f' + n : '', name: (route === 'R1' ? 'N1' : 'N2') + ' Night of 10-2.pdf',
    made_at: at('15:01'), status, error: status === 'failed' ? 'Drive said no' : '', updated: endSeq === 4, by_name: 'Plow Command' });
  // The first End's set: one saved, one failed. They belong to End 2, which is no longer the newest.
  w.sheets = [sh(1, 'R1', 2, 'saved'), sh(2, 'R2', 2, 'failed')];
  const fake = {};
  // The clock is pinned at 10:05, five minutes after End 4 (10:00): too soon to offer Retry on "making".
  const calls = await openStorm(page, w, { token: 'tok-matt', fake, clockAt: at('10:05') });
  const status = page.locator('#sheetsstatus');
  const retries = () => calls.filter((c) => c.body.action === 'retrySheets');
  // The newest End (4) has no Sheets row yet: making. The old End's failed row is not counted.
  await expect(status).toBeVisible();
  await expect(status).toHaveText('Sheets: making…');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // End 4's files: N1 saved, N2 failed -> "1 not saved", with Retry.
  w.sheets.push(sh(3, 'R1', 4, 'saved'), sh(4, 'R2', 4, 'failed'));
  await pollNow(page);
  await expect(status).toHaveText('Sheets: 1 not saved · Retry');
  // Retry: a double tap sends one, naming the storm; the reply says it is scheduled.
  await page.evaluate(() => { const b = document.getElementById('retrySheets'); b.click(); b.click(); });
  await expect.poll(() => retries().length).toBe(1);
  expect(retries()[0].body).toMatchObject({ storm_id: 'ST-1', token: 'tok-matt' });
  await expect(page.locator('#sheetsmsg')).toContainText('Retrying');
  // A Retry while the job is already running is queued, and the phone says so.
  fake.retryReply = { ok: true, storm_id: 'ST-1', failed: 1, owed: 1, scheduled: false, running: true };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(2);
  await expect(page.locator('#sheetsmsg')).toHaveText('Sheets are being made now; your Retry is queued');
  // The job saves N2: its newest row (seq 5) is saved, so all is saved and Retry goes.
  w.sheets.push(sh(5, 'R2', 4, 'saved'));
  await pollNow(page);
  await expect(status).toHaveText('Sheets: 2 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // Open again: no line while the storm is open.
  w.storms.push({ id: 'ST-5', seq: 5, kind: 'reopen', storm_id: 'ST-1', at: at('11:00'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(status).toHaveCount(0);
});

// Ten minutes after the newest End, a sheet that has still not appeared is not "being made": the job
// never ran (or died), and Matt can Retry. Before that, only the wait is shown. The clock is pinned at
// 8:09 AM, 9 minutes after an End at 8:00, then moved to 8:11 (11 minutes after).
const endedAt8 = () => {
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' }];
  w.sheets = [];
  return w;
};
const savedRow = (n, route) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', route_id: route, shift_id: SHIFT, end_seq: 2, file_id: 'f' + n,
  url: 'https://drive.example/f' + n, name: (route === 'R1' ? 'N1' : 'N2') + ' Night of 10-2.pdf', made_at: at('08:02'), status: 'saved', error: '', updated: false, by_name: 'Plow Command' });

test('"making" offers Retry only ten minutes after the End, and Retry answers are said', async ({ page }) => {
  const w = endedAt8(), fake = {};
  const calls = await openStorm(page, w, { token: 'tok-matt', fake, clockAt: at('08:09') });
  const retries = () => calls.filter((c) => c.body.action === 'retrySheets');
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: making…'); // 9 minutes: still waiting
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await page.clock.fastForward(2 * 60 * 1000); // 8:11, 11 minutes after the End
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: making… · Retry');
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(1);
  expect(retries()[0].body).toMatchObject({ storm_id: 'ST-1' });
  await expect(page.locator('#sheetsmsg')).toContainText('Retrying');
  // Nothing owed (the sheets arrived in the meantime): the phone says so.
  fake.retryReply = { ok: true, storm_id: 'ST-1', failed: 0, owed: 0, scheduled: false };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(2);
  await expect(page.locator('#sheetsmsg')).toHaveText('Nothing to retry.');
  // A refusal is shown with its reason.
  fake.retryReply = { ok: false, code: 'invalid', reason: 'That storm is open: its sheets are made when it is ended' };
  await page.click('#retrySheets');
  await expect.poll(() => retries().length).toBe(3);
  await expect(page.locator('#sheetsmsg')).toHaveText('Retry not sent: That storm is open: its sheets are made when it is ended');
});

test('"N of M saved" offers Retry only ten minutes after the End', async ({ page }) => {
  // The post names Alex on N1 and N2: this phone expects two sheets (N1 and N2, night of 10/2).
  // Only N1's file has been made: 1 of 2. Nothing failed, so before 10 minutes it is "making", after it Retry.
  const w = endedAt8();
  w.sheets = [savedRow(1, 'R1')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · making…');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await page.clock.fastForward(2 * 60 * 1000);
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · Retry');
  // The second file lands: all saved, no Retry.
  w.sheets.push(savedRow(2, 'R2'));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 2 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test("the Sheets status, Retry and Print sheets are Matt's alone", async ({ page, browser }) => {
  // Final review I2: Print is in "Matt's live view" (the spec). A lead's phone holds no Posts but the
  // newest, so its print could differ from the PDF in Drive: leads have no Print (they have Copy for BT).
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' }];
  w.sheets = [{ id: 'SH-1', seq: 1, storm_id: 'ST-1', route_id: 'R1', shift_id: SHIFT, end_seq: 2, status: 'failed', error: 'x', name: 'N1 Night of 10-2.pdf', updated: false }];
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();     // the lead's screen drew (the driver's)
  await expect(page.locator('#stormctl')).toHaveCount(0);                // no storm open: Reopen is the dispatcher's (I1)
  await expect(page.locator('#sheetsstatus')).toHaveCount(0);
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await expect(page.locator('#printSheets')).toHaveCount(0);
  // Matt, same storm, his own phone: all three.
  const matt = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await matt.newPage();
    await openStorm(p2, w, { token: 'tok-matt' });
    await expect(p2.locator('#printSheets')).toBeVisible();
    await expect(p2.locator('#sheetsstatus')).toBeVisible();
    await expect(p2.locator('#retrySheets')).toBeVisible();
  } finally { await matt.close(); }
});

test('an ended storm with nothing logged says so, with no Retry', async ({ page }) => {
  // Final review M2. Started 6:00, ended 8:00, nobody tapped, carded or was posted: no sheet is owed
  // (the server makes none and writes no Sheets row). Twenty minutes later it must not still say
  // "making…" with a Retry that can only answer "Nothing to retry".
  const w = endedAt8();
  w.posts = [];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:20') });
  await expect(page.locator('#sheetsstatus')).toBeVisible();
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: none (nothing logged)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

// ---------------- Download CSV, and the CSV on the Sheets line (Plow Command, Task 17) ----------------
// The storm's one spreadsheet. At every End the backend files it in Drive beside the route sheets (a Sheets row of kind
// 'csv': no route, no shift, made_for 'end'); Matt's phone builds the same text itself, from the rows it holds, with the
// shared lib/csv.js, and hands it over as a file. Nothing is sent to the server.
const CrewCsv = require('../lib/csv.js');

// Two storms are in the rows. ST-0 (9/20, long over) left a tap and a card on PAC; they must never reach this storm's file.
// ST-1 started 10/2 at 10:00 AM and is open. At the storm clock (7:30 AM on 10/3, still the night of 10/2):
//   N1 = PAC, truck T-5: Alex plowed it at 6:30 AM; his card says 2.5 inches of new snow and "salt 2 bags".
//   N2 = TUDOR-TRANSIT, no truck: nobody tapped it, but a crew was posted (Alex leads N2 too).
const csvWorld = () => {
  const w = stormWorld();
  w.storms = [
    { id: 'ST-0', seq: 1, kind: 'start', storm_id: 'ST-0', at: '2026-09-20T06:00:00.000-08:00', by_name: 'Matthew' },
    { id: 'ST-0e', seq: 2, kind: 'end', storm_id: 'ST-0', at: '2026-09-21T08:00:00.000-08:00', by_name: 'Matthew' },
    { id: 'ST-1', seq: 3, kind: 'start', storm_id: 'ST-1', at: '2026-10-02T10:00:00.000-08:00', by_name: 'Matthew' }];
  w.posts = [postOf()];
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Old Driver', { storm_id: 'ST-0', shift_id: 'night-2026-09-20', at: '2026-09-20T23:10:00.000-08:00' }),
    logRow(2, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') })];
  w.visits = [visitRow(1, 'S1', 'C09', 'Old Driver', { storm_id: 'ST-0', shift_id: 'night-2026-09-20', depth_in: '9' }),
    visitRow(2, 'S1', 'C01', 'Alex Test', { depth_in: '2.5', materials_used: 'salt 2 bags' })];
  w.trucks = [truckRow(1, 'R1', 'T-5')];
  return w;
};

test('live view: Download CSV saves a file named Plow visits 10-2.csv whose text equals CrewCsv.stormCsv over the fake rows', async ({ page }) => {
  const w = csvWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-csv]')).toBeVisible();
  await expect(page.locator('[data-csv]')).toHaveText('Download CSV');
  const before = calls.length;
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-csv]')]);
  // The name: the storm's start date, month-day with no padding. Not "(updated ...)": the first file of the storm.
  expect(download.suggestedFilename()).toBe('Plow visits 10-2.csv');
  const bytes = fs.readFileSync(await download.path());
  const text = bytes.toString('utf8');
  // The file starts with the UTF-8 byte order mark ONCE (final wave M4: the text carries it, the Blob adds none): EF BB BF, then
  // the header's "s". Node's utf8 read keeps the mark as the first character of `text`.
  expect([...bytes.subarray(0, 4)]).toEqual([0xEF, 0xBB, 0xBF, 's'.charCodeAt(0)]);
  // Worked out on paper. Only ST-1's rows count (ST-0's tap by Old Driver and its 9-inch card are another storm's).
  //   Start row of ST-1: 2026-10-02 10:00 -> the storm_start cell on every line.
  //   Sheets owed (one per live route with a tap, a card or a posted crew, in route order): N1 and N2, both the night of 10/2.
  //   N1 / PAC: plowed by Alex Test at 2026-10-03 06:30; truck T-5 (the Trucks row); new snow "Alex Test 2.5"; materials
  //             "Alex Test salt 2 bags"; he is on N1's posted crew, so off_route no. No address, no customer: two empty cells.
  //   N2 / TUDOR-TRANSIT: no tap -> "not done", no driver and no time; no truck; nothing else.
  // 14 columns, CRLF after every line, the last too. Names are cells as they are (no commas to quote).
  const paper = String.fromCharCode(0xFEFF) + [
    'storm_start,shift,route,truck,driver,site,address,customer,plowed_at,state,problem_note,new_snow_in,materials_used,off_route',
    '2026-10-02 10:00,Night of 10/2,N1,T-5,Alex Test,PAC,,,2026-10-03 06:30,plowed,,Alex Test 2.5,Alex Test salt 2 bags,no',
    '2026-10-02 10:00,Night of 10/2,N2,,,TUDOR-TRANSIT,,,,not done,,,,no',
  ].join('\r\n') + '\r\n';
  expect(text).toBe(paper);
  // And the shared code over the same rows, built the way the app builds the sheets' rows (shiftlogui sheetOpts). The backend's own
  // tests proved stormCsv on paper; this is the proof that the phone hands it THIS storm's rows and the right name.
  const o = { storm_id: 'ST-1', routes: w.routes, sites: w.sites, zones: w.zones, crew: w.crew, log: w.log, visits: w.visits,
    posts: w.posts, moves: [], trucks: w.trucks, storms: w.storms };
  expect(text).toBe(CrewCsv.stormCsv(o));
  expect(download.suggestedFilename()).toBe(CrewCsv.fileName(o));
  // The file is made on the phone: the tap sends nothing (only the polls that were already going).
  expect(calls.slice(before).filter((c) => !['getShiftLog', 'getPost', 'getZones', 'getCrew'].includes(c.body.action))).toEqual([]);
});

// Matt's alone, like Print sheets: a lead's phone holds only the newest Post, so its file could differ from the one in Drive.
const csvLast = () => {   // the last storm, ended: the sheets exist, the controls still draw (Reopen)
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' }];
  return w;
};
test('live view: crew and leads never see Download CSV; Matt sees it on the last storm, and not before there has been one', async ({ page, browser }) => {
  const w = csvLast();
  // A lead (Alex leads N1 on the post): the driver's screen draws, with no storm controls while no storm is open (final wave
  // I1: Reopen is the dispatcher's); Print and Download do not.
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  await expect(page.locator('[data-csv]')).toHaveCount(0);
  await expect(page.locator('#printSheets')).toHaveCount(0);
  const other = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    // A plain crew member has no storm controls at all.
    const p2 = await other.newPage();
    await openStorm(p2, w, { token: 'tok-jordan' });
    await expect(p2.locator('#stormhead')).toBeVisible();
    await expect(p2.locator('[data-csv]')).toHaveCount(0);
    // Matt, same ended storm: both buttons.
    const p3 = await other.newPage();
    await openStorm(p3, w, { token: 'tok-matt' });
    await expect(p3.locator('#printSheets')).toBeVisible();
    await expect(p3.locator('[data-csv]')).toBeVisible();
    // Before any storm has ever been started there is nothing to download: the controls draw (Start storm), the button does not.
    const none = stormWorld(); none.storms = [];
    const p4 = await other.newPage();
    await openStorm(p4, none, { token: 'tok-matt' });
    await expect(p4.locator('[data-storm="start"]')).toBeVisible();
    await expect(p4.locator('[data-csv]')).toHaveCount(0);
    await expect(p4.locator('#printSheets')).toHaveCount(0);
  } finally { await other.close(); }
});

// The End's set, as the backend writes it (plow-command-script Code.js makeStormSheets_): every row says made_for and for_seq;
// a route sheet names its route and shift, the storm's csv has neither. The newest row per sheet stands (a Retry adds one).
const setRow = (n, kind, route, status, forSeq = 2) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', made_for: 'end', for_seq: forSeq, end_seq: forSeq,
  kind, route_id: kind === 'csv' ? '' : route, shift_id: kind === 'csv' ? '' : SHIFT,
  file_id: status === 'saved' ? 'f' + n : '', url: status === 'saved' ? 'https://drive.example/f' + n : '',
  name: kind === 'csv' ? 'Plow visits 10-3.csv' : (route === 'R1' ? 'N1' : 'N2') + ' Night of 10-2.pdf',
  made_at: at('08:02'), status, error: status === 'failed' ? 'Drive said no' : '', updated: false, by_name: 'Plow Command' });

test('the sheets line counts the CSV: two PDFs and the csv saved read 3 saved, no Retry', async ({ page }) => {
  // endedAt8: the post names Alex on N1 and N2, so this phone expects two PDFs (N1 and N2, the night of 10/2). 2 PDFs + the csv = 3 saved.
  const w = endedAt8();
  w.sheets = [setRow(1, 'route', 'R1', 'saved'), setRow(2, 'route', 'R2', 'saved'), setRow(3, 'csv', '', 'saved')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 3 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test('the sheets line counts the CSV: a failed csv reads 1 not saved with Retry, and the Retry row that saves it clears it', async ({ page }) => {
  // Both PDFs saved, the csv failed: 1 not saved, with Retry (the server's Retry makes the csv again).
  const w = endedAt8();
  w.sheets = [setRow(1, 'route', 'R1', 'saved'), setRow(2, 'route', 'R2', 'saved'), setRow(3, 'csv', '', 'failed')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 not saved · Retry');
  await expect(page.locator('#retrySheets')).toBeVisible();
  // The Retry adds a NEW row (seq 4), saved. The newest row for the csv stands, so all three are saved.
  w.sheets.push(setRow(4, 'csv', '', 'saved'));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 3 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test('the sheets line: a saved csv never stands in for a PDF that is missing', async ({ page }) => {
  // Two PDFs are owed (N1, N2) and the storm's csv: 3 files. N1's PDF and the csv are saved, N2's PDF is not made yet:
  // 2 of 3, not "2 saved" (which would count the csv in place of N2's sheet). Nine minutes after the End it is still being made;
  // at eleven minutes Retry is offered.
  const w = endedAt8();
  w.sheets = [setRow(1, 'route', 'R1', 'saved'), setRow(2, 'csv', '', 'saved')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 2 of 3 saved · making…');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  await page.clock.fastForward(2 * 60 * 1000);
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 2 of 3 saved · Retry');
});

test("the sheets line: an earlier End's csv is another set, whatever became of it", async ({ page }) => {
  // End 2 (first), Reopen 3, End 4 (newest). End 2's set: both PDFs saved, its csv FAILED (never retried). End 4's set so far:
  // both PDFs saved, no csv row yet. The line is End 4's alone: its two PDFs saved. End 2's failed csv is not "1 not saved".
  const w = stormWorld();
  w.storms = [START_ROW, { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' },
    { id: 'ST-3', seq: 3, kind: 'reopen', storm_id: 'ST-1', at: at('09:00'), by_name: 'Matthew' },
    { id: 'ST-4', seq: 4, kind: 'end', storm_id: 'ST-1', at: at('10:00'), by_name: 'Matthew' }];
  w.sheets = [setRow(1, 'route', 'R1', 'saved', 2), setRow(2, 'route', 'R2', 'saved', 2), setRow(3, 'csv', '', 'failed', 2),
    setRow(4, 'route', 'R1', 'saved', 4), setRow(5, 'route', 'R2', 'saved', 4)];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('10:05') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 2 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // End 4's own csv fails: now it is "1 not saved". Its Retry saves it: 3 saved. The old End's failed row still counts for nothing.
  w.sheets.push(setRow(6, 'csv', '', 'failed', 4));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 not saved · Retry');
  w.sheets.push(setRow(7, 'csv', '', 'saved', 4));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 3 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test('the Log tab is gone and the admin tabs are storm, routes, sites, board, roster', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('#tabs button')).toHaveCount(5);
  expect(await page.locator('#tabs button').evaluateAll((els) => els.map((e) => e.dataset.tab))).toEqual(['storm', 'routes', 'sites', 'board', 'roster']);
  await expect(page.locator('nav [data-tab="log"]')).toHaveCount(0);
});

// Final review I1. A storm from the day of 10/2 (start 10:00) into that night. Two Posts: the DAY's
// (Jordan leads N2, nobody on N1), then the night's, which is the newest (Alex leads N1 with Jordan; N2
// empty). The Board (moved at 5 PM on 10/2) has Alex and Jordan on N1, nobody on N2.
const DAY2 = 'day-2026-10-02';
const twoPostStorm = () => {
  const w = stormWorld();
  w.storms = [{ ...START_ROW, at: '2026-10-02T10:00:00.000-08:00' }];
  w.moves = boardMoves();
  w.posts = [
    { ...postOf({ R1: { lead: null, members: [] }, R2: { lead: 'C03', members: [] } }), id: 'P-day', shift: DAY2, posted_at: '2026-10-02T09:30:00.000-08:00' },
    { ...postOf({ R2: { lead: null, members: [] } }), id: 'P-night', posted_at: '2026-10-02T17:30:00.000-08:00' },
  ];
  return w;
};

test("Print of an earlier shift shows that shift's posted crew, not the Board", async ({ page }) => {
  // Taps: Jordan plowed TUDOR-TRANSIT (N2) at 11:00 on 10/2 (day of 10/2); Alex plowed PAC (N1)
  // at 6:30 on 10/3 (night of 10/2). Sheets, worked by hand: N2 Day of 10/2 (its tap; crew from the DAY's
  // Post: Jordan leads), N1 Night of 10/2 (its tap; the night's Post: Alex, Jordan). N1 has no day sheet
  // (no tap, empty in the day Post); N2 none at night (no tap, empty in the night Post).
  // With only the newest Post, the day sheet's crew would come from the Board: "—", "not posted".
  const w = twoPostStorm();
  w.log = [logRow(1, 'S2', 'lot', 'plowed', 'Jordan Demo', { by_key: 'C03', shift_id: DAY2, at: '2026-10-02T11:00:00.000-08:00' }),
    logRow(2, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') })];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0).locator('h1')).toHaveText('Route N2Day of 10/2');
  await expect(sheets.nth(0).locator('.head')).toContainText('Lead: Jordan Demo');
  await expect(sheets.nth(0)).not.toContainText('not posted');
  await expect(sheets.nth(1).locator('h1')).toHaveText('Route N1Night of 10/2');
  await expect(sheets.nth(1).locator('.head')).toContainText('Lead: Alex Test');
  await expect(sheets.nth(1).locator('.head')).toContainText('Crew: Jordan Demo');
});

test("the Sheets count expects an earlier shift's posted crew that logged nothing", async ({ page }) => {
  // The same storm, ended at 8:00 on 10/3. One tap: Alex, PAC's lot (N1), 6:30, night of 10/2. Sheets owed,
  // worked by hand: N2 Day of 10/2 (the DAY's Post sent Jordan out on N2: a true "Not done") and N1 Night
  // of 10/2 (the tap). N1's night file is saved: "1 of 2 saved", not "1 saved". Nine minutes after the End.
  const w = twoPostStorm();
  w.storms.push({ id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: at('08:00'), by_name: 'Matthew' });
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') })];
  w.sheets = [savedRow(1, 'R1')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:09') });
  await expect(page.locator('#sheetsstatus')).toBeVisible();
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 of 2 saved · making…');
});

test('the print rule hides the app only while Print sheets is open', async ({ page }) => {
  // Final review M6: the @media print rule hid everything but #printview on ANY print of the app (a
  // browser's own Print, a screenshot to PDF). It now applies only while the Print view is open.
  await stubPrint(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
  await page.click('#printSheets');
  await expect(page.locator('body')).toHaveClass(/(^|\s)printing(\s|$)/);
  await expect(page.locator('header')).toBeHidden();
  await expect(page.locator('#printsheets')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });                          // the bar (and its Back) is not printed
  await page.click('#printBack');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printview')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/(^|\s)printing(\s|$)/);
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
});

test('a note with <b> prints as text', async ({ page }) => {
  // The note (in the lot's Problem line), and the site's materials line, hold markup. Both must print as the
  // characters typed.
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, materials_needed: '<script>window.__x = 1</script>' } : s));
  w.log = [logRow(1, 'S1', 'lot', 'problem', 'Alex Test', { note: '<b>ice</b> & "mud"', at: at('06:30') })];
  await stubPrint(page);
  await openStorm(page, w, { token: 'tok-matt' });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect(page.locator('#printsheets .lot')).toHaveText('Problem: <b>ice</b> & "mud" 6:30 AM by Alex Test');
  await expect(page.locator('#printsheets .lot b')).toHaveCount(0);
  await expect(page.locator('#printsheets')).toContainText('<script>window.__x = 1</script>');
  await expect(page.locator('#printsheets script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

// Final review minor 1: a map opened from a drilled-in route sits on top of the route.
test('Back from a site map opened on a route returns to the route, then the live view', async ({ page }) => {
  await tiles(page);
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await openRoute(page, 'R1');
  await page.click('.shift-site [data-map="S1"]');
  await expect(page.locator('#mapback')).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual(['route', 'map']);
  await page.goBack(); // the phone's Back
  await expect(page.locator('#mapback')).toBeHidden();
  await expect(page.locator('#liveBack')).toBeVisible(); // the route, not the live view
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#liveBack')).toBeHidden();
  await expect(page.locator('[data-liveroute]')).toHaveCount(2);
  expect(page.url()).toContain('index.html');
  expect(await backSteps(page)).toEqual([]);
});

// ---------------- the 8 AM handoff (handoff sheets, Matt 10/5/26; the lot, Plow Command 10/21/26) ----------------
// Night crews stop at 8 AM and the day crew starts at 9. The night of 10/2 is handed off at 8:00 AM on
// 10/3 by the 8 AM run (by_name 'Plow Command'). Worked by hand:
//   Routes by name: D1 (R3: DAY-SITE), N1 (R1: PAC, LEFT-RANK-2, LEFT-RANK-1), N2 (R2: TUDOR-TRANSIT).
//   Night Post (night of 10/2): Alex leads N1 with Jordan, Alex leads N2, D1 empty. So night_routes = [R1, R2].
//   Day Post (day of 10/3, posted 8:30, the newest, so the one a crew phone holds): Alex leads D1 with
//   Jordan, Alex leads N2, N1 empty. Day routes, by name: D1 (Alex, Jordan), N2 (Alex).
//   Night's taps, seq 1-5 (the mark's log_seq is 5), each on a site's one lot:
//     PAC: a Problem "cars in the lot" 6:00, then plowed 6:05: plowed, so not left by night.
//     LEFT-RANK-2 (day rank 2): plowed 6:10, a Problem "drift at the gate" 6:15, a Problem "ice at door" 6:20:
//       its newest standing row is the 6:20 Problem, so it is left, Not plowed, with that note.
//     LEFT-RANK-1 (day rank 1) and TUDOR-TRANSIT (unranked): untouched, Not plowed.
//   Left by night, in day order: LEFT-RANK-1 (rank 1), LEFT-RANK-2 (rank 2), TUDOR-TRANSIT (unranked).
//   Route order would put LEFT-RANK-2 first.
//   The words are CrewHandoff.leftoverParts' and siteParts' (the day PDF's): "Not plowed", "Problem: <note>",
//   "Started by <name> <h:mm>", "Done <h:mm>"; a day-route line "Plowed" or "Not plowed", then "Night: plowed" or
//   "Night: problem" on a site night tapped.
// The repo is public: every site carrying a day rank or a callout has a made-up name.
const hoRoutes = (d1, n1, n2) => [
  { id: 'R3', name: 'D1', sites: [{ id: 'S5', name: 'DAY-SITE' }], lead: null, members: [], ...d1 },
  { id: 'R1', name: 'N1', sites: [{ id: 'S1', name: 'PAC' }, { id: 'S3', name: 'LEFT-RANK-2' }, { id: 'S4', name: 'LEFT-RANK-1' }], lead: null, members: [], ...n1 },
  { id: 'R2', name: 'N2', sites: [{ id: 'S2', name: 'TUDOR-TRANSIT' }], lead: null, members: [], ...n2 }];
const HO_NIGHT_POST = { ...POST, id: 'P-night', shift: SHIFT, posted_at: '2026-10-02T17:30:00.000-08:00', routes: hoRoutes({}, { lead: 'C01', members: ['C03'] }, { lead: 'C01' }) };
const HO_DAY_POST = { ...POST, id: 'P-day', shift: DAY3, posted_at: '2026-10-03T08:30:00.000-08:00', routes: hoRoutes({ lead: 'C01', members: ['C03'] }, {}, { lead: 'C01' }) };
const HANDOFF_ROW = { id: 'ST-2', seq: 2, kind: 'handoff', storm_id: 'ST-1', shift_id: SHIFT, at: at('08:00'), by_name: 'Plow Command', by_profile: '',
  log_seq: 5, visit_seq: 0, truck_seq: 0, night_routes: ['R1', 'R2'] };
const HO_DAY = '2026-10-03T09:30:00-08:00', HO_NIGHT = '2026-10-03T06:30:00-08:00';
const handoffWorld = () => {
  const w = stormWorld();
  w.sites = [{ id: 'S1', name: 'PAC', rev: 1 }, { id: 'S2', name: 'TUDOR-TRANSIT', rev: 1 }, { id: 'S3', name: 'LEFT-RANK-2', rev: 1, day_rank: 2 },
    { id: 'S4', name: 'LEFT-RANK-1', rev: 1, day_rank: 1 }, { id: 'S5', name: 'DAY-SITE', rev: 1 }];
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S3', 'S4'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] },
    { id: 'R3', name: 'D1', rev: 1, site_ids: ['S5'] }];
  w.posts = [HO_NIGHT_POST, HO_DAY_POST];
  w.storms = [START_ROW, HANDOFF_ROW];
  w.log = [logRow(1, 'S1', 'lot', 'problem', 'Alex Test', { note: 'cars in the lot', at: at('06:00') }), logRow(2, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:05') }),
    logRow(3, 'S3', 'lot', 'plowed', 'Alex Test', { at: at('06:10') }), logRow(4, 'S3', 'lot', 'problem', 'Alex Test', { note: 'drift at the gate', at: at('06:15') }),
    logRow(5, 'S3', 'lot', 'problem', 'Alex Test', { note: 'ice at door', at: at('06:20') })];
  return w;
};
// A tap after the mark, filed under the day of 10/3 as the server would.
const dayTap = (n, siteId, zoneId, state, by, byKey, hhmm, extra) => logRow(n, siteId, zoneId, state, by, { by_key: byKey, shift_id: DAY3, at: at(hhmm), ...extra });
const card = (page) => page.locator('#handoff');
const leftIds = (page) => idsOf(page, 'data-leftover');

test('the handoff card at 9:30: the heading, your day route, and what night left in day order', async ({ page }) => {
  await openStorm(page, handoffWorld(), { clockAt: HO_DAY }); // Jordan, on D1 in the day Post
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 8:00 AM'); // the 8 AM run: no "· by"
  // Your route: Jordan's day-Post route only. N2 is crewed on the day Post too, but not with Jordan.
  await expect(card(page).locator('.handoff-part')).toHaveText(['Your route', 'Left by night (3)']);
  expect(await idsOf(page, 'data-handoffroute')).toEqual(['R3']);
  await expect(card(page).locator('[data-handoffroute="R3"] .handoff-route')).toHaveText('D1 · Lead: Alex Test · Crew: Jordan Demo');
  await expect(card(page).locator('[data-daysite="S5"]')).toHaveText('DAY-SITE · Not plowed'); // night never tapped it: no "Night:"
  // Left by night: the three sites night did not plow, ranked ones first by day rank; the open Problem's newest note.
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
  await expect(page.locator('[data-leftover="S4"]')).toHaveText('LEFT-RANK-1 · Not plowed');
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · Not plowed · Problem: ice at door');
  await expect(page.locator('[data-leftover="S2"]')).toHaveText('TUDOR-TRANSIT · Not plowed');
  // Names only: the day Post carries phones, and none reaches the card.
  await expect(card(page)).not.toContainText('555-01');
  // At the top of the Storm tab, above Jordan's own route.
  expect((await card(page).boundingBox()).y).toBeLessThan((await page.locator('.shift-route').first().boundingBox()).y);
});

test("Matt's card lists every day route, above the storm controls; a tapped handoff says who", async ({ page }) => {
  const w = handoffWorld();
  w.storms = [START_ROW, { ...HANDOFF_ROW, at: at('07:10'), by_name: 'Alex Test' }];
  await openStorm(page, w, { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 7:10 AM · by Alex Test');
  await expect(card(page).locator('.handoff-part')).toHaveText(['Day routes', 'Left by night (3)']);
  expect(await idsOf(page, 'data-handoffroute')).toEqual(['R3', 'R2']); // D1, N2: by name
  await expect(card(page).locator('[data-handoffroute="R2"] .handoff-route')).toHaveText('N2 · Lead: Alex Test · Crew: —');
  await expect(card(page).locator('[data-daysite="S2"]')).toHaveText('TUDOR-TRANSIT · Not plowed');
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
  expect((await card(page).boundingBox()).y).toBeLessThan((await page.locator('#stormctl').boundingBox()).y);
});

test('the day route lines say what night did: Night: plowed, Night: problem; an untapped site says nothing of night', async ({ page }) => {
  // The day Post crews N1 too (Alex leads it). N1's sites on day shift, in day order: LEFT-RANK-1 (rank 1),
  // LEFT-RANK-2 (rank 2), PAC (unranked). Night tapped PAC (plowed by the mark) and LEFT-RANK-2 (a Problem by the
  // mark); LEFT-RANK-1 not at all. The first word is the DAY's (final wave C3: done this shift): nobody has tapped any of
  // the three on the day of 10/3, so all three read Not plowed, PAC with "Night: plowed" beside it.
  const w = handoffWorld();
  w.posts = [HO_NIGHT_POST, { ...HO_DAY_POST, routes: hoRoutes({ lead: 'C01', members: ['C03'] }, { lead: 'C01' }, {}) }];
  await openStorm(page, w, { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  expect(await idsOf(page, 'data-handoffroute')).toEqual(['R3', 'R1']); // D1, N1: by name
  const n1 = card(page).locator('[data-handoffroute="R1"]');
  expect(await n1.locator('[data-daysite]').evaluateAll((els) => els.map((e) => e.dataset.daysite))).toEqual(['S4', 'S3', 'S1']);
  await expect(n1.locator('[data-daysite="S1"]')).toHaveText('PAC · Not plowed · Night: plowed');
  await expect(n1.locator('[data-daysite="S3"]')).toHaveText('LEFT-RANK-2 · Not plowed · Night: problem');
  await expect(n1.locator('[data-daysite="S4"]')).toHaveText('LEFT-RANK-1 · Not plowed');
});

test('with no day Post a crew card has no "Your route", and still lists what night left', async ({ page }) => {
  // Only the night Post: at 9:30 it is stale, so Jordan's phone has no day route to show (ruling 10/5/26).
  const w = handoffWorld(); w.posts = [HO_NIGHT_POST];
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.handoff-part')).toHaveText(['Left by night (3)']);
  await expect(page.locator('[data-handoffroute]')).toHaveCount(0);
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
});

test('the card is hidden at night: 10 PM, after night shift on', async ({ page }) => {
  // The same handoff, read at 10 PM on 10/3 with night shift on since 6 PM: the night of 10/3, not day.
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' });
  await openStorm(page, w, { clockAt: '2026-10-03T22:00:00-08:00' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped'); // the poll has landed
  await expect(page.locator('[data-shiftsite="S5"]')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the card is up at 8:30, after the 8:00 run: the night handed off, before the day crew starts', async ({ page }) => {
  // 8:30 AM on 10/3 is still the night of 10/2 by the clock (9 AM cutover): the night the row hands off.
  await openStorm(page, handoffWorld(), { clockAt: at('08:30') });
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 8:00 AM');
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
});

test('after a quiet night the old card does not come back the next day', async ({ page }) => {
  // The night of 10/2 was handed off at 8:00 on 10/3. Night shift on at 6 PM on 10/3, nothing tapped that
  // night, so the 8 AM run on 10/4 handed off nothing. At 9:30 on 10/4 (the day of 10/4) the only handoff is
  // the night of 10/2's, whose day was 10/3: no card.
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' });
  await openStorm(page, w, { token: 'tok-matt', clockAt: '2026-10-04T09:30:00-08:00' });
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the card is hidden with no handoff', async ({ page }) => {
  const w = handoffWorld(); w.storms = [START_ROW];
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('[data-shiftsite="S5"]')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the card goes at Close storm', async ({ page }) => {
  const w = handoffWorld();
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'end', storm_id: 'ST-1', at: at('09:35'), by_name: 'Matthew' });
  await pollNow(page);
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(card(page)).toBeHidden();
});

test("the next night's handoff replaces the card", async ({ page }) => {
  // The storm runs on: night shift on at 6 PM on 10/3, TUDOR-TRANSIT plowed that night at 11 PM (seq 6),
  // and the 8 AM run hands off the night of 10/3 at 8:00 on 10/4 (seq 4, log_seq 6). At 9:30 on 10/4 the
  // card is that handoff's. What THAT night left (final wave C3: a lot is done this shift): of N1 and N2's sites only
  // TUDOR-TRANSIT was plowed on the night of 10/3; PAC was plowed on the night of 10/2, not this one, so it is left too.
  // Day order: LEFT-RANK-1 (rank 1), LEFT-RANK-2 (rank 2), then PAC (unranked).
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' },
    { ...HANDOFF_ROW, id: 'ST-4', seq: 4, shift_id: 'night-2026-10-03', at: '2026-10-04T08:00:00.000-08:00', log_seq: 6 });
  w.log.push(logRow(6, 'S2', 'lot', 'plowed', 'Alex Test', { shift_id: 'night-2026-10-03', at: '2026-10-03T23:00:00.000-08:00' }));
  await openStorm(page, w, { token: 'tok-matt', clockAt: '2026-10-04T09:30:00-08:00' });
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/3 · 8:00 AM');
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S1']);
  await expect(page.locator('[data-leftover="S1"]')).toHaveText('PAC · Not plowed');
});

test('a day tap on a leftover shows "Started by" on the next poll; a plowed one moves last with Done', async ({ page }) => {
  const w = handoffWorld();
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · Not plowed · Problem: ice at door');
  await page.evaluate(() => { window.__sameLoad = true; });
  // 9:41: Jordan finds the gate still locked at LEFT-RANK-2 and says so from another phone: a real tap after the
  // mark (Started by), still a Problem (its new note), not plowed. This phone hears it on its next poll.
  w.log.push(dayTap(6, 'S3', 'lot', 'problem', 'Jordan Demo', 'C03', '09:41', { note: 'gate still locked' }));
  await pollNow(page);
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · Not plowed · Problem: gate still locked · Started by Jordan Demo 9:41');
  // 9:50: Alex plows LEFT-RANK-1. It is done, and goes to the end of the list.
  w.log.push(dayTap(7, 'S4', 'lot', 'plowed', 'Alex Test', 'C01', '09:50'));
  await pollNow(page);
  await expect(page.locator('[data-leftover="S4"]')).toHaveText('LEFT-RANK-1 · Started by Alex Test 9:50 · Done 9:50');
  expect(await leftIds(page)).toEqual(['S3', 'S2', 'S4']);
  await expect(page.locator('[data-leftover="S4"]')).toHaveClass(/(^|\s)done(\s|$)/);
  await expect(page.locator('[data-leftover="S3"]')).not.toHaveClass(/(^|\s)done(\s|$)/);
  expect(await page.evaluate(() => window.__sameLoad)).toBe(true); // no reload
});

test("tapping a leftover opens that site's lot; Back returns to the card", async ({ page }) => {
  const w = handoffWorld(); w.clock = at('09:35'); // the fake stamps Jordan's tap 9:35
  const calls = await openStorm(page, w, { clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await page.click('[data-leftover="S3"]');
  await expect(page.locator('#siteBack')).toBeVisible();
  await expect(card(page)).toBeHidden();
  expect(await idsOf(page, 'data-walkrow')).toEqual(['S3|lot']);
  // The lot as it stands THIS shift (final wave C3): the day has not tapped it yet, so no status line (the night's Problem is
  // on the card's line, "Problem: ice at door").
  await expect(lotLine(page, 'S3')).toHaveCount(0);
  await expect.poll(() => backSteps(page)).toEqual(['route']);
  await lotBtn(page, 'S3', 'plowed').click();
  await expect(lotLine(page, 'S3')).toHaveText('Plowed 9:35 AM by Jordan Demo');
  expect(tapCalls(calls).at(-1).body).toMatchObject({ site_id: 'S3', zone_id: 'lot', state: 'plowed' });
  await page.goBack(); // the phone's Back
  await expect(page.locator('#siteBack')).toBeHidden();
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · Started by Jordan Demo 9:35 · Done 9:35');
  expect(await backSteps(page)).toEqual([]);
  // The in-app ‹ Back does the same, and takes its step with it.
  await page.click('[data-leftover="S2"]');
  await expect(lotRow(page, 'S2')).toBeVisible();
  await page.click('#siteBack');
  await expect(card(page)).toBeVisible();
  await expect.poll(() => backSteps(page)).toEqual([]);
});

// LEFT-RANK-2 (callout 2"): 2" measured by Alex at 9:20, after its last tap (6:20): at its callout.
// LEFT-RANK-1 (callout 1"): 0.5" measured at 9:25: under it. Neither site has a point: no estimate, no fetch.
const calloutLeftovers = () => {
  const w = handoffWorld();
  w.sites = w.sites.map((s) => (s.id === 'S3' ? { ...s, callout_in: 2 } : s.id === 'S4' ? { ...s, callout_in: 1 } : s));
  w.log.push({ ...depthRow(6, 'S3', 2, at('09:20')), shift_id: DAY3 }, { ...depthRow(7, 'S4', 0.5, at('09:25')), shift_id: DAY3 });
  return w;
};

test('a leftover whose measured new snow is at its callout shows the callout line; one under it shows none', async ({ page }) => {
  const seen = await nws(page);
  await openStorm(page, calloutLeftovers(), { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page).locator('[data-leftsite="S3"] .handoff-callout')).toHaveText('LEFT-RANK-2 · 2" measured 9:20 AM by Alex Test · callout 2"');
  await expect(card(page).locator('[data-leftsite="S4"]')).toBeVisible();
  await expect(card(page).locator('[data-leftsite="S4"] .handoff-callout')).toHaveCount(0);
  await expect(card(page).locator('[data-leftsite="S2"] .handoff-callout')).toHaveCount(0); // no callout set
  // A depth reading is not a tap: neither line says "Started by".
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · Not plowed · Problem: ice at door');
  await expect(page.locator('[data-leftover="S4"]')).toHaveText('LEFT-RANK-1 · Not plowed');
  expect(gridHits(seen)).toBe(0);
});

test('a crew card shows the same measured callout line, and the crew phone never asks the NWS for snowfall', async ({ page }) => {
  const seen = await nws(page);
  await openStorm(page, calloutLeftovers(), { clockAt: HO_DAY }); // Jordan
  await expect(card(page).locator('[data-leftsite="S3"] .handoff-callout')).toHaveText('LEFT-RANK-2 · 2" measured 9:20 AM by Alex Test · callout 2"');
  await expect(card(page).locator('[data-leftsite="S4"] .handoff-callout')).toHaveCount(0);
  await expect(page.locator('#callouts')).toHaveCount(0); // the Callouts box stays Matt's and the leads'
  expect(gridHits(seen)).toBe(0);
});

// ---- Hand off now: the night of 10/2 at 6:30 AM, nothing handed off yet ----
// Only the night Post is up: Alex leads N1 and N2 (a posted night lead), Jordan rides N1 (a member).
const nightWorld = () => { const w = handoffWorld(); w.posts = [HO_NIGHT_POST]; w.storms = [START_ROW]; w.clock = at('06:30'); return w; };
const handOffCalls = (calls) => calls.filter((c) => c.body.action === 'handOff');

test('Hand off now is in the live view at 6:30 for Matt and for the posted night lead', async ({ page, browser }) => {
  await openStorm(page, nightWorld(), { token: 'tok-matt', clockAt: HO_NIGHT });
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await expect(page.locator('#handOffNow')).toBeVisible();
  await expect(page.locator('#handOffNow')).toHaveText('Hand off now');
  const lead = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await lead.newPage();
    await openStorm(p2, nightWorld(), { token: 'tok-alex', clockAt: HO_NIGHT });
    await expect(p2.locator('#stormctl')).toBeVisible();
    await expect(p2.locator('#handOffNow')).toBeVisible();
  } finally { await lead.close(); }
});

test('a member never gets Hand off now', async ({ page }) => {
  await openStorm(page, nightWorld(), { clockAt: HO_NIGHT }); // Jordan, a member of N1
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  await expect(page.locator('#handOffNow')).toBeHidden();
});

test('Hand off now is gone by day (10 AM)', async ({ page }) => {
  const w = nightWorld(); w.clock = at('10:00');
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('10:00') });
  await expect(page.locator('#shiftnow')).toHaveText('Day shift');
  await expect(ctl(page, 'end')).toBeVisible();
  await expect(page.locator('#handOffNow')).toBeHidden();
});

test("Hand off now asks first, in Matt's words; Yes sends handOff and the night shows as handed off", async ({ page }) => {
  const w = nightWorld();
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: HO_NIGHT });
  await page.click('#handOffNow');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlgIn h2')).toHaveText('Hand off to day now?');
  await expect(page.locator('#dlgIn p')).toHaveText("The night's sheets are saved and the day crew sees what's left.");
  await expect(page.locator('#ho_yes')).toHaveText('Yes, hand off');
  await expect(page.locator('#dlgClose')).toHaveText('Cancel');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(handOffCalls(calls)).toHaveLength(0); // Cancel sends nothing
  await page.click('#handOffNow');
  await page.click('#ho_yes');
  await expect.poll(() => handOffCalls(calls).length).toBe(1);
  // The phone sends the action alone: the server stamps who, when, which night and the marks.
  expect(Object.keys(handOffCalls(calls)[0].body).sort()).toEqual(['action', 'token']);
  // On paper: the night of 10/2; the newest Log seq is 5; no Visits or Trucks rows (0); the night Post crews N1 and N2.
  expect(w.storms.at(-1)).toMatchObject({ kind: 'handoff', storm_id: 'ST-1', shift_id: SHIFT, at: at('06:30'), by_name: 'Matthew',
    log_seq: 5, visit_seq: 0, truck_seq: 0, night_routes: ['R1', 'R2'] });
  // Handed off: the button gives way to the handoff's line, and Matt's sheets line waits for its files.
  await expect(page.locator('#handoffdone')).toHaveText('Handoff from Night of 10/2 · 6:30 AM · by Matthew');
  await expect(page.locator('#handOffNow')).toHaveCount(0);
  await expect(page.locator('#sheetsstatus')).toHaveText('Handoff sheets: making…');
  // Still the night of 10/2, the night just handed off: the card is up from the handoff on (ruling, fix round 1).
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('h2')).toHaveText('Handoff from Night of 10/2 · 6:30 AM · by Matthew');
});

test('a refused Hand off now shows its reason: nothing tapped tonight', async ({ page }) => {
  const w = nightWorld(); w.log = [];
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: HO_NIGHT });
  await page.click('#handOffNow');
  await page.click('#ho_yes');
  await expect(page.locator('#handofferr')).toHaveText('Not saved: Nothing to hand off yet');
  expect(handOffCalls(calls)).toHaveLength(1);
  expect(w.storms).toHaveLength(1); // nothing was written
  await expect(page.locator('#handOffNow')).toBeVisible(); // it can be tapped again once the crew have tapped
});

test('two phones: the second Hand off now is refused with the first one\'s time, and the phone catches up', async ({ page }) => {
  const w = nightWorld();
  await openStorm(page, w, { token: 'tok-alex', clockAt: HO_NIGHT });
  await expect(page.locator('#handOffNow')).toBeVisible();
  // Matt's phone handed off at 6:20; Alex's has not heard yet.
  w.storms.push({ ...HANDOFF_ROW, at: at('06:20'), by_name: 'Matthew' });
  await page.click('#handOffNow');
  await page.click('#ho_yes');
  await expect(page.locator('#handofferr')).toHaveText('Not saved: Already handed off at 6:20 AM');
  expect(w.storms.filter((r) => r.kind === 'handoff')).toHaveLength(1);
  // The refusal makes the phone ask again: the handoff arrives, and the button gives way to its line.
  await expect(page.locator('#handoffdone')).toHaveText('Handoff from Night of 10/2 · 6:20 AM · by Matthew');
  await expect(page.locator('#handOffNow')).toHaveCount(0);
});

test("the next night gets Hand off now again: last night's handoff is not tonight's", async ({ page }) => {
  // The night of 10/2 was handed off at 8:00 on 10/3. Night shift on at 6 PM on 10/3: at 10 PM it is the night
  // of 10/3, which has no handoff yet, so the button is back and no "handed off" line shows.
  const w = handoffWorld(); w.clock = at('22:00');
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'night_on', storm_id: 'ST-1', at: at('18:00'), by_name: 'Matthew' });
  await openStorm(page, w, { token: 'tok-matt', clockAt: '2026-10-03T22:00:00-08:00' });
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await expect(page.locator('#handOffNow')).toBeVisible();
  await expect(page.locator('#handoffdone')).toBeHidden();
});

// The handoff's Sheets rows (snow-app-script Task 3): made_for 'handoff', for_seq = the handoff's seq (2), end_seq null.
const hoSheet = (n, kind, route, shift, name, status) => ({ id: 'SH-' + n, seq: n, storm_id: 'ST-1', made_for: 'handoff', for_seq: 2, kind,
  route_id: route, shift_id: shift, end_seq: null, file_id: status === 'saved' ? 'f' + n : '', url: '', name, made_at: at('08:01'), status,
  error: status === 'failed' ? 'Drive said no' : '', updated: false, by_name: 'Plow Command' });

test("Matt's sheets line after a handoff: making, then the night's saved count; a failed one offers Retry", async ({ page }) => {
  const w = handoffWorld();
  w.sheets = [{ ...hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'failed'), storm_id: 'ST-0' }]; // another storm's: never counted
  const calls = await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:05') });
  const status = page.locator('#sheetsstatus');
  await expect(status).toHaveText('Handoff sheets: making…'); // 5 minutes after the handoff: no Retry yet
  await page.clock.fastForward(6 * 60 * 1000); // 8:11, 11 minutes after it
  await pollNow(page);
  await expect(status).toHaveText('Handoff sheets: making… · Retry');
  // The job's set: the night's two route sheets and its day sheet, all saved. The count is the night's (2).
  // The day sheet is the left-by-night one (route ''): at 8:00 the day had no plan (the day Post went up at 8:30,
  // and nobody was moved on the Board), so that is the one day sheet the server's set holds (final review M3: the
  // line now counts only sheets still in the set, and this test used to hold two day sheets the set never had).
  w.sheets.push(hoSheet(2, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(3, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'),
    hoSheet(4, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'saved'));
  await pollNow(page);
  await expect(status).toHaveText('Night sheets saved at handoff 8:00 AM (2)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // The day sheet made again, and failed: the newest row per sheet stands, so 1 not saved, with Retry.
  w.sheets.push(hoSheet(6, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'failed'));
  await pollNow(page);
  await expect(status).toHaveText('Handoff sheets: 1 not saved · Retry');
  await page.click('#retrySheets');
  await expect.poll(() => calls.filter((c) => c.body.action === 'retrySheets').length).toBe(1);
  expect(calls.filter((c) => c.body.action === 'retrySheets')[0].body).toMatchObject({ storm_id: 'ST-1' });
});

test("Matt's line counts the handoff's night set: 1 of 2 saved is not \"saved\"", async ({ page }) => {
  // The handoff's night set, the server's rule (snow-app-script handoffJobs_): sheetsFor at the handoff moment
  // (Log, Visits, Trucks cut at the marks; Posts and Moves made by 8:00), that night's pairs on night_routes
  // [R1, R2]. On paper: N1 (its taps), N2 (Alex on the 5:30 PM night Post): 2. D1 is not a night route.
  const w = handoffWorld();
  w.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'saved'),
    hoSheet(3, 'day', 'R2', DAY3, 'N2 Day handoff 10-3.pdf', 'saved')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('08:05') });
  const status = page.locator('#sheetsstatus');
  await expect(status).toHaveText('Handoff sheets: 1 of 2 saved · making…'); // 5 minutes: still being made
  await expect(page.locator('#retrySheets')).toHaveCount(0);
  // 8:12. Meanwhile Matt re-posted the night at 8:10 with nobody on N2. The handoff's set is the 8:00 one, so
  // N2's night sheet is still owed (a count from the live Posts would drop it and say "(1)").
  w.posts.push({ ...HO_NIGHT_POST, id: 'P-night-2', posted_at: at('08:10'), routes: hoRoutes({}, { lead: 'C01', members: ['C03'] }, {}) });
  await page.clock.fastForward(7 * 60 * 1000); // its 20 s tick polls, and carries the re-post
  await pollNow(page);
  await expect.poll(async () => (await phoneState(page)).posts.map((p) => p.id)).toContain('P-night-2'); // the phone holds it
  await expect(status).toHaveText('Handoff sheets: 1 of 2 saved · Retry');
  w.sheets.push(hoSheet(4, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'));
  await pollNow(page);
  await expect(status).toHaveText('Night sheets saved at handoff 8:00 AM (2)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

// Final review M3 (10/5/26): the server owes only the sheets still in a handoff's set (snow-app-script owedIn_), so a
// failed row for a sheet that has left the set is owed by nobody, and its Retry could only hear "That storm is open".
// Matt's line counts a failed row only while its sheet is in the set: the night sheets (CrewHandoff.nightSheets) and
// the day sheets of the handoff moment (one per crewed day route, else the left-by-night one).
test("Matt's handoff line leaves out a failed sheet the set no longer holds: no Retry the server would refuse", async ({ page, browser }) => {
  // (a) N2 archived after its night sheet failed. The set at the moment, by hand: sheetsFor on LIVE routes only, so
  //     N1 (its taps), and not N2 -> night set {N1}. Day: no plan at 8:00 (the day Post is 8:30's) -> {left by night}.
  //     Rows: N1 saved (in), N2 failed (out), left-by-night saved (in) -> nothing failed, 1 of 1 night: "(1)".
  const a = handoffWorld();
  a.routes = a.routes.map((r) => (r.id === 'R2' ? { ...r, archived: true } : r));
  a.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'failed'),
    hoSheet(3, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'saved')];
  await openStorm(page, a, { token: 'tok-matt', clockAt: at('08:05') });
  await expect(page.locator('#sheetsstatus')).toHaveText('Night sheets saved at handoff 8:00 AM (1)');
  await expect(page.locator('#retrySheets')).toHaveCount(0);

  // (b) A left-by-night row from a run that could not work out the day part (it failed, seq 3), and the day sheet a
  //     later run made once it could (seq 4). At 7:30 Matt put Alex on D1 as lead, after the 5:30 PM night Post: the
  //     Board is the day's plan at 8:00, so the set's day sheet is D1's, not the left-by-night one.
  //     Rows: N1, N2 saved (the night set {N1, N2}), left by night failed (out), D1 saved (in) -> "(2)", no Retry.
  const ctx = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await ctx.newPage();
    const b = handoffWorld();
    b.moves = [{ id: 'M1', rev: 1, at: at('07:30'), worker: 'C01', to_route: 'R3', role: 'lead' }];
    b.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'),
      { ...hoSheet(3, 'day', '', DAY3, 'Day handoff 10-3 (left by night).pdf', 'failed'), error: 'no day part' },
      hoSheet(4, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'saved')];
    await openStorm(p2, b, { token: 'tok-matt', clockAt: at('08:05') });
    const status = p2.locator('#sheetsstatus');
    await expect(status).toHaveText('Night sheets saved at handoff 8:00 AM (2)');
    await expect(p2.locator('#retrySheets')).toHaveCount(0);
    // A failed sheet that IS in the set still says so, with Retry: D1's day sheet made again, and failed.
    b.sheets.push(hoSheet(5, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'failed'));
    await pollNow(p2);
    await expect(status).toHaveText('Handoff sheets: 1 not saved · Retry');
  } finally { await ctx.close(); }
});

test('after Close storm, a night the handoff saved counts as saved: no false "of" and no Retry', async ({ page }) => {
  // Closed at 10:00 on 10/3; read 20 minutes later. The sheets this phone expects (CrewRouteSheet.sheetsFor), by hand:
  //   night of 10/2: N1 (its taps), N2 (Alex posted); day of 10/3: D1 (Jordan's 9:41 tap), N2 (Alex on the day Post).
  //   D1 has no night sheet (no tap, nobody on it in the night Post); N1 no day sheet (no tap, empty in the day Post). 4.
  // The End made only the two day sheets: both nights were saved at the handoff and did not change after it.
  // The handoff's first try at N2's night failed (seq 2); it is retried below.
  const w = handoffWorld();
  w.storms.push({ id: 'ST-3', seq: 3, kind: 'end', storm_id: 'ST-1', at: at('10:00'), by_name: 'Matthew' });
  w.log.push(dayTap(6, 'S5', 'lot', 'plowed', 'Jordan Demo', 'C03', '09:41'));
  const endSheet = (n, route, name) => ({ ...hoSheet(n, 'route', route, DAY3, name, 'saved'), made_for: 'end', for_seq: 3, end_seq: 3 });
  w.sheets = [hoSheet(1, 'route', 'R1', SHIFT, 'N1 Night of 10-2.pdf', 'saved'), hoSheet(2, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'failed'),
    hoSheet(3, 'day', 'R3', DAY3, 'D1 Day handoff 10-3.pdf', 'saved'), hoSheet(4, 'day', 'R2', DAY3, 'N2 Day handoff 10-3.pdf', 'saved'),
    endSheet(5, 'R3', 'D1 Day of 10-3.pdf'), endSheet(6, 'R2', 'N2 Day of 10-3.pdf')];
  await openStorm(page, w, { token: 'tok-matt', clockAt: at('10:20') });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  // N2's night stands on the handoff's failed row: that night has no saved record.
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 1 not saved · Retry');
  // Its Retry saves it: every expected sheet is now saved, the days by the End's rows and the nights by the handoff's.
  w.sheets.push(hoSheet(7, 'route', 'R2', SHIFT, 'N2 Night of 10-2.pdf', 'saved'));
  await pollNow(page);
  await expect(page.locator('#sheetsstatus')).toHaveText('Sheets: 4 saved');
  await expect(page.locator('#retrySheets')).toHaveCount(0);
});

test('Print sheets lists the day handoff sheets after the route sheets, each named as its PDF', async ({ page }) => {
  // On paper (Matt, 9:30, storm open): route sheets N1 and N2 for the night of 10/2 (the day Post's shift is past
  // the storm's latest logged shift, so it adds none yet), then one day handoff sheet per crewed day route, by
  // name: D1, N2. Four sheets.
  await stubPrint(page);
  await openStorm(page, handoffWorld(), { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect(page.locator('#printbar .muted')).toHaveText('4 sheets');
  const sheets = page.locator('#printsheets .sheet');
  await expect(sheets).toHaveCount(4);
  await expect(sheets.nth(0).locator('h1')).toHaveText('Route N1Night of 10/2');
  await expect(sheets.nth(1).locator('h1')).toHaveText('Route N2Night of 10/2');
  await expect(page.locator('#printsheets .printname')).toHaveText(['D1 Day handoff 10-3.pdf', 'N2 Day handoff 10-3.pdf']);
  await expect(sheets.nth(2).locator('h1')).toHaveText('Route D1Day of 10/3');
  await expect(sheets.nth(2)).toContainText('Handoff from Night of 10/2 · 8:00 AM');
  await expect(sheets.nth(2)).toContainText('Left by night (3)');
  await expect(sheets.nth(2).locator('.site').filter({ hasText: 'LEFT-RANK-2' })).toContainText('Not plowed · Problem: ice at door');
  await expect(sheets.nth(3).locator('h1')).toHaveText('Route N2Day of 10/3');
  // The day sheet's own style came with it, kept inside the print view.
  expect(await sheets.nth(2).locator('h2.part').first().evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe('solid');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('header h1')).fontFamily)).not.toMatch(/Arial/);
  // The file name is for the screen; on paper the sheet's own heading says what it is.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printsheets .printname').first()).toBeHidden();
  await expect(sheets.nth(2)).toBeVisible();
});

test('without lib/handoff.js the Storm tab still works: no card, no throw, and Print makes the route sheets', async ({ page, browser }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => u.href.endsWith('/lib/handoff.js'), (r) => r.abort());
  await stubPrint(page);
  await openStorm(page, handoffWorld(), { token: 'tok-matt', clockAt: HO_DAY });
  expect(await page.evaluate(() => typeof CrewHandoff)).toBe('undefined'); // the block really held
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await page.click('#printSheets');
  await expect(page.locator('#printsheets .sheet')).toHaveCount(2);
  await expect(page.locator('#printsheets .printname')).toHaveCount(0);
  // A crew phone missing the file too.
  const crew = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const p2 = await crew.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.route((u) => u.href.endsWith('/lib/handoff.js'), (r) => r.abort());
    await openStorm(p2, handoffWorld(), { clockAt: HO_DAY });
    await expect(p2.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
    await expect(lotBtn(p2, 'S5', 'plowed')).toBeVisible();
    await expect(p2.locator('#handoff')).toHaveCount(0);
  } finally { await crew.close(); }
  expect(errors).toEqual([]);
});

test("without lib/handoff.js at night Matt's live view still draws, with Hand off now (the server decides)", async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => u.href.endsWith('/lib/handoff.js'), (r) => r.abort());
  await openStorm(page, nightWorld(), { token: 'tok-matt', clockAt: HO_NIGHT });
  expect(await page.evaluate(() => typeof CrewHandoff)).toBe('undefined');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('#shiftnow')).toHaveText('Night shift');
  await expect(page.locator('[data-liveroute="R1"]')).toBeVisible();
  await expect(page.locator('#handOffNow')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a card that throws while it is drawn leaves the rest of the Storm tab drawn', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const w = handoffWorld();
  await openStorm(page, w, { clockAt: HO_DAY }); // Jordan
  await expect(card(page)).toBeVisible();
  // One of the card's words breaks (a bad copy of lib/handoff.js, say); the next redraw is a poll's.
  await page.evaluate(() => { CrewHandoff.leftoverParts = () => { throw new Error('broken leftover line'); }; });
  w.log.push(dayTap(6, 'S5', 'lot', 'plowed', 'Alex Test', 'C01', '09:40'));
  await pollNow(page);
  await expect(lotLine(page, 'S5')).toHaveText('Plowed 9:40 AM by Alex Test'); // the poll landed and drew
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(lotBtn(page, 'S5', 'problem')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a day handoff sheet whose page cannot be read is left out and said, not printed as a bare name', async ({ page }) => {
  // D1's page comes back with no <body>: only N2's day sheet prints after the two route sheets.
  await stubPrint(page);
  await openStorm(page, handoffWorld(), { token: 'tok-matt', clockAt: HO_DAY });
  await expect(card(page)).toBeVisible();
  await page.evaluate(() => {
    const real = CrewHandoff.handoffHtml;
    CrewHandoff.handoffHtml = (data, id, madeAt) => (id === 'R3' ? '<p>no page here</p>' : real(data, id, madeAt));
  });
  await page.click('#printSheets');
  await expect(page.locator('#printview')).toBeVisible();
  await expect(page.locator('#printbar .muted')).toHaveText('3 sheets');
  await expect(page.locator('#printsheets .printname')).toHaveText(['N2 Day handoff 10-3.pdf']);
  await expect(page.locator('#printsheets .sheet')).toHaveCount(3);
  await expect(page.locator('#printsheets .sheet').nth(2).locator('h1')).toHaveText('Route N2Day of 10/3');
  await expect(page.locator('#toast')).toHaveText("1 day handoff sheet couldn't be built on this phone.");
});

// ---------- Roster self-service (Matt, 10/6/26) ----------
// A person fills out their own card from their phone; Matt approves the Inventory request and
// taps Add to crew on the Roster tab; crew edit their own card from Tonight. The server keeps
// everything Matt owns: what leaves the phone is the self fields and nothing else.
const SELF_FIELDS = ['phone', 'photo_thumb', 'can_drive', 'valid_id', 'on_call', 'cold_rated', 'can_operate', 'seasons', 'gear', 'emergency_name', 'emergency_phone', 'home_area'];
const pngOf = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400;
  const g = c.getContext('2d'); g.fillStyle = '#a73'; g.fillRect(0, 0, 600, 400); return c.toDataURL('image/png').split(',')[1]; });
// Inventory with a live request list: Approve and Reject change it, as the real one does.
function invWithRequests(list) {
  return (p) => {
    if (p.action === 'getProfiles') return { profiles: list };
    if (p.action === 'approveProfile' || p.action === 'rejectProfile') {
      const hit = list.find((x) => String(x.id) === p.id);
      if (hit) hit.status = p.action === 'approveProfile' ? 'approved' : 'rejected';
      return { success: !!hit };
    }
    return {};
  };
}

test('self-service: not on the roster, the card is theirs to fill; Save sends only the self fields, the picture as a JPEG, never a name; then the pending screen', async ({ page }) => {
  const calls = await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await expect(page.locator('#notroster')).toContainText('Nina Nursery');
  await expect(page.locator('#signout')).toBeVisible();
  await page.click('#fillCard');
  await expect(page.locator('#s_title')).toHaveText('Nina Nursery');
  await expect(page.locator('#s_photo_cam')).toHaveAttribute('capture', 'user');   // the front camera on a phone
  await page.fill('#s_phone', ' 555-0199 ');
  await page.selectOption('#s_can_drive', 'yes');
  await page.selectOption('#s_valid_id', 'no');
  // roster-2: cold-rated is theirs to claim; Smokes is not asked; the emergency contact is theirs to fill.
  await expect(page.locator('#s_smokes')).toHaveCount(0);
  await page.selectOption('#s_cold_rated', 'yes');
  await page.fill('#s_emergency_name', ' Pat Nursery ');
  await page.fill('#s_emergency_phone', '555-0911');
  await page.check('input[data-sop][value="blower"]');
  await page.fill('#s_seasons', '2');
  await page.selectOption('#s_gear', 'needs_issued');
  const png = await pngOf(page);
  await page.locator('#s_photo_file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#s_photo_msg')).toContainText('Picture ready');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toBeVisible();
  await expect(page.locator('#pendingcard')).toContainText('Your card is in. The dispatcher will add you to the crew.');
  await expect(page.locator('#pendingcard')).toContainText('555-0199');
  await expect(page.locator('#pendingcard')).toContainText('Pat Nursery · 555-0911');
  await expect(page.locator('#pendingcard')).not.toContainText('Smokes');
  await expect(page.locator('#pendingcard img.av')).toHaveAttribute('src', /^data:image\/jpeg/);
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect(Object.keys(c.body.card).sort()).toEqual(SELF_FIELDS.slice().sort());
  expect(c.body.card).toMatchObject({ phone: '555-0199', can_drive: true, valid_id: false, on_call: null, cold_rated: true, can_operate: ['blower'], seasons: 2, gear: 'needs_issued',
    emergency_name: 'Pat Nursery', emergency_phone: '555-0911' });
  expect('smokes' in c.body.card).toBe(false);
  expect(c.body.card.photo_thumb).toMatch(/^data:image\/jpeg;base64,/);
  expect(c.body.card.photo_thumb.length).toBeLessThan(30000);
  expect('name' in c.body.card).toBe(false);
  expect(c.body.token).toBe('tok-nina');
  expect(c.contentType).toContain('text/plain');
});

// Pictures (Matt, 10/7/26 field test: a driver's 160 px picture stretched over a 140+ px tile was blurry):
// stored at 240 px on the long side. The server caps the data URL at 30,000 characters, so a
// noisy picture is squeezed (lower quality, then smaller) until it fits, instead of being refused.
const noisyPngOf = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600;
  const g = c.getContext('2d'); const d = g.createImageData(600, 600); for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
  g.putImageData(d, 0, 0); return c.toDataURL('image/png').split(',')[1]; });
const sizeOf = (page, src) => page.evaluate((s) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = s; }), src);

test('self-service: pictures are stored at 240 px; a noisy one is squeezed under the server cap, never refused', async ({ page }) => {
  const calls = await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await page.click('#fillCard');
  await page.locator('#s_photo_file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(await pngOf(page), 'base64') });
  await expect(page.locator('#s_photo_msg')).toContainText('Picture ready');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toBeVisible();
  const flat = calls.find((x) => x.body && x.body.action === 'saveMyCard').body.card.photo_thumb;
  expect(await sizeOf(page, flat)).toEqual([240, 160]);                       // 600x400 scaled to the 240 px long side
  expect(flat.length).toBeLessThan(30000);
  await page.click('#editCard');
  await page.locator('#s_photo_file').setInputFiles({ name: 'noise.png', mimeType: 'image/png', buffer: Buffer.from(await noisyPngOf(page), 'base64') });
  await expect(page.locator('#s_photo_msg')).toContainText('Picture ready');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toBeVisible();
  const noisy = calls.filter((x) => x.body && x.body.action === 'saveMyCard').at(-1).body.card.photo_thumb;
  expect(noisy).toMatch(/^data:image\/jpeg;base64,/);
  expect(noisy.length).toBeLessThan(30000);                                   // squeezed, not refused
  const [nw] = await sizeOf(page, noisy);
  expect(nw).toBeLessThanOrEqual(240);
  expect(nw).toBeGreaterThanOrEqual(120);                                     // squeezed by quality first, size last
});

test('self-service: a pending sign-in sees its card and edits it; a picture not touched is left out of the save; Check again asks the server', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1, phone: '555-0199', photo_thumb: 'data:image/jpeg;base64,QUJD', can_drive: true, seasons: 2 });
  const calls = await open(page, { token: 'tok-nina', snow: fakeSnow(w) });
  await expect(page.locator('#pendingcard')).toContainText('Your card is in');
  await expect(page.locator('#pendingcard img.av')).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(page.locator('#signout')).toBeVisible();
  await expect(page.locator('#tabs')).toBeHidden();
  await page.click('#editCard');
  await expect(page.locator('#s_phone')).toHaveValue('555-0199');
  await expect(page.locator('#s_can_drive')).toHaveValue('yes');
  await expect(page.locator('#s_seasons')).toHaveValue('2');
  await expect(page.locator('#s_photo_msg')).toHaveText('Picture on file');
  await page.fill('#s_phone', '555-0000');
  await page.click('#s_save');
  await expect(page.locator('#pendingcard')).toContainText('555-0000');
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect('photo_thumb' in c.body.card).toBe(false);
  expect(c.body.card.phone).toBe('555-0000');
  await page.click('#checkAgain');
  await expect(page.locator('#pendingcard')).toBeVisible();
  expect(calls.filter((x) => x.body && x.body.action === 'bootstrap').length).toBe(2);
});

test('self-service: the server refuses a card in its own words; the form keeps what was typed; Cancel goes back', async ({ page }) => {
  await open(page, { token: 'tok-nina', snow: fakeSnow(world()) });
  await page.click('#fillCard');
  await page.fill('#s_seasons', 'two');
  await page.click('#s_save');
  await expect(page.locator('#s_err')).toHaveText('Seasons must be a whole number');
  await expect(page.locator('#s_seasons')).toHaveValue('two');
  await expect(page.locator('#pendingcard')).toHaveCount(0);
  await page.click('#s_cancel');
  await expect(page.locator('#notroster')).toBeVisible();
});

test('self-service: crew open Your card on Tonight, see their card from bootstrap, and save only the form', async ({ page }) => {
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('#yourCard')).toBeVisible();
  await page.click('#yourCard');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#s_title')).toHaveText('Jordan Demo');
  await expect(page.locator('#s_phone')).toHaveValue('555-0103');
  await page.fill('#s_phone', '555-0333');
  await page.check('input[data-sop][value="shovel"]');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Saved');
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect(c.body.card.phone).toBe('555-0333');
  expect(c.body.card.can_operate).toEqual(['shovel']);
  expect('name' in c.body.card).toBe(false);
  await page.click('#yourCard');
  await expect(page.locator('#s_phone')).toHaveValue('555-0333');   // the card follows the reply
});

test('self-service: Matt sees the pending Inventory request; Approve calls Inventory with his token and the row goes', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(PROFILES.map((p) => ({ ...p }))) });
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#waitapprove')).toContainText('Waiting for approval (1)');
  await expect(page.locator('#waitapprove')).toContainText('Pending Pat');
  await page.click('[data-approve="9"]');
  await expect(page.locator('#toast')).toHaveText('Pending Pat can sign in now');
  const a = calls.inv.find((x) => x.action === 'approveProfile');
  expect(a).toMatchObject({ action: 'approveProfile', id: '9', token: 'tok-matt' });
  await expect(page.locator('#waitapprove')).toHaveCount(0);
  await page.click('#addWorker');
  await expect(page.locator('#f_profile option[value="9"]')).toHaveCount(1);   // approved: a sign-in Matt can link
});

test('self-service: Reject takes a second tap, then calls Inventory; one tap alone sends nothing', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(PROFILES.map((p) => ({ ...p }))) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-reject="9"]');
  await expect(page.locator('[data-reject="9"]')).toHaveText('Really reject?');
  expect(calls.inv.some((x) => x.action === 'rejectProfile')).toBe(false);
  await page.click('[data-reject="9"]');
  await expect(page.locator('#toast')).toHaveText('Request rejected');
  expect(calls.inv.find((x) => x.action === 'rejectProfile')).toMatchObject({ id: '9', token: 'tok-matt' });
  await expect(page.locator('#waitapprove')).toHaveCount(0);
});

// ---- who is waiting (Matt, 10/19/26: "when I have new people signing in, will I get a notification?") ----
// Matt's Roster tab carries a count: requests from the sign-in screen (Inventory names still pending) plus cards
// filled out and not added yet, the same rows as the two waiting lists. Read at sign-in, every 5 minutes while
// the app is on screen, and whenever it comes back on screen. Only Matt's phone asks; crew phones never do.
const rosterTab = (page) => page.locator('#tabs [data-tab="roster"]');
const NINA_CARD = { id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1, phone: '555-0199' };

test('roster count: the Roster tab counts who is waiting on Matt, and each decision takes one off', async ({ page }) => {
  // Worked by hand: Pending Pat's request (PROFILES, pending) + Nina's card (pending, not added) = 2.
  const w = world(); w.crew.push({ ...NINA_CARD });
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), inv: invWithRequests(PROFILES.map((p) => ({ ...p }))) });
  await expect(rosterTab(page)).toHaveText('Roster 2'); // before the Roster tab was ever opened
  await rosterTab(page).click();
  await page.click('[data-approve="9"]');
  await expect(page.locator('#toast')).toHaveText('Pending Pat can sign in now');
  await expect(rosterTab(page)).toHaveText('Roster 1');
  await page.click('[data-addcrew="C04"]');
  await expect(rosterTab(page)).toHaveText('Roster');
  await expect(page.locator('#tabs .tabcount')).toHaveCount(0); // nobody waiting: no count at all, never a 0
});

test('roster count: a request sent while the app is open shows within 5 minutes, and a new card at once when the app comes back on screen', async ({ page }) => {
  const list = PROFILES.filter((p) => p.status !== 'pending').map((p) => ({ ...p })); // nobody waiting
  const w = world();
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), inv: invWithRequests(list), clockAt: STORM_CLOCK });
  await expect.poll(() => calls.inv.filter((c) => c.action === 'getProfiles').length).toBe(1); // the sign-in check
  await expect(rosterTab(page)).toHaveText('Roster');
  list.push({ id: 12, name: 'Newbie Nate', status: 'pending', hasPin: true }); // asks from his own phone
  await page.clock.fastForward('04:50');
  expect(calls.inv.filter((c) => c.action === 'getProfiles')).toHaveLength(1); // not yet: 4 min 50 s
  await page.clock.fastForward('00:15');
  await expect(rosterTab(page)).toHaveText('Roster 1');
  await rosterTab(page).click();
  await expect(page.locator('#waitapprove')).toContainText('Newbie Nate');
  await expect(page.locator('#waitadd')).toHaveCount(0);
  // Nina fills out her card on her phone; Matt's phone comes back on screen, on the Roster tab: the list itself
  // shows her, with no tap.
  w.crew.push({ ...NINA_CARD });
  await pollNow(page);
  await expect(rosterTab(page)).toHaveText('Roster 2');
  await expect(page.locator('#waitadd')).toContainText('Nina Nursery');
  await expect(page.locator('#waitapprove')).toContainText('Newbie Nate');
  expect(await page.locator('[data-addcrew]').count()).toBe(1); // Nina once, never twice
});

test('roster count: a check on its way when Matt approves never brings the request back', async ({ page }) => {
  // The check reads Pat as pending; Matt approves before its reply lands. The newer ask (the one Approve makes)
  // has already answered with Pat approved, so the old reply is thrown away.
  const list = PROFILES.map((p) => ({ ...p }));
  const slow = { next: false };
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(list),
    invDelay: (p) => (slow.next && p.action === 'getProfiles' ? ((slow.next = false), 2000) : 0) });
  await rosterTab(page).click();
  await expect(page.locator('#waitapprove')).toContainText('Pending Pat');
  const asked = calls.inv.filter((c) => c.action === 'getProfiles').length;
  slow.next = true;
  await pollNow(page); // back on screen: the check asks, and its reply is held 2 s
  await expect.poll(() => calls.inv.filter((c) => c.action === 'getProfiles').length).toBe(asked + 1);
  await page.click('[data-approve="9"]');
  await expect(page.locator('#toast')).toHaveText('Pending Pat can sign in now');
  await expect(page.locator('#waitapprove')).toHaveCount(0);
  await expect.poll(() => calls.invAnswered).toBe(calls.inv.length); // the held reply has landed
  await page.waitForTimeout(300);
  await expect(page.locator('#waitapprove')).toHaveCount(0);
  await expect(rosterTab(page)).toHaveText('Roster');
});

test('roster count: crew phones never ask for the waiting lists', async ({ page }) => {
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(world()), clockAt: STORM_CLOCK });
  await expect(page.locator('#tabs [data-tab="tonight"]')).toBeVisible();
  await page.clock.fastForward('05:01');
  await pollNow(page);
  await page.waitForTimeout(300);
  expect(calls.filter((c) => c.body.action === 'getCrew')).toEqual([]);
  expect(calls.inv.filter((c) => c.action === 'getProfiles')).toEqual([]);
  await expect(page.locator('#tabs .tabcount')).toHaveCount(0);
});

test('bars: with 12 waiting, all five admin tabs still sit inside a 320 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  // Pending Pat + 11 more requests = 12.
  const list = PROFILES.map((p) => ({ ...p })).concat(Array.from({ length: 11 }, (_, i) => ({ id: 20 + i, name: 'Request ' + i, status: 'pending', hasPin: true })));
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(list) });
  await expect(rosterTab(page)).toHaveText('Roster 12');
  const tabs = await page.locator('#tabs button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; }));
  for (const t of tabs) { expect(t.l, t.t).toBeGreaterThanOrEqual(0); expect(t.r, t.t).toBeLessThanOrEqual(320); expect(t.w, t.t).toBeGreaterThan(30); }
});

test('self-service: a pending card waits to be added, off the grid and off the Board; Add to crew saves it whole with pending false', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1, phone: '555-0199', can_drive: true });
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C01"]')).toHaveCount(1);
  await expect(page.locator('.chip[data-worker="C04"]')).toHaveCount(0);
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('#waitadd')).toContainText('Waiting to be added (1)');
  await expect(page.locator('#waitadd')).toContainText('Nina Nursery');
  await expect(page.locator('.grid [data-open="C04"]')).toHaveCount(0);
  await page.click('#waitadd .pname[data-open="C04"]');
  await expect(page.locator('#dlg')).toContainText('Waiting to be added');
  await page.click('#dlgClose');
  await page.click('#waitadd [data-addcrew="C04"]');
  await expect(page.locator('#toast')).toHaveText('Nina Nursery is on the crew');
  const c = calls.find((x) => x.body && x.body.action === 'saveCrew');
  expect(c.body.record).toMatchObject({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: false, rev: 1, phone: '555-0199', can_drive: true });
  await expect(page.locator('#waitadd')).toHaveCount(0);
  await expect(page.locator('.grid [data-open="C04"]')).toHaveCount(1);
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C04"]')).toHaveCount(1);
});

// ---- roster-2 (Matt, 10/6/26 bedtime): cold-rated theirs to claim, Smokes his alone, an emergency contact only he sees ----
test("roster-2: Matt's worker card shows the emergency contact (not set when blank); his editor keeps Smokes and saves the contact trimmed", async ({ page }) => {
  const w = world();
  Object.assign(w.crew[0], { emergency_name: 'Kim Test', emergency_phone: '555-0911', smokes: true, cold_rated: false });
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlg tr:has-text("Emergency contact")')).toContainText('not set');
  await page.click('#dlgClose');
  await page.click('[data-open="C01"]');
  await expect(page.locator('#dlg tr:has-text("Emergency contact")')).toContainText('Kim Test · 555-0911');
  await page.click('#w_edit');
  await expect(page.locator('#f_smokes')).toHaveValue('yes');            // Smokes stays Matt's to set
  await expect(page.locator('#f_cold_rated')).toHaveValue('no');         // and cold-rated his to correct
  await expect(page.locator('#f_emergency_name')).toHaveValue('Kim Test');
  await expect(page.locator('#f_emergency_phone')).toHaveValue('555-0911');
  await page.fill('#f_emergency_name', ' Kim Tester ');
  await page.fill('#f_emergency_phone', ' 555-0913 ');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const save = calls.find((c) => c.body.action === 'saveCrew');
  expect(save.body.record).toMatchObject({ id: 'C01', emergency_name: 'Kim Tester', emergency_phone: '555-0913', smokes: true, cold_rated: false });
  await page.click('[data-open="C01"]');
  await expect(page.locator('#dlg tr:has-text("Emergency contact")')).toContainText('Kim Tester · 555-0913');
});

test('roster-2: Your card on Tonight shows the cold-rated question and the emergency contact from bootstrap, never Smokes; a save carries them', async ({ page }) => {
  const w = world();
  Object.assign(w.crew[1], { cold_rated: true, emergency_name: 'Dee Demo', emergency_phone: '555-0912', smokes: true });
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(w) });
  await page.click('#yourCard');
  await expect(page.locator('#s_cold_rated')).toHaveValue('yes');
  await expect(page.locator('#s_emergency_name')).toHaveValue('Dee Demo');
  await expect(page.locator('#s_emergency_phone')).toHaveValue('555-0912');
  await expect(page.locator('#s_smokes')).toHaveCount(0);
  await expect(page.locator('#dlg')).not.toContainText('smoke');
  await page.selectOption('#s_cold_rated', 'no');
  await page.fill('#s_emergency_phone', '555-0914');
  await page.click('#s_save');
  await expect(page.locator('#toast')).toHaveText('Saved');
  const c = calls.find((x) => x.body && x.body.action === 'saveMyCard');
  expect(c.body.card).toMatchObject({ cold_rated: false, emergency_name: 'Dee Demo', emergency_phone: '555-0914' });
  expect('smokes' in c.body.card).toBe(false);
  // Every self field but the picture, which was not touched: left out, so the one on file is kept.
  expect(Object.keys(c.body.card).sort()).toEqual(SELF_FIELDS.filter((k) => k !== 'photo_thumb').sort());
});

test('self-service: with no requests and no cards waiting, the Roster tab has no waiting sections', async ({ page }) => {
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()), inv: invWithRequests(PROFILES.filter((x) => x.status !== 'pending')) });
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('.grid')).toBeVisible();
  await expect(page.locator('#waitapprove')).toHaveCount(0);
  await expect(page.locator('#waitadd')).toHaveCount(0);
});

// ---------- Place from the roster (Matt, 10/6/26) ----------
// The Roster tab says where tonight's Board has each person, and the worker card places,
// promotes or pulls them: one Move each, planned as a Board tap is, through the Board's
// one-at-a-time write. Nothing is stored but the Move.
const MOVE = (worker, to_route, role) => ({ id: 'M-' + worker, at: '2026-10-06T17:00:00-08:00', worker, to_route, role });

test("place from the roster: tiles say where tonight's Board has each person", async ({ page }) => {
  const w = world();
  w.moves = [MOVE('C01', 'R1', 'lead')];
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await expect(page.locator('[data-open="C01"] .where')).toHaveText('N1 · lead');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('Unplaced');
});

test('place from the roster: Place sends one Move as a member; the tile and the Board follow', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#w_where')).toHaveText('Unplaced');
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Jordan Demo placed on N1');
  const m = calls.filter((c) => c.body.action === 'addMove');
  expect(m.length).toBe(1);
  expect(m[0].body.record).toMatchObject({ worker: 'C03', to_route: 'R1', role: 'member' });
  expect(m[0].body.record.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('N1');
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.board-route[data-route="R1"] .chip[data-worker="C03"]')).toHaveCount(1);
});

test('place from the roster: Make lead and Unassign are one Move each; nothing to change writes nothing', async ({ page }) => {
  const w = world();
  w.moves = [MOVE('C03', 'R1', 'member')];
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#w_route')).toHaveValue('R1');
  await page.click('#w_place');   // already a member of N1
  await expect(page.locator('#toast')).toHaveText('Nothing to change');
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(0);
  await page.click('[data-open="C03"]');
  await page.click('#w_lead');
  await expect(page.locator('#toast')).toHaveText('Jordan Demo: lead on N1');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('N1 · lead');
  await page.click('[data-open="C03"]');
  await page.click('#w_unassign');
  await expect(page.locator('#toast')).toHaveText('Jordan Demo taken off the Board');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('Unplaced');
  const m = calls.filter((c) => c.body.action === 'addMove').map((c) => c.body.record);
  expect(m).toMatchObject([{ worker: 'C03', to_route: 'R1', role: 'lead' }, { worker: 'C03', to_route: null, role: null }]);
});

test("place from the roster: Place with no route picked asks for one and sends nothing; a lost save toasts and changes nothing", async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), abortIf: (b) => b.action === 'addMove' });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#w_unassign')).toHaveCount(0);   // not on the Board: nothing to pull
  await page.click('#w_place');
  await expect(page.locator('#w_err')).toHaveText('Pick a route');
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(0);
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await expect(page.locator('#toast')).toContainText('Not saved');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('Unplaced');
});

test('place from the roster: a second place while one is saving sends nothing more', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()), delay: { addMove: 1500 } });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await page.click('[data-open="C01"]');
  await page.selectOption('#w_route', 'R1');
  await page.click('#w_place');
  await expect(page.locator('#toast')).toContainText('Still saving');
  await expect(page.locator('[data-open="C03"] .where')).toHaveText('N1', { timeout: 5000 });
  expect(calls.filter((c) => c.body.action === 'addMove').length).toBe(1);
});

test('place from the roster: a card still waiting to be added has no Place row', async ({ page }) => {
  const w = world();
  w.crew.push({ id: 'C04', name: 'Nina Nursery', profile_id: '4', pending: true, rev: 1 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(w) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C04"]');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#w_route')).toHaveCount(0);
  await expect(page.locator('#w_place')).toHaveCount(0);
});

// ---------- Live window (Matt, 10/6/26) ----------
// The live view's summary line, and the wide layout on a laptop or TV. The numbers below are
// worked by hand from stormWorld: R1 = [S1], R2 = [S2], each site one Lot (PAC's piles are never walks).
test('live window: the summary line counts lots plowed, open Problems, the newest real tap and routes started, and follows the poll', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];   // S1 plowed at 6:30; S2 untouched
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#livesum')).toHaveText('1 of 2 lots · 0 problems · last tap 6:30 AM · 1 of 2 routes started');
  // A Problem lands at S1 on the next poll: S1 is no longer plowed, one Problem is open, the tap is newer.
  w.log.push(logRow(2, 'S1', 'lot', 'problem', 'Jordan Demo', { note: 'cars in the lot', at: '2026-10-03T06:45:00.000-08:00' }));
  await pollNow(page);
  await expect(page.locator('#livesum')).toHaveText('0 of 2 lots · 1 problem · last tap 6:45 AM · 1 of 2 routes started');
  // An undo of that Problem is not a tap: the lot goes back to plowed and the newest real tap is the 6:30 one again.
  w.log.push(logRow(3, 'S1', 'lot', 'plowed', 'Jordan Demo', { undoes: 'L-2', at: '2026-10-03T06:50:00.000-08:00' }));
  await pollNow(page);
  await expect(page.locator('#livesum')).toHaveText('1 of 2 lots · 0 problems · last tap 6:30 AM · 1 of 2 routes started');
});

test('live window: with no storm open the line says so and still counts the sites and routes', async ({ page }) => {
  const w = stormWorld();
  w.storms = [];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#livesum')).toHaveText('No storm open · 2 sites on 2 routes');
});

test('live window: crew get no summary line (they see their own route, not the live view)', async ({ page }) => {
  await openStorm(page, stormWorld());
  await expect(page.locator('h2.shift-route')).toHaveCount(1);
  await expect(page.locator('#livesum')).toHaveCount(0);
});

test('live window: on a wide screen the Storm tab opens out and the routes sit in a grid; on a phone, one column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openStorm(page, stormWorld(), { token: 'tok-matt' });
  await expect(page.locator('.live-grid .live-route')).toHaveCount(2);
  expect(await page.evaluate(() => document.body.dataset.tab)).toBe('storm');
  const wide = await page.evaluate(() => ({
    cols: getComputedStyle(document.querySelector('.live-grid')).gridTemplateColumns.split(' ').length,
    main: getComputedStyle(document.querySelector('main')).maxWidth,
  }));
  expect(wide.cols).toBeGreaterThanOrEqual(2);
  expect(wide.main).toBe('none');
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await page.evaluate(() => ({
    cols: getComputedStyle(document.querySelector('.live-grid')).gridTemplateColumns,
    main: getComputedStyle(document.querySelector('main')).maxWidth,
  }));
  expect(narrow.cols).toBe('none');
  expect(narrow.main).toBe('720px');
  // Another tab is not the live window, whatever the width.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('nav [data-tab="routes"]');
  expect(await page.evaluate(() => [document.body.dataset.tab, getComputedStyle(document.querySelector('main')).maxWidth])).toEqual(['routes', '720px']);
});

// ---------- Snow map (Matt, 10/6/26) ----------
// stormWorld with S1 given a saved view at NWS_POINT (so the NWS is asked about 61.34,-149.51) and
// S2 left with no view and no outline (not mapped). Clock 7:30 AM Alaska on 10/3 (15:30Z).
// The gridpoint has one 6-hour period from 7:00 AM (15:00Z), 50.8 mm: 5.5 of its 6 hours fall in
// the next 12 h, so 50.8 * 5.5 / 6 = 46.57 mm = 1.83" -> ~1.8", the 1-3" step.
const GRID_6H = [{ validTime: '2026-10-03T15:00:00+00:00/PT6H', value: 50.8 }];
const noTiles = (page) => page.route((u) => /arcgisonline\.com|ancgis\.com/.test(u.href), (route) => route.abort());
const snowWorld = () => withView(stormWorld(), 'S1', NWS_POINT);

test('snow map: Matt opens it from the live view; one dot per mapped site, coloured and labelled by the forecast; the rest counted; the NWS asked once', async ({ page }) => {
  await noTiles(page);
  const seen = await nws(page, { grid: GRID_6H });
  await openStorm(page, snowWorld(), { token: 'tok-matt' });
  await expect(page.locator('#snowmapcard')).toBeVisible();
  await expect(page.locator('#snowmaptoggle')).toHaveText('Snow map');   // closed on a phone
  await expect(page.locator('#snowmapslot')).toHaveCount(0);
  await page.click('#snowmaptoggle');
  await expect(page.locator('#snowmapbox')).toBeVisible();
  await expect(page.locator('.snowdot')).toHaveCount(1);
  await expect(page.locator('#snowmapmissing')).toHaveText('1 site not mapped yet');
  const dot = page.locator('.snowdot[data-site="S1"]');
  await expect(dot).toHaveClass(/\bmid\b/);
  await expect(dot.locator('.snowdot-label')).toHaveText('~1.8"');
  await dot.click();
  // The last word is the site's lot (SnowMapOverview.siteStatus): nobody has tapped PAC, so Not plowed.
  await expect(page.locator('#snowmapinfo')).toHaveText('PAC · Forecast ~1.8" next 12 h · No reading yet · Not plowed');
  expect(gridHits(seen)).toBe(1);
  await pollNow(page);
  await expect(page.locator('.snowdot')).toHaveCount(1);
  expect(gridHits(seen)).toBe(1);   // inside the 30-minute gate: not asked again
  await page.click('#snowmaptoggle');
  await expect(page.locator('#snowmapslot')).toHaveCount(0);
  await expect(page.locator('#snowmaptoggle')).toHaveText('Snow map');
});

test('snow map: open by default on a wide screen; a measured depth rings the dot and the label follows the crews, poll by poll', async ({ page }) => {
  await noTiles(page);
  await nws(page, { grid: GRID_6H });
  await page.setViewportSize({ width: 1280, height: 800 });
  const w = snowWorld();
  w.log = [logRow(1, 'S1', '*', 'depth', 'Alex Test', { depth_in: 3 })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#snowmaptoggle')).toHaveText('Hide map');
  const dot = page.locator('.snowdot[data-site="S1"]');
  await expect(dot).toHaveClass(/\bmeasured\b/);
  await expect(dot.locator('.snowdot-label')).toHaveText('3.0" 6:30 AM Alex Test');
  await dot.click();
  await expect(page.locator('#snowmapinfo')).toContainText('Measured 3.0" at 6:30 AM by Alex Test');
  // A site card with a newer depth lands on the next poll.
  w.visits = [{ id: 'V-1', seq: 1, storm_id: 'ST-1', shift_id: 'night-2026-10-02', site_id: 'S1', by_key: 'C03', by_name: 'Jordan Demo',
    at: '2026-10-03T07:00:00.000-08:00', depth_in: 4, materials_used: '', equipment: {} }];
  await pollNow(page);
  await expect(dot.locator('.snowdot-label')).toHaveText('4.0" 7:00 AM Jordan Demo');
  await expect(dot).toHaveClass(/\bmid\b/);   // the colour is still the forecast
});

test('snow map: a failing NWS leaves a grey dot with a question mark, and no error on the screen', async ({ page }) => {
  await noTiles(page);
  await nws(page, { fail: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openStorm(page, snowWorld(), { token: 'tok-matt' });
  const dot = page.locator('.snowdot[data-site="S1"]');
  await expect(dot).toHaveClass(/\bnofc\b/);
  await expect(dot.locator('.snowdot-label')).toHaveText('?');
  await dot.click();
  await expect(page.locator('#snowmapinfo')).toContainText('No forecast');
  await expect(page.locator('#stormerr')).toHaveCount(0);
});

test('snow map: crew get no map card', async ({ page }) => {
  await noTiles(page);
  await nws(page, { grid: GRID_6H });
  await openStorm(page, snowWorld());
  await expect(page.locator('h2.shift-route')).toHaveCount(1);
  await expect(page.locator('#snowmapcard')).toHaveCount(0);
});

// ---------- The bars fit a phone (Matt, 10/6/26 evening) ----------
// On Matt's phone, with its larger text, the admin tabs (six then, five since the Log tab went in Plow Command) overflowed the bottom bar and Roster sat
// off the right edge; the top bar squeezed his name to "M…" while "Snow Crew" kept its full width.
// 320 px is the narrowest phone in use; every tab must sit inside it, and the name must outrank the title.
test('bars: all five admin tabs sit inside a 320 px screen, and the name badge keeps room over the title', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await expect(page.locator('#tabs button')).toHaveCount(5);
  const tabs = await page.locator('#tabs button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; }));
  for (const t of tabs) { expect(t.l, t.t).toBeGreaterThanOrEqual(0); expect(t.r, t.t).toBeLessThanOrEqual(320); expect(t.w, t.t).toBeGreaterThan(30); }
  // Pending Pat (PROFILES) is waiting: the Roster tab counts 1 (10/19/26). Read once the sign-in check lands.
  await expect(page.locator('#tabs [data-tab="roster"]')).toHaveText('Roster 1');
  const all = await page.locator('#tabs button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; }));
  for (const t of all) { expect(t.l, t.t).toBeGreaterThanOrEqual(0); expect(t.r, t.t).toBeLessThanOrEqual(320); expect(t.w, t.t).toBeGreaterThan(30); }
  expect(all.map((t) => t.t)).toEqual(['Storm', 'Routes', 'Sites', 'Board', 'Roster 1']);
  await page.click('#tabs [data-tab="roster"]');
  await expect(page.locator('#addWorker')).toBeVisible();
  // The top bar: the name badge is at least as wide as the words it holds minus the title's share; concretely, wider than a lone initial.
  const who = await page.locator('#who').evaluate((e) => ({ w: Math.round(e.getBoundingClientRect().width), text: e.textContent, scroll: e.scrollWidth, client: e.clientWidth }));
  expect(who.text).toBe('Matthew · admin');
  expect(who.w).toBeGreaterThanOrEqual(90);
  // Nothing in the header leaves the screen.
  const hdr = await page.locator('header > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  for (const r of hdr) expect(r).toBeLessThanOrEqual(320);
});

// ---- roster-3 (Matt, 10/8/26): where one lives, and a short night on the Board ----
// Valley or Anchorage is theirs to say (blank until chosen) and only Matt sees it. On a short night he will
// not call Valley people in for under 8 hours: the Board marks them (a V always; amber plus a line while it
// is a short night). Short = after 11:30 PM and before 8 AM (8 h work + the 30-minute lunch), or Matt's own
// switch for a night only he knows is short. Warn, never block; a blank never fires.
const homeWorld = () => { const w = world(); w.crew = w.crew.map((c) => (c.id === 'C03' ? { ...c, home_area: 'valley' } : c.id === 'C01' ? { ...c, home_area: 'anchorage' } : c)); return w; };
const JORDAN_ON_N1 = [{ id: 'M1', at: '2026-10-01T17:00:00.000-08:00', worker: 'C03', to_route: 'R1', role: 'member' }];

test('roster-3: Your card asks where you live, blank until chosen; Valley is sent with the save and the card follows the reply', async ({ page }) => {
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#yourCard');
  await expect(page.locator('#s_home_area')).toHaveValue('');
  // Spec section 3: the emergency contact (and where one lives) is Matt's and the dispatchers' to see (final wave addendum).
  await expect(page.locator('#dlgIn')).toContainText('Only the dispatcher and Matt see where you live.');
  await expect(page.locator('#dlgIn')).toContainText('Only the dispatcher and Matt see your emergency contact.');
  await expect(page.locator('#dlgIn')).not.toContainText('Only Matt sees');
  await page.selectOption('#s_home_area', 'valley');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  const saves = () => calls.filter((x) => x.body && x.body.action === 'saveMyCard');
  expect(saves().at(-1).body.card.home_area).toBe('valley');
  await page.click('#yourCard');
  await expect(page.locator('#s_home_area')).toHaveValue('valley');
  // Saved again with nothing touched: still Valley, never cleared by the form.
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves().at(-1).body.card.home_area).toBe('valley');
  // Chosen back to not set: sent as null, the server clears it.
  await page.click('#yourCard');
  await page.selectOption('#s_home_area', '');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saves().at(-1).body.card.home_area).toBe(null);
});

test("roster-3: Matt's worker card shows where they live (not set when blank) and his editor sets and clears it", async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  const saved = () => calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlgIn tr', { hasText: 'Lives in' })).toContainText('not set');
  await page.click('#w_edit');
  await expect(page.locator('#f_home_area')).toHaveValue('');
  await page.selectOption('#f_home_area', 'valley');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saved().home_area).toBe('valley');
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C03"]');
  await expect(page.locator('#dlgIn tr', { hasText: 'Lives in' })).toContainText('Valley');
  await page.click('#w_edit');
  await page.selectOption('#f_home_area', '');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saved().home_area).toBe(null);
});

test('roster-3: a Valley chip carries a V all the time; Anchorage and not set carry nothing; a normal evening has no line and the switch is off', async ({ page }) => {
  const w = homeWorld(); w.moves = JORDAN_ON_N1;
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-02T18:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C03"] .home')).toHaveText('V');
  await expect(page.locator('.chip[data-worker="C01"] .home')).toHaveCount(0);
  await expect(page.locator('.chip[data-worker="C03"]')).not.toHaveClass(/valley-short/);
  await expect(page.locator('li[data-rule="valley-short"]')).toHaveCount(0);
  await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#shortnight')).toContainText('off');
});

// 8 working hours + the 30-minute lunch = 8.5 h before the 8 AM deadline: 11:30 PM is the last start that
// reaches 8 h. Exactly 11:30:00 PM is exactly 8 hours (not short): that second is pinned in warnings.test.js; the page clock
// keeps running after install, so a screen test at the exact second would drift to 23:30:01 under load. At 8:00 AM the night is over.
for (const [stamp, short] of [['2026-10-02T23:29:00', false], ['2026-10-02T23:29:30', false], ['2026-10-02T23:31:00', true],
  ['2026-10-03T00:00:00', true], ['2026-10-03T07:59:00', true], ['2026-10-03T08:00:00', false]]) {
  test('roster-3: at ' + stamp.slice(11, 19) + ' the clock says ' + (short ? 'a short night' : 'a normal night') + ': a Valley person on a route ' + (short ? 'warns and is amber' : 'is left alone'), async ({ page }) => {
    const w = homeWorld(); w.moves = JORDAN_ON_N1;
    await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: stamp + '-08:00' });
    await page.click('nav [data-tab="board"]');
    await expect(page.locator('[data-route="R1"]')).toBeVisible();
    await expect(page.locator('[data-route="R1"] .warns li[data-rule="valley-short"]')).toHaveCount(short ? 1 : 0);
    if (short) {
      await expect(page.locator('[data-route="R1"] .warns li[data-rule="valley-short"]')).toHaveText('Jordan Demo: Valley, short night (under 8 hours)');
      await expect(page.locator('.chip[data-worker="C03"]')).toHaveClass(/valley-short/);
      // The clock's own answer cannot be switched off: the button says so and is disabled.
      await expect(page.locator('#shortnight')).toBeDisabled();
      await expect(page.locator('#shortnight')).toContainText('after 11:30 PM');
    } else {
      await expect(page.locator('.chip[data-worker="C03"]')).not.toHaveClass(/valley-short/);
      await expect(page.locator('#shortnight')).toBeEnabled();
    }
    await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', short ? 'true' : 'false');
  });
}

test('roster-3: on a short night an unplaced Valley person is amber in Unassigned too, and an Anchorage person or a blank is not', async ({ page }) => {
  const w = homeWorld(); w.crew.push({ id: 'C04', name: 'Blank Person', rev: 1 });
  await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-03T01:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('.chip[data-worker="C03"]')).toHaveClass(/valley-short/);
  await expect(page.locator('.chip[data-worker="C01"]')).not.toHaveClass(/valley-short/);
  await expect(page.locator('.chip[data-worker="C04"]')).not.toHaveClass(/valley-short/);
  await expect(page.locator('.chip[data-worker="C04"] .home')).toHaveCount(0);
});

test("roster-3: the switch is Matt's own for a cleanup night: off at 8 PM, on until 9 AM when tapped, nothing sent, and off again when tapped back", async ({ page }) => {
  const w = homeWorld(); w.moves = JORDAN_ON_N1;
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: '2026-10-02T20:00:00-08:00' });
  await page.click('nav [data-tab="board"]');
  await expect(page.locator('#shortnight')).toContainText('off');
  await expect(page.locator('li[data-rule="valley-short"]')).toHaveCount(0);
  const before = calls.length;
  await page.click('#shortnight');
  await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#shortnight')).toContainText('until 9 AM');
  await expect(page.locator('[data-route="R1"] .warns li[data-rule="valley-short"]')).toHaveCount(1);
  await expect(page.locator('.chip[data-worker="C03"]')).toHaveClass(/valley-short/);
  // Phone-local: no write of any kind goes to the backend.
  expect(calls.slice(before).filter((c) => /^(save|add|post|handoff|archive)/.test(c.body.action))).toEqual([]);
  // It lasts until the next 9 AM after it was turned on: 8 PM on 10/2 -> 9 AM on 10/3.
  expect(await page.evaluate(() => Number(localStorage.getItem('plow-short-night-until')))).toBe(new Date('2026-10-03T09:00:00-08:00').getTime());
  await page.click('#shortnight');
  await expect(page.locator('#shortnight')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('li[data-rule="valley-short"]')).toHaveCount(0);
});

test('roster-3: the switch is remembered on this phone until 9 AM and is off again at 9:00 sharp', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } });
  const w = homeWorld(); w.moves = JORDAN_ON_N1;
  const visit = async (stamp, tap) => {
    const page = await ctx.newPage();
    await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: stamp });
    await page.click('nav [data-tab="board"]');
    await expect(page.locator('#shortnight')).toBeVisible();
    if (tap) await page.click('#shortnight');
    const on = await page.locator('#shortnight').getAttribute('aria-pressed');
    await page.close();
    return on;
  };
  expect(await visit('2026-10-02T20:00:00-08:00', true)).toBe('true');
  expect(await visit('2026-10-03T08:59:00-08:00', false)).toBe('true');   // the clock window ended at 8:00; only the switch keeps it on until 9:00
  expect(await visit('2026-10-03T09:00:00-08:00', false)).toBe('false');  // 9:00 sharp: the switch has expired, the night is over
  await ctx.close();
});

// ---------- Spanish (Matt, 10/9/26: crew screens, switched on the phone) ----------
// The screen is translated by lib/es.js; a test on translated text asserts the Spanish
// is visible AND the English is gone (10/5/26 rule), never toContainText alone.
test('Spanish: a phone set to ES opens the sign-in form in Spanish, before anyone signs in', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin h2')).toHaveText('Iniciar sesión');
  await expect(page.getByText('Sign in', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('es');
  await expect(page.locator('#langWrap .lang-btn[data-lang="es"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Spanish: no plow-lang yet, wolf-lang=es from Groundwork opens Spanish and writes plow-lang', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wolf-lang', 'es'));
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin h2')).toHaveText('Iniciar sesión');
  expect(await page.evaluate(() => localStorage.getItem('plow-lang'))).toBe('es');
});

test('Spanish: plow-lang=en wins over wolf-lang=es; a garbage value reads as English', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('plow-lang', 'en'); localStorage.setItem('wolf-lang', 'es'); });
  await open(page, { snow: fakeSnow(world()) });
  await expect(page.locator('#signin h2')).toHaveText('Sign in');
  expect(await page.evaluate(() => localStorage.getItem('plow-lang'))).toBe('en'); // not overwritten by wolf-lang
  await page.evaluate(() => { localStorage.setItem('plow-lang', 'fr'); localStorage.removeItem('wolf-lang'); });
  await page.goto(PAGE);
  await expect(page.locator('#signin h2')).toHaveText('Sign in');
  await expect(page.locator('#langWrap .lang-btn[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Spanish: EN comes back without a reload, and ES twice does not double-translate', async ({ page }) => {
  const calls = await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await expect(page.locator('nav [data-tab="routes"]')).toHaveText('Routes');
  const boots = () => calls.filter((c) => c.body.action === 'bootstrap').length;
  const before = boots();
  await page.click('#langWrap [data-lang="es"]');
  await page.click('#langWrap [data-lang="es"]');
  await expect(page.locator('nav [data-tab="routes"]')).toHaveText('Rutas');
  await expect(page.locator('nav [data-tab="sites"]')).toHaveText('Sitios');
  await page.click('#langWrap [data-lang="en"]');
  await expect(page.locator('nav [data-tab="routes"]')).toHaveText('Routes');
  await expect(page.locator('nav [data-tab="sites"]')).toHaveText('Sites');
  expect(boots()).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('plow-lang'))).toBe('en');
});

test('Spanish: the Storm tab reads Spanish, the English is gone, and a tap still sends plowed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const calls = await openStorm(page, stormWorld());
  await expect(lotBtn(page, 'S1', 'plowed')).toHaveText('Quitado');
  await expect(lotBtn(page, 'S1', 'problem')).toHaveText('Problema');
  await expect(page.getByText('Plowed', { exact: true })).toHaveCount(0);
  await expect(page.locator('#stormhead')).toHaveText('Tormenta abierta · Nieve detenida');
  // The Problem box refuses a blank note in Spanish, before anything is sent.
  await lotBtn(page, 'S1', 'problem').click();
  await page.click('[data-savenote="S1|lot"]');
  await expect(lotRow(page, 'S1').locator('.note-err')).toHaveText('Un problema necesita una nota');
  await expect(page.getByText('A problem needs a note', { exact: true })).toHaveCount(0);
  await page.click('[data-cancelnote="S1|lot"]');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect.poll(() => tapCalls(calls).length).toBe(1);
  expect(tapCalls(calls)[0].body.state).toBe('plowed'); // the server never sees a Spanish word
  // The status line: the state and "by" read Spanish; the time and the name stay as they are.
  await expect(lotLine(page, 'S1')).toHaveText('Quitado 7:50 AM por Jordan Demo');
});

test('Spanish: Tonight for the crew: Tu ruta, and LÍDER keeps its space before the name', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await openStorm(page, stormWorld());
  await page.click('nav [data-tab="tonight"]');
  await expect(page.locator('.tonight-route.mine .badge')).toHaveText('Tu ruta');
  await expect(page.getByText('Your route', { exact: true })).toHaveCount(0);
  await expect(page.locator('.tonight-route.mine .lead').first()).toHaveText('LÍDER ');
  await expect(page.locator('.tonight-route.mine .crewlist li').first()).toContainText('LÍDER Alex Test');
});

test('Spanish: a lot refused after the switch says No se guardó (the observer path)', async ({ page }) => {
  await openStorm(page, stormWorld(), { abortIf: (b) => b.action === 'tapZone' });
  await expect(lotBtn(page, 'S1', 'plowed')).toHaveText('Plowed');
  await page.click('#langWrap [data-lang="es"]');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotRow(page, 'S1')).toContainText('No se guardó');
  await expect(lotRow(page, 'S1').getByText('Not saved')).toHaveCount(0);
  await expect(page.locator('[data-retry="S1|lot"]')).toHaveText('Reintentar');
});

test('Spanish: a dispatcher\'s live view counts lots in Spanish, and the Problems box names the Lot', async ({ page }) => {
  // Dee carries the dispatch mark: the live view (a Board lead has the driver's screen: final wave I1). PAC plowed (seq 1),
  // TUDOR-TRANSIT a Problem (seq 2), both this shift: 1 of 2 lots in all; N1 1 of 1, N2 0 of 1.
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test'), logRow(2, 'S2', 'lot', 'problem', 'Alex Test', { note: 'Done by the Lot gate' })];
  await openStorm(page, w, { token: 'tok-dee' });
  await expect(page.locator('#livesum span').first()).toHaveText('1 de 2 estacionamientos');
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('1 de 1 estacionamientos');
  await expect(page.locator('[data-liveroute="R2"] .live-count')).toHaveText('0 de 1 estacionamientos');
  await expect(page.locator('[data-livesite="S1"] .live-status')).toHaveText('Quitado');
  await expect(page.locator('[data-livesite="S2"] .live-status')).toHaveText('Problema');
  await expect(page.locator('[data-problem="S2|lot"]')).toContainText('TUDOR-TRANSIT · Estacionamiento');
  // The note is a person's words: "Done" and "Lot" are rows, and still it stays as typed.
  await expect(page.locator('[data-problem="S2|lot"] .problem-note')).toHaveText('Done by the Lot gate');
  await expect(page.getByText(/\blots\b/)).toHaveCount(0);
});

test('Spanish: the weather hint is translated by rule', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await nws(page);
  await openStorm(page, withView(stormWorld(), 'S1', NWS_POINT));
  await expect(page.locator('#stormhint')).toHaveText('Nieve hasta las 10 AM');
});

test('Spanish: a plow note, a site note and a name stay as typed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld();
  w.sites[0].plow_note = 'Lot: Plowed edge first, Done by 6';  // "Lot", "Plowed" and "Done" are dictionary rows; the note is Matt's
  w.sites[0].notes = 'Not plowed by the city';                 // "Not plowed" is a dictionary row; the note is Matt's
  await openStorm(page, w);
  await expect(page.locator('[data-shiftsite="S1"] .plow-note')).toHaveText('Lot: Plowed edge first, Done by 6');
  await expect(page.locator('[data-shiftsite="S1"]').getByText('Estacionamiento')).toHaveCount(0);
  await expect(page.locator('#who')).toHaveText('Jordan Demo');
  await page.click('nav [data-tab="sites"]'); // the Sites list prints s.notes (lib/app.js)
  await expect(page.locator('.site-card[data-site="S1"]')).toContainText('Not plowed by the city');
  await expect(page.locator('.site-card[data-site="S1"]').getByText('Sin quitar')).toHaveCount(0);
  await expect(page.locator('.site-card[data-site="S1"] [data-map]')).toHaveText('Mapa'); // the button beside it still translates
});

test('Spanish: the Copy for BT text is byte-identical in EN and ES', async ({ page }) => {
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'problem', 'Alex Test', { note: 'cars in the lot', at: '2026-10-03T06:30:00.000-08:00' })];
  await stubClipboard(page);
  await openStorm(page, w, { token: 'tok-alex' }); // the lead's own route is on his Storm tab (final wave I1)
  await page.locator('[data-bt="S1"]').click();
  await page.click('#bt_copy');
  await page.click('#dlgClose'); // the dialog is modal: the header switch is reachable only between openings
  await page.click('#langWrap [data-lang="es"]');
  await page.locator('[data-bt="S1"]').click();
  await expect(page.locator('label[for="bt_text"]')).toHaveText('Notas'); // the label translates
  await page.click('#bt_copy');
  const copied = await page.evaluate(() => window.__copied);
  // "Problem" is a dictionary row; the text in the box is never translated, in either language.
  expect(copied).toEqual(['Problem: cars in the lot.', 'Problem: cars in the lot.']);
});

test('Spanish: without lib/es.js the app still signs in and runs, in English', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((u) => u.href.endsWith('/lib/es.js'), (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await openStorm(page, stormWorld());
  expect(await page.evaluate(() => typeof SnowEs)).toBe('undefined'); // the block really held
  await expect(lotBtn(page, 'S1', 'plowed')).toHaveText('Plowed');
  await expect(page.locator('#langWrap .lang-btn[aria-pressed="true"]')).toHaveCount(0); // nothing painted, nothing thrown
  expect(errors).toEqual([]);
});

// ---- Spanish, final-review fix pass (10/9/26): the data rule on Tonight, the guard's own holes, a lead's
// controls, a comparison on translated text, and rows the review found missing. Each failed before its fix.
test('Spanish: Tonight never translates a route, site or person name, while its labels still do', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld();
  // Tonight draws every name from the post itself: a real route name with a dictionary word in it, a site
  // with two, and a night lead named like two rows.
  w.posts = [{ ...POST, shift: 'night-2026-10-02',
    routes: [{ id: 'R1', name: 'ANTHC Sidewalk 1', sites: [{ id: 'S1', name: 'Map Valley Plaza' }], lead: 'C01', members: ['C03'] }],
    people: { C01: { name: 'Valley Lead', phone: '555-0101', shifts: { night: 3, day: 1 } }, C03: POST.people.C03 } }];
  await openStorm(page, w);
  await page.click('nav [data-tab="tonight"]');
  const mine = page.locator('.tonight-route.mine');
  await expect(page.locator('#shifts-worked')).toContainText('Valley Lead — 3 noches · 1 día'); // the name kept, the counts by rule
  await expect(mine.locator('.route-badge')).toHaveText('ANTHC Sidewalk 1');
  await expect(mine.locator('.sitelist li').first()).toContainText('Map Valley Plaza');
  await expect(mine.locator('.crewlist li').first()).toContainText('LÍDER Valley Lead');
  await expect(page.locator('#main').getByText('Banqueta')).toHaveCount(0);
  await expect(page.locator('#main').getByText('El Valle')).toHaveCount(0);
  await expect(page.locator('#main').getByText('Mapa Valley')).toHaveCount(0);
  await expect(mine.locator('.badge')).toHaveText('Tu ruta');                 // the labels beside them still translate
  await expect(mine.locator('.sitelist li [data-map]').first()).toHaveText('Mapa');
});

test('Spanish: data-no-es holds for a text node set later and for attributes under it (the engine itself)', async ({ page }) => {
  const w = stormWorld();
  await openStorm(page, w);
  await page.evaluate(() => {
    const p = document.createElement('span'); p.id = 'probe'; p.setAttribute('data-no-es', '');
    p.innerHTML = '<img id="probe_img" alt="Lead" title="Valley">';
    const q = document.createElement('img'); q.id = 'probe_out'; q.alt = 'Lead';
    document.querySelector('main').append(p, q);
  });
  await page.click('#langWrap [data-lang="es"]');                              // the full-body path
  expect(await page.evaluate(() => [document.getElementById('probe_img').alt, document.getElementById('probe_img').title, document.getElementById('probe_out').alt]))
    .toEqual(['Lead', 'Valley', 'Líder']);
  await page.evaluate(() => { document.getElementById('who').textContent = 'Valley Lead'; });   // the observer path, a new Text node
  await expect(page.locator('#who')).toHaveText('Valley Lead');
  await page.evaluate(() => { document.getElementById('who').firstChild.nodeValue = 'Map Start'; }); // characterData
  await expect(page.locator('#who')).toHaveText('Map Start');
});

test("Spanish: the storm controls are not half-translated: the dispatcher's Start stays English, a lead's switch reads Spanish; the card's Start and Finish are Spanish", async ({ page, browser }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld(); w.storms = [];                                       // no storm open: Start storm shows, to Matt
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('[data-storm="start"]')).toHaveText('Start storm'); // the dispatcher's controls: English by ruling
  // A lead (final wave I1), the storm open: his switch is two rows, Snowing and Snow stopped, whole in Spanish; no Start.
  w.storms = [START_ROW];
  const leadCtx = await browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
  try {
    const lead = await leadCtx.newPage();
    await lead.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
    await openStorm(lead, w, { token: 'tok-alex' });
    await expect(lead.locator('#stormctl [data-storm]')).toHaveText(['Nevando', 'Nieve detenida']);
    await expect(lead.locator('[data-storm="start"]')).toHaveCount(0);
    await openCard(lead, 'S1');
    await expect(lead.locator('.vc-times')).toContainText('Inicio');
    await expect(lead.locator('.vc-times')).toContainText('Fin');
    await expect(lead.locator('.vc-times').getByText('Start')).toHaveCount(0);
    await expect(lead.locator('.vc-times').getByText('Finish')).toHaveCount(0);
  } finally { await leadCtx.close(); }
});

test('Spanish: the still-saving note on another card still clears when the slow save lands', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld();
  const calls = await openStorm(page, w, { delay: { saveVisit: 2000 } });
  await openCard(page, 'S1');
  await page.fill('#vc_depth', '2');
  await page.click('#vc_save');
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  await page.click('#otherRoutes');
  await openCard(page, 'S2');
  await page.fill('#vc_depth', '7');
  await page.click('#vc_save');
  await expect(page.locator('#vc_err')).toContainText('Todavía se está guardando');
  expect(visitCalls(calls)).toHaveLength(1);
  await expect.poll(async () => (await phoneState(page)).visits.map((r) => r.id)).toEqual(['V-1']);
  await expect(page.locator('#vc_err')).toHaveText('');                        // cleared, as it is in English
});

test('Spanish: the Problems box keeps the site name as typed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld();
  w.sites[0].name = 'Sidewalk Plaza';
  w.log = [logRow(1, 'S1', 'Z1', 'problem', 'Alex Test', { note: 'ice, needs chipper' })];
  await openStorm(page, w, { token: 'tok-matt' });
  await expect(page.locator('#problems b').first()).toHaveText('Sidewalk Plaza');
  await expect(page.locator('#problems').getByText('Banqueta')).toHaveCount(0);
});

test('Spanish: a three-digit PIN is refused in Spanish', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await open(page, { snow: fakeSnow(world()) });
  await page.selectOption('#si_who', '3');
  await page.fill('#si_pin', '123');
  await page.click('#si_go');
  await expect(page.locator('#si_err')).toHaveText('El PIN tiene 4 dígitos.');
});

// A new person types their name (10/20/26): the sign-in line, the button, the form, the first-and-last rule, the
// already-on-the-list line and Request sent all read Spanish; what is SENT is the name as typed, never translated.
test('Spanish: a new person types their name in Spanish, and Inventory gets the name as typed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const calls = await open(page, { snow: fakeSnow(world()), inv: invWithSignup(PROFILES.map((p) => ({ ...p }))) });
  await expect(page.locator('#si_who option')).toHaveCount(6);
  await expect(page.locator('#signin')).toContainText('Elige tu nombre y luego tu PIN. Si usas Titan Inventory, es el mismo PIN.');
  await expect(page.locator('#signin')).toContainText('¿No estás en la lista?');
  await expect(page.locator('#si_req')).toHaveText('Escribe tu nombre');
  await expect(page.getByText('Not on the list?', { exact: true })).toHaveCount(0);
  await page.click('#si_req');
  await expect(page.locator('#request h2')).toHaveText('Escribe tu nombre');
  await expect(page.locator('#request')).toContainText('Escribe tu nombre y apellido y elige un PIN de 4 dígitos. Esto le llega a Matt. Cuando él lo apruebe, inicia sesión aquí con tu nombre y este PIN.');
  await expect(page.locator('#request')).not.toContainText('Titan Inventory');
  await expect(page.locator('#rq_pos')).toHaveAttribute('placeholder', 'Conductor de quitanieves'); // the box says it in Spanish; what is SENT stays Plow driver
  await expect(page.locator('#request label').first()).toHaveText('Tu nombre y apellido');
  await page.fill('#rq_pin', '4821');
  await page.fill('#rq_name', 'Rosa');
  await page.click('#rq_go');
  await expect(page.locator('#rq_err')).toHaveText('Escribe tu nombre y apellido.');
  await page.fill('#rq_name', 'jordan demo');
  await page.click('#rq_go');
  await expect(page.locator('#rq_err')).toHaveText('Ese nombre ya está en la lista. Si eres tú, regresa y elígelo. Si no, agrega tu segundo apellido o una inicial.');
  await page.fill('#rq_name', 'Clear Snow'); // two dictionary words ("Clear", "Snow"): still sent exactly as typed
  await page.click('#rq_go');
  await expect(page.locator('#reqsent h2')).toHaveText('Solicitud enviada');
  await expect(page.locator('#reqsent')).toContainText('Cuando Matt la apruebe, inicia sesión aquí.');
  await expect(page.locator('#reqsent')).not.toContainText('Titan Inventory');
  await expect(page.locator('#reqsent')).not.toContainText('Matt approves');
  expect(requests(calls)).toEqual([{ action: 'requestProfile', name: 'Clear Snow', position: 'Plow driver', pin: '4821' }]);
});

// ---- Plow Command (10/21/26, Task 15): the Dispatcher switch on the Roster ----
// A dispatcher is a roster person Matt marks (`dispatch: true`); that sign-in is an admin WITH a crew id. C05 is Dee Dispatch, marked,
// and signs in as 'tok-dee'. C01 carries an explicit false (reads "No"); C03 carries no mark at all (a card from before the column:
// reads "Not set"). Crew and leads never receive the field: the fake sends them the public fields only, like the server.
const dispatchWorld = () => {
  const w = world();
  w.crew[0].dispatch = false;
  w.crew.push({ id: 'C05', name: 'Dee Dispatch', phone: '555-0105', is_lead: false, rev: 1, dispatch: true });
  return w;
};
// The Dispatcher row's value cell on the open worker card.
const dispatchCell = (page) => page.locator('#dlgIn tr', { has: page.locator('th', { hasText: /^Dispatcher$/ }) }).locator('td');
const lastSave = (calls) => calls.filter((c) => c.body.action === 'saveCrew').at(-1).body.record;
async function rosterPage(browser, token, world) {
  const page = await (await browser.newContext()).newPage();
  const calls = await open(page, { token, snow: fakeSnow(world) });
  await page.click('nav [data-tab="roster"]');
  return { page, calls };
}

test('roster: the worker card shows Dispatcher to Matt and to a dispatcher, never to crew', async ({ browser }) => {
  // On paper: C05 is marked true -> yes; C01 false -> no; C03 has no mark -> not set (the same words as the Can drive row beside it,
  // yn() in lib/app.js). Matt (the code admin) and Dee (an admin by the mark) read the same three: the phone draws what the server
  // sent for the role.
  for (const token of ['tok-matt', 'tok-dee']) {
    const { page } = await rosterPage(browser, token, dispatchWorld());
    for (const [id, want] of [['C05', 'yes'], ['C01', 'no'], ['C03', 'not set']]) {
      await page.click('[data-open="' + id + '"]');
      await expect(dispatchCell(page), token + ' ' + id).toHaveText(want);
      await page.click('#dlgClose');
    }
    await page.context().close();
  }
  // Crew and a lead: the server never sends the mark (not a public crew field), so no reply they get carries the key, they have
  // no Roster tab, and no screen of theirs says Dispatcher. Dee IS on the roster they read: the mark is the only thing missing.
  for (const token of ['tok-jordan', 'tok-alex']) {
    const page = await (await browser.newContext()).newPage();
    await open(page, { token, snow: fakeSnow(dispatchWorld()) });
    await expect(page.locator('#who')).toContainText(token === 'tok-jordan' ? 'Jordan' : 'Alex');
    const boot = await page.evaluate(() => SnowApi.call('bootstrap'));
    const list = await page.evaluate(() => SnowApi.call('getCrew'));
    for (const r of [boot, list]) {
      expect(r.ok).toBe(true);
      expect(r.crew.map((c) => c.id)).toContain('C05');
      expect(r.crew.some((c) => 'dispatch' in c)).toBe(false);
    }
    await expect(page.locator('nav [data-tab="roster"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Dispatcher');
    if (token === 'tok-jordan') {
      await page.click('#yourCard');                      // their own card, the self view
      await expect(page.locator('#dlg')).toBeVisible();
      await expect(page.locator('#dlg')).not.toContainText('Dispatcher');
    }
    await page.context().close();
  }
});

test("roster: the Dispatcher switch is disabled on one's own card, with its hint; on no other card, and never for Matt", async ({ browser }) => {
  const label = (page) => page.locator('#dlgIn label', { hasText: 'Dispatcher' });
  // Dee (C05) opens her own card: it shows her mark (yes), is off, and says why. Her other cards are free.
  const dee = (await rosterPage(browser, 'tok-dee', dispatchWorld())).page;
  await dee.click('[data-open="C05"]');
  await dee.click('#w_edit');
  await expect(dee.locator('#f_dispatch')).toBeDisabled();
  await expect(dee.locator('#f_dispatch')).toHaveValue('yes');
  await expect(label(dee)).toHaveText('Dispatcher (your own card)');
  await dee.click('#dlgClose');
  for (const id of ['C03', 'C01']) {
    await dee.click('[data-open="' + id + '"]');
    await dee.click('#w_edit');
    await expect(dee.locator('#f_dispatch'), id).toBeEnabled();
    await expect(label(dee), id).toHaveText('Dispatcher');           // no hint on someone else's card
    await dee.click('#dlgClose');
  }
  // "Add worker" opens a record with no id yet: nobody's own card.
  await dee.click('#addWorker');
  await expect(dee.locator('#f_dispatch')).toBeEnabled();
  await expect(label(dee)).toHaveText('Dispatcher');
  await dee.context().close();
  // Matt has no crew card (crew_id null): never held, on C05 or anywhere, and a new worker is not "his own" either
  // (undefined must not equal his missing crew id).
  const matt = (await rosterPage(browser, 'tok-matt', dispatchWorld())).page;
  await matt.click('[data-open="C05"]');
  await matt.click('#w_edit');
  await expect(matt.locator('#f_dispatch')).toBeEnabled();
  await expect(matt.locator('#f_dispatch')).toHaveValue('yes');
  await expect(label(matt)).toHaveText('Dispatcher');
  await matt.click('#dlgClose');
  await matt.click('#addWorker');
  await expect(matt.locator('#f_dispatch')).toBeEnabled();
  await expect(matt.locator('#f_dispatch')).toHaveValue('');
  await matt.context().close();
});

test('roster: saving sends dispatch true; no goes as false and not set as null; a new worker carries it too', async ({ browser }) => {
  const { page, calls } = await rosterPage(browser, 'tok-matt', dispatchWorld());
  // C03 has no mark. Matt sets yes: the save carries true, and the worker card then reads yes.
  await page.click('[data-open="C03"]');
  await page.click('#w_edit');
  await expect(page.locator('#f_dispatch')).toHaveValue('');
  await page.selectOption('#f_dispatch', 'yes');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(lastSave(calls)).toMatchObject({ id: 'C03', rev: 1, dispatch: true });
  await page.click('[data-open="C03"]');
  await expect(dispatchCell(page)).toHaveText('yes');
  // Matt may take Dee's mark away (only Dee is held from her own): No -> false, then blank -> null.
  await page.click('#dlgClose');
  await page.click('[data-open="C05"]');
  await page.click('#w_edit');
  await page.selectOption('#f_dispatch', 'no');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(lastSave(calls)).toMatchObject({ id: 'C05', dispatch: false });
  await page.click('[data-open="C05"]');
  await expect(dispatchCell(page)).toHaveText('no');
  await page.click('#w_edit');
  await page.selectOption('#f_dispatch', '');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(lastSave(calls)).toMatchObject({ id: 'C05', dispatch: null });
  await page.click('[data-open="C05"]');
  await expect(dispatchCell(page)).toHaveText('not set');
  await page.click('#dlgClose');
  // A new worker: the switch is there from the start, and what Matt picks is what goes.
  await page.click('#addWorker');
  await page.fill('#f_name', 'New Plow');
  await page.selectOption('#f_dispatch', 'yes');
  await page.click('#f_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(lastSave(calls)).toMatchObject({ name: 'New Plow', dispatch: true });
  await page.context().close();
  // A dispatcher gives the mark to someone else: allowed (the server holds her only from her own).
  const dee = await rosterPage(browser, 'tok-dee', dispatchWorld());
  await dee.page.click('[data-open="C03"]');
  await dee.page.click('#w_edit');
  await dee.page.selectOption('#f_dispatch', 'yes');
  await dee.page.click('#f_save');
  await expect(dee.page.locator('#dlg')).toBeHidden();
  expect(lastSave(dee.calls)).toMatchObject({ id: 'C03', dispatch: true });
  await dee.page.context().close();
});

test('roster: editing another field sends the existing dispatch unchanged', async ({ browser }) => {
  // saveCrew REPLACES the record, so a plain phone-number fix must carry the mark back as it came or it silently clears Dee's
  // mark. On paper: C05 came true -> goes true; C01 came false -> goes false; C03 came with no mark -> goes as not set (null).
  const { page, calls } = await rosterPage(browser, 'tok-matt', dispatchWorld());
  for (const [id, phone, want] of [['C05', '555-0199', true], ['C01', '555-0198', false], ['C03', '555-0197', null]]) {
    await page.click('[data-open="' + id + '"]');
    await page.click('#w_edit');
    await page.fill('#f_phone', phone);
    await page.click('#f_save');
    await expect(page.locator('#dlg')).toBeHidden();
    expect(lastSave(calls), id).toMatchObject({ id, phone, rev: 1 });
    expect(lastSave(calls).dispatch, id).toBe(want);       // strictly: true is true, false is false, never "falsy"
  }
  await page.click('[data-open="C05"]');
  await expect(dispatchCell(page)).toHaveText('yes');     // and the card still says so after the round trip
  await page.context().close();
  // Dee fixing her OWN phone number: the switch is off, but its value still goes (true), so the server sees no change and saves.
  const dee = await rosterPage(browser, 'tok-dee', dispatchWorld());
  await dee.page.click('[data-open="C05"]');
  await dee.page.click('#w_edit');
  await dee.page.fill('#f_phone', '555-0106');
  await dee.page.click('#f_save');
  await expect(dee.page.locator('#dlg')).toBeHidden();
  await expect(dee.page.locator('#toast')).toHaveText('Saved');
  expect(lastSave(dee.calls)).toMatchObject({ id: 'C05', phone: '555-0106', dispatch: true });
  await dee.page.click('[data-open="C05"]');
  await expect(dispatchCell(dee.page)).toHaveText('yes');
  await dee.page.context().close();
});

test("roster: the server's forbidden reply shows its reason, and the mark stays as it was", async ({ browser }) => {
  // The phone holds Dee off her own switch, but the server is the authority: if the page is tampered with (or a stale copy of
  // her card says otherwise) the refusal comes back in the server's words and nothing on screen changes.
  const { page, calls } = await rosterPage(browser, 'tok-dee', dispatchWorld());
  await page.click('[data-open="C05"]');
  await page.click('#w_edit');
  await page.evaluate(() => { const s = document.getElementById('f_dispatch'); s.disabled = false; s.value = 'no'; });
  await page.click('#f_save');
  await expect(page.locator('#f_err')).toHaveText('You cannot change your own dispatcher mark');
  await expect(page.locator('#dlg')).toBeVisible();                 // the editor stays open
  expect(lastSave(calls)).toMatchObject({ id: 'C05', dispatch: false });   // what was asked, so the refusal is the server's
  await page.keyboard.press('Escape');
  await page.click('[data-open="C05"]');
  await expect(dispatchCell(page)).toHaveText('yes');               // the card still carries the mark
  await page.context().close();
});

test("roster: Spanish: the card row and the editor read Despachador, with the hint (tu propia tarjeta) on one's own card", async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const page = await ctx.newPage();
  await open(page, { token: 'tok-dee', snow: fakeSnow(dispatchWorld()) });
  await page.click('nav [data-tab="roster"]');
  await page.click('[data-open="C05"]');
  await expect(page.locator('#dlgIn th', { hasText: /^Despachador$/ })).toHaveCount(1);
  await expect(page.locator('#dlgIn th', { hasText: /^Dispatcher$/ })).toHaveCount(0);
  // The value reads like its neighbours in Spanish (the same rows as Can drive / Valid ID): C05 marked -> sí; the Can drive row
  // beside it (no answer on C05) -> sin definir; C01 false -> no (no row for it: the word is the same in Spanish); C03 no mark -> sin definir.
  const cellOf = (th) => page.locator('#dlgIn tr', { has: page.locator('th', { hasText: th }) }).locator('td');
  await expect(cellOf(/^Despachador$/)).toHaveText('sí');
  await expect(cellOf(/^Puede manejar$/)).toHaveText('sin definir');
  for (const [id, want] of [['C01', 'no'], ['C03', 'sin definir']]) {
    await page.click('#dlgClose');
    await page.click('[data-open="' + id + '"]');
    await expect(cellOf(/^Despachador$/), id).toHaveText(want);
  }
  await page.click('#dlgClose');
  await page.click('[data-open="C05"]');
  await page.click('#w_edit');
  await expect(page.locator('#dlgIn label', { hasText: 'Despachador' })).toHaveText('Despachador (tu propia tarjeta)');
  await expect(page.locator('#dlgIn')).not.toContainText('your own card');
  await ctx.close();
});

// ---------------- Sites tab: the plow note, and Pull from Shovel Command (Plow Command, Task 16, 10/21/26) ----------------
// The plow note is the dispatcher's line for the drivers (500 characters at most). It sits under the address on the Sites card
// and the Storm card for everyone; the edit box saves it trimmed, blank as '' (the server keeps what a left-out field held, so
// the phone always sends it). Pull from Shovel Command copies the sites and the piles from the shovel crew's Sheet (Task 9):
// a preview first (apply: false), then Pull now (the literal apply: true). Admins only: Matt and the dispatcher.
const pullCalls = (calls) => calls.filter((c) => c.body.action === 'pullFromShovel');
const siteCardOf = (page, id) => page.locator('.site-card[data-site="' + id + '"]');
const saveCalls = (calls) => calls.filter((c) => c.body.action === 'saveSite');
// A pull as the shovel Sheet would answer: S2 (a site the phone knows by name) and S99 (one it has never seen) archived on the
// shovel side. Adds 2 sites + 3 piles = 5; updates 1 site + 6 piles = 7 (different, so the toast cannot swap them unseen).
const PULL = { updates: { sites: 1, zones: 6 }, shovel_archived: ['S2', 'S99'] };
const PULL_LINE = 'Adds: 2 sites, 3 piles · Updates: 1 site, 6 piles · Unchanged: 5 sites, 6 piles · Left out: 7 zones';

// ---------------- the lot's square footage (lot outlines, 10/22/26) ----------------
// "Lot: 48,200 sq ft" under the address (after the plow note) on the Sites card and the Storm card: the sum of the site's
// live lot zones' area_sqft, the server's figures. A site with no lot zone shows no line, never a 0. A route's total is
// the sum over its live sites, on the Routes tab and the dispatcher's live view. Worked by hand: S1 has two lots,
// 30,000 + 18,200 = 48,200; S2 has none; R1 = [S1, S2] totals 48,200; R2 = [S2] has no line.
const lotCards = () => {
  const w = stormWorld();
  w.routes = [{ id: 'R1', name: 'N1', rev: 1, site_ids: ['S1', 'S2'] }, { id: 'R2', name: 'N2', rev: 1, site_ids: ['S2'] }];
  // The crew's Storm tab shows their own posted route only, so the post's R1 (Jordan's) carries S2 too: S2's card is
  // there once, with no line. (R2, Alex's, stays [S2] and is not Jordan's to see.)
  w.posts = [{ ...POST, shift: 'night-2026-10-02', routes: [POST.routes[0], { ...POST.routes[1], sites: [{ id: 'S1', name: 'PAC' }, { id: 'S2', name: 'TUDOR-TRANSIT' }] }] }];
  w.zones = w.zones.concat([
    { id: 'L1', site_id: 'S1', type: 'lot', name: 'Front lot', ring: ring(PAC[0], PAC[1], 60, 50), area_sqft: 30000, rev: 1 },
    { id: 'L2', site_id: 'S1', type: 'lot', name: 'Back lot', ring: ring(PAC[0], PAC[1] + 0.001, 40, 40), area_sqft: 18200, rev: 1 },
  ]);
  return w;
};
const lotLineOf = (loc) => loc.locator('.lot-sqft');

test('cards: the lot\'s square footage sits under the address on the Sites card and the Storm card; none without a lot', async ({ page }) => {
  const w = lotCards();
  await openStorm(page, w);
  await expect(lotLineOf(page.locator('[data-shiftsite="S1"]'))).toHaveText('Lot: 48,200 sq ft');
  await expect(page.locator('[data-shiftsite="S2"]')).toHaveCount(1);   // the card is there...
  await expect(lotLineOf(page.locator('[data-shiftsite="S2"]'))).toHaveCount(0);   // ...with no line
  // Under the plow note, which is under the address.
  expect((await lotLineOf(page.locator('[data-shiftsite="S1"]')).boundingBox()).y).toBeGreaterThan((await page.locator('[data-shiftsite="S1"] .plow-note').boundingBox()).y);
  await page.click('nav [data-tab="sites"]');
  await expect(lotLineOf(siteCardOf(page, 'S1'))).toHaveText('Lot: 48,200 sq ft');
  await expect(lotLineOf(siteCardOf(page, 'S2'))).toHaveCount(0);
  expect((await lotLineOf(siteCardOf(page, 'S1')).boundingBox()).y).toBeGreaterThan((await siteCardOf(page, 'S1').locator('.plow-note').boundingBox()).y);
});

test('routes: a route\'s total is the sum over its sites; a route with no lots shows no line', async ({ page }) => {
  await openStorm(page, lotCards());
  await page.click('nav [data-tab="routes"]');
  await expect(lotLineOf(page.locator('.route-card[data-route="R1"]'))).toHaveText('Lot: 48,200 sq ft');
  await expect(lotLineOf(page.locator('.route-card[data-route="R2"]'))).toHaveCount(0);
});

test('live window: each truck\'s card carries its route\'s lot total', async ({ page }) => {
  await openStorm(page, lotCards(), { token: 'tok-matt' });
  await expect(lotLineOf(page.locator('.live-route[data-liveroute="R1"]'))).toHaveText('Lot: 48,200 sq ft');
  await expect(lotLineOf(page.locator('.live-route[data-liveroute="R2"]'))).toHaveCount(0);
});

test('Spanish: the lot line reads Estacionamiento and pies²', async ({ page }) => {
  await openStorm(page, lotCards());
  await page.click('#langWrap [data-lang="es"]');
  await expect(lotLineOf(page.locator('[data-shiftsite="S1"]'))).toHaveText('Estacionamiento: 48,200 pies²');
});

test('sites: the plow note shows on the card and the storm tab; the edit box saves it (sends plow_note trimmed)', async ({ browser }) => {
  // PAC (S1) has the note and an address; TUDOR-TRANSIT (S2) has no plow_note key at all (a site saved before the field existed).
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, address: '4001 TUDOR CENTRE' } : s));
  // Jordan (crew): the Storm tab, then the Sites tab, both show the note; the site without one shows no line.
  const jp = await (await browser.newContext()).newPage();
  await openStorm(jp, w);
  await expect(jp.locator('[data-shiftsite="S1"] .plow-note')).toHaveText(PLOW_NOTE);
  await jp.click('nav [data-tab="sites"]');
  await expect(siteCardOf(jp, 'S1').locator('.plow-note')).toHaveText(PLOW_NOTE);
  // under the address, which is the card's first muted line
  expect((await siteCardOf(jp, 'S1').locator('.plow-note').boundingBox()).y).toBeGreaterThan((await siteCardOf(jp, 'S1').locator('div.muted').boundingBox()).y);
  await expect(siteCardOf(jp, 'S2').locator('.plow-note')).toHaveCount(0);
  await expect(jp.locator('[data-edit]')).toHaveCount(0);                 // and no way to change it
  await jp.context().close();
  // Matt: the box holds the note as stored (never "undefined" for a site with none); the label, rows and cap are the brief's.
  const page = await (await browser.newContext()).newPage();
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(w), clockAt: STORM_CLOCK });
  await page.click('nav [data-tab="sites"]');
  await expect(siteCardOf(page, 'S1').locator('.plow-note')).toHaveText(PLOW_NOTE);
  await page.click('[data-edit="site:S1"]');
  const box = page.locator('#f_plow_note');
  await expect(page.getByLabel('Plow note for drivers')).toHaveCount(1);
  expect(await box.evaluate((e) => [e.tagName, e.rows, e.maxLength])).toEqual(['TEXTAREA', 3, 500]);
  await expect(box).toHaveValue(PLOW_NOTE);
  // Typed with spaces and a trailing newline around it: sent trimmed.
  await box.fill('   Gate stays shut, push east.  \n');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saveCalls(calls)).toHaveLength(1);
  expect(saveCalls(calls)[0].body.record).toMatchObject({ id: 'S1', plow_note: 'Gate stays shut, push east.' });
  await expect(siteCardOf(page, 'S1').locator('.plow-note')).toHaveText('Gate stays shut, push east.');
  // A site with no note: an empty box; saved untouched it sends '' (the field is always sent); typing only spaces sends '' too.
  await page.click('[data-edit="site:S2"]');
  await expect(page.locator('#f_plow_note')).toHaveValue('');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saveCalls(calls)[1].body.record).toMatchObject({ id: 'S2', plow_note: '' });
  await page.click('[data-edit="site:S2"]');
  await page.fill('#f_plow_note', '    ');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saveCalls(calls)[2].body.record).toMatchObject({ id: 'S2', plow_note: '' });
  await expect(siteCardOf(page, 'S2').locator('.plow-note')).toHaveCount(0);  // a blank note draws no line
  await page.context().close();
});

test('sites: a new site is saved with its plow note too', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world()) });
  await page.click('nav [data-tab="sites"]');
  await page.click('[data-edit="site:"]');
  await expect(page.locator('#f_plow_note')).toHaveValue('');
  await page.fill('#s_name', 'NEW LOT');
  await page.fill('#f_plow_note', ' Dumpster on the north side ');
  await page.click('#s_save');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(saveCalls(calls)[0].body.record).toMatchObject({ name: 'NEW LOT', plow_note: 'Dumpster on the north side' });
});

test('sites: Pull preview lists the counts and the archived names, Pull now sends apply true and refreshes', async ({ page }) => {
  const w = world();   // PAC (S1) and TUDOR-TRANSIT (S2)
  const calls = await open(page, { token: 'tok-matt', delay: { pullFromShovel: 250 },
    snow: fakeSnow(w, { pull: PULL, onPull: (st) => { st.sites = st.sites.concat([{ id: 'S3', name: 'PULLED-IN', rev: 1 }]); } }) });
  await page.click('nav [data-tab="sites"]');
  // The card is the first thing on the tab: heading, the sentence, the button. Nothing is asked until Preview is tapped.
  expect(await page.locator('#main').evaluate((m) => m.firstElementChild.id)).toBe('pullcard');
  await expect(page.locator('#pullcard h2')).toHaveText('Pull from Shovel Command');
  await expect(page.locator('#pullcard p').first()).toHaveText("Copies the sites and snow piles from the shovel crew's map. Your plow notes and push arrows are kept.");
  await expect(page.locator('#pull_preview')).toHaveText('Preview');
  expect(pullCalls(calls)).toHaveLength(0);
  await expect(siteCardOf(page, 'S3')).toHaveCount(0);
  await page.click('#pull_preview');
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlg h2')).toHaveText('Pull from Shovel Command');
  await expect(page.locator('#pull_sum')).toHaveText(PULL_LINE);
  // S2 is TUDOR-TRANSIT on this phone: its name, not its id; S99 is unknown here: the id itself.
  await expect(page.locator('#pull_arch')).toHaveText('Archived on the shovel side (not archived here): TUDOR-TRANSIT, S99');
  expect(pullCalls(calls).map((c) => c.body.apply)).toEqual([false]);   // a preview applies nothing
  // Pull now, tapped twice in a row: one apply (the second tap lands on a button already off).
  await expect(page.locator('#pull_go')).toHaveText('Pull now');
  await page.dblclick('#pull_go');
  await expect(page.locator('#dlg')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Pulled: 5 added, 7 updated');
  expect(pullCalls(calls).map((c) => c.body.apply)).toEqual([false, true]);
  expect(pullCalls(calls)[1].body.apply).toBe(true);                     // the literal true, not a string
  // Refreshed: the sign-in's read was the first bootstrap, the refresh the second, and the pulled-in site is on the list.
  await expect(siteCardOf(page, 'S3')).toBeVisible();
  expect(calls.filter((c) => c.body.action === 'bootstrap')).toHaveLength(2);
  await expect(page.locator('#pullcard')).toBeVisible();
});

test('sites: a crew phone has no Pull card', async ({ browser }) => {
  // Jordan is crew, Alex a route lead: neither gets the card, the button or the dialog, and neither phone asks the server.
  for (const token of ['tok-jordan', 'tok-alex']) {
    const page = await (await browser.newContext()).newPage();
    const calls = await open(page, { token, snow: fakeSnow(world()) });
    await page.click('nav [data-tab="sites"]');
    await expect(siteCardOf(page, 'S1')).toBeVisible();                  // the tab itself is drawn
    await expect(page.locator('#pullcard')).toHaveCount(0);
    await expect(page.locator('#pull_preview')).toHaveCount(0);
    await expect(page.locator('#main')).not.toContainText('Pull from Shovel Command');
    expect(pullCalls(calls)).toHaveLength(0);
    await page.context().close();
  }
});

test('sites: the dispatcher (an admin sign-in with a crew card) has the Pull card', async ({ page }) => {
  const calls = await open(page, { token: 'tok-dee', snow: fakeSnow(dispatchWorld(), { pull: PULL }) });
  await page.click('nav [data-tab="sites"]');
  await expect(page.locator('#pullcard h2')).toHaveText('Pull from Shovel Command');
  await page.click('#pull_preview');
  await expect(page.locator('#pull_sum')).toHaveText(PULL_LINE);
  expect(pullCalls(calls).map((c) => c.body.apply)).toEqual([false]);
});

test('sites: pull_failed shows the reason and keeps the dialog', async ({ page }) => {
  // The shovel Sheet could not be opened: the reason in the server's words after ours, the dialog stays up, and there is nothing
  // to Pull (no preview came). Cancel closes it. Nothing was asked to apply.
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { pullFail: { reason: 'Service Spreadsheets failed' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('#pull_preview');
  await expect(page.locator('#pull_err')).toHaveText("Couldn't open the shovel crew's Sheet: Service Spreadsheets failed");
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#pull_sum')).toHaveCount(0);
  await expect(page.locator('#pull_go')).toBeDisabled();
  expect(pullCalls(calls).map((c) => c.body.apply)).toEqual([false]);
  await page.click('#dlgClose');
  await expect(page.locator('#dlg')).toBeHidden();
  expect(calls.filter((c) => c.body.action === 'bootstrap')).toHaveLength(1);   // no refresh for a pull that did not happen
});

test('sites: a pull_failed on Pull now keeps the preview, shows the reason, and gives the button back', async ({ page }) => {
  const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { pull: PULL, pullFail: { reason: 'Service error', on: 'apply' } }) });
  await page.click('nav [data-tab="sites"]');
  await page.click('#pull_preview');
  await expect(page.locator('#pull_sum')).toHaveText(PULL_LINE);
  await page.click('#pull_go');
  await expect(page.locator('#pull_err')).toHaveText("Couldn't open the shovel crew's Sheet: Service error");
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#pull_sum')).toHaveText(PULL_LINE);        // the preview is still what they are looking at
  await expect(page.locator('#pull_go')).toBeEnabled();                 // and they may try again
  expect(pullCalls(calls).map((c) => c.body.apply)).toEqual([false, true]);
  await expect(page.locator('#toast')).not.toContainText('Pulled');
  expect(calls.filter((c) => c.body.action === 'bootstrap')).toHaveLength(1);
});

test('sites: the open-storm hint shows only while a storm is open', async ({ browser }) => {
  // The hint reads the storm rows the phone has (CrewShiftLog.stormState(S.storms).open); Matt has read them on the Storm tab.
  // Open: the muted line, and the Preview button is still there (a hint, not a block). Ended, or never started: no line at all.
  const END_ROW = { id: 'ST-2', seq: 2, kind: 'end', storm_id: 'ST-1', at: '2026-10-03T06:50:00.000-08:00', by_name: 'Matthew' };
  async function sitesTab(w, head) {
    const page = await (await browser.newContext()).newPage();
    await openStorm(page, w, { token: 'tok-matt' });
    await expect(page.locator('#stormhead')).toHaveText(head);           // the rows have landed
    await page.click('nav [data-tab="sites"]');
    await expect(page.locator('#pull_preview')).toBeVisible();
    return page;
  }
  const HINT = 'Pull when no truck is out: phones read Busy while it runs.';
  let page = await sitesTab(stormWorld(), 'Storm open · Snow stopped');
  await expect(page.locator('#pull_hint')).toHaveText(HINT);
  await expect(page.locator('#pull_hint')).toHaveClass(/muted/);
  await page.context().close();
  const ended = stormWorld(); ended.storms = [START_ROW, END_ROW];
  page = await sitesTab(ended, 'No storm open');
  await expect(page.locator('#pull_hint')).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText('phones read Busy');
  await page.context().close();
  const never = stormWorld(); never.storms = [];
  page = await sitesTab(never, 'No storm open');
  await expect(page.locator('#pull_hint')).toHaveCount(0);
  await page.context().close();
});

test('Spanish: the Pull card, its dialog, the toast and the reason read Spanish; site names stay as typed', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const page = await ctx.newPage();
  await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { pull: PULL }) });
  await page.click('nav [data-tab="sites"]');
  await expect(page.locator('#pullcard h2')).toHaveText('Traer de Shovel Command');
  await expect(page.locator('#pullcard p').first()).toHaveText('Copia los sitios y las pilas de nieve del mapa de la cuadrilla de palas. Se conservan tus notas de quitanieves y tus flechas de empuje.');
  await expect(page.locator('#pull_preview')).toHaveText('Vista previa');
  await page.click('#pull_preview');
  await expect(page.locator('#pull_sum')).toHaveText('Agrega: 2 sitios, 3 pilas · Actualiza: 1 sitio, 6 pilas · Sin cambios: 5 sitios, 6 pilas · Se dejó fuera: 7 zonas');
  // The label is Spanish, the names (a site's own name, an id) are not touched.
  await expect(page.locator('#pull_arch')).toHaveText('Archivado del lado de palas (no archivado aquí): TUDOR-TRANSIT, S99');
  await expect(page.locator('#pull_go')).toHaveText('Traer ahora');
  await expect(page.locator('#dlg').getByText(/\b(Adds|Updates|Unchanged|Pull now)\b/)).toHaveCount(0);
  await page.click('#pull_go');
  await expect(page.locator('#toast')).toHaveText('Traído: 5 agregado(s), 7 actualizado(s)');
  await ctx.close();
  // The failure line: ours in Spanish, the server's reason as it came.
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const p2 = await ctx2.newPage();
  await open(p2, { token: 'tok-matt', snow: fakeSnow(world(), { pullFail: { reason: 'Service Spreadsheets failed' } }) });
  await p2.click('nav [data-tab="sites"]');
  await p2.click('#pull_preview');
  await expect(p2.locator('#pull_err')).toHaveText('No se pudo abrir la hoja de la cuadrilla de palas: Service Spreadsheets failed');
  await ctx2.close();
  // The editor label and the card's note in Spanish; the note is Matt's words, untouched.
  const ctx3 = await browser.newContext();
  await ctx3.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const p3 = await ctx3.newPage();
  const w = world(); w.sites[0].plow_note = 'Plowed edge first, Done by 6';
  await open(p3, { token: 'tok-matt', snow: fakeSnow(w) });
  await p3.click('nav [data-tab="sites"]');
  await expect(siteCardOf(p3, 'S1').locator('.plow-note')).toHaveText('Plowed edge first, Done by 6');
  await p3.click('[data-edit="site:S1"]');
  await expect(p3.locator('label[for="f_plow_note"]')).toHaveText('Nota para los conductores');
  await expect(p3.locator('#f_plow_note')).toHaveValue('Plowed edge first, Done by 6');
  await ctx3.close();
});

test('sites: a session that ends during the preview, or during Pull now, goes back to sign-in and pulls nothing', async ({ browser }) => {
  for (const when of ['preview', 'apply']) {
    const page = await (await browser.newContext()).newPage();
    const exp = { on: false };
    const calls = await open(page, { token: 'tok-matt', snow: fakeSnow(world(), { pull: PULL, expired: exp }) });
    await page.click('nav [data-tab="sites"]');
    if (when === 'preview') exp.on = true;
    await page.click('#pull_preview');
    if (when === 'apply') {
      await expect(page.locator('#pull_sum')).toHaveText(PULL_LINE);
      exp.on = true;
      await page.click('#pull_go');
    }
    await expect(page.locator('#signin')).toBeVisible();
    await expect(page.locator('#dlg')).toBeHidden();
    await expect(page.locator('#toast')).not.toContainText('Pulled');
    expect(pullCalls(calls).map((c) => c.body.apply)).toEqual(when === 'preview' ? [false] : [false, true]);
    await page.context().close();
  }
});

test('sites: closing the dialog while Pull now is on its way still says what happened', async ({ browser }) => {
  // The pull is the server's the moment Pull now is sent: a Cancel after that cannot take it back, so the answer still comes
  // (the toast), and a pull that landed still re-reads the books.
  for (const fails of [false, true]) {
    const page = await (await browser.newContext()).newPage();
    const calls = await open(page, { token: 'tok-matt', delay: { pullFromShovel: 500 },
      snow: fakeSnow(world(), { pull: PULL, ...(fails ? { pullFail: { reason: 'Service error', on: 'apply' } } : {}),
        onPull: (st) => { st.sites = st.sites.concat([{ id: 'S3', name: 'PULLED-IN', rev: 1 }]); } }) });
    await page.click('nav [data-tab="sites"]');
    await page.click('#pull_preview');
    await expect(page.locator('#pull_sum')).toHaveText(PULL_LINE);
    await page.click('#pull_go');
    await page.click('#dlgClose');
    await expect(page.locator('#dlg')).toBeHidden();
    if (fails) {
      await expect(page.locator('#toast')).toHaveText("Couldn't open the shovel crew's Sheet: Service error");
      await expect(siteCardOf(page, 'S3')).toHaveCount(0);
      expect(calls.filter((c) => c.body.action === 'bootstrap')).toHaveLength(1);
    } else {
      await expect(page.locator('#toast')).toHaveText('Pulled: 5 added, 7 updated');
      await expect(siteCardOf(page, 'S3')).toBeVisible();
    }
    await page.context().close();
  }
});

// ---------- Task 18 (10/22/26): the wording Matt ruled, in English and in Spanish ----------
// Each failed before its fix: the status line of an undone lot, the lot/walk words, the New snow label, the Share rows,
// and the live summary's "N sites on M routes" (the bare 'sites' row left it half Spanish).
test('storm tab: an undone lot reads Not plowed alone, with no time and no name', async ({ page }) => {
  // Jordan plows PAC (stamped 7:50 AM) and undoes it. The undo is a row too: state none, stamped 7:50 AM, by Jordan. A lot
  // nobody plowed has no time and nobody to blame, and "Not plowed 7:50 AM by Jordan Demo" sounded as if Jordan reported it:
  // the line is "Not plowed" and nothing else. Undo stays, because an undo can itself be undone.
  const calls = await openStorm(page, stormWorld());
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 7:50 AM by Jordan Demo');
  await page.click('[data-undo="1"]');
  await expect(lotLine(page, 'S1')).toHaveText('Not plowed');
  expect(calls.filter((c) => c.body.action === 'undoTap').map((c) => c.body.seq)).toEqual([1]);
  await expect(lotRow(page, 'S1').locator('.lot-line')).not.toContainText('Jordan');
  await expect(lotRow(page, 'S1').locator('.lot-line')).not.toContainText('7:50');
  await expect(lotBtn(page, 'S1', 'plowed')).toHaveAttribute('aria-pressed', 'false');
  await expect(lotRow(page, 'S1').locator('[data-undo="2"]')).toBeVisible();
  // and a standing tap still names its time and who, so the short form is only for state none
  await lotBtn(page, 'S1', 'problem').click();
  await page.fill('[data-note="S1|lot"]', 'gate locked');
  await page.click('[data-savenote="S1|lot"]');
  await expect(lotLine(page, 'S1')).toHaveText('Problem 7:50 AM by Jordan Demo');
});

test('Spanish: an undone lot reads Sin quitar alone', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await openStorm(page, stormWorld());
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Quitado 7:50 AM por Jordan Demo');
  await page.click('[data-undo="1"]');
  await expect(lotLine(page, 'S1')).toHaveText('Sin quitar');
  await expect(page.getByText('Not plowed', { exact: true })).toHaveCount(0);
});

test('the dispatcher starting or closing a storm is asked first, in lots and not walks', async ({ page }) => {
  // Start and Close are the dispatcher's (final wave I1): Matt here.
  const w = stormWorld(); w.storms = [];
  await openStorm(page, w, { token: 'tok-matt' });
  await ctl(page, 'start').click();
  await expect(page.locator('#dlgIn .muted')).toHaveText('Every lot goes back to not plowed. Nothing already logged is deleted.');
  await expect(page.locator('#dlgIn')).not.toContainText('walk');
  await page.click('#sc_yes');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await ctl(page, 'end').click();
  await expect(page.locator('#dlgIn .muted')).toHaveText('The crew can no longer mark lots until it is reopened.');
  await expect(page.locator('#dlgIn')).not.toContainText('walk');
});

test('Spanish: the Start storm confirm sentence reads Spanish and its English is gone', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld(); w.storms = [];
  await openStorm(page, w, { token: 'tok-matt' }); // Start is the dispatcher's (final wave I1)
  await ctl(page, 'start').click();
  await expect(page.locator('#dlgIn .muted')).toHaveText('Cada estacionamiento vuelve a sin quitar. Nada de lo ya registrado se borra.');
  await expect(page.getByText('Every lot goes back', { exact: false })).toHaveCount(0);
});

test('Spanish: the read-only Storm line says estacionamientos and cuadrilla; the English is gone', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld();
  w.posts = [boardPost({ lead: 'C01' }, {})]; // Jordan is not on it
  await openStorm(page, w);
  const line = page.locator('main p.muted').filter({ hasText: 'Puedes ver las rutas' });
  await expect(line).toBeVisible();
  await expect(line).toHaveText('Puedes ver las rutas, pero no marcar estacionamientos. Si te acaban de agregar a la cuadrilla, pídele al despachador que vuelva a publicar.');
  await expect(page.getByText('You can see the routes', { exact: false })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('recorridos');
  await expect(page.locator('main')).not.toContainText('equipo');
});

test('Spanish: the New snow label asks for inches since the last pass', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await nws(page);
  const w = stormWorld();
  w.sites = w.sites.map((s) => (s.id === 'S1' ? { ...s, callout_in: 1 } : s));
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];
  await openStorm(page, w, { token: 'tok-alex' }); // his route is on his Storm tab (final wave I1)
  await page.click('[data-depth="S1"]');
  await expect(page.locator('label[for="dn_in"]')).toHaveText('Pulgadas desde la última pasada');
  await expect(page.getByText('Inches since the last plow', { exact: false })).toHaveCount(0);
});

test('Spanish: the Share toast reads Spanish', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await stubShare(page, null, true);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect(page.locator('#toast')).toHaveText('Enlace copiado. Pégalo en un mensaje de texto.');
  await expect(page.getByText('Link copied', { exact: false })).toHaveCount(0);
});

test('Spanish: with nothing to copy with, the Share dialog reads Spanish and the link text stays English', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await stubShare(page, null, false);
  await open(page, { token: 'tok-jordan', snow: fakeSnow(world()) });
  await page.click('#share');
  await expect(page.locator('#dlgIn h2')).toHaveText('Compartir Plow Command');
  await expect(page.locator('#dlgIn p')).toHaveText('Copia esto y envíalo por mensaje de texto:');
  expect(await page.locator('#sharetext').inputValue()).toContain('Plow Command, the Titan plow truck app.'); // it leaves the app: English always
  await expect(page.getByText('Copy this and text it', { exact: false })).toHaveCount(0);
});

test('Spanish: the live summary counts sites and routes in Spanish when no storm is open', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld(); w.storms = [];
  await openStorm(page, w, { token: 'tok-matt' }); // the live view is the dispatcher's (final wave I1)
  // two routes, one site on each: "2 sites on 2 routes" is one phrase, so it is one rule, whole.
  await expect(page.locator('#livesum')).toHaveText('No hay tormenta abierta · 2 sitios en 2 rutas');
  await expect(page.getByText('sites on', { exact: false })).toHaveCount(0);
});

// ---------- Task 18 fix round 1 (10/22/26): the server's reason for a refused Undo reads Spanish ----------
test('storm tab: an Undo refused because someone tapped since says why, under the lot', async ({ page }) => {
  // Alex plowed PAC (seq 1, the phone's newest row). Another phone then tapped it (seq 2, on the server only: the phone has not
  // polled yet). Undo of seq 1 is refused by the server's own undoTarget, and the reason is printed after "Not saved:".
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];
  await openStorm(page, w);
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 6:30 AM by Alex Test');
  w.log.push(logRow(2, 'S1', 'lot', 'problem', 'Alex Test', { by_key: 'C03', note: 'gate locked', at: '2026-10-03T06:40:00.000-08:00' }));
  await page.click('[data-undo="1"]');
  await expect(lotRow(page, 'S1').locator('.walk-fail')).toContainText('Not saved: Someone has tapped this lot since');
});

test('Spanish: an Undo refused because someone tapped since reads Spanish, and the English is gone', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  const w = stormWorld();
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test')];
  await openStorm(page, w);
  await expect(lotLine(page, 'S1')).toHaveText('Quitado 6:30 AM por Alex Test');
  w.log.push(logRow(2, 'S1', 'lot', 'problem', 'Alex Test', { by_key: 'C03', note: 'gate locked', at: '2026-10-03T06:40:00.000-08:00' }));
  await page.click('[data-undo="1"]');
  const fail = lotRow(page, 'S1').locator('.walk-fail');
  await expect(fail).toBeVisible();
  await expect(fail).toContainText('No se guardó: Alguien ya tocó este estacionamiento desde entonces');
  await expect(page.getByText('Someone has tapped', { exact: false })).toHaveCount(0);
});

test('Spanish: the route card\'s truck line reads Camión: and the English label is gone', async ({ page }) => {
  // Found by the one-word scan of test/es-coverage.test.js: "Truck:" is on every route card (and on Tonight) and had no row.
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await openStorm(page, stormWorld());
  const row = page.locator('[data-truckrow="R1"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Camión:');
  await expect(page.getByText('Truck:', { exact: false })).toHaveCount(0);
});

// ---------------- Final wave (10/22/26): a lot is done THIS SHIFT (C3), the driver's screen (I1), names stay as typed (M6) ----
// The phone's clock at 9:30 AM on 10/3: past the 9 AM cutover with no night_on, so the shift running is the day of 10/3.
const DAY_CLOCK = '2026-10-03T09:30:00-08:00';
const configCtx = (browser) => browser.newContext({ timezoneId: 'America/Anchorage', viewport: { width: 390, height: 844 } }); // as playwright.config.js
const FADED = /(^|\s)done(\s|$)/;

test("C3: a lot the night plowed reads Not plowed on the day shift and does not fade, until the day plows it", async ({ page, browser }) => {
  // PAC (S1) was plowed at 6:30 AM, the night of 10/2 (logRow's shift). At 9:30 on 10/3 the shift running is the day of 10/3:
  // PAC has no row this shift -> no status line, the card not faded, Plowed not pressed. The day Post puts Jordan on N1.
  // He taps Plowed; the fake stamps it 9:35 and files it under the day (the server's shiftFor) -> his line, and the card fades.
  const w = stormWorld();
  w.posts = [{ ...POST, shift: DAY3, posted_at: at('08:30') }];
  w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') })];
  w.clock = at('09:35');
  await openStorm(page, w, { clockAt: DAY_CLOCK });
  const site = page.locator('[data-shiftsite="S1"]');
  await expect(lotBtn(page, 'S1', 'plowed')).toBeVisible();
  await expect(lotLine(page, 'S1')).toHaveCount(0);
  await expect(site).not.toHaveClass(FADED);
  await expect(lotBtn(page, 'S1', 'plowed')).toHaveAttribute('aria-pressed', 'false');
  await lotBtn(page, 'S1', 'plowed').click();
  await expect(lotLine(page, 'S1')).toHaveText('Plowed 9:35 AM by Jordan Demo');
  await expect(site).toHaveClass(FADED);
  expect(w.log.at(-1)).toMatchObject({ site_id: 'S1', state: 'plowed', shift_id: DAY3 });
  // The same night row read at 7:30 AM, still the night of 10/2: it stands, the card fades.
  const ctx = await configCtx(browser);
  try {
    const night = await ctx.newPage();
    const w2 = stormWorld(); w2.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') })];
    await openStorm(night, w2);
    await expect(lotLine(night, 'S1')).toHaveText('Plowed 6:30 AM by Alex Test');
    await expect(night.locator('[data-shiftsite="S1"]')).toHaveClass(FADED);
  } finally { await ctx.close(); }
});

test("C3: the live view and its summary count this shift: the night's plowed lot is 0 of 1 on the day, 1 of 1 at night", async ({ page, browser }) => {
  // stormWorld: N1 = PAC, N2 = TUDOR-TRANSIT. PAC plowed at 6:30 AM, the night of 10/2.
  //   9:30 AM (the day of 10/3): nothing this shift -> N1 0 of 1 lots, PAC Not plowed, No taps yet; summary 0 of 2 lots,
  //     0 problems, no taps yet, 0 of 2 routes started.
  //   7:30 AM (the night of 10/2): N1 1 of 1 lots, PAC Plowed, Last tap 6:30 AM; summary 1 of 2 lots, last tap 6:30 AM,
  //     1 of 2 routes started.
  const rows = () => { const w = stormWorld(); w.log = [logRow(1, 'S1', 'lot', 'plowed', 'Alex Test', { at: at('06:30') })]; return w; };
  await openStorm(page, rows(), { token: 'tok-matt', clockAt: DAY_CLOCK });
  await expect(page.locator('[data-liveroute="R1"] .live-count')).toHaveText('0 of 1 lots');
  await expect(page.locator('[data-livesite="S1"] .live-status')).toHaveText('Not plowed');
  await expect(page.locator('[data-liveroute="R1"] .live-last')).toHaveText('No taps yet');
  await expect(page.locator('#livesum span')).toHaveText(['0 of 2 lots', '0 problems', 'no taps yet', '0 of 2 routes started']);
  const ctx = await configCtx(browser);
  try {
    const night = await ctx.newPage();
    await openStorm(night, rows(), { token: 'tok-matt' });
    await expect(night.locator('[data-liveroute="R1"] .live-count')).toHaveText('1 of 1 lots');
    await expect(night.locator('[data-livesite="S1"] .live-status')).toHaveText('Plowed');
    await expect(night.locator('[data-liveroute="R1"] .live-last')).toHaveText('Last tap 6:30 AM');
    await expect(night.locator('#livesum span')).toHaveText(['1 of 2 lots', '0 problems', 'last tap 6:30 AM', '1 of 2 routes started']);
  } finally { await ctx.close(); }
});

test("C3: the handoff card lists a lot as a leftover only if the NIGHT it hands off left it", async ({ page }) => {
  // handoffWorld: the night of 10/2 plowed PAC by the mark, so its card (read at 9:30 on 10/3) leaves PAC out: S4, S3, S2.
  // (The next night's card lists PAC, which THAT night left: "the next night's handoff replaces the card".)
  await openStorm(page, handoffWorld(), { clockAt: HO_DAY });
  expect(await leftIds(page)).toEqual(['S4', 'S3', 'S2']);
  await expect(page.locator('[data-leftover="S1"]')).toHaveCount(0);
});

test("I1: a Board lead gets the driver's screen: their routes, the Snowing switch and Hand off now; no live view, no Start, End or Night shift on", async ({ page }) => {
  // stormWorld at 7:30 AM, the night of 10/2, the storm open. Alex leads N2 and N1 on the night Post. Spec sections 4 and 5: the
  // truck's driver has their route's sites, the Snowing/Stopped switch, Hand off now (night) and Set truck; Start, End, Reopen and
  // Night shift on are the dispatcher's.
  const w = stormWorld();
  const calls = await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snow stopped');
  await expect(page.locator('[data-liveroute]')).toHaveCount(0);
  await expect(page.locator('#livesum')).toHaveCount(0);
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();          // both his routes
  await expect(page.locator('[data-shiftsite="S2"]')).toBeVisible();
  await expect(page.locator('#stormctl [data-storm]')).toHaveText(['Snowing', 'Snow stopped']);
  for (const kind of ['start', 'end', 'reopen', 'night_on']) await expect(page.locator('[data-storm="' + kind + '"]')).toHaveCount(0);
  await expect(page.locator('#handOffNow')).toBeVisible();
  await expect(page.locator('[data-truckinput="R1"]')).toBeVisible();        // Set truck on his own route
  await page.click('[data-storm="snowing"]');
  await expect(page.locator('#stormhead')).toHaveText('Storm open · Snowing');
  expect(calls.filter((c) => c.body.action === 'stormAction').map((c) => c.body.kind)).toEqual(['snowing']);
});

test('I1: with no storm open a lead has no storm controls; a dispatcher (a crew card with the mark) has the live view and every control', async ({ page, browser }) => {
  const w = stormWorld(); w.storms = [];
  await openStorm(page, w, { token: 'tok-alex' });
  await expect(page.locator('#stormhead')).toHaveText('No storm open');
  await expect(page.locator('[data-shiftsite="S1"]')).toBeVisible();
  await expect(page.locator('#stormctl')).toHaveCount(0);
  const ctx = await configCtx(browser);
  try {
    const dee = await ctx.newPage();
    await openStorm(dee, stormWorld(), { token: 'tok-dee' });               // open storm, 7:30 AM
    await expect(dee.locator('[data-liveroute="R1"]')).toBeVisible();
    await expect(dee.locator('#livesum')).toBeVisible();
    await expect(dee.locator('#stormctl [data-storm]')).toHaveText(['Close storm (cleanup done)', 'Snowing', 'Snow stopped', 'Night shift on']);
  } finally { await ctx.close(); }
});

test('M6: on a Spanish phone the handoff card keeps a site named Muldoon Lot, and a Problem note, as typed', async ({ page }) => {
  // handoffWorld at 9:30, Jordan. LEFT-RANK-1 (S4) is renamed "Muldoon Lot" ("Lot" alone is a row: Estacionamiento); LEFT-RANK-2's
  // night Problem (seq 5) says "Lot full". The card's own words read Spanish ("Sin quitar", "Problema:"); the name and the note
  // stay as typed.
  const w = handoffWorld();
  w.sites = w.sites.map((s) => (s.id === 'S4' ? { ...s, name: 'Muldoon Lot' } : s));
  w.log = w.log.map((r) => (r.seq === 5 ? { ...r, note: 'Lot full' } : r));
  await page.addInitScript(() => localStorage.setItem('plow-lang', 'es'));
  await openStorm(page, w, { clockAt: HO_DAY });
  await expect(page.locator('[data-leftover="S4"]')).toHaveText('Muldoon Lot · Sin quitar');
  await expect(page.locator('[data-leftover="S3"]')).toHaveText('LEFT-RANK-2 · Sin quitar · Problema: Lot full');
  await expect(page.locator('#handoff').getByText('Muldoon Estacionamiento')).toHaveCount(0);
});
