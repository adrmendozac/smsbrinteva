// Verification for the hosted-itinerary parsing contract
// (docs/hosted-itinerary-parsing.md). Run with: npm test
//
// These are pure-function tests plus the Unsplash calls exercised through the
// dependency-injection seam the app already uses (deps.axios / deps.db). No
// database is touched and no network request is made, so this suite is safe to
// run anywhere — the live-DB verification stays a separate, manual step.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const h = require('../lib/hosted');

const parse = body => h.parseBody(body);
const days = body => parse(body).sections.filter(s => s.type === 'day');

// ── Day headings ───────────────────────────────────────────────────────────

test('recognizes Spanish numbered headings', () => {
  for (const line of [
    'Día 1: Bangkok', 'Dia 2: Bangkok', 'DÍA 03 - Bangkok',
    'Día 4 — Chiang Mai', 'Día 5 → Phuket', '1er día: Bangkok', 'Primer día: Bangkok',
  ]) {
    assert.ok(h.matchDay(line), `should be a heading: ${line}`);
  }
});

test('recognizes English numbered headings', () => {
  for (const line of ['Day 1: Bangkok', 'DAY 02 - Bangkok', 'Day 3 — Chiang Rai', 'First day: Bangkok']) {
    assert.ok(h.matchDay(line), `should be a heading: ${line}`);
  }
});

test('recognizes the Spanish "Día 1.- MADRID" period-dash separator', () => {
  for (const line of ['Día 1.- MADRID', 'DIA 1.-MADRID', 'Día 2.– TOLEDO', 'Día 3.— SEVILLA']) {
    assert.ok(h.matchDay(line), `should be a heading: ${line}`);
  }
  assert.equal(h.matchDay('Día 1.- MADRID').place, 'MADRID');
  assert.equal(h.matchDay('11.09.2026.- MADRID').date, '11.09.2026');
  // The period is what makes the un-spaced dash safe; a bare interior hyphen
  // must still never split a place name.
  assert.equal(h.matchDay('Día 1: Baden-Baden').place, 'Baden-Baden');
  // A colon earlier in the line still wins (leftmost match).
  assert.equal(h.matchDay('Día 1: MADRID.- llegada temprano').place, 'MADRID.- llegada temprano');
});

test('period-dash prose is still not a day heading', () => {
  for (const line of [
    'Precio: $2.499.- por persona', 'Total 2.499.- USD', 'Hotel 4.- estrellas',
    'Fin de los servicios.- Traslado incluido',
  ]) {
    assert.equal(h.matchDay(line), null, `should NOT be a heading: ${line}`);
  }
});

// ── Word-less "1.- MADRID" headings ────────────────────────────────────────
// This shape carries no word marking it as a day, so it is decided per
// document rather than per line. See allowsBareNumberDays().

test('recognizes word-less numbered headings when the whole paste uses them', () => {
  const parsed = parse('1.- MADRID\nLlegada y traslado.\n2.- TOLEDO\nExcursión.');
  assert.equal(parsed.dayCount, 2);
  assert.equal(parsed.title, 'MADRID a TOLEDO');
  assert.deepEqual(parsed.sections.filter(s => s.type === 'day').map(s => s.place), ['MADRID', 'TOLEDO']);
  // The renderer still supplies exactly one sequential label.
  assert.equal(h.renderHostedPage({ body: '1.- MADRID\nLlegada.\n2.- TOLEDO\nTren.' }).match(/Día 1/g).length, 1);
});

test('word-less headings work with colon and spaced-dash separators too', () => {
  assert.equal(parse('1: MADRID\nLlegada.\n2: TOLEDO\nTren.').dayCount, 2);
  assert.equal(parse('1 - MADRID\nLlegada.\n2 - TOLEDO\nTren.').dayCount, 2);
});

test('bare numbers stay list items when the paste already has real day headings', () => {
  const parsed = parse('Día 1: LIMA\nItinerario:\n1 - Traslado\n2 - Cena');
  assert.equal(parsed.dayCount, 1);
  assert.deepEqual(parsed.sections[0].lines, ['Itinerario:', '1 - Traslado', '2 - Cena']);
  // Same when the recognized headings are weekdays rather than numbers.
  assert.equal(parse('lunes: MADRID\nLlegada.\n1 - Traslado\n2 - Cena').dayCount, 1);
});

test('bare numbers are rejected without a consistent day-numbered run', () => {
  assert.equal(parse('1.- MADRID\nLlegada.\nAlojamiento.').dayCount, 0, 'one candidate is not a style');
  assert.equal(parse('3.- MADRID\nx\n4.- TOLEDO\ny').dayCount, 0, 'must start at 1');
  assert.equal(parse('1.- MADRID\nx\n2.- TOLEDO\ny\n7.- SEVILLA\nz').dayCount, 0, 'must be consecutive');
});

test('a numbered inclusion list is never read as an itinerary', () => {
  assert.equal(parse('Incluye:\n1.- Traslados\n2.- Desayunos').dayCount, 0);
  // Nor are numbered items inside an inclusion run that follows real days.
  const parsed = parse('1.- LIMA\nLlegada.\n2.- CUSCO\nTren.\nIncluye:\n1.- Traslados\n2.- Desayunos');
  assert.equal(parsed.dayCount, 2);
  assert.deepEqual(
    parsed.sections.find(s => s.type === 'inclusions').included,
    ['Traslados', 'Desayunos'],
    'the "1.-" prefix is stripped whole, leaving no orphan dash'
  );
});

test('long numbered lines are services, not destinations', () => {
  assert.equal(parse([
    '1.- Traslados de llegada y salida del aeropuerto principal en Dubái',
    '2.- Espectáculo Noche Turca en Capadocia, sólo en la opción -SI',
  ].join('\n')).dayCount, 0);
});

test('word-less itineraries keep the unmarked-reset guard', () => {
  assert.equal(
    h.classifyItineraries('1.- MADRID\nx\n2.- TOLEDO\ny\n1.- LIMA\nz\n2.- CUSCO\nw').kind,
    'ambiguous'
  );
  assert.equal(h.classifyItineraries('1.- MADRID\nx\n2.- TOLEDO\ny').kind, 'single');
  // The style is decided for the whole paste, so a short first block after an
  // explicit marker is still parsed with word-less headings enabled.
  assert.equal(
    h.classifyItineraries('1.- MADRID\nLlegada.\n--- NUEVO ITINERARIO ---\n1.- LIMA\nx\n2.- CUSCO\ny').kind,
    'explicit-appended'
  );
});

test('recognizes Spanish weekday headings and keeps their date text', () => {
  assert.equal(h.matchDay('viernes, 11 de septiembre de 2026: Roma').date, 'viernes, 11 de septiembre de 2026');
  assert.equal(h.matchDay('Sábado 12 de septiembre — Florencia').place, 'Florencia');
  assert.equal(h.matchDay('lunes: Madrid').place, 'Madrid');
});

test('recognizes English weekday headings', () => {
  assert.equal(h.matchDay('Friday, September 11, 2026: Rome').place, 'Rome');
  assert.equal(h.matchDay('Saturday, 12 September — Florence').place, 'Florence');
  assert.equal(h.matchDay('Monday: Madrid').place, 'Madrid');
});

test('recognizes numeric date headings only with a separator and a place', () => {
  assert.equal(h.matchDay('2026-09-11: Rome').place, 'Rome');
  assert.equal(h.matchDay('09/11/2026 — Rome').place, 'Rome');
  assert.equal(h.matchDay('11/09/2026 — Roma').place, 'Roma');
  assert.equal(h.matchDay('2026-09-11'), null, 'a bare date is not a heading');
});

test('heading-like prose stays paragraph text', () => {
  for (const line of [
    'visit on Monday', 'day 1 of the conference', 'call at 09/11/2026',
    'Desayuno. Día libre para disfrutar de las playas.',
    'Alojamiento.', 'Llegada a Roma y traslado al hotel.',
  ]) {
    assert.equal(h.matchDay(line), null, `should NOT be a heading: ${line}`);
  }
});

// ── Separator-less "glued" numbered headings ───────────────────────────────
// The day token and its place can share one line with nothing but
// whitespace between them and no colon/dash right after the number at all —
// "Día 1 Toronto", "Día 2 Toronto - Toronto" (a real production example).

test('recognizes a day token glued directly to its place with no separator', () => {
  assert.deepEqual(h.matchDay('Día 1 Toronto'), { label: null, date: null, place: 'Toronto' });
  assert.deepEqual(h.matchDay('Day 2 Bangkok'), { label: null, date: null, place: 'Bangkok' });
});

test('a glued place keeps its own interior route dash intact', () => {
  // The dash here belongs to the place/route, not to a heading separator —
  // it must not truncate the place the way an ordinary separator would.
  assert.equal(h.matchDay('Día 2 Toronto - Toronto').place, 'Toronto - Toronto');
  assert.equal(h.matchDay('Día 5 Cataratas Niagara - Toronto').place, 'Cataratas Niagara - Toronto');
});

test('glued headings still reject prose, not just a bare day token', () => {
  for (const line of [
    'Día 1 llegada al hotel y traslado',                    // lowercase: not a proper noun
    'Day 1 of the conference was incredible',               // lowercase, and too long
    'Día 1 Un Recorrido Muy Largo Por La Ciudad Completa',  // too many words
  ]) {
    assert.equal(h.matchDay(line), null, `should NOT be a heading: ${line}`);
  }
});

test('parses a real separator-less 5-day paste (Toronto/Niagara)', () => {
  const body = [
    'Día 1 Toronto',
    'Llegada por su cuenta.',
    'Día 2 Toronto - Toronto',
    'Recorrido por la ciudad.',
    'Día 3 Toronto - Cataratas Niagara',
    'Traslado a las cataratas.',
    'Día 4 Cataratas Niagara - Cataratas Niagara',
    'Excursión guiada.',
    'Día 5 Cataratas Niagara - Toronto',
    'Regreso al aeropuerto.',
  ].join('\n');
  const parsed = parse(body);
  assert.equal(parsed.dayCount, 5);
  assert.deepEqual(days(body).map(d => d.place), [
    'Toronto', 'Toronto - Toronto', 'Toronto - Cataratas Niagara',
    'Cataratas Niagara - Cataratas Niagara', 'Cataratas Niagara - Toronto',
  ]);
  // Before this fix, no line matched matchDay() at all, dayCount was 0, and
  // the literal first line "Día 1 Toronto" became the title verbatim.
  assert.notEqual(parsed.title, 'Día 1 Toronto');
});

test('the unmarked-reset guard still fires for glued headings', () => {
  // sourceDayNumber() must recognize the same day 1 this heading style
  // produces, or two appended tours with no marker would silently merge.
  assert.equal(
    h.classifyItineraries('Día 1 Roma\nx\nDía 2 Pisa\ny\nDía 1 París\nz').kind,
    'ambiguous'
  );
});

test('numbered headings do not print the day label twice', () => {
  // label stays null so the renderer supplies exactly one sequential "Día N".
  assert.equal(h.matchDay('Día 1: BANGKOK').label, null);
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });
  assert.equal(html.match(/Día 1/g).length, 1);
});

test('keeps all days expanded and provides an expand-collapse control', () => {
  const html = h.renderHostedPage({ body: 'Día 1: ROMA\nLlegada.\nDía 2: PISA\nVisita.' });
  assert.match(html, /<details class="day-details" open><summary>[\s\S]*?Día 1/);
  assert.match(html, /<details class="day-details" open><summary>[\s\S]*?Día 2/);
  assert.match(html, /data-toggle-details data-expand-label="Expandir" data-collapse-label="Comprimir" aria-expanded="true">Comprimir/);
  assert.match(html, /\.day-details\[open\] summary::after\{content:'−'\}/);
  assert.match(html, /\.day-details:not\(\[open\]\) \.day-content\{display:block\}/);
});

// ── Structure ──────────────────────────────────────────────────────────────

test('parses consecutive days with no blank lines between them', () => {
  const body = ['Día 1: BANGKOK', 'Llegada.', 'Día 2: BANGKOK', 'Desayuno.',
    'Día 3: BANGKOK - CHIANG RAI', 'Vuelo.'].join('\n');
  const d = days(body);
  assert.equal(d.length, 3);
  assert.equal(d[0].place, 'BANGKOK');
  assert.equal(d[2].place, 'BANGKOK - CHIANG RAI');
});

test('classifies an explicit same-client itinerary append and preserves its blocks', () => {
  const body = [
    'Día 1: ROMA', 'Llegada.',
    '--- NUEVO ITINERARIO ---',
    'Día 1: PARÍS', 'Llegada.', 'Día 2: LYON', 'Tren.',
  ].join('\n');
  const result = h.classifyItineraries(body);
  assert.equal(result.kind, 'explicit-appended');
  assert.equal(result.blocks.length, 2);
  assert.equal(parse(result.blocks[0]).dayCount, 1);
  assert.equal(parse(result.blocks[1]).dayCount, 2);
});

test('rejects an unmarked source-day reset and malformed explicit boundaries', () => {
  assert.equal(h.classifyItineraries('Día 1: ROMA\nDía 2: PISA\nDía 1: PARÍS').kind, 'ambiguous');
  assert.equal(h.classifyItineraries('Día 1: ROMA\n--- NUEVO ITINERARIO ---\nPendiente').kind, 'invalid-marker');
});

test('an appended itinerary renders each tour with its own Día 1', () => {
  const html = h.renderHostedPage({
    body: 'Día 1: ROMA\nLlegada.\n--- NUEVO ITINERARIO ---\nDía 1: PARÍS\nLlegada.',
  });
  assert.equal(html.match(/Día 1/g).length, 2);
  assert.doesNotMatch(html, /NUEVO ITINERARIO/);
  assert.match(html, /class="itinerary-tour-label">Itinerario 2<\/p>/);
  assert.match(html, /ROMA/);
  assert.match(html, /PARÍS/);
});

test('parses and renders Spanish included and excluded lists after an itinerary', () => {
  const body = [
    'Día 1: DUBÁI',
    'Llegada.',
    'INCLUYE:',
    '• Traslados de llegada y salida.',
    '• 12 noches de alojamiento.',
    'NO INCLUYE:',
    '• Bebidas no incluidas en las comidas.',
    '• Visado no incluido.',
  ].join('\n');
  const parsed = parse(body);
  const inclusions = parsed.sections.find(section => section.type === 'inclusions');

  assert.deepEqual(inclusions.included, ['Traslados de llegada y salida.', '12 noches de alojamiento.']);
  assert.deepEqual(inclusions.excluded, ['Bebidas no incluidas en las comidas.', 'Visado no incluido.']);

  const html = h.renderHostedPage({ body });
  assert.match(html, /class="inclusions-column inclusions-column--included"/);
  assert.match(html, /class="inclusions-column inclusions-column--excluded"/);
  assert.match(html, /svgs\/solid\/circle-check\.svg/);
  assert.match(html, /svgs\/solid\/ban\.svg/);
  assert.match(html, /12 noches de alojamiento/);
  assert.match(html, /Visado no incluido/);
});

test('recognizes inline Spanish inclusion headings without spaces after a sentence', () => {
  const body = 'Día 12: ESTAMBUL\nFin de los servicios.Incluye: Traslado del hotel.No incluye: Visado y bebidas.';
  const parsed = parse(body);
  const inclusions = parsed.sections.find(section => section.type === 'inclusions');

  assert.equal(parsed.sections[0].lines[0], 'Fin de los servicios.');
  assert.deepEqual(inclusions.included, ['Traslado del hotel.']);
  assert.deepEqual(inclusions.excluded, ['Visado y bebidas.']);
});

test('a trailing inline heading switches state for the following lines', () => {
  const body = [
    'Día 1: BANGKOK',
    'Llegada.',
    'Incluye: Traslado del hotel.No incluye:',
    '• Visado',
    '• Propinas',
  ].join('\n');
  const parsed = parse(body);
  const inclusions = parsed.sections.find(section => section.type === 'inclusions');

  assert.deepEqual(inclusions.included, ['Traslado del hotel.']);
  assert.deepEqual(inclusions.excluded, ['Visado', 'Propinas']);
});

test('prose before a trailing inline heading stays day content, items follow the heading', () => {
  const body = [
    'Día 1: BANGKOK',
    'Fin de los servicios.Incluye:',
    '• Traslados',
    '• Desayunos',
  ].join('\n');
  const parsed = parse(body);
  const inclusions = parsed.sections.find(section => section.type === 'inclusions');

  assert.equal(parsed.sections[0].lines[0], 'Fin de los servicios.');
  assert.deepEqual(inclusions.included, ['Traslados', 'Desayunos']);
  assert.deepEqual(inclusions.excluded, []);
});

test('keeps ordinary Spanish inclusion prose as itinerary content', () => {
  const parsed = parse('Día 1: ROMA\nEl paquete incluye traslado del hotel.');
  assert.equal(parsed.sections.some(section => section.type === 'inclusions'), false);
  assert.equal(parsed.sections[0].lines[0], 'El paquete incluye traslado del hotel.');
});

test('retains option hyphens in inclusion items', () => {
  const parsed = parse('Día 1: ROMA\nIncluye\n• Espectáculo, sólo en la opción -SI.');
  const inclusions = parsed.sections.find(section => section.type === 'inclusions');
  assert.equal(inclusions.included[0], 'Espectáculo, sólo en la opción -SI.');
});

test('parses days separated by blank lines', () => {
  const body = 'MI VIAJE\n\nDía 1: ROMA\n\nLlegada.\n\nDía 2: FLORENCIA\n\nTren.';
  const parsed = parse(body);
  assert.equal(parsed.title, 'MI VIAJE');
  assert.equal(parsed.dayCount, 2);
});

test('tolerates mixed capitalization and missing accents', () => {
  const d = days('DIA 1: bangkok\nTexto.\ndía 2: BANGKOK\nTexto.\nDía 3: Phuket\nTexto.');
  assert.equal(d.length, 3);
});

test('normalizes CRLF and lone CR line endings', () => {
  assert.equal(days('Día 1: ROMA\r\nLlegada.\r\nDía 2: PISA\r\nTren.').length, 2);
  assert.equal(days('Día 1: ROMA\rLlegada.\rDía 2: PISA\rTren.').length, 2);
});

// ── Input normalization ────────────────────────────
// The stored body stays byte-for-byte as the seller sent it; only the parser's
// working copy is normalized. Invisible characters are written as escapes here,
// never as literals: a literal separator in source is unreviewable and one
// editor round-trip can silently turn it into an ordinary space.

test('normalizes the working copy to NFC without losing Unicode content', () => {
  // macOS and Word both emit NFD: "D\u00eda" arrives as d + i + U+0301 + a.
  const decomposed = 'Di\u0301a 1: SAO PAULO\nCafe\u0301, \u6771\u4eac, \u20ac1.250';
  const parsed = parse(decomposed);
  assert.equal(parsed.dayCount, 1);
  assert.equal(parsed.sections[0].lines[0], 'Caf\u00e9, \u6771\u4eac, \u20ac1.250');
  assert.equal(parsed.sections[0].lines[0], parsed.sections[0].lines[0].normalize('NFC'));
});

test('normalizes every supported line separator to LF', () => {
  // CR and CRLF are the common pair; NEL, LS and PS arrive from word processors
  // and some webmail clients. All are line boundaries, and this parser is
  // line-based: gluing two day headings together destroys the structure.
  for (const [name, sep] of [
    ['CRLF', '\r\n'], ['CR', '\r'], ['NEL', '\u0085'],
    ['LS', '\u2028'], ['PS', '\u2029'],
  ]) {
    const body = `D\u00eda 1: ROMA${sep}Llegada.${sep}D\u00eda 2: PISA${sep}Tren.`;
    assert.equal(days(body).length, 2, `${name} must separate lines`);
  }
});

test('removes unsafe control characters but keeps meaningful invisibles', () => {
  const n = h.normalizeSellerText;
  assert.equal(n('D\u00eda 1: ROMA\u0000\nLlegada.\tHotel'), 'D\u00eda 1: ROMA\nLlegada.\tHotel');

  // Stateful bidi embeddings, overrides and isolates reorder visible text
  // against its logical order. In itinerary prose that is a spoofing
  // primitive, not writing.
  assert.equal(n('ROMA\u202eAMOR\u202c'), 'ROMAAMOR');
  assert.equal(n('a\u2066b\u2069c'), 'abc');
  assert.equal(n('a\u200bb\u00adc\ufeffd'), 'abcd');

  // ZWJ/ZWNJ join emoji sequences and are load-bearing in Arabic, Persian and
  // Indic scripts; LRM/RLM are directional marks that carry meaning in
  // mixed-direction text. Neither group is a stateful control.
  for (const keep of ['\u200c', '\u200d', '\u200e', '\u200f']) {
    assert.ok(n(`a${keep}b`).includes(keep), `must preserve ${JSON.stringify(keep)}`);
  }

  // The family emoji is a ZWJ sequence: strip the joiner and it breaks into
  // three separate glyphs.
  const rich = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467} \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u201cx\u201d \u20ac1,50 \u2014';
  assert.equal(n(rich), rich, 'emoji, non-Latin scripts, quotes and currency survive');
});

// ── Seller-wrapper grammar ──────────────────────────────────────────────────
// Anchored phrase-family matching, not a flat sentence list. Every case here
// must match the WHOLE line (or whole prefix, for the delivery clause): the
// presence of the word "itinerario" is never sufficient on its own.

test('matches every Spanish delivery family, singular and plural voice', () => {
  for (const line of [
    'Este es su itinerario', 'Esta es su itinerario', 'Aquí está su itinerario',
    'Aquí tiene su itinerario', 'Le comparto su itinerario', 'Te comparto tu itinerario',
    'Les compartimos el itinerario', 'Le envío su itinerario', 'Les enviamos el itinerario',
    'Le adjunto su itinerario', 'Les adjuntamos el itinerario',
    'Le hago llegar su itinerario', 'Les hacemos llegar el itinerario',
    'Aquí encontrará su itinerario', 'Aquí encontrarán el itinerario',
    'A continuación encontrará el itinerario', 'Encontrará su itinerario',
    'Este es su programa de viaje', 'Le comparto los detalles de su viaje',
  ]) {
    assert.ok(h.matchDeliveryClause(line), `should match: ${line}`);
  }
});

test('matches every English delivery family', () => {
  for (const line of [
    'This is your itinerary', 'Here is your itinerary', 'Attached is your itinerary',
    'I am sharing your itinerary', "I'm sharing your itinerary",
    'We are sending your itinerary', "We're sending the itinerary",
    'I am sharing your itinerary for your trip',
    'You will find your itinerary', "You'll find the itinerary",
    'Please find your itinerary below', 'Below you will find the itinerary',
    'This is the travel itinerary', 'Here is your travel itinerary',
  ]) {
    assert.ok(h.matchDeliveryClause(line), `should match: ${line}`);
  }
});

test('delivery clause matching is accent-insensitive and case-insensitive', () => {
  assert.ok(h.matchDeliveryClause('ESTE ES SU ITINERARIO'));
  assert.ok(h.matchDeliveryClause('aqui esta su itinerario'), 'missing accents');
  assert.ok(h.matchDeliveryClause('AQUÍ ESTÁ SU ITINERARIO'), 'accented and uppercase');
  assert.ok(h.matchDeliveryClause('Le   comparto   su   itinerario'), 'repeated whitespace');
});

test('accepts the documented terminal punctuation, rejects the rest', () => {
  for (const p of ['.', ',', ';', ':', '!', '—', '-']) {
    assert.ok(h.matchDeliveryClause(`Le comparto su itinerario${p}`), `should accept terminal ${p}`);
  }
  assert.equal(h.matchDeliveryClause('Le comparto su itinerario?'), false, 'rejects "?"');
  assert.equal(h.matchDeliveryClause('Le comparto su itinerario...'), false, 'rejects ellipsis');
  assert.ok(h.matchDeliveryClause('¡Le comparto su itinerario!'), 'paired leading ¡ with trailing !');
  assert.equal(h.matchDeliveryClause('¡Le comparto su itinerario'), false, 'unpaired leading ¡ is rejected');
});

test('rejects trip-specific modifiers, prices, dates, and instructions', () => {
  for (const line of [
    'Le comparto el itinerario de aniversario para Ana y Luis',
    'Le comparto el itinerario con el precio final',
    'El itinerario incluye vuelos y hotel',
    'Revisar el itinerario antes de emitir',
    'Itinerary price: $3,400',
    'Call me if the itinerary needs changes',
    'Este es el itinerario: sujeto a disponibilidad',
    'Le comparto su itinerario para el viaje a Cancún',
  ]) {
    assert.equal(h.matchDeliveryClause(line), false, `should NOT match: ${line}`);
  }
});

test('recognizes greetings with accented, apostrophed, hyphenated, and non-Latin names', () => {
  for (const line of [
    'Hola', 'Hola Ana', 'Buen día', 'Buenos días, Ana', 'Buenas tardes',
    'Estimado cliente', 'Estimada Ana', 'Estimada María José',
    "Estimada O'Neil", 'Estimada Pérez-Ruiz', 'Estimado Sr. Müller',
    'Hello', 'Hello Ana', 'Good morning', 'Good afternoon, Ana',
    'Dear customer', 'Dear Ana', 'Hello 李雷', 'Estimado 王芳',
  ]) {
    assert.ok(h.matchGreeting(line), `should be a greeting: ${line}`);
  }
});

test('rejects greeting-like lines that are not a bounded greeting', () => {
  for (const line of [
    'Holanda es un país precioso', 'Hola, aquí van los precios: $3,400',
    'Dear Sir or Madam, please review the attached quote at http://example.com',
    'Hola ' + 'x'.repeat(90),
  ]) {
    assert.equal(h.matchGreeting(line), false, `should NOT be a greeting: ${line}`);
  }
});

test('classifies a bounded courtesy line only in the reviewed set', () => {
  for (const line of [
    'Espero que se encuentre bien', 'Esperamos que se encuentre bien',
    'Espero que estés bien', 'I hope you are well', 'We hope you are well.',
  ]) {
    const wrapper = h.matchSellerWrapper([line, 'Le comparto su itinerario:', 'Día 1: ROMA']);
    assert.equal(wrapper, null, 'a courtesy line alone (no greeting) is not a wrapper start');
  }
});

test('matchSellerWrapper consumes exactly the wrapper lines it recognizes', () => {
  const one = h.matchSellerWrapper(['Le comparto su itinerario:', 'Día 1: BANGKOK']);
  assert.equal(one.consumed, 1);
  assert.equal(one.display, 'Le comparto su itinerario:');

  const two = h.matchSellerWrapper(['Hola Ana,', 'Le comparto su itinerario:', 'Día 1: ROMA']);
  assert.equal(two.consumed, 2);
  assert.equal(two.display, 'Hola Ana,\nLe comparto su itinerario:');

  const three = h.matchSellerWrapper([
    'Buenos días, Sra. O\'Connor,', 'Espero que se encuentre bien.',
    'Le comparto su itinerario:', 'Día 1: MADRID',
  ]);
  assert.equal(three.consumed, 3);
  assert.equal(three.display, "Buenos días, Sra. O'Connor,\nEspero que se encuentre bien.\nLe comparto su itinerario:");

  const combined = h.matchSellerWrapper(['Hola Ana, le comparto su itinerario:', 'Día 1: BANGKOK']);
  assert.equal(combined.consumed, 1);
  assert.equal(combined.display, 'Hola Ana, le comparto su itinerario:');

  assert.equal(h.matchSellerWrapper(['Viaje de aniversario para Ana y Luis', 'Día 1: ROMA']), null);
  assert.equal(h.matchSellerWrapper(['Hola Ana', 'Día 1: ROMA']), null, 'greeting alone is not a wrapper');
});

// ── Boundary-first parsing: parseBody() gains `preamble` ───────────────────
// The wrapper grammar from the previous block is exercised in isolation.
// These tests wire it into parseBody() around the first recognized day.

test('no leading content: parseBody behaves exactly as before', () => {
  const parsed = parse('Día 1: BANGKOK\nLlegada.');
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.title, 'BANGKOK');
  assert.equal(parsed.dayCount, 1);
});

test('a suppressible wrapper alone becomes preamble; the day supplies the title', () => {
  const parsed = parse('Le comparto su itinerario:\nDía 1: BANGKOK\nLlegada.');
  assert.equal(parsed.preamble, 'Le comparto su itinerario:');
  assert.equal(parsed.title, 'BANGKOK');
  assert.equal(parsed.dayCount, 1);
});

test('meaningful leading content is kept as the title, never classified as a wrapper', () => {
  const parsed = parse('Viaje de aniversario para Ana y Luis\nDía 1: ROMA\nLlegada.');
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.title, 'Viaje de aniversario para Ana y Luis');
  assert.equal(parsed.dayCount, 1);
});

test('wrapper plus a meaningful title: the wrapper is suppressed, the title survives', () => {
  const parsed = parse('Le comparto su itinerario:\nMARAVILLAS DE ITALIA\nDía 1: ROMA\nLlegada.');
  assert.equal(parsed.preamble, 'Le comparto su itinerario:');
  assert.equal(parsed.title, 'MARAVILLAS DE ITALIA');
  assert.equal(parsed.dayCount, 1);
});

test('multi-line wrapper plus a title', () => {
  const body = 'Hola Ana,\nLe comparto su itinerario:\nMARAVILLAS DE ITALIA\nDía 1: ROMA\nLlegada.';
  const parsed = parse(body);
  assert.equal(parsed.preamble, 'Hola Ana,\nLe comparto su itinerario:');
  assert.equal(parsed.title, 'MARAVILLAS DE ITALIA');
  assert.equal(parsed.dayCount, 1);
});

test('unknown leading prose is preserved as an ordinary text section', () => {
  const parsed = parse('ENCABEZADO\nNota introductoria.\nDía 1: ROMA\nLlegada.');
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.title, 'ENCABEZADO');
  const html = h.renderHostedPage({ body: 'ENCABEZADO\nNota introductoria.\nDía 1: ROMA\nLlegada.' });
  assert.match(html, /Nota introductoria\./);
});

test('a greeting is classified only when paired with a delivery clause', () => {
  const parsed = parse('Hola Ana\nDía 1: ROMA\nLlegada.');
  assert.equal(parsed.preamble, null, 'a lone greeting is not suppressible');
  assert.equal(parsed.title, 'Hola Ana');
  assert.equal(parsed.dayCount, 1);
});

test('recognizes wrappers before Spanish and English day headings', () => {
  const es = parse('Le comparto su itinerario:\nDía 1: BANGKOK\nLlegada.');
  assert.equal(es.preamble, 'Le comparto su itinerario:');

  const en = parse('Please find your itinerary below\nDay 1: London\nArrival.');
  assert.equal(en.preamble, 'Please find your itinerary below');
  assert.equal(en.title, 'London');
});

test('a single combined greeting-plus-delivery line splits correctly', () => {
  const parsed = parse('Hola Ana, le comparto su itinerario:\nDía 1: BANGKOK\nLlegada.');
  assert.equal(parsed.preamble, 'Hola Ana, le comparto su itinerario:');
  assert.equal(parsed.title, 'BANGKOK');
  assert.equal(parsed.dayCount, 1);
});

test('a combined greeting may contain its own comma before the delivery clause', () => {
  for (const [body, preamble, title] of [
    ['Buenos días, Ana, le comparto su itinerario:\nDía 1: ROMA\nLlegada.',
      'Buenos días, Ana, le comparto su itinerario:', 'ROMA'],
    ['Good morning, Ana, please find your itinerary below:\nDay 1: London\nArrival.',
      'Good morning, Ana, please find your itinerary below:', 'London'],
  ]) {
    const parsed = parse(body);
    assert.equal(parsed.preamble, preamble);
    assert.equal(parsed.title, title);
    assert.equal(parsed.dayCount, 1);
  }
});

// ── Bounded inline wrappers ─────────────────────────────────────────────────
// "Hola Ana, le comparto su itinerario: Día 1: BANGKOK" — the day heading and
// its wrapper share one line. A split is valid only when BOTH independently
// validate: the prefix against the complete wrapper grammar, the suffix
// against matchDay(). That double validation, not the terminator character
// itself, is what keeps this from corrupting a hyphenated place name.

test('splits a Spanish inline wrapper at the colon before the day heading', () => {
  const parsed = parse('Le comparto su itinerario: Día 1: BANGKOK\nLlegada.');
  assert.equal(parsed.preamble, 'Le comparto su itinerario:');
  assert.equal(parsed.title, 'BANGKOK');
  assert.equal(parsed.dayCount, 1);
});

test('splits an English inline wrapper', () => {
  const parsed = parse('Please find your itinerary below: Day 1: London\nArrival.');
  assert.equal(parsed.preamble, 'Please find your itinerary below:');
  assert.equal(parsed.title, 'London');
  assert.equal(parsed.dayCount, 1);
});

test('splits a greeting-prefixed inline wrapper', () => {
  const parsed = parse('Hola Ana, le comparto su itinerario: Día 1: BANGKOK\nLlegada.');
  assert.equal(parsed.preamble, 'Hola Ana, le comparto su itinerario:');
  assert.equal(parsed.title, 'BANGKOK');
  assert.equal(parsed.dayCount, 1);
});

test('splits at a dash or em-dash terminator, not just a colon', () => {
  const dash = parse('Le comparto su itinerario - Día 1: Madrid\nLlegada.');
  assert.equal(dash.preamble, 'Le comparto su itinerario -');
  assert.equal(dash.title, 'Madrid');

  const emdash = parse('Le comparto su itinerario — Día 1: Madrid\nLlegada.');
  assert.equal(emdash.preamble, 'Le comparto su itinerario —');
  assert.equal(emdash.title, 'Madrid');
});

test('does not split when the suffix is not a valid day heading', () => {
  const parsed = parse('Le comparto su itinerario: pendiente de confirmación');
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.title, 'Le comparto su itinerario: pendiente de confirmación');
  assert.equal(parsed.dayCount, 0);
});

test('does not split when the prefix is meaningful text, not a wrapper', () => {
  const parsed = parse('Viaje de Ana: Día 1: ROMA\nLlegada.');
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.title, 'Viaje de Ana: Día 1: ROMA');
});

test('does not split at a period — only :, —, or - are inline terminators', () => {
  const parsed = parse('Le comparto su itinerario. Día 1: ROMA\nLlegada.');
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.title, 'Le comparto su itinerario. Día 1: ROMA');
});

test('evaluates many colons right to left and still finds the valid split', () => {
  // The day heading itself supplies one of the colons; the correct split is
  // the wrapper's own terminator, several colons to the left of it.
  const parsed = parse('Le comparto su itinerario: Día 1: A: B: C: D: E\nLlegada.');
  assert.equal(parsed.preamble, 'Le comparto su itinerario:');
  assert.equal(parsed.dayCount, 1);
});

test('caps the number of terminator candidates it evaluates', () => {
  // The wrapper's own colon is the only valid split point. Padding the DAY
  // side with 8 more colons (harmless — matchDay() only looks at the first
  // separator in a line, so they just become trailing place text) pushes the
  // wrapper's colon to 9th-from-the-right, one past the evaluated bound. The
  // line is correctly left unsplit rather than rescanned without bound.
  const padded = 'Le comparto su itinerario: Día 1: A: B: C: D: E: F: G: H';
  assert.equal(h.matchDay('Día 1: A: B: C: D: E: F: G: H').place, 'A: B: C: D: E: F: G: H',
    'sanity check: the padding is valid place text, not itself a parsing failure');
  assert.equal(h.splitInlineWrapper(padded), null,
    "the wrapper's own colon is 9th-from-the-right and out of the evaluated bound");
});

test('bounds the inline prefix to 500 characters', () => {
  const long = 'Le comparto su itinerario: ' + 'x'.repeat(500) + ': Día 1: ROMA';
  assert.equal(h.splitInlineWrapper(long), null);
});

test('the day parsed from an inline split is identical to parsing it standalone', () => {
  const inline = parse('Le comparto su itinerario: Día 1: BANGKOK\nLlegada.');
  const standalone = parse('Día 1: BANGKOK\nLlegada.');
  assert.deepEqual(inline.sections, standalone.sections);
});

// ── Preservation and rendering safety across every wrapper shape ───────────

test('line accounting holds for standalone, multi-line, inline, unknown, no-day, and 30-day input', () => {
  const bodies = [
    'Le comparto su itinerario:\nDía 1: BANGKOK\nLlegada.',
    'Hola Ana,\nLe comparto su itinerario:\nDía 1: ROMA\nLlegada.',
    'Le comparto su itinerario: Día 1: BANGKOK\nLlegada.',
    'ENCABEZADO\nNota introductoria.\nDía 1: ROMA\nLlegada.',
    'Le comparto su itinerario:\nPendiente de confirmación.',
    Array.from({ length: 30 }, (_, i) => `Día ${i + 1}: CIUDAD ${i + 1}\nActividad ${i + 1}.`).join('\n'),
  ];
  for (const body of bodies) assertLossless(body, parse(body));
});

test('wrapper-looking HTML remains inert plain text', () => {
  const html = h.renderHostedPage({
    body: 'Este es su itinerario: <script>alert(1)</script>',
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('a recipient name with an apostrophe, ampersand, or angle bracket is escaped, not executed', () => {
  const html = h.renderHostedPage({
    body: "Buenos días, Sra. O'Connor <img onerror=alert(1)>,\nEspero que se encuentre bien.\nLe comparto su itinerario:\nDía 1: ROMA\nLlegada & bienvenida.",
  });
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.match(html, /Llegada &amp; bienvenida\./);
  assert.match(html, /O&#39;Connor/);
});

test('destination extraction and hero resolution are unchanged for standalone and multi-line wrappers', () => {
  // Day recognition does not move for these shapes: the wrapper occupies its
  // own line(s) before the day heading either way.
  const withWrapper = parse('Le comparto su itinerario:\nDía 1: BANGKOK\nLlegada.');
  const withoutWrapper = parse('Día 1: BANGKOK\nLlegada.');
  assert.equal(h.extractDestination(withWrapper), h.extractDestination(withoutWrapper));
  assert.equal(h.extractDestination(withWrapper), 'BANGKOK');
});

test('an inline wrapper newly resolves a destination that did not resolve before this change', () => {
  // Before Task 5, matchDay() failed on the whole combined line, so dayCount
  // was 0 and extractDestination() returned null. It now finds the day and
  // resolves BANGKOK, so a hero lookup fires that previously never happened.
  const inline = parse('Hola Ana, le comparto su itinerario: Día 1: BANGKOK\nLlegada.');
  assert.equal(inline.dayCount, 1);
  assert.equal(h.extractDestination(inline), 'BANGKOK');
});

test('the link SMS carries the itinerary title, not the seller wrapper', () => {
  const env = { PUBLIC_BASE_URL: 'https://sms.brintevaworlds.com' };
  const parsed = parse('Le comparto su itinerario:\nDía 1: BANGKOK\nLlegada.');
  // This mirrors how index.js builds the outgoing SMS: buildLinkSms() is fed
  // parsed.title, not the raw seller text.
  const sms = h.buildLinkSms(env, parsed.title, 'k7mp2q9xrt');
  assert.match(sms, /^BANGKOK: https:\/\//);
  assert.doesNotMatch(sms, /itinerario/i);
});

const sellerFixtures = require('./fixtures/hosted-seller-input.json');

test('fixture corpus: synthetic seller wrappers parse to the documented contract', () => {
  for (const { lines, expect: want, note } of sellerFixtures) {
    const parsed = parse(lines.join('\n'));
    if ('preamble' in want) assert.equal(parsed.preamble, want.preamble, note);
    if ('title' in want) assert.equal(parsed.title, want.title, note);
    if ('dayCount' in want) assert.equal(parsed.dayCount, want.dayCount, note);
  }
});

// ── No-boundary fallback is provably lossless ──────────────────────────────
// Invariant 6: with no recognized day anywhere, `preamble` stays null and the
// wrapper grammar never runs — a phrase that looks exactly like a wrapper
// must not vanish just because no itinerary happened to follow it.

// Every non-empty normalized line must appear in title/preamble/section text,
// and in the same relative order as the input.
// A numbered day heading like "Día 1: BANGKOK" is never stored verbatim —
// only place: 'BANGKOK' survives, because the renderer supplies the "Día N"
// label itself and printing the source label too would show it twice (see
// matchDay()'s comment). So containment here is bidirectional, matching the
// pre-existing "loses no non-empty line" test's approach: a body line counts
// as preserved if it appears in a parsed value, OR a parsed value (the
// heading's date/place fragment) appears in the body line.
function assertLossless(body, parsed) {
  // A multi-line wrapper's `preamble` joins several original body lines into
  // ONE string ("Hola Ana,\nLe comparto su itinerario:"). Split every
  // candidate back into individual lines so each original body line has its
  // own entry to match against, at its own position in the order check.
  const values = [];
  const pushLines = value => {
    if (!value) return;
    for (const piece of String(value).split('\n')) if (piece) values.push(piece);
  };
  pushLines(parsed.title);
  pushLines(parsed.preamble);
  for (const s of parsed.sections) {
    pushLines(s.date);
    pushLines(s.place);
    s.lines.forEach(pushLines);
  }

  let lastIndex = -1;
  for (const line of body.split('\n').map(l => l.trim()).filter(Boolean)) {
    const idx = values.findIndex((v, i) => i > lastIndex && (v.includes(line) || line.includes(v)));
    assert.ok(idx !== -1, `line missing (or out of order) from parse output: ${line}`);
    lastIndex = idx;
  }
}

test('a wrapper as the entire body is restored as ordinary title text', () => {
  const parsed = parse('Le comparto su itinerario:');
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.title, 'Le comparto su itinerario:');
  assert.equal(parsed.dayCount, 0);
  assert.equal(parsed.sections.length, 0);
});

test('a wrapper followed by one prose line has no day, so nothing is suppressed', () => {
  const body = 'Le comparto su itinerario:\nPendiente de confirmación.';
  const parsed = parse(body);
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.dayCount, 0);
  assertLossless(body, parsed);
});

test('a wrapper followed by several prose lines has no day, so nothing is suppressed', () => {
  const body = [
    'Le comparto su itinerario:',
    'Pendiente de confirmación',
    'Te llamaremos mañana.',
    'Gracias por su paciencia.',
  ].join('\n');
  const parsed = parse(body);
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.dayCount, 0);
  assertLossless(body, parsed);
});

test('a greeting plus delivery clause with no day heading is fully restored', () => {
  const body = 'Hola Ana,\nLe comparto su itinerario:\nPendiente de confirmación.';
  const parsed = parse(body);
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.dayCount, 0);
  assertLossless(body, parsed);
});

test('malformed heading-like text after a wrapper stays visible, not suppressed', () => {
  const body = 'Le comparto su itinerario:\nday 1 of the conference\ncall at 09/11/2026';
  const parsed = parse(body);
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.dayCount, 0);
  assertLossless(body, parsed);
});

test('no-boundary fallback never invokes the wrapper grammar', () => {
  // A three-line shape that WOULD match the greeting+courtesy+delivery grammar
  // if a day followed it. With no day anywhere, invariant 6 means the wrapper
  // path is never even consulted — every line renders as ordinary text.
  const body = [
    "Buenos días, Sra. O'Connor,",
    'Espero que se encuentre bien.',
    'Le comparto su itinerario:',
  ].join('\n');
  const parsed = parse(body);
  assert.equal(parsed.preamble, null);
  assert.equal(parsed.dayCount, 0);
  assertLossless(body, parsed);
});

test('free-form text with no days renders as title plus paragraphs', () => {
  const parsed = parse('Cotización para 2 personas.\nTotal: $3,400 USD.\nIncluye vuelos.');
  assert.equal(parsed.dayCount, 0);
  const html = h.renderHostedPage({ body: 'Cotización para 2 personas.\nTotal: $3,400 USD.' });
  assert.ok(html.includes('3,400'));
});

test('renders the externally hosted Brinteva logo in the header and footer', () => {
  const logoUrl = 'https://brintevaworlds.com/wp-content/uploads/2019/10/BRINTEVA-WORLDS-final-06-1.png';
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });

  assert.equal(html.match(new RegExp(`src="${logoUrl}"`, 'g'))?.length, 2);
  assert.match(html, /<header class="masthead">[\s\S]*alt="Brinteva Worlds"/);
  assert.match(html, /<footer class="site-footer">[\s\S]*alt="Brinteva Worlds"/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)\{[\s\S]*?\.brand-logo\{filter:brightness\(0\) invert\(1\)\}/);
  assert.match(html, /© 2026 Todos los derechos reservados\.<\/span>[\s\S]*Brinteva Worlds, Inc\./);
  assert.doesNotMatch(html, /class="mark"|class="brand"/);
});

test('renders the questions card on the fixed brand-navy surface with high-contrast text', () => {
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });

  assert.match(html, /\.contact\{[\s\S]*?background:linear-gradient\(155deg,var\(--night\)/);
  assert.match(html, /--night:#1a2038; --night-2:#262f57/);
  assert.match(html, /\.contact h2\{[\s\S]*?color:#fff/);
  assert.match(html, /href="tel:\+19256658003">/);
  assert.match(html, />\(925\) 665-8003<\/strong>/);
  assert.match(html, /class="contact-label">Reservas<\/span>/);
});

test('renders a green WhatsApp button with icon, label, and phone number', () => {
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });

  assert.match(html, /fontawesome-free@6\.7\.2\/svgs\/brands\/whatsapp\.svg/);
  assert.match(html, /class="whatsapp-icon"[^>]*alt=""/);
  // WhatsApp intentionally carries its own number, separate from the Reservas
  // call line — a business's WhatsApp line need not be the same number.
  assert.match(html, /href="https:\/\/wa\.me\/19254353077"/);
  assert.match(html, /Escríbenos por WhatsApp/);
  assert.match(html, />\+1 925 435 3077<\/strong>/);
  assert.match(html, /\.contact-button--whatsapp \.contact-icon\{background:#087a63\}/);
  assert.match(html, /\.contact-button--call \.contact-icon\{background:var\(--crimson\)\}/);
});

test('the phone and WhatsApp actions share one contact-button layout', () => {
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });

  assert.match(html, /fontawesome-free@6\.7\.2\/svgs\/solid\/phone\.svg/);
  assert.equal((html.match(/class="contact-button /g) || []).length, 3);
  assert.match(html, /\.contact-button\{[\s\S]*?border-radius:14px/);
});

test('the hosted page loads the vendored GSAP core and its init script, same-origin only', () => {
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });
  const script = fs.readFileSync(path.join(__dirname, '..', 'public/vendor/hosted-contact.js'), 'utf8');

  assert.match(html, /<script src="\/vendor\/gsap\.min\.js" defer><\/script>/);
  assert.match(html, /<script src="\/vendor\/hosted-contact\.js" defer><\/script>/);
  assert.match(html, /<main class="text">/);
  assert.match(html, /<div class="itinerary-heading">[\s\S]*?data-share-itinerary/);
  assert.match(html, /svgs\/solid\/share-nodes\.svg/);
  assert.match(script, /gsap\.from\(text, \{[\s\S]*?opacity: 0,[\s\S]*?y: 30,[\s\S]*?duration: 1,[\s\S]*?ease: 'power2\.out'/);
  assert.match(script, /if \(text && !reduceMotion\)/);
  assert.match(html, /data-print-itinerary/);
  assert.match(html, /svgs\/solid\/print\.svg/);
  assert.match(script, /printButton\.addEventListener\('click',[\s\S]*?window\.print\(\)/);
  assert.match(script, /data-toggle-details/);
  assert.match(script, /collapseLabel[\s\S]*?expandLabel/);
  assert.match(script, /if \(navigator\.share\)[\s\S]*?await navigator\.share\(data\)/);
});

test('handles a 30-day itinerary without a day-count limit', () => {
  const body = Array.from({ length: 30 }, (_, i) =>
    `Día ${i + 1}: CIUDAD ${i + 1}\nActividad del día ${i + 1}.`).join('\n');
  const parsed = parse(body);
  assert.equal(parsed.dayCount, 30);
  assert.equal(parsed.sections[29].place, 'CIUDAD 30');
});

test('loses no non-empty line and keeps original order', () => {
  const body = ['ENCABEZADO', 'Nota introductoria.', 'Día 1: ROMA', 'Llegada.',
    'Cena incluida.', 'Día 2: PISA', 'Torre inclinada.'].join('\n');
  const parsed = parse(body);
  const seen = [parsed.title];
  for (const s of parsed.sections) {
    if (s.date) seen.push(s.date);
    if (s.place) seen.push(s.place);
    seen.push(...s.lines);
  }
  for (const line of body.split('\n')) {
    assert.ok(seen.some(v => String(v).includes(line) || line.includes(String(v))),
      `line missing from parse output: ${line}`);
  }
  const bodyIdx = seen.indexOf('Llegada.');
  assert.ok(bodyIdx < seen.indexOf('Torre inclinada.'), 'order must be stable');
});

// ── Destination resolution ─────────────────────────────────────────────────

test('extracts the first confident destination', () => {
  const cases = [
    ['Día 1: BANGKOK', 'BANGKOK'],
    ['Day 1: Rome - Florence', 'Rome'],
    ['Día 1: CIUDAD DE ORIGEN - ROMA', 'ROMA'],
    ['Día 1: ORIGIN → PARIS', 'PARIS'],
    ['Día 1: Aix-en-Provence', 'Aix-en-Provence'],
  ];
  for (const [head, want] of cases) {
    assert.equal(h.extractDestination(parse(`${head}\nTexto.`)), want, head);
  }
});

test('falls back to an explicit arrival phrase when the day names no place', () => {
  assert.equal(h.extractDestination(parse('Día 1:\nLlegada a Madrid, capital de España.')), 'Madrid');
  assert.equal(h.extractDestination(parse('Day 1:\nArrival in London.')), 'London');
});

test('rejects infrastructure and generic labels as destinations', () => {
  assert.equal(h.extractDestination(parse('Día 1:\nLlegada al aeropuerto de Suvarnabhumi.')), null);
  assert.equal(h.extractDestination(parse('Día 1: ORIGEN\nTexto.')), null);
  assert.equal(h.extractDestination(parse('Cotización sin días.')), null);
});

test('place confidence rules', () => {
  assert.equal(h.isConfidentPlace('R'), false, 'too short');
  assert.equal(h.isConfidentPlace('123'), false, 'digits only');
  assert.equal(h.isConfidentPlace('---'), false, 'punctuation only');
  assert.equal(h.isConfidentPlace('destino'), false, 'generic');
  assert.equal(h.isConfidentPlace('x'.repeat(121)), false, 'too long');
  assert.equal(h.isConfidentPlace('Roma'), true);
});

// ── Size limit ─────────────────────────────────────────────────────────────

test('body limit is measured in UTF-8 bytes, not characters', () => {
  assert.equal(h.bodyByteLength('a'.repeat(100)), 100);
  assert.equal(h.bodyByteLength('ñ'.repeat(100)), 200, 'ñ is two bytes');
  assert.equal(h.MAX_BODY_BYTES, 120000);
});

test('accepts just under and rejects just over 120,000 bytes', async () => {
  const db = { execute: async () => [{ insertId: 1 }] };
  const deps = { db, env: {}, axios: null };
  await h.createHostedMessage(deps, { body: 'a'.repeat(119999) });         // under
  await assert.rejects(
    () => h.createHostedMessage(deps, { body: 'a'.repeat(120001) }),
    /120001 bytes/,
  );
  // Multi-byte: 60,001 ñ characters is 120,002 bytes despite being far fewer
  // than 120,000 JavaScript characters.
  await assert.rejects(() => h.createHostedMessage(deps, { body: 'ñ'.repeat(60001) }), /bytes/);
});

// ── Unsplash ───────────────────────────────────────────────────────────────

const PHOTO = {
  id: 'abc123',
  urls: { regular: 'https://images.unsplash.com/photo-1?ixid=XYZ&w=1080' },
  links: { html: 'https://unsplash.com/photos/abc123', download_location: 'https://api.unsplash.com/photos/abc123/download' },
  user: { name: 'Ada Lovelace', links: { html: 'https://unsplash.com/@ada' } },
};
const fakeAxios = (impl) => ({ get: impl });
const env = { UNSPLASH_ACCESS_KEY: 'test-key' };

test('destination aliases affect only the Unsplash search name', async () => {
  assert.equal(h.destinationSearchName('BKK'), 'Bangkok');
  assert.equal(h.destinationSearchName('bkk'), 'Bangkok');
  assert.equal(h.destinationSearchName('San Miguel de Allende'), 'San Miguel de Allende');

  let query = null;
  const axios = fakeAxios(async (_url, cfg) => {
    query = cfg.params.query;
    return { data: { results: [PHOTO] } };
  });
  const hero = await h.fetchUnsplashHero({ axios, env }, 'BKK');

  assert.equal(query, 'Bangkok travel landmark');
  assert.equal(hero.destination, 'BKK', 'visible destination remains seller text');
});

test('search sends the contract parameters and authentication', async () => {
  let seen = null;
  const axios = fakeAxios(async (url, cfg) => { seen = { url, cfg }; return { data: { results: [PHOTO] } }; });
  const hero = await h.fetchUnsplashHero({ axios, env }, 'Bangkok');

  assert.equal(seen.url, 'https://api.unsplash.com/search/photos');
  assert.equal(seen.cfg.params.query, 'Bangkok travel landmark');
  assert.equal(seen.cfg.params.per_page, 1);
  assert.equal(seen.cfg.params.order_by, 'relevant');
  assert.equal(seen.cfg.params.orientation, 'landscape');
  assert.equal(seen.cfg.params.content_filter, 'high');
  assert.equal(seen.cfg.timeout, 3000);
  assert.equal(seen.cfg.headers.Authorization, 'Client-ID test-key');
  assert.equal(seen.cfg.headers['Accept-Version'], 'v1');
  assert.equal(hero.photographerName, 'Ada Lovelace');
  assert.ok(hero.imageUrl.includes('ixid=XYZ'), 'ixid must survive');
});

test('search degrades to null on missing key, no results, and errors', async () => {
  const ok = fakeAxios(async () => ({ data: { results: [PHOTO] } }));
  assert.equal(await h.fetchUnsplashHero({ axios: ok, env: {} }, 'Bangkok'), null, 'no key');
  assert.equal(await h.fetchUnsplashHero({ axios: ok, env }, null), null, 'no destination');
  assert.equal(await h.fetchUnsplashHero({ axios: fakeAxios(async () => ({ data: { results: [] } })), env }, 'X'), null);

  const timeout = fakeAxios(async () => { const e = new Error('timeout of 3000ms exceeded'); e.code = 'ECONNABORTED'; throw e; });
  assert.equal(await h.fetchUnsplashHero({ axios: timeout, env }, 'Bangkok'), null, 'timeout');

  const rateLimited = fakeAxios(async () => { const e = new Error('Request failed'); e.response = { status: 403 }; throw e; });
  assert.equal(await h.fetchUnsplashHero({ axios: rateLimited, env }, 'Bangkok'), null, 'rate limit');
});

test('rejects a photo whose image URL is not on images.unsplash.com', async () => {
  const evil = { ...PHOTO, urls: { regular: 'https://evil.example.com/x.jpg' } };
  const axios = fakeAxios(async () => ({ data: { results: [evil] } }));
  assert.equal(await h.fetchUnsplashHero({ axios, env }, 'Bangkok'), null);
});

test('URL allowlists', () => {
  assert.equal(h.isUnsplashImageUrl('https://images.unsplash.com/photo-1'), true);
  assert.equal(h.isUnsplashImageUrl('http://images.unsplash.com/photo-1'), false, 'http rejected');
  assert.equal(h.isUnsplashImageUrl('https://images.unsplash.com.evil.com/x'), false);
  assert.equal(h.isUnsplashLinkUrl('https://unsplash.com/@ada'), true);
  assert.equal(h.isUnsplashLinkUrl('https://api.unsplash.com/photos/x/download'), true);
  assert.equal(h.isUnsplashLinkUrl('https://evil.com/@ada'), false);
});

test('never logs the access key', async () => {
  const lines = [];
  const log = { info: (...a) => lines.push(JSON.stringify(a)), warn: (...a) => lines.push(JSON.stringify(a)) };
  const boom = fakeAxios(async () => { throw new Error('Request failed with status code 401'); });
  await h.fetchUnsplashHero({ axios: boom, env, log }, 'Bangkok');
  assert.ok(lines.length > 0, 'a failure should be logged');
  assert.ok(!lines.join(' ').includes('test-key'), 'the key must never appear in a log');
});

// ── Hero rendering ─────────────────────────────────────────────────────────

const validHero = {
  destination: 'Bangkok',
  imageUrl: PHOTO.urls.regular,
  photoUrl: PHOTO.links.html,
  photographerName: 'Ada Lovelace',
  photographerUrl: PHOTO.user.links.html,
};

test('renders the hero with attribution and referral parameters', () => {
  const html = h.renderHero(validHero);
  assert.ok(html.includes('Foto de'));
  assert.ok(html.includes('Ada Lovelace'));
  assert.ok(html.includes('Unsplash'));
  assert.ok(html.includes('utm_source=brinteva_worlds'));
  assert.ok(html.includes('utm_medium=referral'));
  assert.ok(html.includes('width="1080"') && html.includes('height="540"'));
  assert.ok(html.includes('decoding="async"'));
  assert.ok(html.includes('ixid=XYZ'), 'ixid preserved in the rendered src');
});

test('suppresses the whole hero when metadata is incomplete or disallowed', () => {
  assert.equal(h.renderHero(null), '');
  assert.equal(h.renderHero({ ...validHero, photographerName: null }), '', 'no credit, no hero');
  assert.equal(h.renderHero({ ...validHero, imageUrl: 'https://evil.com/x.jpg' }), '');
  assert.equal(h.renderHero({ ...validHero, photographerUrl: 'https://evil.com/@ada' }), '');
});

test('page renders unchanged when there is no hero', () => {
  const body = 'Día 1: BANGKOK\nLlegada.';
  const withoutHero = h.renderHostedPage({ body });
  assert.ok(!withoutHero.includes('<figure class="hero">'));
  assert.ok(withoutHero.includes('BANGKOK'));

  const withHero = h.renderHostedPage({
    body,
    hero_image_url: validHero.imageUrl,
    hero_photo_url: validHero.photoUrl,
    hero_photographer_name: validHero.photographerName,
    hero_photographer_url: validHero.photographerUrl,
    hero_destination: 'Bangkok',
  });
  assert.ok(withHero.includes('<figure class="hero">'));
  assert.ok(withHero.includes('Vista de Bangkok'), 'alt text names the destination');
});

test('escapes seller text and hero metadata', () => {
  // The page legitimately emits two static <script src="/vendor/..."> tags of
  // its own (the vendored GSAP init), so this checks for the exact attacker
  // payload surviving unescaped rather than banning "<script" outright.
  const html = h.renderHostedPage({ body: 'Día 1: <script>alert(1)</script>\nTexto.' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'attacker payload must not survive unescaped');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

  const injected = h.renderHero({ ...validHero, photographerName: '"><script>alert(1)</script>' });
  assert.ok(!injected.includes('<script>alert(1)</script>'), 'photographer name must be escaped');
});

// ── Creation flow ──────────────────────────────────────────────────────────

test('creation stores hero metadata and tracks the download exactly once', async () => {
  const calls = [];
  const axios = fakeAxios(async (url) => {
    calls.push(url);
    if (url.startsWith('https://api.unsplash.com/search')) return { data: { results: [PHOTO] } };
    return { data: {} };
  });
  let stored = null;
  const db = { execute: async (_sql, params) => { stored = params; return [{ insertId: 7 }]; } };

  const rec = await h.createHostedMessage({ db, env, axios }, { body: 'Día 1: BANGKOK\nLlegada.' });
  await new Promise(r => setImmediate(r)); // let the fire-and-forget ping run

  assert.equal(rec.id, 7);
  assert.ok(stored.includes(PHOTO.urls.regular), 'image URL stored');
  assert.ok(stored.includes('Ada Lovelace'), 'photographer stored');
  const downloads = calls.filter(u => u.includes('/download'));
  assert.equal(downloads.length, 1, 'exactly one download-tracking request');
});

test('creation still succeeds when Unsplash is unavailable', async () => {
  const axios = fakeAxios(async () => { throw new Error('ENOTFOUND'); });
  const db = { execute: async () => [{ insertId: 8 }] };
  const rec = await h.createHostedMessage({ db, env, axios }, { body: 'Día 1: BANGKOK\nLlegada.' });
  assert.equal(rec.id, 8);
  assert.equal(rec.hero, null);
});

test('creation rejects empty, whitespace, and non-string bodies', async () => {
  const deps = { db: { execute: async () => [{ insertId: 1 }] }, env: {}, axios: null };
  for (const bad of [undefined, null, '', '   \n\n ', { text: 'hi' }, 42]) {
    await assert.rejects(() => h.createHostedMessage(deps, { body: bad }), /vacío/,
      `should reject: ${JSON.stringify(bad)}`);
  }
});

// ── Haiku-assisted creation and stored rendering (Phase 2) ───────────────

const AI_OAXACA_BODY = [
  'Hola, le comparto el itinerario.',
  'OAXACA AL MÁXIMO - 2 dias',
  'Día 1 AEROPUERTO OAXACA / OAXACA',
  'Llegada y traslado al hotel.',
  'Día 2 OAXACA / MONTE ALBÁN',
  'Visita a la zona arqueológica.',
].join('\n');

const AI_OAXACA_STRUCTURE = {
  classification: 'itinerary',
  title: { line: 1, value: 'OAXACA AL MÁXIMO - 2 dias' },
  preamble: { startLine: 0, endLine: 0 },
  tours: [{
    titleLine: 1,
    days: [
      { number: 1, headingLine: 2, place: 'AEROPUERTO OAXACA / OAXACA', contentStartLine: 3, contentEndLine: 3 },
      { number: 2, headingLine: 4, place: 'OAXACA / MONTE ALBÁN', contentStartLine: 5, contentEndLine: 5 },
    ],
  }],
};

function aiAxios(output, usage = null) {
  return {
    post: async () => ({ data: { content: [{ text: JSON.stringify(output) }], usage } }),
    get: async () => ({ data: { results: [] } }),
  };
}

test('stored Haiku structure renders separator-less day headings without another API call', () => {
  const html = h.renderHostedPage({
    title: 'OAXACA AL MÁXIMO - 2 dias',
    body: AI_OAXACA_BODY,
    ai_structure: JSON.stringify(AI_OAXACA_STRUCTURE),
  });
  assert.match(html, /OAXACA AL MÁXIMO - 2 dias/);
  assert.match(html, /Día 1/);
  assert.match(html, /Día 2/);
  assert.match(html, /AEROPUERTO OAXACA \/ OAXACA/);
  assert.match(html, /Visita a la zona arqueológica/);
  assert.match(html, /2 días/);
});

test('stored Haiku travel offers render as separate titled blocks', () => {
  const body = [
    'Buenas tardes, estas son las opciones:',
    'Guadalajara y León - septiembre 2026',
    'Precio: $1,290 USD por persona',
    'Guadalajara y Morelia - diciembre 2026',
    'Reserva con $250 USD por persona',
  ].join('\n');
  const structure = {
    classification: 'travel_offers',
    title: null,
    preamble: { startLine: 0, endLine: 0 },
    tours: [
      { titleLine: 1, days: [] },
      { titleLine: 3, days: [] },
    ],
  };
  const html = h.renderHostedPage({ title: 'Opciones de viaje', body, ai_structure: structure });
  assert.match(html, /Guadalajara y León - septiembre 2026/);
  assert.match(html, /Guadalajara y Morelia - diciembre 2026/);
  assert.match(html, /Precio: \$1,290 USD por persona/);
  assert.match(html, /Reserva con \$250 USD por persona/);
});

test('creation persists validated Haiku structure and derives the source title', async () => {
  let inserted = null;
  const db = { execute: async (sql, params) => { inserted = { sql, params }; return [{ insertId: 21 }]; } };
  const rec = await h.createHostedMessage({
    db,
    axios: aiAxios(AI_OAXACA_STRUCTURE, { input_tokens: 3000, output_tokens: 600 }),
    env: { ANTHROPIC_API_KEY: 'test-key' },
    log: { info: () => {}, warn: () => {} },
  }, { body: AI_OAXACA_BODY });

  assert.equal(rec.parseMethod, 'haiku');
  assert.equal(rec.classification, 'itinerary');
  assert.equal(rec.title, 'OAXACA AL MÁXIMO - 2 dias');
  assert.match(inserted.sql, /ai_structure/);
  assert.equal((inserted.sql.match(/\?/g) || []).length, inserted.params.length, 'insert placeholders match params');
  assert.ok(inserted.params.includes(AI_OAXACA_BODY), 'raw body is stored');
  assert.ok(inserted.params.some(value => typeof value === 'string' && value.includes('AEROPUERTO OAXACA')));
  assert.ok(inserted.params.includes('source'));
  assert.ok(inserted.params.includes(3000));
  assert.ok(inserted.params.includes(600));
  assert.ok(inserted.params.includes(0.006));
});

test('a null Haiku title for a real itinerary is invalid and falls back to the deterministic parser', async () => {
  // A day heading is never a title, so Haiku must always suggest one when the
  // source has none — a null title here means the response failed
  // validation, and the whole interpretation (not just the title) falls back.
  const body = 'Hola, revise su viaje.\nDía 1 Bangkok\nLlegada al hotel.';
  const output = {
    classification: 'itinerary',
    title: null,
    preamble: { startLine: 0, endLine: 0 },
    tours: [{ titleLine: null, days: [
      { number: 1, headingLine: 1, place: 'Bangkok', contentStartLine: 2, contentEndLine: 2 },
    ] }],
  };
  const db = { execute: async () => [{ insertId: 22 }] };
  const rec = await h.createHostedMessage({
    db,
    axios: aiAxios(output),
    env: { ANTHROPIC_API_KEY: 'test-key' },
    log: { info: () => {}, warn: () => {} },
  }, { body });
  assert.equal(rec.parseMethod, 'deterministic');
});

test('a Haiku-suggested title is persisted with suggested provenance', async () => {
  const body = 'Hola, revise su viaje.\nDía 1 Bangkok\nLlegada al hotel.';
  const output = {
    classification: 'itinerary',
    title: { line: null, value: 'Itinerario Bangkok', origin: 'suggested' },
    preamble: { startLine: 0, endLine: 0 },
    tours: [{ titleLine: null, days: [
      { number: 1, headingLine: 1, place: 'Bangkok', contentStartLine: 2, contentEndLine: 2 },
    ] }],
  };
  let inserted = null;
  const db = { execute: async (sql, params) => { inserted = { sql, params }; return [{ insertId: 24 }]; } };
  const rec = await h.createHostedMessage({
    db,
    axios: aiAxios(output),
    env: { ANTHROPIC_API_KEY: 'test-key' },
    log: { info: () => {}, warn: () => {} },
  }, { body });
  assert.equal(rec.title, 'Itinerario Bangkok');
  assert.ok(inserted.params.includes('suggested'));
});

test('Haiku API failure falls back to deterministic parsing and still creates the page', async () => {
  const db = { execute: async () => [{ insertId: 23 }] };
  const axios = { post: async () => { throw new Error('network unavailable'); } };
  const rec = await h.createHostedMessage({
    db,
    axios,
    env: { ANTHROPIC_API_KEY: 'test-key' },
    log: { info: () => {}, warn: () => {} },
  }, { body: 'Día 1: ROMA\nLlegada.' });
  assert.equal(rec.parseMethod, 'deterministic');
  assert.equal(rec.title, 'ROMA');
});

test('Haiku cost estimate uses separate input and output prices', () => {
  assert.equal(h.estimateHaikuCost(3000, 600), 0.006);
  assert.equal(h.estimateHaikuCost(1000, 300), 0.0025);
  assert.equal(h.estimateHaikuCost(null, 300), null);
});
