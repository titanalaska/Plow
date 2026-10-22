// Plow Command -- site maps, crew view. One site's drawings over live aerial imagery: the lot itself
// has no polygon (the aerial IS the lot); Matt draws its snow piles, its keep-clear areas and the push
// arrows the plow drives. MapLibre is loaded on first use, not on every page load: it is ~900 KB and
// most opens of the app never look at a map.
//
// The drawings never depend on the imagery. They are a GeoJSON source over a plain background; the
// photo tiles are underneath and may fail on their own.
var SnowMap = (function () {
  'use strict';
  var ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  var MOA = 'https://www.ancgis.com/arcgis/rest/services/imagery_public/Photo_2024/MapServer/tile/{z}/{y}/{x}';
  var ANCHORAGE = [-149.9003, 61.2181]; // first open of an undrawn site: Matt pans from here, then Save view
  var MOA_BOUNDS = [-150.09, 60.85, -149.04, 61.47]; // Bootprint's, so MOA is never asked for tiles it can't have
  // The three kinds (Plow Command, 10/21/26). storage and no_touch are areas (3+ corners) in Bootprint's colours (Matt,
  // 10/4/26); push is an arrow, a line of 2+ corners, white with a dark edge, its head at its last corner. The Shovel
  // crew's sidewalk, hand and heated are not kinds here: a zone of any other type (a row typed into the Sheet by hand)
  // draws nothing. Key order is the legend's order.
  var TYPES = {
    storage: { color: '#7d5ba6', label: 'Snow storage' },
    no_touch: { color: '#e0218a', label: 'Keep clear' },
    push: { color: '#ffffff', edge: '#1a1a1a', label: 'Push snow this way' },
  };
  var AREAS = ['storage', 'no_touch'];

  // MapLibre 5 fires NO error for a 404 raster tile (sparse sources 404 by
  // design), so the map can't tell us the photo is missing. Ask the servers:
  // fetch the one tile under the site's centre from each source.
  function tileUrl(tpl, lng, lat, z) {
    var n = Math.pow(2, z), r = lat * Math.PI / 180;
    var x = Math.floor((lng + 180) / 360 * n);
    var y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }
  function fetchOk(u) {
    return fetch(u, { cache: 'force-cache' }).then(function (r) { return r.ok; }, function () { return false; });
  }
  function probePhotos(c, zoom) {
    var moaCovers = c.lng >= MOA_BOUNDS[0] && c.lng <= MOA_BOUNDS[2] && c.lat >= MOA_BOUNDS[1] && c.lat <= MOA_BOUNDS[3];
    return Promise.all([
      fetchOk(tileUrl(ESRI, c.lng, c.lat, Math.min(19, Math.round(zoom)))),
      moaCovers ? fetchOk(tileUrl(MOA, c.lng, c.lat, Math.max(13, Math.min(21, Math.round(zoom))))) : Promise.resolve(false),
    ]).then(function (r) { return { esriOk: r[0], moaOk: r[1], moaCovers: moaCovers }; });
  }

  // Should the crew see "Aerial photo unavailable"?
  //   esriOk    -- Esri answered with a photo (Esri is the base layer, everywhere)
  //   moaOk     -- MOA answered with a photo (it sits on top where it has one)
  //   moaCovers -- the site is inside MOA's area at all
  // Matt, 10/1/26: warn only when NO photo loads at all. A blurrier Esri photo
  // is still a photo, and a banner that cries wolf gets ignored.
  function photoUnavailable(esriOk, moaOk, moaCovers) {
    return !esriOk && !(moaCovers && moaOk);
  }

  var loading = null;
  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    if (loading) return loading;
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'vendor/maplibre-gl.css';
    document.head.appendChild(css);
    loading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/maplibre-gl.js';
      s.onload = function () { res(); };
      s.onerror = function () { loading = null; rej(new Error('map library did not load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Area-weighted centroid in the lng/lat plane (the forecast point when a site has a drawing and no saved view:
  // lib/weather.js): plenty at site scale, and it stays inside an L-shaped outline where the corner average can fall
  // outside. The corners are taken relative to the first (R5, 10/9/26; it lived in lib/points.js until the outlines
  // went): the formula does not care where the origin is, but at -149.9 / 61.2 the products p[0]*q[1] - q[0]*p[1] are
  // about 9,000 each and their sum about 1e-7, so raw lng/lat rounding swamps the answer (a 4 ft x 100 ft curb strip
  // came out 628 m to 1,350 m off). Relative to a corner the same rings come out within a millimetre. A ring with no
  // area (an arrow's corners) answers its first corner.
  function centroid(ring) {
    var o = ring[0], a = 0, x = 0, y = 0, n = ring.length;
    for (var i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n];
      var px = p[0] - o[0], py = p[1] - o[1], qx = q[0] - o[0], qy = q[1] - o[1];
      var c = px * qy - qx * py;
      a += c; x += (px + qx) * c; y += (py + qy) * c;
    }
    if (!a) return [o[0], o[1]];
    return [o[0] + x / (3 * a), o[1] + y / (3 * a)];
  }

  function finite(n) { return typeof n === 'number' && isFinite(n); }
  // A zone the map can draw: one of the three kinds, with enough corners for its kind (an area 3, an arrow 2), each a
  // [lng, lat] of finite numbers. The Zones tab can be edited by hand, so a row is never trusted to be drawable.
  function drawable(z) {
    if (!z || !TYPES[z.type] || !Array.isArray(z.ring) || z.ring.length < (z.type === 'push' ? 2 : 3)) return false;
    return z.ring.every(function (p) { return Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]); });
  }

  // An arrow's head: a closed ring [tip, left, right, tip]. The tip is the arrow's last corner; the base centre sits 4 m
  // back along the last leg (from the second-last corner toward the tip); left and right are 2 m either side of it,
  // left being on the left of the way the arrow points. Worked in metres at the tip (dx = cos(lat) x 111,320 m per degree
  // of longitude, dy = 110,540 per degree of latitude), so the head is not squashed this far north. null when there is no
  // last leg to point along: fewer than 2 corners, or the last two coincide.
  var HEAD_BACK_M = 4, HEAD_HALF_M = 2;
  function arrowHead(ring) {
    if (!Array.isArray(ring) || ring.length < 2) return null;
    var tip = ring[ring.length - 1], prev = ring[ring.length - 2];
    var dx = Math.cos(tip[1] * Math.PI / 180) * 111320, dy = 110540;
    var ex = (tip[0] - prev[0]) * dx, ny = (tip[1] - prev[1]) * dy, len = Math.sqrt(ex * ex + ny * ny);
    if (!(len > 0)) return null;
    var ux = ex / len, uy = ny / len;                          // the last leg's direction, in metres east and north
    var bx = -HEAD_BACK_M * ux, by = -HEAD_BACK_M * uy;          // the base centre, from the tip
    var lx = -uy * HEAD_HALF_M, ly = ux * HEAD_HALF_M;           // a quarter turn left, 2 m
    function at(e, n) { return [tip[0] + e / dx, tip[1] + n / dy]; }
    return [[tip[0], tip[1]], at(bx + lx, by + ly), at(bx - lx, by - ly), [tip[0], tip[1]]];
  }

  // The source the map draws: an area is a Polygon (its ring closed); an arrow is a LineString through its corners in
  // order, then its head as a Polygon with its own id (<zone id>:head) and type push_head. A zone the map cannot draw
  // (drawable) has no feature at all.
  function featureCollection(zones) {
    var features = [];
    (zones || []).forEach(function (z) {
      if (!drawable(z)) return;
      if (z.type !== 'push') {
        features.push({ type: 'Feature', properties: { id: z.id, type: z.type }, geometry: { type: 'Polygon', coordinates: [z.ring.concat([z.ring[0]])] } });
        return;
      }
      features.push({ type: 'Feature', properties: { id: z.id, type: 'push' }, geometry: { type: 'LineString', coordinates: z.ring.slice() } });
      var head = arrowHead(z.ring);
      if (head) features.push({ type: 'Feature', properties: { id: z.id + ':head', type: 'push_head' }, geometry: { type: 'Polygon', coordinates: [head] } });
    });
    return { type: 'FeatureCollection', features: features };
  }

  // The table as a paint expression: a feature's colour from its `type`, every kind in
  // legend order, `fallback` for a feature with none. The areas' layers and the editor's
  // import preview both colour from this, so a kind can never be missing from one of them.
  function typeColour(fallback) {
    var colour = ['match', ['get', 'type']];
    Object.keys(TYPES).forEach(function (k) { colour.push(k, TYPES[k].color); });
    colour.push(fallback);
    return colour;
  }

  // The arrow's swatch is white like its line, so it carries its dark edge or it vanishes on the white legend.
  function legendHtml() {
    return Object.keys(TYPES).map(function (k) {
      var t = TYPES[k];
      return '<span><i style="background:' + t.color + (t.edge ? ';box-shadow:inset 0 0 0 2px ' + t.edge : '') + '"></i>' + esc(t.label) + '</span>';
    }).join('');
  }

  // A zone's card. An arrow has a name and a note and nothing else to say: no area, no kind line (the legend says what
  // the white arrow is), and a priority is not drawn for it.
  function sheetHtml(z) {
    if (z.type === 'push') return '<h2 data-no-es>' + esc(z.name) + '</h2>' + (z.note ? '<div data-no-es>' + esc(z.note) + '</div>' : '');
    var t = TYPES[z.type] || { label: z.type };
    return '<h2 data-no-es>' + (z.priority ? '★ ' : '') + esc(z.name) + '</h2>' +
      '<div><span class="swatch" style="background:' + (t.color || '#888') + '"></span>' + esc(t.label) + '</div>' +
      (z.priority ? '<div><b>Priority: do first</b></div>' : '') +
      (z.note ? '<div data-no-es>' + esc(z.note) + '</div>' : '') +
      (z.area_sqft != null ? '<div class="muted">≈ ' + Math.round(z.area_sqft).toLocaleString('en-US') + ' sq ft</div>' : '');
  }

  // ---- a tap on the map shows a zone's card ----
  // How far a tap reaches, in screen pixels each way: about a fingertip, so a thin zone can be hit at all.
  var REACH_PX = 20;
  // The layers a tap can hit: the areas, and an arrow by its line or its head.
  var HIT = ['zones-fill', 'push-line', 'push-head'];
  // The distance in pixels from point p to a shape (its corners in pixels): 0 inside a closed outline, else to its
  // nearest edge. An open line (an arrow) has no edge from its last corner back to its first.
  function pxDistance(p, pts, closed) {
    var best = Infinity, inside = false, n = pts.length, i, a, b;
    for (i = 0; i < n; i++) {
      a = pts[i]; b = pts[(i + 1) % n];
      if (closed && (a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      if (!closed && i === n - 1) break;
      var vx = b[0] - a[0], vy = b[1] - a[1], ll = vx * vx + vy * vy;
      var t = ll ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / ll)) : 0;
      var cx = a[0] + t * vx - p[0], cy = a[1] + t * vy - p[1];
      best = Math.min(best, Math.sqrt(cx * cx + cy * cy));
    }
    if (n === 1) best = Math.sqrt(Math.pow(pts[0][0] - p[0], 2) + Math.pow(pts[0][1] - p[1], 2));
    return closed && inside ? 0 : best;
  }
  // The zones in reach, best first (Plow Command, 10/21/26: a tap shows the CLOSEST; no "Which zone?" list). The zones
  // right under the fingertip first; then, when `dist` ({ id: pixels }) is given, the closer; then the smaller (a zone
  // with no area after those with one), then by name. `under` is the ids under the fingertip. A new list; `near` is
  // untouched.
  function pickOrder(near, under, dist) {
    var on = {};
    (under || []).forEach(function (id) { on[id] = true; });
    function area(z) { return typeof z.area_sqft === 'number' && isFinite(z.area_sqft) ? z.area_sqft : Infinity; }
    function far(z) { return dist && typeof dist[z.id] === 'number' ? dist[z.id] : 0; }
    return near.slice().sort(function (a, b) {
      return (on[a.id] ? 0 : 1) - (on[b.id] ? 0 : 1) || (far(a) - far(b)) || (area(a) - area(b) || 0) || String(a.name).localeCompare(String(b.name));
    });
  }
  function showZone(map, z) {
    var sheet = map._snow.sheetEl;
    sheet.innerHTML = sheetHtml(z);
    sheet.hidden = false;
  }
  // A head's feature names its arrow: '<zone id>:head'.
  function zoneOf(map, f) {
    var id = String(f.properties.id);
    if (f.properties.type === 'push_head') id = id.slice(0, -':head'.length);
    return map._snow.byId[id];
  }
  function onTap(map, e) {
    var p = e.point, seen = {}, near = [], dist = {};
    // Before the style is parsed there is no zones layer to ask (and asking for one logs an error): nothing to hit.
    if (!map.getLayer('zones-fill')) return;
    map.queryRenderedFeatures([[p.x - REACH_PX, p.y - REACH_PX], [p.x + REACH_PX, p.y + REACH_PX]], { layers: HIT }).forEach(function (f) {
      var z = zoneOf(map, f);
      if (z && !seen[z.id]) { seen[z.id] = true; near.push(z); }
    });
    if (!near.length) return;
    near.forEach(function (z) {
      dist[z.id] = pxDistance([p.x, p.y], z.ring.map(function (c) { var q = map.project(c); return [q.x, q.y]; }), z.type !== 'push');
    });
    var under = map.queryRenderedFeatures(p, { layers: HIT }).map(function (f) { var z = zoneOf(map, f); return z && z.id; });
    showZone(map, pickOrder(near, under, dist)[0]);
  }

  // MapLibre parses an inline style on the NEXT ANIMATION FRAME, and a page off screen
  // gets none (10/9/26, Fire Station #10: the phone's screen off, the app behind another,
  // the desktop pane's window hidden). open() still hands the map over after its 8 s
  // fallback, so a style write can meet a style that is not parsed yet: addSource,
  // setLayoutProperty and the like throw "Style is not done loading", and getSource is
  // undefined. fn runs now if the style is parsed, else once at the first styledata, which
  // the parse fires. The probe is the site's own zones source, which the parse puts there --
  // NOT isStyleLoaded(): that also waits for the photo tiles, and the photo may never come.
  // One pending fn per key (the newest wins: it reads the map's own state when it runs),
  // one listener for all of them. A map removed before the parse never fires it.
  function whenStyled(map, key, fn) {
    if (map.getSource('zones')) { fn(); return; }
    var p = map._snow.pending;
    if (!p) {
      p = map._snow.pending = {};
      map.once('styledata', function () {
        map._snow.pending = null;
        Object.keys(p).forEach(function (k) { whenStyled(map, k, p[k]); });
      });
    }
    p[key] = fn;
  }

  function index(map, zones) {
    map._snow.byId = {};
    zones.forEach(function (z) { map._snow.byId[z.id] = z; });
  }
  // After a save or archive: the same map, redrawn from the new zone list. The zones source takes the
  // list when the style is parsed (the parse builds that source from the list the map OPENED with, so
  // a zone saved before it would never show without this).
  function setZones(map, zones) {
    map._snow.zones = zones;
    index(map, zones);
    whenStyled(map, 'zones', function () { map.getSource('zones').setData(featureCollection(map._snow.zones)); });
  }

  // els: {map, legend, warn, sheet}. Resolves to the map as soon as it exists.
  async function open(els, site, zones) {
    await loadLib();
    var gl = window.maplibregl;
    var view = site.map || {};
    var colour = typeColour('#888888');
    var shown = zones.filter(drawable);
    var isPush = ['==', ['get', 'type'], 'push'], isHead = ['==', ['get', 'type'], 'push_head'], isArea = ['in', ['get', 'type'], ['literal', AREAS]];
    var round = { 'line-cap': 'round', 'line-join': 'round' };
    // The zones are part of the starting style, not added on 'load': 'load'
    // waits for the photo tiles, and with no signal it may never come.
    var map = new gl.Map({
      container: els.map,
      center: view.center || (shown.length ? shown[0].ring[0] : ANCHORAGE),
      zoom: view.zoom || (shown.length ? 18 : 15),
      bearing: view.bearing || 0, // Matt may turn a site so its main entrance faces him; the crew open it the same way
      maxZoom: 22,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' },
          moa: { type: 'raster', tiles: [MOA], tileSize: 256, minzoom: 13, maxzoom: 21, bounds: MOA_BOUNDS, attribution: 'Municipality of Anchorage' },
          zones: { type: 'geojson', data: featureCollection(zones) },
        },
        // The areas, then the arrows over them: a dark casing with the white line on it, then the head (white, edged dark).
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#20241f' } },
          { id: 'esri', type: 'raster', source: 'esri' },
          { id: 'moa', type: 'raster', source: 'moa' },
          { id: 'zones-fill', type: 'fill', source: 'zones', filter: isArea, paint: { 'fill-color': colour, 'fill-opacity': 0.35 } },
          { id: 'zones-line', type: 'line', source: 'zones', filter: isArea, paint: { 'line-color': colour, 'line-width': 3 } },
          { id: 'push-casing', type: 'line', source: 'zones', filter: isPush, layout: round, paint: { 'line-color': TYPES.push.edge, 'line-width': 7 } },
          { id: 'push-line', type: 'line', source: 'zones', filter: isPush, layout: round, paint: { 'line-color': TYPES.push.color, 'line-width': 4 } },
          { id: 'push-head', type: 'fill', source: 'zones', filter: isHead, paint: { 'fill-color': TYPES.push.color } },
          { id: 'push-head-line', type: 'line', source: 'zones', filter: isHead, layout: { 'line-join': 'round' }, paint: { 'line-color': TYPES.push.edge, 'line-width': 2 } },
        ],
      },
    });
    // The compass turns a rotated map back to north in one tap.
    map.addControl(new gl.NavigationControl({ showCompass: true }), 'bottom-right');
    // No saved view yet: frame the drawings rather than open on an empty corner.
    if (!view.center && shown.length) {
      var b = new gl.LngLatBounds();
      shown.forEach(function (z) { z.ring.forEach(function (p) { b.extend(p); }); });
      map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 20 });
    }

    probePhotos(map.getCenter(), map.getZoom()).then(function (p) {
      els.warn.hidden = !photoUnavailable(p.esriOk, p.moaOk, p.moaCovers);
    });

    els.legend.innerHTML = legendHtml();

    // One tap flips the photo. Tall buildings lean over the walks in one flight
    // and not the same way in the other (Matt, tracing PAC, 10/1/26). Esri is
    // always underneath, so hiding the city layer is the whole switch.
    var sw = document.createElement('button');
    sw.id = 'photoswitch'; sw.className = 'photoswitch'; sw.type = 'button';
    // Never ask the map: right after new Map() it has not built the layer yet,
    // and MapLibre logs "non-existing layer moa" on every open (10/4/26). It
    // starts visible. The label says what Matt chose; the layer takes it now,
    // or when the style is parsed (a tap before that used to throw, and the
    // switch's flag flipped with nothing to show for it: three taps for one change).
    var moaOn = true;
    function showSwitch() { sw.textContent = moaOn ? 'Photo: City 2024' : 'Photo: Esri'; }
    sw.onclick = function () {
      moaOn = !moaOn;
      showSwitch();
      whenStyled(map, 'photo', function () { map.setLayoutProperty('moa', 'visibility', moaOn ? 'visible' : 'none'); });
    };
    showSwitch();
    els.map.appendChild(sw);

    // editing: set by the zone editor, so a tap edits instead of showing the sheet.
    map._snow = { byId: {}, editing: false, zones: zones, pending: null, sheetEl: els.sheet };
    index(map, zones);
    // Any tap, not only one on a zone: a tap beside a thin strip or an arrow still reaches it (onTap).
    map.on('click', function (e) {
      if (map._snow.editing) return;
      onTap(map, e);
    });
    ['zones-fill', 'push-line'].forEach(function (layer) {
      map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
    });
    // Hand the map over once the zones are painted (not when the photo is:
    // that may never happen). A tap before this would find nothing to hit.
    await new Promise(function (res) {
      var done = false;
      function finish() { if (!done) { done = true; map.off('render', check); res(); } }
      function check() {
        var ok = false;
        try { ok = map.isSourceLoaded('zones'); } catch (e) { /* style not parsed yet */ }
        if (ok) map.once('render', finish);
      }
      map.on('render', check);
      map.triggerRepaint();
      setTimeout(finish, 8000); // never leave the screen half-open
    });
    return map;
  }

  return { open: open, setZones: setZones, TYPES: TYPES, typeColour: typeColour, centroid: centroid, arrowHead: arrowHead, drawable: drawable, photoUnavailable: photoUnavailable,
    pickOrder: pickOrder, pxDistance: pxDistance, featureCollection: featureCollection, legendHtml: legendHtml, sheetHtml: sheetHtml,
    loadLib: loadLib }; // the snow map (lib/snowmap.js, 10/6/26) loads MapLibre the same way
})();
if (typeof window !== 'undefined') window.SnowMap = SnowMap;
if (typeof module !== 'undefined') module.exports = SnowMap;
