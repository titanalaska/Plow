// Where a signed-in person stands on the storm tab (lib/shiftlogui.js standing(S)): 'admin', 'lead', 'member', 'unposted'
// or null. A dispatcher (Plow Command, 10/21/26) signs in as an admin WITH a crew id, so the order of the checks matters:
// the admin check has to come before the crew-id lookup on the Board, or a dispatcher who is not on tonight's post (or who has
// no post at all) would be read-only on the storm tab. This pins that order.
//
// lib/shiftlogui.js is a browser file with no exports, so it is run in a vm with the two things it touches: a `document` whose
// listener registration does nothing (it registers one at load) and a CrewTime whose answers are fixed here. The stubbed
// isStale() says a post is stale when its shift is 'old'; every other post is fresh. standing() reads nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const ctx = {
    window: {}, document: { addEventListener() {} },
    CrewTime: { localIso: () => '2026-10-01T22:00:00-08:00', isStale: (shift) => shift === 'old' },
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'shiftlogui.js'), 'utf8');
  vm.runInContext(src + '\n;this.__ui = SnowShiftUI;', ctx);
  return ctx.__ui;
}
const UI = load();

// Tonight's post: R1 is led by C01 with C03 riding. C05 (a dispatcher) is on no route.
const POST = { shift: 'night-2026-10-01', routes: [{ id: 'R1', lead: 'C01', members: ['C03'] }] };
const STALE = { shift: 'old', routes: POST.routes };
const as = (role, crew_id, post) => UI.standing({ me: { role, crew_id }, post });

test('standing: crew read the post: its lead, its member, someone not on it, no post, a stale post', () => {
  assert.equal(as('crew', 'C01', POST), 'lead');       // leads R1
  assert.equal(as('crew', 'C03', POST), 'member');     // rides on R1
  assert.equal(as('crew', 'C05', POST), null);         // on the roster, not on tonight's post: read-only
  assert.equal(as('crew', 'C01', null), 'unposted');   // no post: the phone cannot see the Board, the server decides
  assert.equal(as('crew', 'C01', STALE), 'unposted');  // last night's post counts for nothing
  assert.equal(as('crew', null, POST), null);          // no crew id at all
  assert.equal(UI.standing({ me: null, post: POST }), null);
});

test('standing: an admin is admin first, even with a crew id the post leaves out (a dispatcher), no post, or a stale post', () => {
  // The same C05 who reads null as crew above: admin by the mark, so the post does not matter.
  assert.equal(as('admin', 'C05', POST), 'admin');     // a post that omits C05: still admin, not null
  assert.equal(as('admin', 'C05', null), 'admin');     // no post: admin, not 'unposted'
  assert.equal(as('admin', 'C05', STALE), 'admin');    // a stale post: admin, not 'unposted'
  assert.equal(as('admin', 'C01', POST), 'admin');     // a dispatcher who also leads R1: admin, not 'lead'
  assert.equal(as('admin', 'C03', POST), 'admin');     // ...or rides on it: admin, not 'member'
  assert.equal(as('admin', null, POST), 'admin');      // Matt, the code admin: no crew id
});
