const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

// The "not saved" guard in lib/api.js (10/10/26). Twice that day the live app was handed the GET health reply,
// { ok: true, version }, for a POST: a Google redirect hiccup. The phone counts any ok:true as success, so a save
// looked saved and was never written. Every POST reply from outlines-1 on carries `action`, the action it
// answers; the health check (GET) never does. So a reply from the version this phone expects, whose `action` is
// not the one it asked for, is not an answer to the ask: it is "no signal", and the person is told it was not
// saved. A reply from any OTHER version (an older server mid-deploy) is not checked: it never sent `action`, and
// the version banner covers that window.
//
// lib/api.js is a browser script (SnowApi on `this`), so it is run in a vm context holding just what it reads.
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'api.js'), 'utf8');
const NO_SIGNAL = "Couldn't reach the server. Not saved, try again.";
const EXPECTED = 'outlines-1';

// `reply` is what the server body parses to; the fetch double hands it back as JSON.
function api(reply) {
  const calls = [], removed = [];
  const sandbox = {
    SNOW_CONFIG: { SNOW_URL: 'https://snow.example/exec', INV_URL: 'https://inv.example/exec', EXPECTED_BACKEND: EXPECTED },
    localStorage: { getItem: () => 'tok', setItem: () => {}, removeItem: (k) => removed.push(k) },
    fetch: async (u, init) => { calls.push({ u, init }); return { json: async () => (typeof reply === 'function' ? reply(JSON.parse(init.body)) : reply) }; },
    AbortController, setTimeout, clearTimeout, URLSearchParams, JSON, Object, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { SnowApi: sandbox.SnowApi, calls, removed };
}
const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the vm realm, for deepEqual

test('a reply for the action that was asked is the answer, whatever else it carries', async () => {
  const { SnowApi } = api({ ok: true, version: EXPECTED, action: 'saveZone', record: { id: 'Z1' } });
  const r = await SnowApi.call('saveZone', { record: {} });
  assert.equal(r.ok, true);
  assert.equal(r.record.id, 'Z1');
  assert.equal(r.versionMismatch, false);
});

test('the health check reply { ok: true, version } for a POST is no signal, not a save', async () => {
  const { SnowApi } = api({ ok: true, version: EXPECTED });
  const r = await SnowApi.call('saveZone', { record: {} });
  assert.deepEqual(plain(r), { ok: false, code: 'network', reason: NO_SIGNAL });
});

test('a reply that answers a DIFFERENT action is no signal either', async () => {
  const { SnowApi } = api({ ok: true, version: EXPECTED, action: 'bootstrap', me: {} });
  const r = await SnowApi.call('restoreSite', { id: 'S1', rev: 2 });
  assert.deepEqual(plain(r), { ok: false, code: 'network', reason: NO_SIGNAL });
});

test('a refusal from this version is checked too: an ok:false reply with no action is not an answer', async () => {
  const { SnowApi } = api({ ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.', version: EXPECTED });
  const r = await SnowApi.call('archiveSite', { id: 'S1', rev: 1 });
  assert.equal(r.code, 'network');
  assert.equal(r.reason, NO_SIGNAL);
});

test('a sign-in refusal that names its action still signs out; one without is not trusted to', async () => {
  const named = api({ ok: false, code: 'signin', reason: 'Session expired. Sign in again.', version: EXPECTED, action: 'bootstrap' });
  assert.equal((await named.SnowApi.call('bootstrap', { slim: true })).code, 'signin');
  assert.deepEqual(named.removed, ['titan-plow-token']);
  // Without `action` it is the redirect hiccup, not the server saying the session ended: the token stays.
  const bare = api({ ok: false, code: 'signin', reason: 'Session expired. Sign in again.', version: EXPECTED });
  assert.equal((await bare.SnowApi.call('bootstrap', { slim: true })).code, 'network');
  assert.deepEqual(bare.removed, []);
});

test('an older server (another version) is not checked: no action, and the reply stands', async () => {
  const { SnowApi } = api({ ok: true, version: 'curbs-1', zones: [] });
  const r = await SnowApi.call('getZones', { site_id: 'S1' });
  assert.equal(r.ok, true);
  assert.deepEqual(plain(r.zones), []);
  assert.equal(r.versionMismatch, true); // the banner's cue, unchanged
});

test('a reply with no version at all is not checked either', async () => {
  const { SnowApi } = api({ ok: true, zones: [] });
  const r = await SnowApi.call('getZones', {});
  assert.equal(r.ok, true);
});

test('the check compares to the action as asked: the request carries it, and the reply must echo it', async () => {
  const { SnowApi, calls } = api((body) => ({ ok: true, version: EXPECTED, action: body.action }));
  const r = await SnowApi.call('restoreRoute', { id: 'R1', rev: 3 });
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(calls[0].init.body), { id: 'R1', rev: 3, action: 'restoreRoute', token: 'tok' });
});

test('a body that is not a reply with a boolean ok keeps its own refusal', async () => {
  const { SnowApi } = api({ version: EXPECTED, action: 'saveZone' });
  const r = await SnowApi.call('saveZone', {});
  assert.deepEqual(plain(r), { ok: false, code: 'error', reason: 'Unexpected reply from the server.' });
});

// Plow Command (10/21/26): this phone and its backend share one label, plow-2 (lib/config.js EXPECTED_BACKEND, the script's
// VERSION). If only one of them moves, every reply is a "version mismatch" and the red banner shows on every phone, so the
// two are read side by side. The backend repo sits beside this one (no remote); not there, the phone's half is still checked.
test('the phone expects plow-2, and the backend beside it answers plow-2', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'lib', 'config.js'), 'utf8');
  assert.equal(/EXPECTED_BACKEND: '([^']+)'/.exec(config)[1], 'plow-2');
  const backend = path.join(__dirname, '..', '..', 'plow-command-script', 'Code.js');
  if (!fs.existsSync(backend)) return;
  assert.equal(/var VERSION = '([^']+)';/.exec(fs.readFileSync(backend, 'utf8'))[1], 'plow-2');
});

// Final wave I3 (10/22/26): the first Pull's apply writes ~120 records and can take longer than the 45 s every other call
// waits. call() takes an optional third argument, { timeout: ms }, for that one call; left out, or not a positive number, the
// wait is the 45 s it always was. The timer here fires at once (a fetch that never answers on its own), so each call ends as
// "no signal" and the test reads the wait it was given.
function slowApi() {
  const waits = [];
  const sandbox = {
    SNOW_CONFIG: { SNOW_URL: 'https://snow.example/exec', INV_URL: 'https://inv.example/exec', EXPECTED_BACKEND: EXPECTED },
    localStorage: { getItem: () => 'tok', setItem: () => {}, removeItem: () => {} },
    // a server that never answers: only the abort ends the request
    fetch: (u, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); }),
    AbortController, URLSearchParams, JSON, Object, Promise,
    setTimeout: (fn, ms) => { waits.push(ms); return setTimeout(fn, 0); }, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { SnowApi: sandbox.SnowApi, waits };
}

test('a call waits 45 s, unless it names a longer wait: the Pull apply waits 120 s (I3)', async () => {
  const { SnowApi, waits } = slowApi();
  // Worked: the default, 45000; the apply with { timeout: 120000 }, 120000; a timeout that is not a positive number
  // ('120000' as text, 0, -5) or no opts at all is the default again.
  const r1 = await SnowApi.call('getShiftLog', {});
  const r2 = await SnowApi.call('pullFromShovel', { apply: true }, { timeout: 120000 });
  await SnowApi.call('saveSite', {}, { timeout: '120000' });
  await SnowApi.call('saveSite', {}, { timeout: 0 });
  await SnowApi.call('saveSite', {}, { timeout: -5 });
  await SnowApi.call('saveSite', {}, null);
  assert.deepEqual(waits, [45000, 120000, 45000, 45000, 45000, 45000]);
  // Either way a request that never answers ends as no signal, not a hang.
  assert.deepEqual([plain(r1), plain(r2)], [{ ok: false, code: 'network', reason: NO_SIGNAL }, { ok: false, code: 'network', reason: NO_SIGNAL }]);
});
