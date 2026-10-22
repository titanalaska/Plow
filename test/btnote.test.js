// The "Copy for BT" note (Matt, 10/3/26): the app writes the text, the lead posts
// it in BuilderTrend as themselves. Claude and the app never touch BT.
// Plow Command (10/21/26): the lot is the unit. The note's first line is the lot's state now (its newest
// standing row in the storm): "Plowed.", "Problem: <note>." or "Not plowed."; the rest is this shift's.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../lib/btnote.js');

// PAC has two piles and a keep-clear area drawn: drawings only, never in the note.
const ZONES = [
  { id: 'Z5', site_id: 'S1', type: 'storage', name: 'Snow pile 1' },
  { id: 'Z6', site_id: 'S1', type: 'storage', name: 'Snow pile 2' },
  { id: 'Z9', site_id: 'S1', type: 'no_touch', name: 'Dumpster pad' },
];
const SITE = { id: 'S1', name: 'PAC', units: { bobcat: 'BCT7', snowrator: '' } };
const row = (seq, state, extra = {}) => ({ id: 'L-' + seq, seq, storm_id: 'ST-1', shift_id: 'night-2026-12-04', site_id: 'S1',
  zone_id: 'lot', state, note: '', by_name: 'Alex Test', at: '2026-12-04T23:55:00.000-09:00', ...extra });
const card = (seq, key, extra = {}) => ({ id: 'V-' + seq, seq, storm_id: 'ST-1', shift_id: 'night-2026-12-04', site_id: 'S1', by_key: key,
  by_name: key, depth_in: '', materials_used: '', equipment: { blower: '', snowrator: '', bobcat: '', sweepster: '' }, ...extra });

const base = () => ({ site: SITE, zones: ZONES, storm_id: 'ST-1', log: [], visits: [] });
const first = (o) => N.btNote(o, 'night-2026-12-04').text.split('\n')[0];

test('btnote copy for a plowed and a problem site', () => {
  // Plowed at 11:55 PM (seq 1): "Plowed." The piles and the keep-clear area never appear.
  const plowed = base();
  plowed.log = [row(1, 'plowed')];
  const p = N.btNote(plowed, 'night-2026-12-04');
  assert.equal(p.text, 'Plowed.');
  assert.ok(!/pile|Dumpster/i.test(p.text), p.text);
  assert.deepEqual([p.timeIn, p.timeOut], ['11:55 PM', '11:55 PM']);
  // A Problem with its note (seq 1, 11:55 PM): "Problem: gate locked." The note is trimmed as the lead typed it.
  const problem = base();
  problem.log = [row(1, 'problem', { note: '  gate locked ' })];
  assert.equal(first(problem), 'Problem: gate locked.');
  // A Problem whose note is blank (an old row: the phone and the server both refuse one now) still says Problem.
  problem.log = [row(1, 'problem', { note: '' })];
  assert.equal(first(problem), 'Problem.');
});

test('the newest standing row wins: plowed then a problem is a problem; an undo back to none is not plowed', () => {
  // Seq 1 plowed, seq 2 problem "drift at the gate": the lot stands at the Problem.
  const o = base();
  o.log = [row(1, 'plowed'), row(2, 'problem', { note: 'drift at the gate' })];
  assert.equal(first(o), 'Problem: drift at the gate.');
  // Seq 3 undoes seq 2 back to plowed (the row carries the state it went back to): Plowed.
  o.log.push(row(3, 'plowed', { undoes: 'L-2' }));
  assert.equal(first(o), 'Plowed.');
  // A lot plowed (seq 1) and undone back to none (seq 2): Not plowed.
  const u = base();
  u.log = [row(1, 'plowed'), row(2, 'none', { undoes: 'L-1' })];
  assert.equal(first(u), 'Not plowed.');
});

test('nobody has tapped the lot: Not plowed, and the times are blank, never invented', () => {
  const n = N.btNote(base(), 'night-2026-12-04');
  assert.equal(n.text, 'Not plowed.');
  assert.equal(n.timeIn, '');
  assert.equal(n.timeOut, '');
});

test('a depth reading is never the lot: a reading after a plowed tap leaves it Plowed, and adds no time', () => {
  // Seq 1 plowed 11:55 PM; seq 2 a New snow reading ('*', depth 2) at 12:30 AM: still "Plowed.", In and Out 11:55 PM.
  const o = base();
  o.log = [row(1, 'plowed'), row(2, 'depth', { zone_id: '*', depth_in: 2, at: '2026-12-05T00:30:00.000-09:00' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.equal(n.text.split('\n')[0], 'Plowed.');
  assert.deepEqual([n.timeIn, n.timeOut], ['11:55 PM', '11:55 PM']);
});

test('a site with nothing drawn is the same one lot', () => {
  const o = { ...base(), site: { id: 'S2', name: 'TUDOR' }, zones: [] };
  o.log = [row(1, 'plowed', { site_id: 'S2' })];
  assert.equal(first(o), 'Plowed.');
});

test('time in and out are the first and last tap at the site this shift, readable', () => {
  // Taps 11:55 PM and 12:53 AM (next calendar day, same night shift). A day-shift tap is not counted.
  const o = base();
  o.log = [row(1, 'plowed'), row(2, 'problem', { note: 'cars', at: '2026-12-05T00:53:00.000-09:00' }),
    row(3, 'plowed', { shift_id: 'day-2026-12-05', at: '2026-12-05T10:00:00.000-09:00' })];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.equal(n.timeIn, '11:55 PM');
  assert.equal(n.timeOut, '12:53 AM');
});

test('depth, materials and machine minutes come from each person\'s newest site card', () => {
  // C01: depth 1, 'salt', bobcat 45 (V-1), then re-saves depth 1.5 (V-4) -> V-4 counts.
  // C03: depth 1, '2 bags IceMelt', blower 30. Depths 1 and 1.5 -> 1-1.5". Bobcat carries its unit BCT7.
  const o = base();
  o.visits = [card(1, 'C01', { depth_in: 1, materials_used: 'salt', equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' } }),
    card(2, 'C03', { depth_in: 1, materials_used: '2 bags IceMelt', equipment: { blower: 30, snowrator: '', bobcat: '', sweepster: '' } }),
    card(4, 'C01', { depth_in: 1.5, materials_used: 'salt', equipment: { blower: '', snowrator: '', bobcat: 45, sweepster: '' } })];
  const lines = N.btNote(o, 'night-2026-12-04').text.split('\n');
  assert.ok(lines.includes('Depth: 1-1.5"'), lines.join(' | '));
  assert.ok(lines.includes('Materials: salt; 2 bags IceMelt'), lines.join(' | '));
  assert.ok(lines.includes('Equipment: Blower 30 min, Bobcat BCT7 45 min'), lines.join(' | '));
});

test('blank cards add no depth, materials or equipment lines', () => {
  const o = base(); o.visits = [card(1, 'C01')];
  const n = N.btNote(o, 'night-2026-12-04');
  assert.ok(!/Depth|Materials|Equipment/.test(n.text), n.text);
});

test('the lot line is THIS shift\'s: a lot the night plowed reads Not plowed in the day\'s note until the day plows it (C3)', () => {
  // Final wave C3: the note's first line reads the shift it is written for. Seq 1 plowed on the night of 12/4. The day of 12/5's
  // note: no day row -> "Not plowed." Then seq 4, a day Problem "ice on the ramp" -> "Problem: ice on the ramp.". The night's own
  // note still reads "Plowed." (its row is the night's).
  const o = base();
  o.log = [row(1, 'plowed')];
  assert.equal(N.btNote(o, 'day-2026-12-05').text.split('\n')[0], 'Not plowed.');
  o.log.push(row(4, 'problem', { note: 'ice on the ramp', shift_id: 'day-2026-12-05', at: '2026-12-05T10:05:00.000-09:00' }));
  assert.equal(N.btNote(o, 'day-2026-12-05').text.split('\n')[0], 'Problem: ice on the ramp.');
  assert.equal(first(o), 'Plowed.');
});
