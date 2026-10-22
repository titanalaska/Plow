// Plow Command's saved keys and shell cache, as plain text (no DOM): every place the phone code
// reads, writes or removes a localStorage key is found and checked.
//
// WHY: titanalaska.github.io carries every Titan app on ONE origin, so localStorage (and the Cache
// API) is shared with Shovel Command, Inventory and Groundwork. A key named the way another app
// names it would be read, overwritten or wiped by that app, and the other way round. Plow Command
// writes and removes exactly its four keys (below), never merely one that starts `titan-plow-` or
// `plow-` (the Task 3 ruling, tightened in Task 13 when the kept outlines went). The only keys it
// ever READS that are not its own are the two language fallbacks (`snow-lang`, then `wolf-lang`,
// once, when `plow-lang` is unset). Spec: docs/superpowers/specs/2026-10-21-plow-command-design.md.
//
// HOW IT CATCHES A FUTURE KEY: the scan is receiver-agnostic (`localStorage.setItem(`,
// `root.localStorage.setItem(`, `s.setItem(` all match) and a key it cannot read as a literal or a
// declared *KEY constant (`prefix + id`, a parameter, `localStorage[x]`, `localStorage.clear()`)
// FAILS the test naming file:line. A key can't slip past by being built at run time.
//
// The scanner is a plain function with its own tests below on made-up source, so each rule has
// been seen to fail (a scanner that matches nothing would pass the real-files test for free).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OWN = /^(titan-plow-|plow-)/;
// The four keys Plow Command owns: the only ones it writes or removes. It READS those and the two
// language fallbacks, once. (plow-outlines, the kept-outlines copy, went with the outlines in Task 13.)
const OWN_KEYS = ['titan-plow-token', 'titan-plow-editing', 'plow-short-night-until', 'plow-lang'];
const READ_ALLOW = OWN_KEYS.concat(['snow-lang', 'wolf-lang']);
// A *KEY constant that is not a storage key at all (an in-memory busy/failed map entry).
const NOT_STORAGE = { 'lib/shiftlogui.js': ['HANDOFF_KEY'] };
// es.js reads and writes through these two helpers; their CALLS are scanned like storage calls
// (the one raw call inside each helper takes the parameter `k`, which is not a key itself).
const WRAPPERS = { 'lib/es.js': { readKey: 'getItem', writeKey: 'setItem' } };

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

// scan(text, file) -> { problems: ['file:line: ...'], found: [{ op, name, line }] }
function scan(text, file) {
  const problems = [];
  const found = [];
  const consts = {}; // NAME -> 'literal' | ['a', 'b']
  const wrappers = WRAPPERS[file] || {};
  const skip = NOT_STORAGE[file] || [];

  for (const m of text.matchAll(/\b([A-Z_]*KEY)\s*=\s*(['"])([^'"]+)\2/g)) {
    const at = file + ':' + lineOf(text, m.index);
    if (skip.indexOf(m[1]) >= 0) continue;
    consts[m[1]] = m[3];
    if (!OWN.test(m[3])) problems.push(at + ': ' + m[1] + ' = ' + JSON.stringify(m[3]) + ' (a key must start titan-plow- or plow-)');
    else if (OWN_KEYS.indexOf(m[3]) < 0) problems.push(at + ': ' + m[1] + ' = ' + JSON.stringify(m[3]) + ' (not one of the four keys Plow Command owns)');
  }
  for (const m of text.matchAll(/\b([A-Z_]*KEYS)\s*=\s*\[([^\]]*)\]/g)) {
    const at = file + ':' + lineOf(text, m.index);
    const names = [...m[2].matchAll(/(['"])([^'"]+)\1/g)].map((x) => x[2]);
    consts[m[1]] = names;
    for (const n of names) if (READ_ALLOW.indexOf(n) < 0) problems.push(at + ': ' + m[1] + ' lists ' + JSON.stringify(n) + ', which Plow Command may not read');
  }

  // The names a call's first argument stands for, or null when it can't be read as a literal.
  function namesOf(arg) {
    let m = /^(['"])([^'"]+)\1$/.exec(arg);
    if (m) return [m[2]];
    m = /^([A-Z_]*KEYS?)(\s*\[[^\]]*\])?$/.exec(arg);
    if (m && typeof consts[m[1]] === 'string' && !m[2]) return [consts[m[1]]];
    if (m && Array.isArray(consts[m[1]]) && m[2]) return consts[m[1]];
    return null;
  }

  function check(op, arg, index) {
    const line = lineOf(text, index);
    const at = file + ':' + line;
    const names = namesOf(arg.trim());
    if (!names) { problems.push(at + ': ' + op + '(' + arg.trim() + ') is not a literal or a *KEY constant: a key built at run time can\'t be checked'); return; }
    for (const name of names) {
      found.push({ op: op, name: name, line: line });
      if (op === 'getItem') {
        if (READ_ALLOW.indexOf(name) < 0) problems.push(at + ': getItem(' + JSON.stringify(name) + ') reads a key Plow Command does not own');
      } else if (!OWN.test(name)) {
        problems.push(at + ': ' + op + '(' + JSON.stringify(name) + ') touches a key that does not start titan-plow- or plow-');
      } else if (OWN_KEYS.indexOf(name) < 0) {
        problems.push(at + ': ' + op + '(' + JSON.stringify(name) + ') touches a plow key that is not one of the four Plow Command owns');
      }
    }
  }

  for (const m of text.matchAll(/\b(getItem|setItem|removeItem)\s*\(\s*([^,)]*)/g)) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineText = text.slice(lineStart, text.indexOf('\n', m.index) < 0 ? text.length : text.indexOf('\n', m.index));
    // inside a wrapper's own definition: `function readKey(k) { ... localStorage.getItem(k) ... }`
    if (Object.keys(wrappers).some((w) => new RegExp('function\\s+' + w + '\\s*\\(').test(lineText))) continue;
    check(m[1], m[2], m.index);
  }
  for (const w of Object.keys(wrappers)) {
    for (const m of text.matchAll(new RegExp('(function\\s+)?\\b' + w + '\\s*\\(\\s*([^,)]*)', 'g'))) {
      if (m[1]) continue; // the definition itself
      check(wrappers[w], m[2], m.index);
    }
  }

  for (const m of text.matchAll(/\blocalStorage\s*\.\s*clear\s*\(/g)) problems.push(file + ':' + lineOf(text, m.index) + ': localStorage.clear() would wipe every other Titan app\'s keys');
  for (const m of text.matchAll(/\blocalStorage\s*\[/g)) problems.push(file + ':' + lineOf(text, m.index) + ': localStorage[...] reaches a key the scan can\'t read: use getItem/setItem/removeItem with a literal or a *KEY constant');
  return { problems: problems, found: found };
}

// --- the scanner, on made-up source: each rule seen to fail ---------------------------------

test('scanner: another app\'s key written, read or removed is named with its line', () => {
  const src = "var TOKEN_KEY = 'titan-snow-token';\nfunction a() { localStorage.setItem('snow-outlines', '1'); }\nfunction b() { return root.localStorage.getItem('titan-snow-token'); }\nfunction c() { localStorage.removeItem('wolf-lang'); }\n";
  const r = scan(src, 'lib/x.js');
  assert.deepEqual(r.problems, [
    'lib/x.js:1: TOKEN_KEY = "titan-snow-token" (a key must start titan-plow- or plow-)',
    'lib/x.js:2: setItem("snow-outlines") touches a key that does not start titan-plow- or plow-',
    'lib/x.js:3: getItem("titan-snow-token") reads a key Plow Command does not own',
    'lib/x.js:4: removeItem("wolf-lang") touches a key that does not start titan-plow- or plow-'
  ]);
});

test('scanner: a key built at run time, clear() and bracket access fail loudly', () => {
  const src = "function a(id) { localStorage.setItem('plow-' + id, '1'); }\nfunction b(k) { return localStorage.getItem(k); }\nfunction c() { localStorage.clear(); }\nfunction d(k) { localStorage[k] = 1; }\n";
  const r = scan(src, 'lib/y.js');
  assert.equal(r.problems.length, 4);
  assert.match(r.problems[0], /^lib\/y\.js:1: setItem\('plow-' \+ id\) is not a literal or a \*KEY constant/);
  assert.match(r.problems[1], /^lib\/y\.js:2: getItem\(k\) is not a literal or a \*KEY constant/);
  assert.match(r.problems[2], /^lib\/y\.js:3: localStorage\.clear\(\)/);
  assert.match(r.problems[3], /^lib\/y\.js:4: localStorage\[\.\.\.\]/);
});

test('scanner: plow keys pass, a KEY constant is followed to its literal, a fallback list is followed element by element', () => {
  const src = "var TOKEN_KEY = 'titan-plow-token';\nvar FALLBACK_KEYS = ['snow-lang', 'wolf-lang'];\nlocalStorage.setItem(TOKEN_KEY, t);\nlocalStorage.getItem(FALLBACK_KEYS[i]);\nlocalStorage.getItem('plow-lang');\n";
  const r = scan(src, 'lib/z.js');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.found.map((f) => f.op + ' ' + f.name), ['setItem titan-plow-token', 'getItem snow-lang', 'getItem wolf-lang', 'getItem plow-lang']);
});

test('scanner: a fallback list naming a key that is not a language fallback fails; the es.js helpers are scanned at their calls', () => {
  const bad = scan("var FALLBACK_KEYS = ['snow-lang', 'titan-snow-token'];\n", 'lib/x.js');
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0], /^lib\/x\.js:1: FALLBACK_KEYS lists "titan-snow-token"/);
  const es = "function readKey(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }\nfunction writeKey(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }\nvar KEY = 'plow-lang';\nreadKey(KEY);\nwriteKey('snow-lang', 'es');\nwriteKey(name, 'es');\n";
  const r = scan(es, 'lib/es.js');
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /^lib\/es\.js:5: setItem\("snow-lang"\) touches a key that does not start/);
  assert.match(r.problems[1], /^lib\/es\.js:6: setItem\(name\) is not a literal/);
});

// Task 3 ruling, applied in Task 13 once the kept outlines (plow-outlines) were gone: the prefix is not enough. Plow
// Command writes and removes exactly its four keys, so a fifth plow-looking key (a new feature's, or one an old build
// left behind) is named the moment it appears, written, removed or declared. Worked by hand on the source below:
//   line 1: OUTLINES_KEY = 'plow-outlines'       -> a constant naming a plow key that is not one of the four
//   line 2: setItem('plow-outlines')             -> written, not one of the four
//   line 3: removeItem('titan-plow-cache')       -> removed, not one of the four
//   line 4: getItem('plow-outlines')             -> read: not one of the four, and not a language fallback
//   line 5: setItem('titan-plow-token')          -> one of the four: no problem
test('scanner: a plow-prefixed key that is not one of the four is named, written, removed, read or declared', () => {
  const src = "var OUTLINES_KEY = 'plow-outlines';\nlocalStorage.setItem('plow-outlines', '{}');\nlocalStorage.removeItem('titan-plow-cache');\nlocalStorage.getItem('plow-outlines');\nlocalStorage.setItem('titan-plow-token', t);\n";
  const r = scan(src, 'lib/w.js');
  assert.deepEqual(r.problems, [
    'lib/w.js:1: OUTLINES_KEY = "plow-outlines" (not one of the four keys Plow Command owns)',
    'lib/w.js:2: setItem("plow-outlines") touches a plow key that is not one of the four Plow Command owns',
    'lib/w.js:3: removeItem("titan-plow-cache") touches a plow key that is not one of the four Plow Command owns',
    'lib/w.js:4: getItem("plow-outlines") reads a key Plow Command does not own',
  ]);
});

test('scanner: a *KEY constant that is not a storage key is skipped only where it is listed', () => {
  assert.deepEqual(scan("var HANDOFF_KEY = '*handoff';\n", 'lib/shiftlogui.js').problems, []);
  assert.equal(scan("var HANDOFF_KEY = '*handoff';\n", 'lib/other.js').problems.length, 1);
});

// --- the real files -------------------------------------------------------------------------

const FILES = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => /\.js$/.test(f)).map((f) => 'lib/' + f).concat(['sw.js', 'index.html']);
const scanned = FILES.map((f) => ({ file: f, result: scan(fs.readFileSync(path.join(ROOT, f), 'utf8'), f) }));

test('every key the phone code writes or removes is one of the four it owns; every key it reads is its own or a language fallback', () => {
  const problems = [].concat(...scanned.map((s) => s.result.problems));
  assert.deepEqual(problems, [], 'storage keys that break the rule:\n' + problems.join('\n'));
});

test('the scan finds the four plow keys where they are used (it is not matching nothing)', () => {
  // Worked out on paper: token read + written + removed in lib/api.js; the editing preference read,
  // written, removed in lib/app.js; the short-night cutover read, written, removed in lib/boardui.js;
  // plow-lang read and written through lib/es.js's helpers. So each of the four appears.
  const names = new Set([].concat(...scanned.map((s) => s.result.found.map((f) => f.name))));
  for (const k of OWN_KEYS) assert.ok(names.has(k), k + ' is used, so the scan must have found it');
  const written = new Set([].concat(...scanned.map((s) => s.result.found.filter((f) => f.op !== 'getItem').map((f) => f.name))));
  for (const k of OWN_KEYS) assert.ok(written.has(k), k + ' is written or removed, so the scan must have found that');
});

test('the language fallbacks are read in order snow-lang, wolf-lang (and never written)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/es.js'), 'utf8');
  const m = /\bFALLBACK_KEYS\s*=\s*\[([^\]]*)\]/.exec(src);
  assert.ok(m, 'lib/es.js declares FALLBACK_KEYS');
  assert.deepEqual([...m[1].matchAll(/(['"])([^'"]+)\1/g)].map((x) => x[2]), ['snow-lang', 'wolf-lang']);
});

test('sw.js: the shell cache is titan-plow-shell-<n>, and the activate step cleans only that prefix', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const v = /var CACHE_VERSION = '([^']+)'/.exec(sw);
  assert.ok(v, 'sw.js declares CACHE_VERSION');
  assert.match(v[1], /^titan-plow-shell-\d+$/);
  // every prefix the worker deletes by is the plow one: Shovel Command's titan-snow-shell-* are not ours to delete
  const prefixes = [...sw.matchAll(/indexOf\('([^']+)'\)\s*===\s*0/g)].map((m) => m[1]);
  assert.deepEqual(prefixes, ['titan-plow-shell-']);
});
