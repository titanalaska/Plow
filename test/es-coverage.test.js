// The Spanish dictionary against the code, both ways (Plow Command Task 18, 10/22/26).
//
//   1. Every English string the CREW screens render reads Spanish: it is a row (a key in ES), matches an ES_RULES pattern, is
//      a piece of a phrase the code builds (BUILT below, with a worked example the engine must translate), or is made
//      only of rows and punctuation (the engine's own matching leaves no English letter in it: "Site card:" is the row
//      "Site card" and a colon). A new sentence in lib/*.js without a row fails here, with its file, line and function,
//      before it ships in English to a phone set to Spanish.
//   2. Every row is still rendered. A key that no lib/*.js string or index.html text holds any more is a dead row
//      (a Shovel-era word the plow screens no longer say); it fails here instead of piling up. A one-word row has to be a
//      whole text node somewhere (a stray "own" inside "Logs own work" proves nothing); a row the code builds from two
//      literals ('Night: ' + word) is named in BUILT_ROWS.
//
// How strings are found (the heuristic docs/superpowers/specs/2026-10-09-spanish-design.md used for its ledger, made
// exact): a small tokenizer reads each lib/*.js (comments, regex literals and template pieces are not strings), joins
// 'a' + 'b' chains, and splits every string on its HTML tags into the text nodes it will render, plus the four
// attributes the engine translates (placeholder, aria-label, title, alt). A text node of two or more words is a
// candidate. Not candidates, because they are not rendered text: strings passed to console.* or new Error(...),
// selectors and CSS, and text inside a data-no-es element (a person's words: the engine never touches them).
//
// What is left out on purpose is named below, each with its reason (LEAVES_THE_APP, ENGLISH_FILES, ENGLISH_FUNCTIONS,
// CREW_FUNCTIONS_ONLY, LEFT_ENGLISH). Every entry but LEAVES_THE_APP must still hide a string that has no row: a stale or
// needless entry fails, so the lists cannot quietly grow into a hiding place, and when a left-English screen gets its
// rows its entry goes.
//
// Scope is the Shovel spec's (Decisions Matt made 10/9/26 and the final-review rulings): the screens a crew phone
// shows are translated; Matt's and the dispatcher's screens (the Board, the map editor, the Roster, the forms, Pull),
// the leads' live view and storm controls, the handoff card and the New snow dialog are English by decision. In Plow
// Command every truck's driver is that route's lead, so the lead screens are in drivers' hands too: promoting them is
// a matter of deleting entries here and adding rows (this test names what is missing). Two controller rulings of
// 10/21/26 carry a row inside those English dialogs (the Start storm sentence, the New snow label): they are rows, and
// the dead-row check keeps them honest.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Es = require('../lib/es.js');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');

// ---------------------------------------------------------------- the tokenizer
// Enough JavaScript for these files: // and /* */ comments, '...' and "..." strings, template literals (their ${}
// parts skipped), regex literals (told from division by the token before the slash), identifiers, numbers, punctuation.
// It also remembers, for each string, the named functions around it and whether it sits inside console.*(...) or
// new Error(...). It reports a bracket imbalance at the end of a file, which is how a wrong regex-or-division call
// would show itself.
function tokenize(src, label) {
  const toks = [];
  let i = 0, line = 1, parenDepth = 0, pending = null, lastIdent = '', lastPunct = '';
  const n = src.length;
  const braces = [];            // one entry per open {: the name of the function it is the body of, or null
  const calls = [];             // open ( that belong to console.x( or new Error(: their paren depth
  let callArm = null;           // set while reading `console . x` or `new Error`, until its ( arrives
  const regexOk = () => {
    const t = toks[toks.length - 1];
    if (!t) return true;
    if (t.type === 'str' || t.type === 'tpl' || t.type === 'num' || t.type === 're') return false;
    if (t.type === 'id') return /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(t.value);
    return !/^[)\]}]$/.test(t.value);
  };
  const fnNames = () => braces.filter(Boolean);
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      line += (src.slice(i, e + 2).match(/\n/g) || []).length; i = e + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const lit = src.slice(i, j + 1);
      let value;
      try { value = (new Function('return ' + lit))(); } catch (e) { throw new Error(label + ':' + line + ' the tokenizer lost its place at ' + lit.slice(0, 50)); }
      toks.push({ type: 'str', value, line, fns: fnNames(), quiet: calls.length > 0 });
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, depth = 0, raw = '';
      while (j < n && !(src[j] === '`' && depth === 0)) {
        if (src[j] === '\\') { raw += src[j] + src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (src[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (depth === 0) raw += src[j];
        j++;
      }
      toks.push({ type: 'tpl', value: raw, line, fns: fnNames(), quiet: calls.length > 0 });
      i = j + 1; continue;
    }
    if (c === '/' && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && (src[j] !== '/' || cls)) {
        if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        j++;
      }
      j++; while (/[a-z]/.test(src[j] || '')) j++;
      toks.push({ type: 're', value: src.slice(i, j), line }); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      const w = src.slice(i, j), prev = toks[toks.length - 1], prev2 = toks[toks.length - 2];
      if (w === 'function') {
        const m = /^\s*([A-Za-z_$][\w$]*)/.exec(src.slice(j, j + 80));
        pending = { name: m ? m[1] : (lastIdent && (lastPunct === ':' || lastPunct === '=') ? lastIdent : '(anon)'), depth: undefined, closed: false };
      }
      if (w === 'Error' && prev && prev.type === 'id' && prev.value === 'new') callArm = true;
      if (prev && prev.type === 'p' && prev.value === '.' && prev2 && prev2.type === 'id' && prev2.value === 'console') callArm = true;
      toks.push({ type: 'id', value: w, line }); lastIdent = w; i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ type: 'num', value: src.slice(i, j), line }); i = j; continue; }
    if (c === '(') {
      if (pending && pending.depth === undefined) pending.depth = parenDepth;
      if (callArm) { calls.push(parenDepth); callArm = null; }
      parenDepth++;
    } else if (c === ')') {
      parenDepth--;
      if (pending && pending.depth === parenDepth) pending.closed = true;
      if (calls.length && calls[calls.length - 1] === parenDepth) calls.pop();
    } else if (c === '{') {
      if (pending && pending.closed) { braces.push(pending.name); pending = null; } else braces.push(null);
    } else if (c === '}') braces.pop();
    if (c !== '.' && c !== '(') callArm = null; // `console.x` / `new Error` must be followed by its ( with nothing between
    lastPunct = c;
    toks.push({ type: 'p', value: c, line }); i++;
  }
  if (parenDepth !== 0 || braces.length !== 0) throw new Error(label + ': brackets do not balance after tokenizing (paren ' + parenDepth + ', brace ' + braces.length + '): a regex literal was read as division, or the other way round');
  return toks;
}

// The strings of a file, 'a' + 'b' joined into one, each with its line, the named functions around it, and
// quiet = inside console.*( or new Error(.
function stringsOf(src, label) {
  const toks = tokenize(src, label), out = [];
  const isStr = (t) => t && (t.type === 'str' || t.type === 'tpl');
  const plus = (t) => t && t.type === 'p' && t.value === '+';
  for (let i = 0; i < toks.length; i++) {
    if (!isStr(toks[i])) continue;
    if (plus(toks[i - 1]) && isStr(toks[i - 2])) continue; // the middle of a chain already taken
    let v = toks[i].value, j = i;
    while (plus(toks[j + 1]) && isStr(toks[j + 2])) { v += toks[j + 2].value; j += 2; }
    out.push({ value: v, line: toks[i].line, fns: toks[i].fns, quiet: toks[i].quiet });
  }
  return out;
}

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
const squash = (s) => decode(s).replace(/\s+/g, ' ').trim();

// The text a string will put on the screen, piece by piece: the text between its tags, and the four translated
// attributes. A piece that opens or closes mid-tag (the string is one slice of a longer concatenation) is trimmed
// to its text. Text right after a tag that carries data-no-es, up to the next tag, is a person's and is dropped.
function textPieces(v) {
  const out = [];
  const attrRe = /\b(?:placeholder|aria-label|title|alt)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(v))) out.push(m[1]);
  // The end of a tag a variable cut off leads the string: `">`, ` disabled>`, `class="x">`, or the bare `>` itself.
  const LEAD = /^(?:(?:"|\s|[\w-]+=)[^<>]*)?>/;
  if (!/<[A-Za-z\/!]/.test(v) && !LEAD.test(v)) {
    // no tag in it: plain text, or the tail of an attribute value that a variable cut off (' minutes" placeholder="min"')
    const tail = /^([^"<>]*)"\s*(?:[\w-]+=|\/?>|$)/.exec(v);
    return out.concat([tail ? tail[1] : v]).map(squash).filter(Boolean);
  }
  // mark every tag, remembering which ones carry data-no-es
  let t = v.replace(LEAD, (s) =>'\u0001' + (/data-no-es/.test(s) ? 'N' : 'Y'));
  t = t.replace(/<[^>]*>?/g, (s) => '\u0001' + (/data-no-es/.test(s) ? 'N' : 'Y'));
  const parts = t.split('\u0001');
  parts.forEach((p, k) => {
    if (k === 0) { if (p) out.push(p); return; }
    const flag = p[0]; p = p.slice(1);
    if (flag === 'N') return;
    if (p) out.push(p);
  });
  return out.map(squash).filter(Boolean);
}

const wordsIn = (p) => p.split(' ').filter((w) => /[A-Za-z]/.test(w));
// Prose, not code: no brackets, equals, angle marks, backslashes, pipes, underscores; no CSS "prop:value".
const isProse = (p) => !/[{}\[\]<>=\\|_$@]/.test(p) && !/\b[a-z-]{3,}:[a-z0-9#(]/.test(p) && !/^[;:.#]/.test(p) && p !== 'use strict';

// ---------------------------------------------------------------- what is read
function libFiles() { return fs.readdirSync(LIB).filter((f) => f.endsWith('.js') && f !== 'es.js').sort(); }
const SOURCES = {};
libFiles().forEach((f) => { SOURCES['lib/' + f] = stringsOf(fs.readFileSync(path.join(LIB, f), 'utf8'), 'lib/' + f); });

// index.html: the markup's own text and its translated attributes (its scripts are external files).
function indexPieces() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<title>[\s\S]*?<\/title>/, '');
  return textPieces(html);
}

// Every candidate: { file, line, fns, text } for the pieces of two or more words that read as prose.
function candidates() {
  const out = [];
  Object.keys(SOURCES).forEach((file) => {
    SOURCES[file].forEach((s) => {
      if (s.quiet) return;
      textPieces(s.value).forEach((p) => { if (wordsIn(p).length >= 2 && isProse(p)) out.push({ file, line: s.line, fns: s.fns.filter((x) => x !== '(anon)'), text: p }); });
    });
  });
  indexPieces().forEach((p) => { if (wordsIn(p).length >= 2 && isProse(p)) out.push({ file: 'index.html', line: 0, fns: [], text: p }); });
  return out;
}

// The one-word text nodes (Save, Cancel, Undo, Plowed...): a capitalised piece of a single word. Two-word candidates are the
// sentences; these are the buttons, labels and states, which the crew read just as much and which a missing row leaves English.
function oneWordNodes() {
  const out = [], take = (file, line, fns, p) => {
    if (wordsIn(p).length === 1 && /^[^A-Za-z]*[A-Z]/.test(p) && isProse(p)) out.push({ file, line, fns: fns.filter((x) => x !== '(anon)'), text: p });
  };
  Object.keys(SOURCES).forEach((file) => SOURCES[file].forEach((s) => { if (!s.quiet) textPieces(s.value).forEach((p) => take(file, s.line, s.fns, p)); }));
  indexPieces().forEach((p) => take('index.html', 0, [], p));
  return out;
}

// ---------------------------------------------------------------- what is left out, and why
// Whole files whose text LEAVES the app (BuilderTrend, the office's PDFs and CSV, a text message): English always, by the
// Shovel spec, so these are not held to "hides something".
const LEAVES_THE_APP = {
  'lib/routesheet.js': 'the route sheets (a PDF for the office)',
  'lib/csv.js': 'the storm CSV (a file for the office)',
  'lib/btnote.js': 'the Copy for BT text: English always',
  'lib/share.js': 'the share text goes out in a text message; its toast and dialog live in lib/app.js and have rows',
};
// Whole files that only Matt, the dispatcher or a lead ever see, or that the Shovel final ruling left English. Each must still
// hide a string with no row (the last test), so when a screen gets its rows the entry goes.
const ENGLISH_FILES = {
  'lib/warnings.js': 'the Board\'s warnings (dispatcher)',
  'lib/handoff.js': 'the handoff sheets\' lines (the PDF words; the Shovel final ruling keeps the handoff English or mixed)',
  'lib/mapedit.js': 'Matt\'s map editor (Tasks 13-14 gave it the few rows it has; the rest is English by the Shovel spec)',
  'lib/forms.js': 'the Sites and Routes forms\' parsers (Matt\'s)',
  'lib/bpimport.js': 'the Bootprint import (Matt\'s editor)',
  'lib/snowmap.js': 'the Anchorage snow map (the live view\'s, dispatcher and leads)',
};
// Functions, by file, that only Matt, the dispatcher or a Board lead reach, or that the Shovel final ruling left English.
// A string is out when ANY function around it is named here.
const ENGLISH_FUNCTIONS = {
  'lib/app.js': {
    openWorker: 'Matt\'s worker card', editWorker: 'Matt\'s worker form', editSite: 'Matt\'s site form', editRoute: 'Matt\'s route form',
    renderRoster: 'the Roster tab (Matt and the dispatcher)', draw: 'a route form\'s list (Matt\'s)',
  },
  'lib/rosterui.js': {
    waitingHtml: 'the Roster tab\'s waiting lists (Matt and the dispatcher)', decide: 'Approve/Reject (Matt)', addToCrew: 'Add to crew (the dispatcher)',
  },
  'lib/shiftlogui.js': {
    controlsHtml: 'the storm controls: a lead\'s and the dispatcher\'s (Start storm is deliberately not a row: es.test.js)',
    confirmStorm: 'the Start / Close storm confirm (controls)',
    handOffHtml: 'the Hand off now button (a lead\'s control, English by ruling; its string begins with a bare > and was invisible to the scan until 10/22)',
    confirmHandoff: 'the Hand off dialog (a lead\'s)',
    handoffCardHtml: 'the handoff card: English or mixed by the Shovel final ruling', dayRouteHtml: 'the handoff card',
    handoffStatus: 'sheet status (dispatcher)', sheetsStatus: 'sheet status (dispatcher)', retrySheets: 'Retry sheets (dispatcher)',
    openPrint: 'Print sheets (dispatcher)', downloadCsv: 'Download CSV (dispatcher; its button has a row)',
    livesumHtml: 'the live view (a lead\'s and the dispatcher\'s)', snowMapHtml: 'the live view\'s snow map',
    onBoard: 'the live view', saveTruck: 'Set truck (a lead\'s)',
    confirmDepth: 'the New snow dialog: English or mixed by the Shovel final ruling (its label has a row, ruled 10/21)',
    openBt: 'Copy for BT (a lead\'s; the text is English always)',
  },
};
// Files where only the named functions are a crew screen; every other string in the file is Matt's or the dispatcher's.
const CREW_FUNCTIONS_ONLY = {
  'lib/boardui.js': { renderTonight: 'Tonight is the crew\'s; everything else in this file is the Board, Post and Callout (Matt and the dispatcher)' },
};
// Single strings inside a crew function that only the dispatcher or a lead sees, or that are a name, a unit or a CSS class.
const LEFT_ENGLISH = {
  'Plow Command': 'the app\'s name: a name is never translated (es.test.js)',
  'Good lead': 'Matt\'s private trait on the worker card',
  'Logs own work': 'Matt\'s private trait on the worker card',
  '‹ Live view': 'a lead\'s and the dispatcher\'s live view',
  'No routes yet. Add them on the Routes tab.': 'the live view and the Board (a lead\'s and the dispatcher\'s); the Routes tab\'s own line has a row',
  'no forecast': 'the snow map\'s legend (live view)',
  'Edit map': 'Matt\'s button on a site map',
  'Add route': 'Matt\'s Routes button', 'Add site': 'Matt\'s Sites button', 'Add worker': 'Matt\'s Roster button',
  'New snow': 'a lead\'s button on the site card (the New snow dialog is English by the Shovel final ruling)',
  'Copy for BT': 'a lead\'s button (Copy for BT is English always)',
  'snowdot nofc': 'two CSS class names',
  'Esri, Maxar, Earthstar Geographics': 'the photo credit: proper nouns',
  'Municipality of Anchorage': 'the photo credit: a proper noun',
  'Esri, HERE, Garmin': 'the photo credit: proper nouns',
  'sq ft': 'a unit on a zone card whose numbers are the zone\'s own',
  // lib/shiftlog.js checkTap: the refusals for a tap that is not the lot or not plowed/problem. The phone only ever sends
  // zone_id lot with a state from its two buttons and checks before it sends, so no crew phone shows these two. (The three
  // undoTarget refusals in the same file ARE shown, as the server's reason after "Not saved:", and have rows.)
  'Only the lot can be tapped': 'checkTap: the phone never sends a zone other than the lot',
  'State must be plowed or problem': 'checkTap: the phone never sends a state other than its two buttons\'',
};
// One-word nodes in a crew function that are not translated, each with its reason: initialisms and names the crew read the
// same in Spanish, and strings that are never on a screen. (Matt's one-word buttons sit in the English functions above.)
const ONE_WORD_ENGLISH = {
  // initialisms and names that read the same in Spanish
  PIN: 'the sign-in label: PIN is the word in Spanish too',
  EN: 'the language buttons (index.html): the codes name the languages',
  ES: 'the language buttons (index.html)',
  AM: 'the clock\'s own suffix, kept in the Spanish lines ("Nieve hasta las 10 AM")',
  PM: 'the clock\'s own suffix',
  Anchorage: 'the Home area option on one\'s own card: a place name; Valley has a row (El Valle) because it is also a word',
  Bobcat: 'a machine\'s name on the site card\'s Equipment list (Blower, the one common noun, has a row)',
  Snowrator: 'a machine\'s name on the site card',
  Sweepster: 'a machine\'s name on the site card',
  // never on a screen
  POST: 'the HTTP method (lib/api.js)',
  'Content-Type': 'an HTTP header name (lib/api.js)',
  Enter: 'a keyboard key name compared in a keydown handler',
  T: 'the ISO date format\'s separator (lib/time.js localIso)',
  Feature: 'GeoJSON type names the map is fed (lib/mapview.js)',
  FeatureCollection: 'GeoJSON type name',
  Polygon: 'GeoJSON type name',
  LineString: 'GeoJSON type name',
  // Matt's and the dispatcher's one-word buttons and labels, in functions the crew also use
  Board: 'the Board tab: Matt\'s and the dispatcher\'s (tabs are drawn by one function for everyone)',
  Roster: 'the Roster tab: Matt\'s and the dispatcher\'s',
  Edit: 'Matt\'s Edit button on a route card',
  'Archived (': 'the heading of Matt\'s Archived list',
  Archived: 'Matt\'s toast after Archive',
  Restore: 'Matt\'s Restore button',
  Restored: 'Matt\'s toast after Restore',
  Smokes: 'Matt\'s private trait on the worker card; the crew never see it',
  Unplaced: 'where Matt\'s Roster says a worker is tonight',
  // a lead's control
  Truck: 'the label of a lead\'s Set truck box (English by ruling). A bare "Truck" row would also turn the lead\'s toast "Truck saved" into "Camión saved"; the read-only line "Truck:" has its row',
  'Callouts (': 'the heading of the Callouts box (a lead\'s and the dispatcher\'s)',
};
// A phrase that is BUILT at run time out of pieces that carry no row of their own, each with an example of the
// finished line; the test runs the example through the engine and wants it fully Spanish (the pieces below it are
// what the code holds). Worked by hand in es.test.js too: the example here must read exactly as given.
const BUILT = {
  'tries left.': ['Wrong PIN. 3 tries left.', 'PIN incorrecto. Quedan 3 intentos.'],
  'Storm open ·': ['Storm open · Snowing', 'Tormenta abierta · Nevando'],
  'Share Plow Command': ['Share Plow Command', 'Compartir Plow Command'],
  'Night of': ['Night of 10/3, posted 12:12 AM', 'Noche del 10/3, publicado 12:12 AM'],
  'Day of': ['Day of 10/3, posted 9:05 AM', 'Día del 10/3, publicado 9:05 AM'],
  'Snow for the next': ['Snow for the next 3 h+', 'Nieve durante las próximas 3 h o más'],
  'Snow until': ['Snow until 10 AM', 'Nieve hasta las 10 AM'],
  'Snow from': ['Snow from 2 AM', 'Nieve desde las 2 AM'],
  'No snow in the next': ['No snow in the next 12 h', 'Sin nieve en las próximas 12 h'],
  'Pulled:': ['Pulled: 5 added, 7 updated', 'Traído: 5 agregado(s), 7 actualizado(s)'],
};

// Rows whose English is never one literal: the code joins two ('Night: ' + s.night, lib/handoff.js siteParts, where
// night is the literal 'plowed' or 'problem'). The dead-row check wants both halves still in that file.
const BUILT_ROWS = {
  'Night: plowed': { file: 'lib/handoff.js', head: 'Night:', tail: 'plowed' },
  'Night: problem': { file: 'lib/handoff.js', head: 'Night:', tail: 'problem' },
};

// ---------------------------------------------------------------- the checks
function isOut(c) {
  if (LEAVES_THE_APP[c.file] || ENGLISH_FILES[c.file]) return true;
  const only = CREW_FUNCTIONS_ONLY[c.file];
  if (only && !c.fns.some((f) => only[f])) return true;
  const fx = ENGLISH_FUNCTIONS[c.file] || {};
  if (c.fns.some((f) => fx[f])) return true;
  return !!LEFT_ENGLISH[c.text];
}
// The engine's own matching: every row, longest first, whole words. A piece whose letters all sit inside matched rows
// reads fully Spanish ("Site card:" is the row "Site card" and a colon; "Storm open ·" is "Storm open" and a dot).
const ROW_RE = new RegExp(Object.keys(Es.ES).sort((a, b) => b.length - a.length).map((k) =>
  (/^[A-Za-z0-9]/.test(k) ? '\\b' : '') + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/[A-Za-z0-9]$/.test(k) ? '\\b' : '')).join('|'), 'g');
function fullyKeyed(text) { return !/[A-Za-z]/.test(text.replace(ROW_RE, ' ')); }
function covered(text) {
  if (Object.prototype.hasOwnProperty.call(Es.ES, text)) return true;
  if (Es.ES_RULES.some((r) => r[0].test(text))) return true;
  if (fullyKeyed(text)) return true;
  const b = BUILT[text];
  return !!b && Es.translateString(b[0]) === b[1];
}
const where = (c) => c.file + ':' + c.line + (c.fns.length ? ' [' + c.fns[c.fns.length - 1] + ']' : '') + ' ' + JSON.stringify(c.text);

test('every English string a crew screen renders has a row or a rule', () => {
  const missing = [], seen = new Set();
  candidates().filter((c) => !isOut(c)).forEach((c) => {
    if (covered(c.text)) return;
    const k = c.file + '|' + c.text;
    if (seen.has(k)) return;
    seen.add(k); missing.push(c);
  });
  assert.deepEqual(missing.map(where), [], missing.length + ' English string(s) rendered by lib/*.js (or index.html) have no row in ES and match no ES_RULES pattern.\n'
    + 'Add a row to lib/es.js, or, if only the dispatcher sees the string, name it in ENGLISH_FUNCTIONS / LEFT_ENGLISH with the reason.\n  '
    + missing.map(where).join('\n  '));
});

const trimEnds = (x) => x.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
// The rows no code renders any more. A row is live when its English is whole inside some rendered text piece (word-bounded,
// as the engine matches it), in any lib/*.js (the English-by-decision files too) or in index.html. es.js itself holds every
// key, so it is not read. A one-word row has to be a whole text node by itself.
function deadRows() {
  const pieces = [];
  Object.keys(SOURCES).forEach((file) => SOURCES[file].forEach((s) => { if (!s.quiet) textPieces(s.value).forEach((p) => pieces.push(p)); }));
  indexPieces().forEach((p) => pieces.push(p));
  const heard = pieces.join('\n');
  const trim = trimEnds;
  return Object.keys(Es.ES).filter((k) => {
    if (BUILT_ROWS[k]) {
      // built from two literals of one file ('Night: ' + word): both must still be whole text pieces there
      const b = BUILT_ROWS[k], file = SOURCES[b.file] || [];
      const has = (w) => file.some((s) => !s.quiet && textPieces(s.value).some((q) => trim(q) === trim(w)));
      return !(has(b.head) && has(b.tail));
    }
    if (wordsIn(k).length >= 2) {
      const re = new RegExp((/^[A-Za-z0-9]/.test(k) ? '\\b' : '') + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/[A-Za-z0-9]$/.test(k) ? '\\b' : ''));
      return !re.test(heard);
    }
    // one word: it has to be a whole text node by itself (a stray "own" inside "Logs own work" proves nothing)
    return !pieces.some((q) => trim(q) === trim(k));
  });
}

test('every row is still rendered: no dead row', () => {
  const dead = deadRows();
  assert.deepEqual(dead, [],dead.length + ' row(s) in lib/es.js translate English that no lib/*.js string or index.html text renders any more. Delete them (and list them in test/es.test.js "retired").\n  '
    + dead.map((k) => JSON.stringify(k)).join('\n  '));
});

const oneWordWhere = (c) => c.file + ':' + c.line + (c.fns.length ? ' [' + c.fns[c.fns.length - 1] + ']' : '') + ' ' + JSON.stringify(c.text);

test('every capitalised one-word text node a crew screen renders is a row, a rule or named; every one-word row is rendered', () => {
  // Forward: a button or label with no row (a deleted "Save", a new "Archive") stays English on an ES phone, and the two-word
  // scan above cannot see it. Every such node in a crew function is covered like a sentence is, or sits in ONE_WORD_ENGLISH.
  const missing = [], seen = new Set();
  oneWordNodes().filter((c) => !isOut(c)).forEach((c) => {
    if (covered(c.text) || ONE_WORD_ENGLISH[c.text]) return;
    const k = c.file + '|' + c.text;
    if (seen.has(k)) return;
    seen.add(k); missing.push(c);
  });
  assert.deepEqual(missing.map(oneWordWhere), [], missing.length + ' one-word text node(s) a crew screen renders have no row and no rule.\n'
    + 'Add a row to lib/es.js, or name the word in ONE_WORD_ENGLISH (or its function in ENGLISH_FUNCTIONS) with the reason.\n  ' + missing.map(oneWordWhere).join('\n  '));
  // Reverse: a one-word row must be one of those nodes, whole, somewhere in the code (not a word inside a longer sentence).
  const deadOne = deadRows().filter((k) => wordsIn(k).length < 2);
  assert.deepEqual(deadOne, [], deadOne.length + ' one-word row(s) are no whole text node in any lib/*.js or index.html:\n  ' + deadOne.map((k) => JSON.stringify(k)).join('\n  '));
  // And every ONE_WORD_ENGLISH entry still names a node with no row (a stale entry is a hole).
  const stale = Object.keys(ONE_WORD_ENGLISH).filter((t) => !oneWordNodes().some((c) => c.text === t && !isOut(c) && !covered(c.text)));
  assert.deepEqual(stale, [], 'ONE_WORD_ENGLISH names words that are not (or no longer) an untranslated crew node: ' + stale.join(', '));
});

test('every left-out entry still hides a string with no row (a stale or needless entry fails)', () => {
  // An entry that hides nothing is a hole waiting for the next crew string to fall into it. Each one must be hiding at least
  // one candidate that has no row today; when its screen gets rows, the entry goes (this test says so).
  const all = candidates(), open = all.filter((c) => !covered(c.text)), problems = [];
  const need = (ok, msg) => { if (!ok) problems.push(msg); };
  Object.keys(LEAVES_THE_APP).forEach((f) => need(fs.existsSync(path.join(ROOT, f)), 'LEAVES_THE_APP names a file that is gone: ' + f));
  Object.keys(ENGLISH_FILES).forEach((f) => {
    need(fs.existsSync(path.join(ROOT, f)), 'ENGLISH_FILES names a file that is gone: ' + f);
    need(open.some((c) => c.file === f), 'ENGLISH_FILES hides nothing in ' + f + ': delete the entry');
  });
  Object.keys(ENGLISH_FUNCTIONS).forEach((f) => {
    need(SOURCES[f], 'ENGLISH_FUNCTIONS names a file that is gone: ' + f);
    Object.keys(ENGLISH_FUNCTIONS[f]).forEach((fn) => {
      need(SOURCES[f].some((s) => s.fns.indexOf(fn) !== -1), 'ENGLISH_FUNCTIONS names a function with no strings in ' + f + ': ' + fn);
      need(open.some((c) => c.file === f && c.fns.indexOf(fn) !== -1), 'ENGLISH_FUNCTIONS hides nothing in ' + f + ' ' + fn + ': delete the entry');
    });
  });
  Object.keys(CREW_FUNCTIONS_ONLY).forEach((f) => {
    Object.keys(CREW_FUNCTIONS_ONLY[f]).forEach((fn) => {
      need(SOURCES[f] && SOURCES[f].some((x) => x.fns.indexOf(fn) !== -1), 'CREW_FUNCTIONS_ONLY names a function with no strings in ' + f + ': ' + fn);
    });
    need(open.some((c) => c.file === f && !c.fns.some((x) => CREW_FUNCTIONS_ONLY[f][x])), 'CREW_FUNCTIONS_ONLY hides nothing in ' + f + ': delete the entry');
  });
  Object.keys(LEFT_ENGLISH).forEach((t) => {
    need(open.some((c) => c.text === t), 'LEFT_ENGLISH hides nothing, or names a string no source holds: ' + t);
  });
  assert.deepEqual(problems, [], problems.length + ' left-out entr' + (problems.length === 1 ? 'y' : 'ies') + ' hide nothing:\n  ' + problems.join('\n  '));
  Object.keys(BUILT).forEach((t) => {
    assert.ok(all.some((c) => c.text === t) || oneWordNodes().some((c) => c.text === t), 'BUILT names a piece no source holds: ' + t);
    assert.equal(Es.translateString(BUILT[t][0]), BUILT[t][1], 'BUILT example for ' + t);
    assert.notEqual(BUILT[t][1], BUILT[t][0]);
  });
});

// The tokenizer and the splitter, on made-up source: they are the instrument, so they get their own proof.
test('the extractor: joins chains, splits tags, keeps attributes, skips code and a person\'s words', () => {
  const src = [
    "var a = 'Hello there ' + 'friend';",
    "// 'not in a comment here'",
    "/* 'nor here' */",
    "var re = /it's \"quoted\" here/g, d = 10 / 2;",
    "console.log('console words are not shown');",
    "throw new Error('error words are not shown');",
    "x.innerHTML = '<p class=\"muted\">Plowed today</p><input placeholder=\"Your name here\"><span data-no-es>Jordan Test</span> and more';",
    "function outer() { return function inner() { return 'Inside two functions'; }; }",
    // a tag cut by a variable: the string after the variable BEGINS with the closing '>' (lib/shiftlogui.js handOffHtml)
    "y.innerHTML = '<button id=\"h\"' + (busy ? ' disabled aria-busy=\"true\"' : '') + '>Hand off now</button></div>';",
    "z.innerHTML = '<button id=\"k\" class=\"x' + '\" disabled' + '>Keep going</button>';",
  ].join('\n');
  const s = stringsOf(src, 'fixture');
  const texts = s.filter((x) => !x.quiet).map((x) => x.value);
  assert.ok(texts.indexOf('Hello there friend') !== -1, 'a + b is one string');
  assert.equal(texts.some((t) => /comment|nor here/.test(t)), false, 'comments are not strings');
  assert.equal(texts.some((t) => /quoted/.test(t)), false, 'a regex literal is not a string');
  assert.equal(s.filter((x) => x.quiet).length, 2, 'console.* and new Error( arguments are quiet');
  const html = s.filter((x) => /Plowed today/.test(x.value))[0].value;
  assert.deepEqual(textPieces(html), ['Your name here', 'Plowed today', 'and more'], 'text between tags, the placeholder, and nothing from data-no-es');
  const inner = s.filter((x) => x.value === 'Inside two functions')[0];
  assert.deepEqual(inner.fns, ['outer', 'inner'], 'named functions around a string');
  // a slice of a longer concatenation that opens and closes mid-tag
  assert.deepEqual(textPieces('">Save the day</b> now'), ['Save the day', 'now']);
  // ...and one that begins with the bare '>' that closes a tag a variable cut (it was read as the text ">Hand off now" and lost)
  const bare = s.filter((x) => /^>Hand off now/.test(x.value))[0];
  assert.ok(bare, 'the fixture string that begins with > is there');
  assert.deepEqual(textPieces(bare.value), ['Hand off now'], 'a leading > closes a tag; the text after it is the text');
  assert.deepEqual(textPieces(s.filter((x) => /Keep going/.test(x.value))[0].value), ['Keep going'], 'a chain that spans a whole tag is one string, and its text is the text');
  assert.deepEqual(textPieces('5 > 3 and more'), ['5 > 3 and more'], 'a > inside running text is left alone');
  assert.throws(() => tokenize("var x = (1;", 'broken'), /balance/);
});

test('the extractor reads every lib file and finds the words the crew read', () => {
  assert.ok(Object.keys(SOURCES).length >= 20, 'lib/*.js are read');
  const all = candidates().map((c) => c.text);
  for (const sample of ['Pick your name, then your PIN. If you use Titan Inventory, it\'s the same PIN.', 'No sites on this route.', 'Aerial photo unavailable. The zones below are still right.']) {
    assert.ok(all.indexOf(sample) !== -1, 'the extractor found: ' + sample);
  }
});

// The judge has to be able to say no. Worked by hand against the rows: "Site card:" is the row "Site card" and a colon, so it
// reads fully Spanish; "Save the day now" holds the row "Save" and the English words "the day now", so it does not.
test('covered(): a whole row, a rule, a string made only of rows and punctuation pass; a half-covered or unknown one fails', () => {
  assert.equal(covered('Link copied. Paste it in a text.'), true);   // a row
  assert.equal(covered('Snow until 10 AM'), true);                   // a rule
  assert.equal(covered('Site card:'), true);                         // "Site card" + a colon
  assert.equal(covered('Storm open ·'), true);                       // "Storm open" + a dot
  assert.equal(covered('Save the day now'), false);                  // "Save" is a row; the rest is English
  assert.equal(covered('Some invented sentence here'), false);
  assert.equal(covered('tries left.'), true);                        // a piece of a built phrase: BUILT names it and its example reads Spanish
  assert.equal(covered('minutes left.'), false);                     // the same shape, named nowhere
  assert.equal(covered('Share Plow Command'), true);                 // BUILT: its example reads Compartir Plow Command
  assert.equal(isOut({ file: 'lib/boardui.js', fns: ['renderBoard'], text: 'Place here' }), true);   // the Board is Matt's
  assert.equal(isOut({ file: 'lib/boardui.js', fns: ['renderTonight'], text: 'Place here' }), false); // Tonight is the crew's
  assert.equal(isOut({ file: 'lib/app.js', fns: ['editWorker'], text: 'Where they live' }), true);
  assert.equal(isOut({ file: 'lib/app.js', fns: ['shareApp'], text: 'Copy this and text it:' }), false);
});
