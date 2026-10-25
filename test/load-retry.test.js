const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

// Opening the app: two quiet retries, and a load that never says "Not saved" (Matt, 10/22/26 for Shovel Command; the same
// failure in Plow Command, Matt 10/24/26: "can't connect every now and then. You retry, sometimes it works, sometimes you do
// it again"). Ported from Shovel Command's test/load-retry.test.js (phone 4e25805, live 10/24/26), re-pointed at this api.js.
//
// What happened: Google now and then fails a doPost in 0 s, before the script's code runs (3 of 22 calls on 10/22 in Shovel
// Command's book). Google's error page carries no CORS header, so the phone's fetch rejects and lib/api.js answers code
// 'network' with the "Not saved" sentence. On the app-open card that sentence was wrong: the load is a READ, nothing was
// being saved. And the same call a moment later answers.
//
// The rules, each worked out on paper below:
//   SnowApi.read(action, body)  = a READ given up to TWO quiet retries: the first 1500 ms after the failure, the second
//                                 4000 ms after the next one, so at most three tries. Only code 'network', and only while
//                                 the read has used under 10 s in all (waits included). A failure that took the 45 s limit
//                                 is not tried again: the person has waited a minute, the card comes.
//   SnowApi.call(action, body, opts) = unchanged, and NEVER retried: a write that failed may have landed (the 45 s abort),
//                                 and its words stay "Not saved". Plow Command's call() also takes opts.timeout (the Pull
//                                 from Shovel Command's long apply, 120 s): that keeps working and is never retried either.
//   A read's failure never says "Not saved": "Couldn't reach the server. Try again." (already in the Spanish rows).
//
// Plow Command's load() asks for bootstrap with NO body (Shovel Command's asks `slim: true`; the plow server has no slim).
//
// lib/api.js is a browser script (SnowApi on `this`): run in a vm holding just what it reads, with a fake clock and a
// setTimeout that records every wait. Delays of 10 s and up are the abort timer: recorded, never fired.
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'api.js'), 'utf8');
const EXPECTED = 'plow-2';
const WRITE_WORDS = "Couldn't reach the server. Not saved, try again.";
const READ_WORDS = "Couldn't reach the server. Try again.";
const UNREADABLE = 'The server sent something unreadable. Try again.';

// `script`: what each successive fetch does. 'down' = the fetch rejects (offline, or Google's error page: no CORS header).
// 'html' = a reply that is not JSON. { reply } = a JSON body. Any entry may carry `took` (ms the clock moves while it runs).
// A fetch past the end of the script is a test bug: it throws.
function api(script) {
  const calls = [], waits = [], removed = [];
  const clock = { t: 1000000 };
  let i = 0;
  const sandbox = {
    SNOW_CONFIG: { SNOW_URL: 'https://plow.example/exec', INV_URL: 'https://inv.example/exec', EXPECTED_BACKEND: EXPECTED },
    localStorage: { getItem: () => 'tok', setItem: () => {}, removeItem: (k) => removed.push(k) },
    fetch: async (u, init) => {
      calls.push({ u, body: JSON.parse(init.body) });
      const step = script[i++];
      if (!step) throw new Error('the test script ran out: a fetch nobody planned');
      clock.t += step.took || 0;
      if (step === 'down' || step.down) throw new TypeError('Failed to fetch');
      if (step === 'html' || step.html) return { json: async () => { throw new SyntaxError('Unexpected token <'); } };
      return { json: async () => step.reply };
    },
    AbortController, URLSearchParams, JSON, Object, Promise,
    Date: { now: () => clock.t },
    // A wait between tries moves the fake clock by what it waited; the abort timer (45 s, or a call's own opts.timeout)
    // is recorded and never fired.
    setTimeout: (fn, ms) => { waits.push(ms); if (ms < 10000) { clock.t += ms; Promise.resolve().then(fn); } return waits.length; },
    clearTimeout: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const retries = () => waits.filter((ms) => ms < 10000); // the waits between tries
  const aborts = () => waits.filter((ms) => ms >= 10000); // the abort timers, one per fetch
  return { SnowApi: sandbox.SnowApi, calls, retries, aborts, removed };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const ok = (action, extra) => ({ reply: Object.assign({ ok: true, version: EXPECTED, action }, extra || {}) });

test('a read that fails fast and then answers: the answer, after one wait of 1500 ms, the same request twice', async () => {
  const { SnowApi, calls, retries } = api(['down', ok('bootstrap', { me: { name: 'Matthew' } })]);
  const r = await SnowApi.read('bootstrap');
  assert.equal(r.ok, true);
  assert.equal(r.me.name, 'Matthew');
  assert.equal(calls.length, 2);
  assert.deepEqual(retries(), [1500]);
  // The same ask both times: the action and the token, and no body of its own (this app's load asks for none).
  assert.deepEqual(calls[1].body, calls[0].body);
  assert.deepEqual(calls[0].body, { action: 'bootstrap', token: 'tok' });
});

test('a read with a body of its own sends it on every try (this app\'s load has none, so the test above cannot see it)', async () => {
  // Worked on paper: three tries, each { site_id: 'S1', action: 'getZones', token: 'tok' }. The first test carries no body, so
  // a read that dropped it would pass there; here a dropped body on ANY try leaves { action, token } only.
  const { SnowApi, calls } = api(['down', 'down', ok('getZones', { zones: [] })]);
  const r = await SnowApi.read('getZones', { site_id: 'S1' });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 3);
  for (const c of calls) assert.deepEqual(c.body, { site_id: 'S1', action: 'getZones', token: 'tok' });
});

test('fail, fail, then an answer: the answer on the third try, after waits of 1500 ms and then 4000 ms', async () => {
  const { SnowApi, calls, retries } = api(['down', 'down', ok('bootstrap', { me: { name: 'Matthew' } })]);
  const r = await SnowApi.read('bootstrap');
  assert.equal(r.ok, true);
  assert.equal(r.me.name, 'Matthew');
  assert.equal(calls.length, 3);
  assert.deepEqual(retries(), [1500, 4000]);
});

test('three failures in a row: the failure stands, after exactly two retries and never a loop', async () => {
  // The script holds NO fourth entry: a fourth fetch would throw "ran out" and fail this test.
  const { SnowApi, calls, retries } = api(['down', 'down', 'down']);
  const r = await SnowApi.read('bootstrap');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'network');
  assert.equal(calls.length, 3);
  assert.deepEqual(retries(), [1500, 4000]);
});

test('a read that answers the first time waits for nothing', async () => {
  const { SnowApi, calls, retries } = api([ok('bootstrap')]);
  const r = await SnowApi.read('bootstrap');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(retries(), []);
});

test('a read\'s failure never says "Not saved": it is a load, nothing was being saved', async () => {
  const { SnowApi } = api(['down', 'down', 'down']);
  const r = await SnowApi.read('bootstrap');
  assert.equal(r.reason, READ_WORDS);
  assert.doesNotMatch(r.reason, /saved/i);
});

test('a write\'s failure keeps its words: call() says "Not saved, try again"', async () => {
  const { SnowApi } = api(['down']);
  const r = await SnowApi.call('saveZone', { record: {} });
  assert.deepEqual(plain(r), { ok: false, code: 'network', reason: WRITE_WORDS });
});

test('call() is never retried, even when the failure came back instantly: a write that failed may have landed', async () => {
  // The script holds a good answer for a second fetch. If call() ever tried again it would find it and the
  // person would be told "saved" on a request the phone sent twice.
  const { SnowApi, calls, retries } = api(['down', ok('tapZone')]);
  const r = await SnowApi.call('tapZone', { site_id: 'S1', zone_id: 'Z1', state: 'plowed' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'network');
  assert.equal(calls.length, 1);
  assert.deepEqual(retries(), []);
});

test('the Pull\'s long call keeps its own limit and is never retried: opts.timeout 120000 is the abort timer, one fetch only', async () => {
  // Plow Command only. The first Pull from Shovel Command's apply writes ~120 records in one call and is given 120 s (lib/pull.js);
  // a retry of it after a fast failure could write them twice, and read() must not have changed what the timer is.
  const pull = api(['down', ok('pullApply')]);
  const r = await pull.SnowApi.call('pullApply', {}, { timeout: 120000 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, WRITE_WORDS);
  assert.equal(pull.calls.length, 1);
  assert.deepEqual(pull.retries(), []);
  assert.deepEqual(pull.aborts(), [120000]);
  // Without opts the same call is the 45 s default.
  const plainCall = api([ok('tapZone')]);
  await plainCall.SnowApi.call('tapZone', {});
  assert.deepEqual(plainCall.aborts(), [45000]);
});

test('every try of a read is a call() with the 45 s limit: three tries, three timers of 45000', async () => {
  const { SnowApi, aborts } = api(['down', 'down', 'down']);
  await SnowApi.read('bootstrap');
  assert.deepEqual(aborts(), [45000, 45000, 45000]);
});

test('only a FAST failure is tried again: 9.999 s is, 10 s is not (the 45 s limit costs a minute already)', async () => {
  const fast = api([{ down: true, took: 9999 }, ok('bootstrap')]);
  const a = await fast.SnowApi.read('bootstrap');
  assert.equal(a.ok, true);
  assert.equal(fast.calls.length, 2);
  const slow = api([{ down: true, took: 10000 }, ok('bootstrap')]);
  const b = await slow.SnowApi.read('bootstrap');
  assert.equal(b.ok, false);
  assert.equal(slow.calls.length, 1);
  assert.deepEqual(slow.retries(), []);
});

test('the second retry needs the whole read under 10 s, waits included: 9.9 s is, 10.5 s is not', async () => {
  // Worked on paper. Try 1 fails after 8000 ms (8000 < 10000: retry, wait 1500 -> 9500).
  //   Try 2 fails after 400 ms  -> 9900 < 10000: a third try, after a wait of 4000.
  //   Try 2 fails after 1000 ms -> 10500 >= 10000: no third try, the card.
  const inside = api([{ down: true, took: 8000 }, { down: true, took: 400 }, ok('bootstrap')]);
  assert.equal((await inside.SnowApi.read('bootstrap')).ok, true);
  assert.equal(inside.calls.length, 3);
  assert.deepEqual(inside.retries(), [1500, 4000]);
  const past = api([{ down: true, took: 8000 }, { down: true, took: 1000 }, ok('bootstrap')]);
  const r = await past.SnowApi.read('bootstrap');
  assert.equal(r.ok, false);
  assert.equal(past.calls.length, 2);
  assert.deepEqual(past.retries(), [1500]);
});

test('a read that ran out the 45 s limit: no second try, the card comes with the honest words', async () => {
  const { SnowApi, calls } = api([{ down: true, took: 45000 }, ok('bootstrap')]);
  const r = await SnowApi.read('bootstrap');
  assert.equal(calls.length, 1);
  assert.equal(r.code, 'network');
  assert.equal(r.reason, READ_WORDS);
});

test('an unreadable reply (not JSON) is a network failure too: tried again, and its own words survive a second one', async () => {
  const again = api(['html', ok('bootstrap')]);
  assert.equal((await again.SnowApi.read('bootstrap')).ok, true);
  assert.equal(again.calls.length, 2);
  const thrice = api(['html', 'html', 'html']);
  const r = await thrice.SnowApi.read('bootstrap');
  assert.equal(r.code, 'network');
  assert.equal(r.reason, UNREADABLE); // already says nothing about saving: left alone
  assert.equal(thrice.calls.length, 3);
});

test('the 10/10 hiccup, the health reply handed back for a POST, is "no signal" and is tried again on a read', async () => {
  const { SnowApi, calls } = api([{ reply: { ok: true, version: EXPECTED } }, ok('bootstrap')]);
  const r = await SnowApi.read('bootstrap');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
});

test('nothing but a network failure is tried again: refusals and answers are one request', async () => {
  const answers = [
    ['a sign-in refusal', { ok: false, code: 'signin', reason: 'Session expired. Sign in again.' }],
    ['not on the roster', { ok: false, code: 'not_on_roster', reason: "You're signed in, but not on the plow crew yet. Ask the dispatcher to add you." }],
    ['a card waiting for the dispatcher', { ok: false, code: 'pending_card', reason: 'Your card is in. The dispatcher will add you to the crew.' }],
    ['a server error', { ok: false, code: 'error', reason: 'Something broke on the server.' }],
    ['a forbidden', { ok: false, code: 'forbidden', reason: 'Only the dispatcher can do that.' }],
  ];
  for (const [what, body] of answers) {
    const { SnowApi, calls, retries } = api([{ reply: Object.assign({ version: EXPECTED, action: 'bootstrap' }, body) }, ok('bootstrap')]);
    const r = await SnowApi.read('bootstrap');
    assert.equal(r.code, body.code, what);
    assert.equal(r.reason, body.reason, what);
    assert.equal(calls.length, 1, what);
    assert.deepEqual(retries(), [], what);
  }
});

test('a sign-in refusal on a read still signs out (the token goes), with no second try', async () => {
  const { SnowApi, removed, calls } = api([{ reply: { ok: false, code: 'signin', reason: 'Sign in again.', version: EXPECTED, action: 'bootstrap' } }]);
  const r = await SnowApi.read('bootstrap');
  assert.equal(r.code, 'signin');
  assert.deepEqual(removed, ['titan-plow-token']);
  assert.equal(calls.length, 1);
});
