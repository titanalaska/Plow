// The Spanish engine, pure part (lib/es.js): the dictionary pass and the rules.
// Expected values are the rows the spec fixes (docs/superpowers/specs/2026-10-09-spanish-design.md).
const test = require('node:test');
const assert = require('node:assert');
const Es = require('../lib/es.js');

test('a known phrase translates; an unknown one comes back unchanged', () => {
  assert.equal(Es.translateString('Sign in'), 'Iniciar sesión');
  assert.equal(Es.translateString('Pumpkin spice'), 'Pumpkin spice');
});

test('longest key wins: "Not saved: try again" is one row, not "Not saved" + ": try again"', () => {
  // Both "try again" and the whole line are rows; the whole line must win.
  assert.equal(Es.translateString('Not saved: try again'), 'No se guardó: inténtalo de nuevo');
});

test('a short key never bites into a longer word: Back vs Backend', () => {
  assert.equal(Es.translateString('Back'), 'Atrás');
  assert.equal(Es.translateString('‹ Back'), '‹ Atrás');
  // Bare longer words with a key inside: these are the ones only the \b anchors protect (the full banner
  // below is its own row, so longest-first would save it even without them; the 10/9 mutation check found that).
  assert.equal(Es.translateString('Backend'), 'Backend');
  assert.equal(Es.translateString('Mapbox'), 'Mapbox');
  assert.equal(Es.translateString('Startup'), 'Startup');
  assert.equal(Es.translateString("Backend out of date. Tell Matt: the app and the server don't match."),
    'El servidor está desactualizado. Dile a Matt: la app y el servidor no coinciden.');
});

test('leading and trailing spaces survive ("Tonight: " before a bold name)', () => {
  assert.equal(Es.translateString('Tonight: '), 'Esta noche: ');
  assert.equal(Es.translateString(' · admin'), ' · admin'); // a role tag, not a row: unchanged, space and all
});

test('number rules: the weather hint and the lots count', () => {
  assert.equal(Es.translateString('Snow until 10 AM'), 'Nieve hasta las 10 AM');
  assert.equal(Es.translateString('No snow in the next 12 h'), 'Sin nieve en las próximas 12 h');
  // lib/livesum.js lotsWords(): '<done> of <total> lots', its own text on the live view
  assert.equal(Es.translateString('3 of 5 lots'), '3 de 5 estacionamientos');
  assert.equal(Es.translateString('0 of 12 lots'), '0 de 12 estacionamientos');
  // The status line's "by" is its own text node between the time and the name: only that whole node is a rule,
  // so a "by" inside another phrase is never touched by it.
  assert.equal(Es.translateString(' by '), ' por ');
  assert.equal(Es.translateString('Started by Alex Test 9:12'), 'Started by Alex Test 9:12');
});

// Plow Command (10/21/26): the lot is the unit. Its words, every one a row (never a lucky word-by-word match).
test('the lot: Plowed, Not plowed, Problem, the refusal, Lot, and the handoff day-route words', () => {
  const words = {
    'Plowed': 'Quitado', 'Not plowed': 'Sin quitar', 'Problem': 'Problema', 'A problem needs a note': 'Un problema necesita una nota',
    'Lot': 'Estacionamiento', 'Night: plowed': 'Noche: quitado', 'Night: problem': 'Noche: problema',
    // fix round 1: a Problem saved while the lot's last tap is still on its way
    'Still sending the last tap. Save again in a moment.': 'Todavía se está enviando el último toque. Guarda de nuevo en un momento.',
  };
  for (const [en, es] of Object.entries(words)) {
    assert.equal(Es.translateString(en), es, en);
    assert.ok(en in Es.ES, 'a row: ' + en);
  }
  // As they render: the status line's first part, a day-route line's tail, a leftover's tail (the note is a person's
  // words and not a row, so it stays).
  assert.equal(Es.translateString('Plowed 2:14 AM'), 'Quitado 2:14 AM');
  assert.equal(Es.translateString(' · Not plowed · Night: problem'), ' · Sin quitar · Noche: problema');
  assert.equal(Es.translateString(' · Plowed · Night: plowed'), ' · Quitado · Noche: quitado');
  assert.equal(Es.translateString(' · Not plowed · Problem: gate locked'), ' · Sin quitar · Problema: gate locked');
  // Lot outlines (10/22/26): the square-footage line under a site's address on the crew's cards, and the unit on a
  // zone's card ("≈ 1,076 sq ft"). The number and the colon are the engine's own; "sq ft" is a row.
  assert.ok('sq ft' in Es.ES, 'a row: sq ft');
  assert.equal(Es.translateString('Lot: 48,200 sq ft'), 'Estacionamiento: 48,200 pies²');
  assert.equal(Es.translateString('≈ 1,076 sq ft'), '≈ 1,076 pies²');
});

test('every row has a Spanish value different from its key and no row is blank', () => {
  const rows = Object.entries(Es.ES);
  assert.ok(rows.length > 0);
  for (const [k, v] of rows) assert.ok(typeof v === 'string' && v.trim() && v !== k, 'row ' + JSON.stringify(k));
});

test('the status words the crew tap all night (spec, Groundwork vocabulary; one crew member checks before ship)', () => {
  const words = {
    'Plowed': 'Quitado', 'Problem': 'Problema', 'Not plowed': 'Sin quitar',
    'Done': 'Listo', 'Retry': 'Reintentar', 'Undo': 'Deshacer',
    // The map's three kinds (Plow Command, 10/21/26), as the legend reads them. Snow storage keeps the row it had.
    'Snow storage': 'Depósito de nieve', 'Keep clear': 'Mantener libre', 'Push snow this way': 'Empuja la nieve en esta dirección',
    "Couldn't reach the server. Not saved, try again.": 'No se pudo conectar con el servidor. No se guardó, inténtalo de nuevo.',
  };
  for (const [en, es] of Object.entries(words)) assert.equal(Es.translateString(en), es, en);
});

// Plow Command (10/21/26): the shovel crew's states and passes are gone from the screen, so are their rows.
test('the lot: no row is left for a word the Storm tab no longer says', () => {
  const retired = ['Cleared', 'Treated', 'Checked', 'Touched', 'Whole site', 'Clean again', 'Yes, clean again', 'Pass', 'pass',
    'Which zone?', "It's still snowing: treated anyway"];
  for (const k of retired) assert.equal(k in Es.ES, false, 'a row for English the app no longer renders: ' + k);
  // and no rule is left for the curb items or the pass line
  assert.equal(Es.translateString('Curbs (about 690 ft)'), 'Curbs (about 690 ft)');
  assert.equal(Es.ES_RULES.some((r) => /Curbs|Pasada/.test(String(r[0]))), false);
});

test('final review: the rows and rules the crew screens were still missing', () => {
  const cases = {
    'PIN is 4 digits.': 'El PIN tiene 4 dígitos.',
    'Wrong PIN. 3 tries left.': 'PIN incorrecto. Quedan 3 intentos.',
    'Too many wrong PINs. Wait 5 minutes.': 'Demasiados PIN incorrectos. Espera 5 minutos.',
    ' (waiting for approval)': ' (esperando aprobación)',
    'Type your first and last name and choose a 4-digit PIN. This goes to Matt. Once he approves it, sign in here with your name and this PIN.':
      'Escribe tu nombre y apellido y elige un PIN de 4 dígitos. Esto le llega a Matt. Cuando él lo apruebe, inicia sesión aquí con tu nombre y este PIN.',
    "Can't reach the server. Trying again.": 'No se puede conectar con el servidor. Intentando de nuevo.',
    'Add minutes for Blower, or untick it': 'Agrega minutos para Sopladora, o desmárcala',
    'Night of 10/3, posted 12:12 AM': 'Noche del 10/3, publicado 12:12 AM',
    'Day of 10/3, posted 9:05 AM': 'Día del 10/3, publicado 9:05 AM',
    'Shifts worked': 'Turnos trabajados',
    '— 3 nights · 1 day': '— 3 noches · 1 día',
    '— 1 night · 2 days': '— 1 noche · 2 días',
    'Start': 'Inicio',           // the card's times line is exactly this text node
    '· Finish': '· Fin',
    'Start storm': 'Start storm', // a lead's control: NOT a row, never "Inicio storm" (spec: leads' screens stay)
    'not set': 'sin definir',
    'none': 'ninguno',
    'own': 'propio',
    'needs issued': 'se necesita entregar',
    'I have my own': 'Tengo el mío',
    'I need it issued': 'Necesito que me lo entreguen',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
});

// Plow Command (Matt, 10/21/26): the app has its own name, and the crew's words for who adds them are "the dispatcher".
// One row per sentence the crew reads that changed. The app's name is a name: it is never translated.
test('Plow Command: the sentences that name the app or the dispatcher read Spanish', () => {
  const cases = {
    'Plow driver': 'Conductor de quitanieves',
    'Once Matt approves it, sign in here.': 'Cuando Matt la apruebe, inicia sesión aquí.',
    'You can see the routes, but not mark lots. If you were just added to the crew, ask the dispatcher to Post again.':
      'Puedes ver las rutas, pero no marcar estacionamientos. Si te acaban de agregar a la cuadrilla, pídele al despachador que vuelva a publicar.',
    "You're signed in, but not on the plow crew yet. Fill out your card and the dispatcher will add you.":
      'Ya iniciaste sesión, pero todavía no estás en la cuadrilla de quitanieves. Llena tu tarjeta y el despachador te agregará.',
    'Your card is in. The dispatcher will add you to the crew.': 'Tu tarjeta está lista. El despachador te agregará a la cuadrilla.',
    "The dispatcher hasn't posted the trucks yet. Check back, or call your lead.":
      'El despachador todavía no ha publicado los camiones. Vuelve a revisar o llama a tu líder.',
    "This site's map isn't drawn yet. Use the plow note for now.":
      'El mapa de este sitio todavía no está dibujado. Usa la nota de quitanieves por ahora.',
    // one's own card (final wave addendum, 10/22/26): where one lives and the emergency contact are the dispatchers' and Matt's
    'Only the dispatcher and Matt see where you live.': 'Solo el despachador y Matt ven dónde vives.',
    'Only the dispatcher and Matt see your emergency contact.': 'Solo el despachador y Matt ven tu contacto de emergencia.',
  };
  for (const [en, es] of Object.entries(cases)) {
    assert.equal(Es.translateString(en), es, en);
    assert.ok(en in Es.ES, 'a row, not a lucky word-by-word match: ' + en);
  }
  // The request line is one text node (a paragraph), so it is one row, whole.
  const req = 'Type your first and last name and choose a 4-digit PIN. This goes to Matt. Once he approves it, sign in here with your name and this PIN.';
  assert.equal(Es.translateString(req), 'Escribe tu nombre y apellido y elige un PIN de 4 dígitos. Esto le llega a Matt. Cuando él lo apruebe, inicia sesión aquí con tu nombre y este PIN.');
  assert.ok(req in Es.ES);
});

// Task 15 (10/21): the Dispatcher switch on the worker card and in the editor, and the hint beside it on one's own card.
// Rows, each by itself: the label sits in its own text node ("Dispatcher " before the hint's span), so it is its own
// row and never part of a sentence. The lower-case word in the crew's sentences is a different word and keeps its rows.
test('Plow Command: Dispatcher and (your own card) are rows; the sentences that say "dispatcher" are untouched by them', () => {
  const rows = { 'Dispatcher': 'Despachador', '(your own card)': '(tu propia tarjeta)' };
  for (const [en, es] of Object.entries(rows)) {
    assert.equal(Es.translateString(en), es, en);
    assert.ok(en in Es.ES, 'a row: ' + en);
  }
  // As the editor renders it: the label's text node keeps its trailing space; the hint is the next node.
  assert.equal(Es.translateString('Dispatcher '), 'Despachador ');
  // The capital D is the key; the crew's lower-case sentences still read as their own rows, word for word.
  assert.equal(Es.translateString('Your card is in. The dispatcher will add you to the crew.'), 'Tu tarjeta está lista. El despachador te agregará a la cuadrilla.');
  assert.equal(Es.translateString('dispatcher'), 'dispatcher');
  // A longer word never gets cut: "Dispatchers" is not the row.
  assert.equal(Es.translateString('Dispatchers'), 'Dispatchers');
});

test('Plow Command: the name is never translated, not alone and not inside the Share heading', () => {
  assert.equal(Es.translateString('Plow Command'), 'Plow Command');
  assert.equal(Es.translateString('Share Plow Command'), 'Compartir Plow Command'); // only the word Share is a row
});

test('Plow Command: the request-access rows never name Titan Inventory (the crew are never sent to another app)', () => {
  for (const [k, v] of Object.entries(Es.ES)) {
    if (!/first and last name|Once Matt approves it/.test(k)) continue;
    assert.ok(!/Inventory/i.test(k + ' ' + v), 'a request-access row names Inventory: ' + k);
  }
  assert.ok(Object.keys(Es.ES).some((k) => /Once Matt approves it, sign in here/.test(k)), 'the request-sent row is there to check');
});

test('Plow Command: no row is left for a sentence the app no longer says', () => {
  const retired = [
    'Snow Crew',
    'Sidewalk crew',
    'Type your first and last name and choose a 4-digit PIN. Matt approves it here in Sidewalk. Then sign in with your name and this PIN.',
    'Matt approves it in Sidewalk. Then come back, pick your name and sign in with your PIN.',
    // Round 1 fix (10/21): the first Plow Command wording named Titan Inventory; the crew are never sent to another app.
    'Type your first and last name and choose a 4-digit PIN. This goes to Matt in Titan Inventory. Once he approves it, sign in with your name and this PIN.',
    'Matt approves it in Titan Inventory. Then come back, pick your name and sign in with your PIN.',
    'You can see the routes, but not mark walks. If Matt just added you, ask him to Post again.',
    // Round 2 fix (10/21): signing out and in cannot move a person onto the Board; only a new Post can.
    'You can see the routes, but not mark walks. If you were just added to the crew, sign out and back in.',
    "Matt hasn't drawn this site's zones. Use the site notes for now.",
    "Matt hasn't posted the crews yet. Check back, or call your lead.",
    "You're signed in, but not on the snow crew yet. Fill out your card and Matt will add you.",
    'Your card is in. Matt will add you to the crew.',
    // Task 13 (10/21): no MOA outlines, so a map never waits for its own download; and the Shovel crew's zone kinds are
    // not on the map (Plow Command draws piles, keep clear and push arrows).
    'Loading map…',
    "This map hasn't been opened on this phone yet. It needs signal the first time.",
    'Sidewalk', 'Hand work', 'Heated: check only, no melt',
    'Priority:', // the priority star's title, and the star is no longer drawn (Task 13 fix round 1)
    // Task 14 (10/21): the editor's buttons are Pile, Keep clear and Push arrow; the import brings piles only.
    'Do not touch', 'Hand', 'Heated', 'walks', 'snow pile', 'snow piles',
    // Task 18 (10/22/26): the read-only sentence says lots now; the bare 'sites' row went (it half-translated "2 sites on 2
    // routes" and "2 sites not mapped yet"): those phrases are whole rules below.
    'You can see the routes, but not mark walks. If you were just added to the crew, ask the dispatcher to Post again.',
    'sites',
    // Final wave M1 (10/22/26): the shared undoTarget says "lot" now.
    'Someone has tapped this walk since',
    // Final wave addendum (10/22/26): one's own card names the dispatchers too.
    'Only Matt sees where you live.',
    'Only Matt sees your emergency contact.',
  ];
  for (const k of retired) assert.equal(k in Es.ES, false, 'a row for English the app no longer renders: ' + k);
});

// Task 14 (10/21): the editor's three buttons, the arrow's two refusals (the server's own words), and the import's
// summary as it renders: "3 piles to add" is one text node, so is "Left out: 12 walks, 3 hand, 1 lot" (the counts after
// "Left out:" are Matt's editor words and have no rows; only the rows below change).
test('the editor: Pile, Keep clear, Push arrow, the arrow refusals and the import summary', () => {
  const rows = {
    'Pile': 'Pila', 'Keep clear': 'Mantener libre', 'Push arrow': 'Flecha de empuje',
    'An arrow needs at least 2 corners': 'Una flecha necesita al menos 2 esquinas',
    'An arrow needs two different corners': 'Una flecha necesita dos esquinas distintas',
    'Left out:': 'Se dejó fuera:', 'piles': 'pilas', 'pile': 'pila',
  };
  for (const [en, es] of Object.entries(rows)) {
    assert.equal(Es.translateString(en), es, en);
    assert.ok(en in Es.ES, 'a row: ' + en);
  }
  assert.equal(Es.translateString('3 piles to add'), '3 pilas to add');
  assert.equal(Es.translateString('1 pile to add'), '1 pila to add');
  assert.equal(Es.translateString('Left out: 12 walks, 3 hand, 1 lot'), 'Se dejó fuera: 12 walks, 3 hand, 1 lot');
  // The button's word never bites into a longer one: "Piles" and "Pileup" stay.
  assert.equal(Es.translateString('Piles'), 'Piles');
  assert.equal(Es.translateString('Pileup'), 'Pileup');
});

// The language key (Task 3, 10/21): Plow Command's own is `plow-lang`. titanalaska.github.io is one origin, so a
// crew member who already picked a language in Shovel Command (`snow-lang`) or Groundwork (`wolf-lang`) is read
// once, in that order, the first one holding a language wins, and it is copied into `plow-lang` so the question is
// never asked again. Those two are only ever READ. A fake localStorage stands in (node has none).
function withStorage(items, fn) {
  const store = Object.assign({}, items);
  const writes = [];
  const fake = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { writes.push(k); store[k] = String(v); },
    removeItem: (k) => { writes.push(k); delete store[k]; },
  };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true });
  try { return fn(store, writes); } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; }
}

test('the language fallbacks are listed in the order they are read: snow-lang, then wolf-lang', () => {
  assert.deepEqual(Es.FALLBACK_KEYS, ['snow-lang', 'wolf-lang']);
});

test('a phone with its own plow-lang uses it and reads nothing else', () => {
  // plow-lang says en; both fallbacks say es. Own choice wins: en, and nothing is written.
  withStorage({ 'plow-lang': 'en', 'snow-lang': 'es', 'wolf-lang': 'es' }, (store, writes) => {
    assert.equal(Es.readLangKey(), 'en');
    assert.deepEqual(writes, []);
  });
});

test('with no plow-lang, snow-lang is read before wolf-lang, and copied into plow-lang once', () => {
  // snow-lang es, wolf-lang en: the first in order wins -> es (wolf-lang's en must not). One write: plow-lang.
  withStorage({ 'snow-lang': 'es', 'wolf-lang': 'en' }, (store, writes) => {
    assert.equal(Es.readLangKey(), 'es');
    assert.deepEqual(writes, ['plow-lang']);
    assert.equal(store['plow-lang'], 'es');
    assert.equal(store['snow-lang'], 'es');   // the other apps' keys are never touched
    assert.equal(store['wolf-lang'], 'en');
    // "once": the copy is now this phone's choice, so a later change to snow-lang does not move it.
    store['snow-lang'] = 'en';
    assert.equal(Es.readLangKey(), 'es');
    assert.deepEqual(writes, ['plow-lang']);
  });
});

test('wolf-lang is read when snow-lang is missing or empty', () => {
  // Nothing under snow-lang (unset, then the empty string): wolf-lang es is the first value there is -> es.
  withStorage({ 'wolf-lang': 'es' }, (store, writes) => {
    assert.equal(Es.readLangKey(), 'es');
    assert.deepEqual(writes, ['plow-lang']);
    assert.equal(store['plow-lang'], 'es');
  });
  withStorage({ 'snow-lang': '', 'wolf-lang': 'es' }, (store) => {
    assert.equal(Es.readLangKey(), 'es');
    assert.equal(store['plow-lang'], 'es');
  });
});

test('with no language saved anywhere the app reads English and writes nothing', () => {
  withStorage({}, (store, writes) => {
    assert.equal(Es.readLangKey(), 'en');
    assert.deepEqual(writes, []);
  });
});

// Task 16 (10/21): the plow note, the Pull from Shovel Command card and its dialog. Rows, each worked by hand; the
// sentences are rows whole (never a lucky word-by-word match). The shovel crew's map is "la cuadrilla de palas".
test('Pull from Shovel Command: the card, the buttons and the editor label are rows', () => {
  const rows = {
    'Plow note for drivers': 'Nota para los conductores',
    'Pull from Shovel Command': 'Traer de Shovel Command',
    'Preview': 'Vista previa',
    'Pull now': 'Traer ahora',
    "Copies the sites and snow piles from the shovel crew's map. Your plow notes and push arrows are kept.":
      'Copia los sitios y las pilas de nieve del mapa de la cuadrilla de palas. Se conservan tus notas de quitanieves y tus flechas de empuje.',
    'Pull when no truck is out: phones read Busy while it runs.':
      'Trae cuando no haya ningún camión afuera: los teléfonos leen Busy mientras corre.',
    "Couldn't open the shovel crew's Sheet:": 'No se pudo abrir la hoja de la cuadrilla de palas:',
    'Archived on the shovel side (not archived here):': 'Archivado del lado de palas (no archivado aquí):',
  };
  for (const [en, es] of Object.entries(rows)) {
    assert.equal(Es.translateString(en), es, en);
    assert.ok(en in Es.ES, 'a row: ' + en);
  }
  // The app's name inside the heading is a name: only the verb changes. A name after a row stays as typed.
  assert.equal(Es.translateString('Pull from Shovel Command'), 'Traer de Shovel Command');
  assert.equal(Es.translateString("Couldn't open the shovel crew's Sheet: Service error"), 'No se pudo abrir la hoja de la cuadrilla de palas: Service error');
});

// The preview line is ONE text node per group (lib/pull.js wraps each in its own span). Worked by hand: after the dictionary
// pass "Adds:" "Updates:" "Unchanged:" "Left out:" are Spanish and "sites" "piles" "pile" too; the lone singular "1 site" and
// the zones are left, and a rule anchored on the group's label finishes them (a bare "site" or "zone" row would also turn Matt's
// "Add site" and "New zone" into half Spanish, so there is none).
test('Pull from Shovel Command: the preview line reads Spanish group by group, singular and plural', () => {
  const cases = {
    'Adds: 2 sites, 3 piles': 'Agrega: 2 sitios, 3 pilas',
    'Updates: 1 site, 4 piles': 'Actualiza: 1 sitio, 4 pilas',
    'Unchanged: 5 sites, 1 pile': 'Sin cambios: 5 sitios, 1 pila',
    'Updates: 0 sites, 0 piles': 'Actualiza: 0 sitios, 0 pilas',
    'Left out: 7 zones': 'Se dejó fuera: 7 zonas',
    'Left out: 1 zone': 'Se dejó fuera: 1 zona',
    'Left out: 0 zones': 'Se dejó fuera: 0 zonas',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
  // The import summary shares "Left out:" and has no sites or zones in it: untouched by the rule, as the Task 14 test fixes.
  assert.equal(Es.translateString('Left out: 12 walks, 3 hand, 1 lot'), 'Se dejó fuera: 12 walks, 3 hand, 1 lot');
  // And the words stay English where the rule does not apply: Matt's buttons and hints.
  assert.equal(Es.translateString('Add site'), 'Add site');
  assert.equal(Es.translateString('New zone'), 'New zone');
  assert.equal(Es.translateString('Edit zone'), 'Edit zone');
  assert.equal(Es.translateString('To rename a site, use its Edit on the Sites tab.'), 'To rename a site, use its Edit on the Sitios tab.');
});

test('Pull from Shovel Command: the toast "Pulled: N added, M updated" is a rule, with the counts kept', () => {
  assert.equal(Es.translateString('Pulled: 5 added, 7 updated'), 'Traído: 5 agregado(s), 7 actualizado(s)');
  assert.equal(Es.translateString('Pulled: 0 added, 0 updated'), 'Traído: 0 agregado(s), 0 actualizado(s)');
  // Anchored: a sentence that merely contains the words is not touched.
  assert.equal(Es.translateString('Pulled: 5 added, 7 updated, 2 more'), 'Pulled: 5 added, 7 updated, 2 more');
  assert.equal(Es.translateString('He pulled: 5 added, 7 updated'), 'He pulled: 5 added, 7 updated');
});

// Task 17 (10/21): Matt's live view has a Download CSV button; the Gear log (and its Log tab) is gone. The button's text is its own
// text node, so it is one row, whole. The roster's own gear field ("Gear", "Cold-weather gear") is a card field and keeps its rows.
test('Plow Command: Download CSV reads Descargar CSV; no row is left for the Gear log screens', () => {
  assert.equal(Es.translateString('Download CSV'), 'Descargar CSV');
  assert.ok('Download CSV' in Es.ES, 'a row, not a lucky word-by-word match');
  // "CSV" alone is not a row: only the button's whole text is.
  assert.equal(Es.translateString('CSV'), 'CSV');
  for (const k of ['Gear on hand', 'none logged', 'Log entry', 'Nothing logged yet.', 'All workers', 'All types', '+ Entry', 'Log']) {
    assert.equal(k in Es.ES, false, 'a row for English the app no longer renders: ' + k);
  }
  // The card field stays.
  assert.equal(Es.translateString('Gear'), 'Equipo');
  assert.equal(Es.translateString('Cold-weather gear'), 'Equipo para el frío');
});

// Task 18 (Matt's wording, 10/22/26): the sentences he ruled, and the strings test/es-coverage.test.js found with no row. Each is a
// row (never a lucky word-by-word match), worked by hand: "Pulgadas desde la última pasada" = inches since the last pass of the plow.
test('Task 18: the ruled sentences and the strings the coverage test found read Spanish, each a row', () => {
  const rows = {
    'Every lot goes back to not plowed. Nothing already logged is deleted.': 'Cada estacionamiento vuelve a sin quitar. Nada de lo ya registrado se borra.',
    'Inches since the last plow': 'Pulgadas desde la última pasada',
    'Push snow this way': 'Empuja la nieve en esta dirección',
    // the Share button's toast and the dialog line over the link
    'Link copied. Paste it in a text.': 'Enlace copiado. Pégalo en un mensaje de texto.',
    'Copy this and text it:': 'Copia esto y envíalo por mensaje de texto:',
    // the lower-case tail of "Site card for PAC not saved: no signal" (the capital N row is a different, earlier phrase)
    'not saved:': 'no se guardó:',
  };
  for (const [en, es] of Object.entries(rows)) {
    assert.equal(Es.translateString(en), es, en);
    assert.ok(en in Es.ES, 'a row: ' + en);
  }
  // "Site card for" + the name + "not saved: " + "no signal": four pieces, three rows, the name between them as typed.
  assert.equal(Es.translateString('Site card for PAC not saved: no signal'), 'Tarjeta del sitio para PAC no se guardó: sin señal');
  assert.equal(Es.translateString('Not saved: no signal'), 'No se guardó: sin señal'); // the capital row still wins where it applies
});

test('Task 18: the crew is the cuadrilla in every row; equipo is the gear and the equipment', () => {
  for (const [en, es] of Object.entries(Es.ES)) {
    if (/\bcrew\b/i.test(en)) assert.equal(/\bequipo\b/i.test(es), false, 'a row says equipo for the crew: ' + en);
  }
  // The three rows that do say equipo are the gear field and the equipment minutes, not the crew.
  assert.deepEqual(Object.entries(Es.ES).filter(([, es]) => /\bequipo\b/i.test(es)).map(([en]) => en).sort(),
    ['Cold-weather gear', 'Equipment (minutes)', 'Gear']);
});

// "N sites ..." (Task 18): the bare row 'sites' is gone, so no phrase is half Spanish. Each rendered phrase is one anchored rule,
// singular and plural. Worked by hand: 1 -> "sitio", every other number (0 too) -> "sitios"; "route" the same -> "ruta"/"rutas".
test('Task 18: "N sites ..." phrases are whole-phrase rules; the bare word is no row', () => {
  const cases = {
    '2 sites not mapped yet': '2 sitios sin mapa todavía',      // the live view's snow-map card (lib/shiftlogui.js snowMapHtml)
    '1 site not mapped yet': '1 sitio sin mapa todavía',
    '2 sites on 2 routes': '2 sitios en 2 rutas',               // the live view's summary line, no storm open
    '1 site on 1 route': '1 sitio en 1 ruta',
    '12 sites on 1 route': '12 sitios en 1 ruta',
    '0 sites on 0 routes': '0 sitios en 0 rutas',
    '3 sites': '3 sitios',                                       // a route's count on the Routes list, alone in its span
    '1 site': '1 sitio',
    '0 sites': '0 sitios',
  };
  for (const [en, es] of Object.entries(cases)) assert.equal(Es.translateString(en), es, en);
  assert.equal('sites' in Es.ES, false, 'no bare row for sites');
  // Anchored: the words inside a longer sentence, and Matt's own words, are left alone.
  assert.equal(Es.translateString('sites'), 'sites');
  assert.equal(Es.translateString('Add site'), 'Add site');
  assert.equal(Es.translateString('Copies 2 sites on 2 routes now'), 'Copies 2 sites on 2 routes now');
  assert.equal(Es.translateString('He has 3 sites today'), 'He has 3 sites today');
  assert.equal(Es.translateString(' 3 sites'), ' 3 sitios'); // a text node's own space survives
});

// Task 18 fix round 1 (10/22/26): the server's refusals of an Undo. lib/shiftlog.js undoTarget answers these three; the phone
// prints the reason under the lot as "Not saved: <reason>" when a lead and a driver race an Undo. Rows AS THE SHARED FILE READS NOW
// (final wave M1, 10/22/26: "this lot since", in both repos; the old "walk" key went with it). The other two refusals in that
// file (checkTap) are never shown: the phone only sends the lot with plowed or problem.
test('Task 18 fix 1: the three Undo refusals the server sends read Spanish, each a row, after "Not saved:"', () => {
  const rows = {
    'Someone has tapped this lot since': 'Alguien ya tocó este estacionamiento desde entonces',
    'That tap is not in this storm': 'Ese toque no es de esta tormenta',
    'That cannot be undone': 'Eso no se puede deshacer',
  };
  for (const [en, es] of Object.entries(rows)) {
    assert.equal(Es.translateString(en), es, en);
    assert.ok(en in Es.ES, 'a row: ' + en);
    // as the phone prints it, in one text node with the "Not saved:" row in front of it
    assert.equal(Es.translateString('Not saved: ' + en), 'No se guardó: ' + es, 'after Not saved: ' + en);
  }
  // The two checkTap refusals are not rows: the phone never sends a tap that could earn them.
  assert.equal('Only the lot can be tapped' in Es.ES, false);
  assert.equal('State must be plowed or problem' in Es.ES, false);
});

// Task 18 fix 3 (10/22/26): the one-word scan found a label the crew read on every route card and on Tonight with no row.
// "Truck:" is the read-only truck line's label (the truck's own code follows in a bold node). Only with its colon: a bare 'Truck'
// would also turn the lead's toast "Truck saved" and the lead's box label into half Spanish.
test('Task 18 fix 3: the truck line reads Camión:, and the lead\'s truck words stay whole English', () => {
  assert.equal(Es.translateString('Truck:'), 'Camión:');
  assert.equal(Es.translateString('Truck: '), 'Camión: ');
  assert.ok('Truck:' in Es.ES, 'a row');
  assert.equal('Truck' in Es.ES, false, 'no bare Truck row');
  assert.equal(Es.translateString('Truck saved'), 'Truck saved');
  assert.equal(Es.translateString('Truck'), 'Truck');
  assert.equal(Es.translateString('Trucks for which shift?'), 'Trucks for which shift?');
});
