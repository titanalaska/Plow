(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./time'), require('./shiftlog'), require('./routesheet'));
  else root.CrewCsv = factory(root.CrewTime, root.CrewShiftLog, root.CrewRouteSheet);
})(this, function (T, SL, RS) {
  'use strict';

  // The storm CSV (Plow Command, 10/21/26): one spreadsheet file per storm, "Plow visits 12-4.csv", for the
  // office. One row per site per posted route per shift, so a lot nobody reached is a row too ("not done", with
  // no time and no driver). One visit is one row: a driver off their own route shows on the route row of the site
  // they tapped, flagged off_route yes. A site that no posted route shows that shift (nobody's sheet would list
  // it) gets one row of its own at the end, from its newest standing tap, whoever made it (an admin's tap is never
  // off route: off_route no), with route and truck blank.
  //
  // The route rows are the POSTED routes (final wave I2, spec section 6: "one row per site per posted route per shift"):
  // for each shift the storm covers, the routes that shift's newest Post crews; only a shift with no Post falls back to the
  // route sheets' pairs for that shift (RS.sheetsFor). So a day driver who plows a night route's leftover makes a tail row,
  // never a day block for the night route. Each row reads the same site data as the route sheets (RS.sheetData), so a sheet
  // and its CSV rows can never disagree about who plowed what. (The PDFs still make a sheet for every route with a tap.)
  // Names only: a person reaches the file through the name a tap or a site card carries and nothing else about them.
  // Pure, and byte-identical in the phone app (Download CSV) and the backend (the file in Drive).

  // The columns, in order. The header, every row and the tests all come from this one list.
  var COLUMNS = ['storm_start', 'shift', 'route', 'truck', 'driver', 'site', 'address', 'customer', 'plowed_at',
    'state', 'problem_note', 'new_snow_in', 'materials_used', 'off_route'];
  var HEADER = COLUMNS.join(',');
  var EOL = '\r\n';
  // The file starts with the UTF-8 byte order mark (final wave M4, 10/22/26), once: Excel opens a .csv without it in the
  // machine's old code page and mangles a Spanish note's letters. The phone's Download writes this same text (its Blob gets
  // the mark from the text, never a second one). HEADER itself carries none.
  var BOM = String.fromCharCode(0xFEFF);

  function bySeq(a, b) { return Number(a.seq) - Number(b.seq); }
  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function text(v) { return blank(v) ? '' : String(v).trim(); }
  function inStorm(rows, stormId) {
    return (rows || []).filter(function (r) { return r.storm_id === stormId; });
  }

  // One cell, RFC 4180: a cell with a comma, a double quote, CR or LF is wrapped in double quotes and each
  // double quote inside it is doubled. Anything else is written as it is ("O'Riley's" needs no quotes).
  function field(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  // "2026-12-05T02:14:00.000-09:00" -> "2026-12-05 02:14". The stored time is a local ISO with its offset, so
  // its first 16 characters ARE the local wall clock: read off the string, never through the machine's zone.
  // Anything that is not an iso time is written as it came; nothing at all stays blank.
  function localMinute(iso) {
    var s = text(iso);
    if (!s) return '';
    return ISO.test(s) ? s.slice(0, 10) + ' ' + s.slice(11, 16) : s;
  }

  // The storm's start row, as the route sheet reads it (sheetData's storm_started): the first start row of this storm.
  function stormStart(o) {
    var start = (o.storms || []).filter(function (r) { return r.kind === 'start' && r.storm_id === o.storm_id; }).sort(bySeq)[0];
    return start ? start.at : null;
  }

  // "<name> <value>" for each person's site card that has the value, joined with "; ": "Alex 2.5; Jordan 1".
  function byPerson(cards, key) {
    return cards.filter(function (c) { return !blank(c[key]); }).map(function (c) {
      var name = text(c.by_name);
      return (name ? name + ' ' : '') + text(c[key]);
    }).join('; ');
  }

  // The (route, shift) pairs the route rows come from, in shift order and route-name order within a shift: for each shift the
  // storm covers (the route sheets' shifts), the live routes that shift's newest Post puts a lead or members on; a shift with
  // no Post at all keeps the route sheets' own pairs for it.
  function postedPairs(o) {
    var sheets = RS.sheetsFor(o), shifts = [], out = [];
    sheets.forEach(function (p) { if (shifts.indexOf(p.shift_id) === -1) shifts.push(p.shift_id); });
    var routes = (o.routes || []).filter(function (r) { return r.archived !== true; }).sort(RS.byRouteName);
    shifts.forEach(function (shiftId) {
      if (RS.newestPost(o.posts, shiftId)) {
        routes.forEach(function (r) { if (RS.postHasCrew(o, r, shiftId)) out.push({ route_id: r.id, shift_id: shiftId }); });
      } else {
        sheets.forEach(function (p) { if (p.shift_id === shiftId) out.push(p); });
      }
    });
    return out;
  }

  // The whole file: the header, a row for every site of every posted (route, shift) pair (postedPairs), then one row for
  // every site + shift that has a real lot tap but is on none of those rows, from its newest standing tap. Every line,
  // the last too, ends CRLF.
  function stormCsv(o) {
    var start = localMinute(stormStart(o));
    var stormVisits = inStorm(o.visits, o.storm_id);
    var siteById = {};
    (o.sites || []).forEach(function (s) { siteById[s.id] = s; });
    var lines = [HEADER];

    // c: { shift_id, route, truck, site_id, site_name, state ('none' = not done), note, by_name, at, off_route }
    function add(c) {
      var site = siteById[c.site_id] || {};
      var cards = SL.visitTotals(stormVisits, c.site_id, c.shift_id).cards;
      var cells = {
        storm_start: start,
        shift: T.shiftLabel(c.shift_id),
        route: c.route,
        truck: c.truck,
        driver: c.state === 'none' ? '' : text(c.by_name),
        site: c.site_name,
        address: text(site.address),
        customer: text(site.customer),
        plowed_at: c.state === 'none' ? '' : localMinute(c.at),
        state: c.state === 'none' ? 'not done' : c.state,
        problem_note: c.state === 'problem' ? text(c.note) : '',
        new_snow_in: byPerson(cards, 'depth_in'),
        materials_used: byPerson(cards, 'materials_used'),
        off_route: c.off_route ? 'yes' : 'no',
      };
      lines.push(COLUMNS.map(function (k) { return field(cells[k]); }).join(','));
    }

    // The site + shift keys the route rows below cover: a tap on one of them is already on its route's row.
    var covered = {};
    postedPairs(o).forEach(function (p) {
      var d = RS.sheetData(o, p.route_id, p.shift_id);
      d.sites.forEach(function (s) {
        covered[s.id + '|' + d.shift_id] = true;
        add({ shift_id: d.shift_id, route: d.route, truck: d.truck ? d.truck.truck : '', site_id: s.id, site_name: s.name,
          state: s.lot.state, note: s.lot.note, by_name: s.lot.by_name, at: s.lot.at, off_route: s.lot.off_route });
      });
    });

    // Every site + shift a real lot tap touched that no route row covers is a row of its own, from the newest standing tap
    // there (by seq), with no route and no truck, off_route as that tap says. The rows run in the order of those taps.
    // (A covered site shows its newest standing tap on its route row, flagged if it was off route; an earlier tap it
    // replaced is listed nowhere: the CSV is per site per shift, the Log keeps every tap.) A tap taken back, an undo
    // row, a depth reading and a row on any other zone id than the lot are not taps.
    var tail = {};
    SL.realTaps(inStorm(o.log, o.storm_id)).filter(function (r) { return r.zone_id === 'lot'; })
      .sort(bySeq).forEach(function (r) {
        var key = r.site_id + '|' + r.shift_id;
        if (!covered[key]) tail[key] = r;
      });
    Object.keys(tail).map(function (k) { return tail[k]; }).sort(bySeq).forEach(function (r) {
      var site = siteById[r.site_id];
      add({ shift_id: r.shift_id, route: '', truck: '', site_id: r.site_id, site_name: site ? String(site.name || site.id) : String(r.site_id),
        state: r.state, note: r.note, by_name: r.by_name, at: r.at, off_route: r.off_route === true });
    });

    return BOM + lines.join(EOL) + EOL;
  }

  // "Plow visits 12-4.csv" (the storm's start date, month-day, no padding), or with a stamp for a later End:
  // "Plow visits 12-4 (updated 9-12 AM).csv". `updated` is the time the later file was made (an iso time, written
  // as the PDFs' stamp is: a colon cannot be in a file name) or false for the storm's first file.
  function fileName(o, updated) {
    var start = stormStart(o);
    var name = 'Plow visits';
    if (ISO.test(String(start || ''))) name += ' ' + Number(start.slice(5, 7)) + '-' + Number(start.slice(8, 10));
    if (updated) name += ' (updated ' + RS.fileSafe(ISO.test(String(updated)) ? RS.clock(updated) : updated) + ')';
    return name + '.csv';
  }

  return { HEADER: HEADER, COLUMNS: COLUMNS, stormCsv: stormCsv, fileName: fileName, field: field };
});
