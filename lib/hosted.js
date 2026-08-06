// Long agent messages hosted as a web page, linked from a one-segment SMS.
//
// Vonage rejects any SMS text over 3200 characters outright, and even under that
// ceiling a multi-thousand-character itinerary bills one segment per 153
// characters. A link costs one segment total, has no length ceiling, renders
// accents and ñ that GSM-7 cannot, and the customer can reopen it later.
//
// The stored body is the RAW seller text, not the SMS-sanitized version: the
// page is HTML and should show "PARÍS", not "PARIS". Only the SMS line that
// carries the link gets sanitized.
const crypto = require('crypto');
const { sanitizeForSMS } = require('./sms');
const destinationAliases = require('../data/destination-aliases.json');

// No i/l/1/o/0 — the code appears in a URL people may read off a screen, and
// ambiguous glyphs turn a working link into a support call. 31 chars ^ 10 is
// ~49 bits, so the codes cannot be enumerated. The code IS the credential:
// the recipient has no login, which is also why the page is served noindex.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 10;
const COMPANY_URL = 'https://brintevaworlds.com/';
const COMPANY_LOGO_URL =
  'https://brintevaworlds.com/wp-content/uploads/2019/10/BRINTEVA-WORLDS-final-06-1.png';

// One SMS segment is 160 GSM-7 characters. The link line must never spill into
// a second segment — that would defeat the entire point of hosting.
const SMS_SEGMENT = 160;

// Measured in UTF-8 BYTES, not JavaScript characters. JS counts UTF-16 code
// units while MySQL counts bytes, so a character limit is not a storage
// guarantee: 32,000 characters of accented Spanish is more than 32,000 bytes.
// 120,000 bytes fits a detailed 30-day itinerary inside MEDIUMTEXT and still
// leaves room for Kommo metadata within the 256 KB request envelope.
const MAX_BODY_BYTES = 120000;

function bodyByteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

// Links expire. An itinerary carries the customer's name, travel dates and
// reservation details, and the URL is a bearer credential that can be forwarded
// or land in someone's message backup — so it must not work forever. 90 days
// also matches the business reality: tours change and quotes go stale, and a
// link that still resolves to last season's price is worse than a dead one.
const DEFAULT_TTL_DAYS = 30;

function ttlDays(env) {
  const raw = Number((env && env.HOSTED_LINK_TTL_DAYS) || DEFAULT_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TTL_DAYS;
}

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// The body is arbitrary text a seller pasted into Kommo. Escaping it is the
// only thing standing between that and stored XSS on a public page.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deaccent(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Normalizes only the parser's working copy — `hosted_messages.body` keeps the
// seller's raw text. CRLF, lone CR, NEL, LS and PS all become LF because this
// parser is line-based: a word processor or webmail client that emits one of
// the less common separators would otherwise glue two day headings together.
//
// The removed range is Unicode control/format characters that have no place
// in itinerary prose. ZWJ/ZWNJ (join emoji sequences and script letterforms)
// and LRM/RLM (directional marks with real meaning in mixed-direction text)
// are deliberately NOT in that range. Bidi embeddings/overrides/isolates ARE:
// their only effect on this content is to reorder visible text against its
// logical order, which is a spoofing primitive, not writing.
function normalizeSellerText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F\u00AD\u200B\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim();
}

// Day headings arrive in several shapes from different tour operators, in two
// languages, and are NOT reliably separated by blank lines — real itineraries
// run day/body/day/body with nothing between them. Parsing is therefore
// line-based and sequential; an earlier block-based version split on blank
// lines and collapsed such a document into one wall of text with zero days.
//
// A line is a heading only when it matches a whole supported shape. That is
// what keeps "day 1 of the conference", "visit on Monday" and "call at
// 09/11/2026" as ordinary paragraph text.

// Route/heading separator: a colon, a dash/arrow with whitespace around it, or
// the "period then dash" idiom Spanish operators use ("Día 1.- MADRID"), which
// needs no surrounding whitespace at all.
//
// The whitespace requirement on the bare-dash form is what preserves hyphenated
// names such as "Aix-en-Provence" and "Baden-Baden". The period-dash form is
// safe without it because the period anchors it: an interior hyphen in a place
// name is never preceded by a period. The trailing lookahead keeps a line that
// merely ENDS in ".-" from splitting into an empty place.
//
// Broadening this is safe in general because matchDay() still requires the head
// to be a COMPLETE day token — a split in the wrong place just yields a head
// that is not a day and the line stays ordinary text. JS regexes match
// leftmost-first, so a colon earlier in the line still wins.
const SEPARATOR = /:|\s[–—→-]\s|\.\s*[–—-]\s*(?=\S)/;
const ROUTE_SPLIT = /\s+[–—→-]\s+/;

const ES_WEEKDAYS = 'lunes|martes|miercoles|jueves|viernes|sabado|domingo';
const EN_WEEKDAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const ES_ORDINALS = 'primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto|septimo|octavo|noveno|decimo';
const EN_ORDINALS = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth';

// Matched against the deaccented, lowercased head — the text before the first
// separator — so it must consume that head entirely.
const HEAD_NUMBERED = new RegExp(
  `^(?:(?:dia|day)\\s*\\d{1,3}` +
  `|\\d{1,3}\\s*(?:er|ro|do|to|mo|vo|no|a|st|nd|rd|th)?\\s*(?:dia|day)` +
  `|(?:${ES_ORDINALS}|${EN_ORDINALS})\\s+(?:dia|day))$`
);
const HEAD_WEEKDAY = new RegExp(`^(?:${ES_WEEKDAYS}|${EN_WEEKDAYS})\\b`);
const HEAD_NUMERIC_DATE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;

// A head that is nothing but a number ("1.- MADRID"). Unlike every other
// heading shape this one carries NO word that marks it as a day, so on its own
// it is indistinguishable from an ordinary numbered list item ("1.- Traslados"
// under "Incluye:"). It is therefore never recognized line-by-line: callers
// must opt in via allowsBareNumberDays() below, which decides once per
// document. matchDay() keeps its bare-number branch off by default so that
// every existing caller behaves exactly as before.
const HEAD_BARE_NUMBER = /^\d{1,3}$/;

// A bare-number heading names a destination, not a service. Real day headings
// are short ("MADRID", "ROMA - FLORENCIA"); a numbered inclusion line usually
// is not ("1.- Traslados de llegada y salida del aeropuerto principal").
const MAX_BARE_PLACE_CHARS = 60;

// Inclusion headings are deliberately Spanish-only and must be complete,
// standalone labels. The inline matcher below permits the same labels after a
// sentence terminator only when they carry a colon, e.g. "Fin.Incluye: ...".
const INCLUDED_HEADING = /^(?:incluye|servicios incluidos)\s*:?$/;
const EXCLUDED_HEADING = /^(?:no incluye|no incluidos|servicios no incluidos)\s*:?$/;
const INLINE_INCLUSION_HEADING =
  /(^|[.!?])\s*(incluye|servicios incluidos|no incluye|no incluidos|servicios no incluidos)\s*:/gi;

function matchInclusionHeading(line) {
  const comparable = toComparable(line);
  if (INCLUDED_HEADING.test(comparable)) return 'included';
  if (EXCLUDED_HEADING.test(comparable)) return 'excluded';
  return null;
}

// The optional dash after a numbered prefix covers the "1.- item" style, which
// otherwise loses only its "1." and renders as "- item". It is anchored to the
// number, so a mid-item hyphen such as "opción -SI" is still untouched.
function cleanInclusionItem(line) {
  return String(line)
    .replace(/^(?:[•●◦*]\s*|[-–—]\s+|\d{1,3}[.)]\s*[-–—]?\s*)/, '')
    .trim();
}

// Split a poorly formatted line without losing the prose before an explicit
// label. A colon is mandatory for inline recognition so ordinary prose such as
// "El paquete incluye traslado" stays ordinary itinerary content.
function splitInlineInclusions(line) {
  const fragments = [];
  let cursor = 0;
  let activeKind = null;
  let match;

  INLINE_INCLUSION_HEADING.lastIndex = 0;
  while ((match = INLINE_INCLUSION_HEADING.exec(line)) !== null) {
    const before = line.slice(cursor, match.index + match[1].length).trim();
    if (before) {
      fragments.push({
        type: activeKind ? 'item' : 'text',
        kind: activeKind,
        value: activeKind ? cleanInclusionItem(before) : before,
      });
    }
    activeKind = matchInclusionHeading(match[2]);
    cursor = match.index + match[0].length;
  }

  if (!activeKind) return [];
  // The final fragment is pushed even when its item is empty: a heading that
  // ends the line ("...Traslado.No incluye:") must still switch the parser's
  // state, or the items on the FOLLOWING lines land in the previous heading's
  // column. appendInclusion stores no empty item, so an empty heading still
  // renders nothing by itself.
  fragments.push({ type: 'item', kind: activeKind, value: cleanInclusionItem(line.slice(cursor)) });
  return fragments;
}

// A weekday heading may carry date text ("viernes, 11 de septiembre de 2026"),
// but prose is not a heading. Length is the cheap, language-neutral guard.
const MAX_HEAD_CHARS = 60;
const MAX_PLACE_CHARS = 120;

// Split a line at its first separator. NFC first so that a decomposed "í" does
// not change length between the original and its deaccented copy.
function splitHeading(rawLine) {
  const line = String(rawLine).normalize('NFC').trim();
  const m = line.match(SEPARATOR);
  if (!m) return { line, head: line, place: '', hasSeparator: false };
  return {
    line,
    head: line.slice(0, m.index).trim(),
    place: line.slice(m.index + m[0].length).trim(),
    hasSeparator: true,
  };
}

// Returns { label, date, place } for a day heading, or null for anything else.
// `label` stays null for numbered headings so the renderer supplies the single
// sequential "Día N" — printing the source label too would show it twice.
//
// `allowBareNumber` opts into the word-less "1.- MADRID" form. It defaults to
// false because that shape is only safe to accept with whole-document context;
// see allowsBareNumberDays().
function matchDay(rawLine, { allowBareNumber = false } = {}) {
  const { line, head, place, hasSeparator } = splitHeading(rawLine);
  if (!line) return null;
  if (place.length > MAX_PLACE_CHARS) return null;
  const flatHead = deaccent(head).toLowerCase();

  // The head must BE the day token, nothing more. "Día 3" alone qualifies, and
  // so does "Día 1:" with no place — the destination then comes from an arrival
  // phrase in the body. "day 1 of the conference" does not: with no separator
  // the head carries the trailing prose and fails the whole-shape match.
  if (HEAD_NUMBERED.test(flatHead)) {
    return { label: null, date: null, place };
  }

  if (head.length <= MAX_HEAD_CHARS && HEAD_WEEKDAY.test(flatHead) && hasSeparator && place) {
    return { label: null, date: head, place };
  }

  if (HEAD_NUMERIC_DATE.test(flatHead) && hasSeparator && place) {
    return { label: null, date: head, place };
  }

  if (allowBareNumber && HEAD_BARE_NUMBER.test(flatHead) && hasSeparator &&
      place.length <= MAX_BARE_PLACE_CHARS && isConfidentPlace(place)) {
    return { label: null, date: null, place };
  }

  return null;
}

// Decide ONCE per document whether word-less "1.- MADRID" headings are days.
// Line-by-line this shape cannot be told apart from a numbered list item, so
// the signal has to come from the document as a whole: an operator picks one
// heading style and uses it throughout.
//
// All four conditions must hold:
//   1. no other day shape is recognized anywhere — if the paste already says
//      "Día 1" or "viernes: Roma", its bare numbers are list items, not days;
//   2. at least two candidates exist — one stray "1 - algo" is not a style;
//   3. they number 1, 2, 3 … consecutively from the top, which a day list does
//      and an interrupted inclusion list generally does not; and
//   4. no inclusion heading precedes the first candidate, which is what keeps
//      a bare "Incluye:" list from being read as an itinerary.
function allowsBareNumberDays(lines) {
  const candidates = [];
  let firstInclusionIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (matchDay(line)) return false;
    if (firstInclusionIndex === -1 &&
        (matchInclusionHeading(line) || splitInlineInclusions(line).length)) {
      firstInclusionIndex = i;
    }
    const day = matchDay(line, { allowBareNumber: true });
    if (day) candidates.push({ index: i, number: Number(splitHeading(line).head) });
  }

  if (candidates.length < 2) return false;
  if (firstInclusionIndex !== -1 && firstInclusionIndex < candidates[0].index) return false;

  // Numbering must run 1, 2, 3 … from the top. A return to 1 is allowed
  // mid-run: that is a second itinerary pasted after the first, and the whole
  // point of recognizing these lines is so classifyItineraries() can refuse it
  // as an unmarked reset instead of silently merging the two tours.
  if (candidates[0].number !== 1) return false;
  let previous = 0;
  for (const { number } of candidates) {
    if (number !== 1 && number !== previous + 1) return false;
    previous = number;
  }
  return true;
}

// The renderer deliberately does not retain source numbers for ordinary day
// headings because it supplies sequential labels itself. Multiple itineraries
// need the source number only to detect a reset before a hosted page is made.
function sourceDayNumber(rawLine, { allowBareNumber = false } = {}) {
  const { head } = splitHeading(rawLine);
  const flat = deaccent(head).toLowerCase().trim();
  const leading = flat.match(/^(?:dia|day)\s*(\d{1,3})$/);
  const trailing = flat.match(/^(\d{1,3})\s*(?:dia|day)$/);
  // A bare number only counts once the document has been cleared for the
  // word-less style; otherwise the reset guard would fire on numbered lists.
  const bare = allowBareNumber && matchDay(rawLine, { allowBareNumber: true })
    ? flat.match(HEAD_BARE_NUMBER)
    : null;
  const value = leading?.[1] || trailing?.[1] || bare?.[0];
  return value ? Number(value) : null;
}

// A seller must state this boundary explicitly when appending a second tour
// for the same client. The marker is never visible as itinerary content.
function isNewItineraryMarker(line) {
  return /^---\s*nuevo itinerario\s*---$/.test(toComparable(line));
}

// Decide whether one raw seller body contains one itinerary, explicitly
// appended tours for one client, or an unsafe unmarked reset. This is pure so
// the Kommo relay can stop before it writes a hosted record or sends an SMS.
function classifyItineraries(rawBody) {
  const text = normalizeSellerText(rawBody);
  const lines = text.split('\n');
  const markerIndexes = [];
  for (let i = 0; i < lines.length; i++) {
    if (isNewItineraryMarker(lines[i])) markerIndexes.push(i);
  }

  // Decided once, from the whole paste, and reused for every block below: the
  // heading style belongs to the seller, not to an individual tour.
  const allowBareNumber = allowsBareNumberDays(lines);

  if (markerIndexes.length > 0) {
    const blocks = [];
    let start = 0;
    for (const end of [...markerIndexes, lines.length]) {
      const body = lines.slice(start, end).join('\n').trim();
      if (!body || parseBody(body, { allowBareNumber }).dayCount === 0) {
        return { kind: 'invalid-marker' };
      }
      blocks.push(body);
      start = end + 1;
    }
    return { kind: 'explicit-appended', blocks, allowBareNumber };
  }

  let sawNumberedDay = false;
  for (const line of lines) {
    const dayNumber = sourceDayNumber(line, { allowBareNumber });
    if (!dayNumber) continue;
    if (dayNumber === 1 && sawNumberedDay) return { kind: 'ambiguous' };
    sawNumberedDay = true;
  }
  return { kind: 'single', blocks: [text], allowBareNumber };
}

// ── Seller-wrapper grammar ─────────────────────────────────────────────────
// A seller wrapper is generic text introducing a pasted itinerary, e.g.
// "Hola Ana, le comparto su itinerario:". Recognition is an anchored phrase
// grammar, not a flat sentence list or a search for the word "itinerario":
// trip-specific modifiers, prices, dates, and instructions must stay visible
// as ordinary text rather than have a prefix stripped from them.
//
// Matching happens on a deaccented, lowercased, whitespace-collapsed
// "comparable" copy. The value returned to the caller is always sliced from
// the ORIGINAL trimmed line, never reconstructed from the comparable copy —
// deaccenting via NFD-then-strip can change string length for input that
// was not already NFC (composed accents are 1 code point; decomposed accents
// are 2), and recovering a substring by length from a copy of different
// length silently corrupts it. Task 1's whole-body NFC pass makes this safe
// for whole-line comparisons; nothing here re-derives an offset from it.
function toComparable(value) {
  return deaccent(String(value ?? ''))
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function altGroup(tokens) {
  return `(?:${tokens.map(escapeRegExp).join('|')})`;
}

// Standalone wrappers accept no terminal punctuation, or exactly one from
// this set. A leading inverted "¡" is only accepted when paired with a
// trailing "!" — an unpaired one is not a documented shape.
const TERMINAL_PUNCT = new Set(['.', ',', ';', ':', '!', '—', '-']);

// Returns the punctuation-stripped core, or null when the line does not have
// a supported terminal shape (e.g. an unpaired leading "¡", or trailing "?").
function stripWrapperPunctuation(value) {
  let v = String(value ?? '').trim();
  let leadingExclaim = false;
  if (v.startsWith('¡')) {
    leadingExclaim = true;
    v = v.slice(1).trim();
  }
  let terminal = null;
  const last = v.slice(-1);
  if (v && TERMINAL_PUNCT.has(last)) {
    terminal = last;
    v = v.slice(0, -1).trim();
  }
  if (leadingExclaim && terminal !== '!') return null;
  return v;
}

const SPANISH_PRESENTATION = ['este es', 'esta es', 'aqui esta', 'aqui tiene'];
const SPANISH_PRONOUN = ['le', 'te', 'les'];
const SPANISH_TRANSFER = ['comparto', 'compartimos', 'envio', 'enviamos', 'adjunto', 'adjuntamos'];
const SPANISH_MAKE_ARRIVE = ['hago llegar', 'hacemos llegar'];
const SPANISH_AVAILABILITY = [
  'aqui encontrara', 'aqui encontraras', 'aqui encontraran',
  'a continuacion encontrara', 'a continuacion encontraras', 'a continuacion encontraran',
  'encontrara', 'encontraras', 'encontraran',
];
const SPANISH_OBJECTS = [
  'el itinerario', 'su itinerario', 'tu itinerario',
  'el programa de viaje', 'su programa de viaje', 'los detalles de su viaje',
];

const ENGLISH_PRESENTATION = ['this is', 'here is', 'attached is'];
const ENGLISH_TRANSFER = [
  'i am sharing', "i'm sharing", 'i am sending', "i'm sending",
  'we are sharing', "we're sharing", 'we are sending', "we're sending",
];
const ENGLISH_AVAILABILITY = ['you will find', "you'll find", 'please find', 'below you will find'];
const ENGLISH_OBJECTS = ['the itinerary', 'your itinerary', 'the travel itinerary', 'your travel itinerary'];

const AC = 'a continuacion';
const SPANISH_OBJ = altGroup(SPANISH_OBJECTS);
const SPANISH_DELIVERY = new RegExp('^(?:' + [
  `(?:${escapeRegExp(AC)} )?${altGroup(SPANISH_PRESENTATION)} ${SPANISH_OBJ}`,
  `(?:${escapeRegExp(AC)} )?(?:${altGroup(SPANISH_PRONOUN)} )?${altGroup(SPANISH_TRANSFER)} ${SPANISH_OBJ}`,
  `(?:${escapeRegExp(AC)} )?${altGroup(SPANISH_PRONOUN)} ${altGroup(SPANISH_MAKE_ARRIVE)} ${SPANISH_OBJ}`,
  `${altGroup(SPANISH_AVAILABILITY)} ${SPANISH_OBJ}(?: (?:abajo|${escapeRegExp(AC)}))?`,
].join('|') + ')$');

const ENGLISH_OBJ = altGroup(ENGLISH_OBJECTS);
const ENGLISH_DELIVERY = new RegExp('^(?:' + [
  `${altGroup(ENGLISH_PRESENTATION)} ${ENGLISH_OBJ}`,
  `${altGroup(ENGLISH_TRANSFER)} ${ENGLISH_OBJ}(?: for your trip)?`,
  `${altGroup(ENGLISH_AVAILABILITY)} ${ENGLISH_OBJ}(?: below)?`,
].join('|') + ')$');

// True only when the WHOLE line is a delivery clause: a presentation,
// transfer, or availability phrase immediately followed by one of the
// bounded object tokens and nothing else. Trailing prose after the object
// ("...itinerario con el precio final") fails the anchored end-of-string
// match rather than having a prefix stripped from it.
function matchDeliveryClause(value) {
  const core = stripWrapperPunctuation(value);
  if (!core) return false;
  const comparable = toComparable(core);
  if (!comparable) return false;
  return SPANISH_DELIVERY.test(comparable) || ENGLISH_DELIVERY.test(comparable);
}

const GREETING_HEAD = new RegExp(
  '^(?:hola|buen d[ií]a|buenos d[ií]as|buenas tardes|estimad[oa]' +
  '|hello|good morning|good afternoon|dear)\\b', 'i'
);

// The recipient after a greeting word: at least one Unicode letter, and only
// letters, combining marks, spaces, apostrophes, hyphens, or the periods used
// in common honorifics (Sr., Sra., Dr., Dra., Mr., Mrs., Ms.). No digits or
// currency symbols reach this charset, so a price line never qualifies. URLs
// would otherwise pass the charset check (a bare "." is allowed for
// honorifics), so they are rejected explicitly.
const RECIPIENT = /^[\p{L}][\p{L}\p{M}\s'’.\-]{0,79}$/u;
const LOOKS_LIKE_URL = /https?:\/\/|www\./i;

// A greeting is one whole line: an optional recipient may follow the greeting
// word directly, or after a comma. It is never partial-line — combining a
// greeting with a delivery clause on one line is handled separately by
// matchSellerWrapper's combined-line case, which needs a comma to split on.
function matchGreeting(value) {
  const raw = String(value ?? '').trim();
  const head = raw.match(GREETING_HEAD);
  if (!head) return false;
  let rest = raw.slice(head[0].length).replace(/^,/, '').trim();
  rest = stripWrapperPunctuation(rest);
  if (rest === null) return false;
  if (!rest) return true; // bare greeting: "Hola", "Good morning"
  if (rest.length > 80) return false;
  if (LOOKS_LIKE_URL.test(rest)) return false;
  return RECIPIENT.test(rest);
}

// One bounded courtesy line, consulted only between a greeting and a delivery
// clause. Reviewed set only — not a general "hope you're well" matcher.
const COURTESY_PHRASES = new Set([
  'espero que se encuentre bien',
  'esperamos que se encuentre bien',
  'espero que estes bien',
  'i hope you are well',
  'we hope you are well',
]);

function matchCourtesy(value) {
  const core = stripWrapperPunctuation(value);
  if (!core) return false;
  return COURTESY_PHRASES.has(toComparable(core));
}

// The single-line form ("Hola Ana, le comparto su itinerario:") splits at a
// comma between the greeting and delivery clause. A greeting can contain its
// own comma ("Buenos días, Ana, le comparto ..."), so test bounded candidate
// commas from right to left instead of assuming the first comma is the split.
// The greeting and delivery checks remain complete, anchored checks.
function matchCombinedGreetingDelivery(value) {
  const raw = String(value ?? '').trim();
  const commaIndexes = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === ',') commaIndexes.push(i);
  }
  for (const commaIndex of commaIndexes.slice(-8).reverse()) {
    const greetingPart = raw.slice(0, commaIndex).trim();
    const deliveryPart = raw.slice(commaIndex + 1).trim();
    if (matchGreeting(greetingPart) && matchDeliveryClause(deliveryPart)) return true;
  }
  return false;
}

// Examines at most the first three non-empty leading lines and returns either
// null or { consumed, display } — the number of leading lines the wrapper
// occupies and their original (not comparable) text joined by "\n". It never
// searches deeper than three lines: a match found by scanning further into
// the document could just as easily strip a line out of the middle of a
// meaningful customer note.
function matchSellerWrapper(lines) {
  const [first, second, third] = lines;

  if (first !== undefined && second !== undefined && third !== undefined &&
      matchGreeting(first) && matchCourtesy(second) && matchDeliveryClause(third)) {
    return { consumed: 3, display: [first, second, third].join('\n') };
  }

  if (first !== undefined && second !== undefined &&
      matchGreeting(first) && matchDeliveryClause(second)) {
    return { consumed: 2, display: [first, second].join('\n') };
  }

  if (first !== undefined &&
      (matchDeliveryClause(first) || matchCombinedGreetingDelivery(first))) {
    return { consumed: 1, display: first };
  }

  return null;
}

// A day heading and its wrapper sharing one line: "Hola Ana, le comparto su
// itinerario: Día 1: BANGKOK". `splitHeading()` is deliberately not reused
// here — itinerary headings and seller wrappers have different grammars, and
// this is not a general "split at the Nth terminator" rule.
//
// Only ':', '—', and '-' are inline terminators; a period commonly ends
// ordinary prose ("Le comparto su itinerario. Día 1: ROMA" must stay intact).
const INLINE_TERMINATORS = new Set([':', '—', '-']);
const INLINE_PREFIX_MAX_CHARS = 500;
const INLINE_MAX_TERMINATOR_CANDIDATES = 8;

// A split is valid only when BOTH sides independently and completely
// validate: the prefix (terminator included) against the full wrapper
// grammar, and the suffix against matchDay(). That double validation is what
// keeps a hyphenated place name intact even though '-' is a candidate
// terminator with no required surrounding whitespace: a split landing inside
// "Aix-en-Provence" leaves a suffix that is not a valid day heading, so it
// never validates regardless of where the hyphen sits.
//
// Candidates are evaluated right to left because the terminator that
// actually separates wrapper from itinerary is normally the LAST one that
// also yields a valid day heading in the suffix — a day heading commonly
// carries its own colon, as in "Día 1: BANGKOK". The candidate list is
// bounded to the rightmost 8 terminators in a line of at most 500 characters,
// keeping this constant-bounded per line and linear for the document.
function splitInlineWrapper(line, { allowBareNumber = false } = {}) {
  const raw = String(line ?? '');
  if (raw.length > INLINE_PREFIX_MAX_CHARS) return null;

  const allTerminators = [];
  for (let i = 0; i < raw.length; i++) {
    if (INLINE_TERMINATORS.has(raw[i])) allTerminators.push(i);
  }
  const candidates = allTerminators.slice(-INLINE_MAX_TERMINATOR_CANDIDATES);

  for (let c = candidates.length - 1; c >= 0; c--) {
    const idx = candidates[c];
    const prefix = raw.slice(0, idx + 1).trim();
    const suffix = raw.slice(idx + 1).trim();
    if (!prefix || !suffix) continue;
    if (!(matchDeliveryClause(prefix) || matchCombinedGreetingDelivery(prefix))) continue;
    const day = matchDay(suffix, { allowBareNumber });
    if (!day) continue;
    return { preamble: prefix, day };
  }
  return null;
}

// Generic slots that name no real place. Compared deaccented and lowercased.
const GENERIC_PLACES = new Set([
  'origen', 'ciudad de origen', 'destino', 'ciudad de destino',
  'origin', 'departure city', 'destination', 'city of origin',
]);

// Nouns that mean the arrival phrase found infrastructure, not a city.
const NOT_A_CITY = new Set([
  'aeropuerto', 'airport', 'hotel', 'terminal', 'puerto', 'port',
  'estacion', 'station', 'apto',
]);

function isGeneric(value) {
  return GENERIC_PLACES.has(deaccent(String(value)).toLowerCase().trim());
}

// A candidate must look like a place name, not a date, a number, or a label.
function isConfidentPlace(value) {
  const v = String(value ?? '').trim();
  if (v.length < 2 || v.length > MAX_PLACE_CHARS) return false;
  if (!/\p{L}/u.test(v)) return false;          // must contain a real letter
  if (isGeneric(v)) return false;
  if (HEAD_NUMERIC_DATE.test(deaccent(v).toLowerCase())) return false;
  if (/^\d+$/.test(v)) return false;
  return true;
}

function routeLegs(place) {
  return String(place ?? '').split(ROUTE_SPLIT).map(s => s.trim()).filter(Boolean);
}

// First real leg of a route, skipping generic origin labels:
// "CIUDAD DE ORIGEN - ROMA" -> "ROMA";  "Rome - Florence" -> "Rome".
function firstRealPlace(place) {
  for (const leg of routeLegs(place)) {
    if (isConfidentPlace(leg)) return leg;
  }
  return null;
}

// "Llegada a Madrid." / "Arrival in London," — only consulted when the first
// day heading names no place at all.
const ARRIVAL = /^(?:llegada\s+a|arribo\s+a|arrival\s+in|arrive\s+in)\s+(?:la\s+|el\s+|los\s+|las\s+|the\s+)?(.+)$/i;

function arrivalPlace(lines) {
  for (const line of lines.slice(0, 3)) {
    const flat = deaccent(String(line)).toLowerCase();
    const m = flat.match(ARRIVAL);
    if (!m) continue;
    // Cut at the first punctuation: "Madrid, capital de España" -> "Madrid".
    const cutFlat = m[1].split(/[,.;(]/)[0].trim();
    if (!cutFlat) continue;
    if (NOT_A_CITY.has(cutFlat.split(/\s+/)[0])) continue;
    // Recover the original spelling (accents, capitals) by offset.
    const start = String(line).length - m[1].length;
    const candidate = String(line).slice(start, start + cutFlat.length).trim();
    const best = candidate && /\p{L}/u.test(candidate) ? candidate : cutFlat;
    if (isConfidentPlace(best)) return best;
  }
  return null;
}

// The first confident travel destination, or null. Pure — never calls out.
function extractDestination(parsed) {
  const firstDay = (parsed && parsed.sections || []).find(s => s.type === 'day');
  if (!firstDay) return null;
  if (firstDay.place) {
    const place = firstRealPlace(firstDay.place);
    if (place) return place;
  }
  return arrivalPlace(firstDay.lines || []);
}

// The numbered format usually opens straight into "Día 1" with no title line of
// its own. Name it by its route instead — that is what the customer wants to
// see in the SMS and at the top of the page.
function deriveTitle(sections) {
  const days = sections.filter(s => s.type === 'day' && s.place);
  if (days.length === 0) return null;

  const first = firstRealPlace(days[0].place);
  const lastLegs = routeLegs(days[days.length - 1].place).filter(isConfidentPlace);
  const last = lastLegs[lastLegs.length - 1];
  if (!first) return null;
  return last && deaccent(first).toLowerCase() !== deaccent(last).toLowerCase()
    ? `${first} a ${last}`
    : first;
}

// Parse into a title plus ordered sections. Everything degrades to plain
// paragraphs: sellers also paste quotes and free-form notes, and those must
// render sensibly rather than fall through a day-shaped parser. No non-empty
// line is ever dropped, whatever shape it has.
// Turns a flat list of normalized lines into title + ordered text sections,
// with no day recognized anywhere. This is also the ONLY path parseBody()
// uses when dayCount is 0 — a candidate wrapper is never committed to
// `preamble` unless a day actually survives (see the boundary-first flow
// below), so a wrapper with no itinerary after it renders here as ordinary
// title text instead of disappearing.
function buildFreeTextFallback(lines) {
  let title = null;
  let intro = null;
  const sections = [];
  for (const line of lines) {
    if (title === null) { title = line; continue; }
    if (!intro) { intro = { type: 'text', lines: [] }; sections.push(intro); }
    intro.lines.push(line);
  }
  return { title: title || deriveTitle(sections), preamble: null, sections, dayCount: 0 };
}

// Boundary-first: scan once, collecting every line before the first
// recognized day into `leadingLines` WITHOUT deciding yet what it means.
// Only once a day has actually been found is that leading prefix classified
// as a seller wrapper, a title, or unknown text worth preserving — a phrase
// like "Le comparto su itinerario" must not disappear when it turns out to be
// the entire message or when no valid day follows it.
// `allowBareNumber` may be supplied by a caller that already decided the
// heading style for the WHOLE paste — an appended second tour is still the same
// seller writing in the same style, and a short block ("1.- MADRID" plus one
// line) has too few candidates to make that call on its own. Omitted, the
// document decides for itself.
function parseBody(raw, { allowBareNumber } = {}) {
  const text = normalizeSellerText(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const leadingLines = [];
  const sections = [];
  let currentDay = null;
  let currentInclusions = null;
  let inclusionKind = null;
  let firstDayFound = false;
  const bareNumberDays = typeof allowBareNumber === 'boolean'
    ? allowBareNumber
    : allowsBareNumberDays(lines);

  const appendInclusion = (kind, item) => {
    if (!currentInclusions) {
      currentInclusions = { type: 'inclusions', included: [], excluded: [] };
      sections.push(currentInclusions);
    }
    inclusionKind = kind;
    if (item) currentInclusions[kind].push(item);
  };

  for (const line of lines) {
    // Inside an inclusion run a bare number is an item ("1.- Traslados"),
    // never a new day. Worded headings still close the run, per the contract.
    const day = matchDay(line, { allowBareNumber: bareNumberDays && !inclusionKind });
    if (day) {
      firstDayFound = true;
      currentInclusions = null;
      inclusionKind = null;
      currentDay = { type: 'day', ...day, lines: [] };
      sections.push(currentDay);
      continue;
    }

    if (firstDayFound) {
      const heading = matchInclusionHeading(line);
      if (heading) {
        appendInclusion(heading);
        continue;
      }

      const inlineInclusions = splitInlineInclusions(line);
      if (inlineInclusions.length) {
        for (const fragment of inlineInclusions) {
          if (fragment.type === 'text') currentDay.lines.push(fragment.value);
          else appendInclusion(fragment.kind, fragment.value);
        }
        continue;
      }

      if (inclusionKind) {
        appendInclusion(inclusionKind, cleanInclusionItem(line));
        continue;
      }

      currentDay.lines.push(line);
      continue;
    }

    const inline = splitInlineWrapper(line, { allowBareNumber: bareNumberDays });
    if (inline) {
      // The inline preamble joins leadingLines exactly like a standalone
      // wrapper line would; matchSellerWrapper() below classifies it the
      // same way whether it arrived on its own line or split out of one.
      leadingLines.push(inline.preamble);
      firstDayFound = true;
      currentDay = { type: 'day', ...inline.day, lines: [] };
      sections.push(currentDay);
      continue;
    }

    leadingLines.push(line);
  }

  const dayCount = sections.filter(s => s.type === 'day').length;
  if (dayCount === 0) return buildFreeTextFallback(lines);

  // A day was found, so a recognized wrapper prefix may now be suppressed.
  // Any leading line the wrapper does not consume keeps the pre-existing
  // title/intro semantics exactly as before this change.
  const wrapper = matchSellerWrapper(leadingLines);
  const preamble = wrapper ? wrapper.display : null;
  const remainingLeading = wrapper ? leadingLines.slice(wrapper.consumed) : leadingLines;

  let title = null;
  let intro = null;
  for (const line of remainingLeading) {
    if (title === null) { title = line; continue; }
    if (!intro) { intro = { type: 'text', lines: [] }; }
    intro.lines.push(line);
  }
  if (intro) sections.unshift(intro);

  return { title: title || deriveTitle(sections), preamble, sections, dayCount };
}

// ── Unsplash destination hero ──────────────────────────────────────────────
// The image stays on Unsplash. Their API terms require hotlinking the returned
// URL with its `ixid` intact, crediting both photographer and Unsplash with
// referral parameters, and pinging the supplied download endpoint once when a
// photo is selected for use. Nothing is copied, proxied or cached on the VPS,
// and the access key never leaves the server or reaches a log line.
//
// Every failure here — no key, no result, timeout, rate limit, bad URL — must
// return null and let the itinerary render without a hero.
const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';
const UNSPLASH_TIMEOUT_MS = 3000;
const DESTINATION_SEARCH_NAMES = new Map(
  destinationAliases.map(({ displayName, searchName }) => [
    deaccent(String(displayName)).toLowerCase().trim(),
    String(searchName).trim(),
  ])
);

function destinationSearchName(destination) {
  const displayName = String(destination ?? '').trim();
  const key = deaccent(displayName).toLowerCase();
  return DESTINATION_SEARCH_NAMES.get(key) || displayName;
}

function unsplashHeaders(key) {
  return { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' };
}

function isUnsplashImageUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && u.hostname === 'images.unsplash.com';
  } catch { return false; }
}

function isUnsplashLinkUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' &&
      (u.hostname === 'unsplash.com' || u.hostname.endsWith('.unsplash.com'));
  } catch { return false; }
}

// Referral parameters are required on every link back to Unsplash.
function withReferral(value) {
  try {
    const u = new URL(String(value));
    u.searchParams.set('utm_source', 'brinteva_worlds');
    u.searchParams.set('utm_medium', 'referral');
    return u.toString();
  } catch { return null; }
}

// One search per hosted message, never per page view.
async function fetchUnsplashHero({ axios, env, log }, destination) {
  const key = env && env.UNSPLASH_ACCESS_KEY;
  if (!key || !destination) return null;
  const searchName = destinationSearchName(destination);

  try {
    const res = await axios.get(UNSPLASH_SEARCH_URL, {
      params: {
        query: `${searchName} travel landmark`,
        per_page: 1,
        order_by: 'relevant',
        orientation: 'landscape',
        content_filter: 'high',
      },
      headers: unsplashHeaders(key),
      timeout: UNSPLASH_TIMEOUT_MS,
    });

    const photo = res && res.data && Array.isArray(res.data.results) ? res.data.results[0] : null;
    if (!photo) {
      if (log) log.info('system', 'Unsplash no devolvió imágenes', { component: 'hosted', destination });
      return null;
    }

    // urls.regular is 1080px wide and carries the ixid we must not strip.
    const imageUrl = photo.urls && photo.urls.regular;
    if (!isUnsplashImageUrl(imageUrl)) {
      if (log) log.warn('system', 'Unsplash devolvió una URL de imagen no permitida', { component: 'hosted', destination });
      return null;
    }

    return {
      destination,
      photoId: (photo.id && String(photo.id)) || null,
      imageUrl,
      photoUrl: (photo.links && photo.links.html) || null,
      photographerName: (photo.user && photo.user.name) || null,
      photographerUrl: (photo.user && photo.user.links && photo.user.links.html) || null,
      downloadLocation: (photo.links && photo.links.download_location) || null,
      alt: `Vista de ${destination}`,
    };
  } catch (err) {
    // Status and error code only. Response bodies and request headers can carry
    // operational detail or the credential itself.
    if (log) {
      log.warn('system', 'Búsqueda de imagen en Unsplash falló', {
        component: 'hosted',
        destination,
        status: (err.response && err.response.status) || null,
        error: err.code || err.message,
      });
    }
    return null;
  }
}

// Unsplash counts "used as a page header" as a download. Fire exactly once,
// after the row is safely stored, and never let it affect the customer.
async function trackUnsplashDownload({ axios, env, log }, downloadLocation) {
  const key = env && env.UNSPLASH_ACCESS_KEY;
  if (!key || !isUnsplashLinkUrl(downloadLocation)) return false;
  try {
    await axios.get(downloadLocation, {
      headers: unsplashHeaders(key),
      timeout: UNSPLASH_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    if (log) {
      log.warn('system', 'No se pudo registrar la descarga en Unsplash', {
        component: 'hosted',
        status: (err.response && err.response.status) || null,
        error: err.code || err.message,
      });
    }
    return false;
  }
}

// Rebuild hero metadata from a stored row. Returns null when the row has none.
function heroFromRow(row) {
  if (!row || !row.hero_image_url) return null;
  return {
    destination: row.hero_destination || null,
    photoId: row.hero_photo_id || null,
    imageUrl: row.hero_image_url,
    photoUrl: row.hero_photo_url || null,
    photographerName: row.hero_photographer_name || null,
    photographerUrl: row.hero_photographer_url || null,
    alt: row.hero_destination ? `Vista de ${row.hero_destination}` : 'Imagen del destino',
  };
}

// Anything short of complete, allowlisted metadata suppresses the whole hero —
// a half-credited photo would breach the API terms.
function renderHero(hero) {
  if (!hero) return '';
  if (!isUnsplashImageUrl(hero.imageUrl)) return '';
  if (!isUnsplashLinkUrl(hero.photoUrl) || !isUnsplashLinkUrl(hero.photographerUrl)) return '';
  if (!hero.photographerName) return '';

  const photoUrl = withReferral(hero.photoUrl);
  const photographerUrl = withReferral(hero.photographerUrl);
  const unsplashUrl = withReferral('https://unsplash.com/');
  if (!photoUrl || !photographerUrl || !unsplashUrl) return '';

  const alt = hero.alt || `Vista de ${hero.destination || 'el destino'}`;
  const link = (href, text) =>
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;

  return '<figure class="hero">' +
    `<a href="${escapeHtml(photoUrl)}" target="_blank" rel="noopener noreferrer">` +
      `<img src="${escapeHtml(hero.imageUrl)}" alt="${escapeHtml(alt)}" ` +
      'width="1080" height="540" decoding="async">' +
    '</a>' +
    '<figcaption>Foto de ' + link(photographerUrl, hero.photographerName) +
      ' en ' + link(unsplashUrl, 'Unsplash') + '</figcaption>' +
  '</figure>';
}

const STYLES = `
:root{
  --paper:#ffffff; --paper-2:#f4f6f9; --ink:#282d46; --ink-soft:#5a6076;
  --crimson:#ca1044; --rule:#e2e6ee;
  /* Fixed brand navy for the closing contact card — deliberately NOT swapped
     in the dark-mode block below. It echoes the logo's own navy, and staying
     constant across color schemes makes the card read as one deliberate
     "spotlight" moment rather than a surface that just inherits the theme. */
  --night:#1a2038; --night-2:#262f57;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#171a26; --paper-2:#1f2333; --ink:#e8eaf2; --ink-soft:#a0a6bd;
    --crimson:#ca1044; --rule:#2e3345;
  }
  .brand-logo{filter:brightness(0) invert(1)}
}
*,*::before,*::after{box-sizing:border-box}
body{
  margin:0; background:var(--paper); color:var(--ink); line-height:1.62;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-text-size-adjust:100%; font-size:16px;
}
.wrap{max-width:34rem;margin:0 auto;padding:0 1.25rem 3.5rem}
.masthead{
  display:flex;flex-direction:column;align-items:center;gap:1.25rem;
  padding:1.75rem 0 1.5rem;margin-bottom:2rem;
}
/* A short centered tick, not a full-bleed navbar rule — this page has no nav,
   so a wall-to-wall hairline would just be borrowed website chrome. Reads
   closer to a title-page mark, and centering the logo above it leans into
   the page being a travel document, not a site with a header bar. */
.masthead::after{content:"";display:block;width:2.25rem;height:2px;background:var(--rule)}
.brand-link{display:inline-flex;align-items:center;line-height:0}
.brand-logo{display:block;width:10rem;max-width:52vw;height:auto}
.eyebrow{
  font-size:.6875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  color:var(--crimson);margin:0 0 .5rem;
}
h1{
  font-size:clamp(1.7rem,7vw,2.4rem);line-height:1.12;letter-spacing:-.02em;
  font-weight:700;margin:0;
}
.itinerary-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem}
.itinerary-heading h1{min-width:0}
.share-button{
  display:inline-flex;align-items:center;gap:.45rem;flex:none;margin-bottom:.15rem;
  padding:.45rem .625rem;border:1px solid var(--rule);border-radius:999px;background:transparent;
  color:var(--ink);font:inherit;font-size:.75rem;font-weight:700;cursor:pointer;
}
.share-button img{
  display:block;width:1rem;height:1rem;
  filter:brightness(0) saturate(100%) invert(17%) sepia(12%) saturate(1773%) hue-rotate(197deg) brightness(90%) contrast(92%);
}
.share-button:hover{border-color:var(--crimson);color:var(--crimson)}
@media (max-width:25rem){.share-button span{display:none}.share-button{padding:.45rem}}
.meta{color:var(--ink-soft);font-size:.875rem;margin:.75rem 0 0}
.details-toggle{
  appearance:none;margin:1rem 0 0;padding:0;border:0;background:transparent;
  color:var(--crimson);font:inherit;font-size:.8125rem;font-weight:700;cursor:pointer;
}
.details-toggle:hover{text-decoration:underline;text-underline-offset:3px}
.hero{margin:1.75rem 0 0;padding:0}
.hero>a{display:block;line-height:0}
.hero img{
  width:100%;height:auto;aspect-ratio:2/1;object-fit:cover;
  border-radius:12px;display:block;background:var(--paper-2);
}
.hero figcaption{margin-top:.5rem;font-size:.75rem;color:var(--ink-soft)}
.hero figcaption a{color:var(--ink-soft)}
.days{list-style:none;margin:2.5rem 0 0;padding:0}
.day{position:relative;padding:0 0 2.25rem 1.5rem;border-left:2px solid var(--rule)}
.day:last-child{border-left-color:transparent;padding-bottom:.5rem}
.day::before{
  content:"";position:absolute;left:-7px;top:.3rem;width:12px;height:12px;
  border-radius:50%;background:var(--crimson);box-shadow:0 0 0 4px var(--paper);
}
.daynum{
  font-size:.6875rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--crimson);display:block;
}
.daydate{color:var(--ink-soft);font-size:.8125rem;display:block;margin-top:.125rem}
.day-details{min-width:0}
.day-details summary{cursor:pointer;list-style:none}
.day-details summary::-webkit-details-marker{display:none}
.day-details summary::after{
  content:'+';float:right;color:var(--crimson);font-size:1.25rem;line-height:1;font-weight:500;
}
.day-details[open] summary::after{content:'−'}
.dayplace{display:block;font-size:1.0625rem;line-height:1.3;margin:.375rem 1.75rem .5rem 0;letter-spacing:-.005em;font-weight:700}
.day-content{padding-top:.125rem}
.day-content p,.block p{margin:0 0 .75rem}
.day-content p:last-child,.block p:last-child{margin-bottom:0}
.block{margin:0 0 1.5rem}
.itinerary-tour + .itinerary-tour{
  margin-top:3rem;padding-top:2rem;border-top:1px solid var(--rule);
}
.itinerary-tour-label{
  color:var(--crimson);font-size:.6875rem;font-weight:700;letter-spacing:.14em;
  margin:0 0 .4rem;text-transform:uppercase;
}
.itinerary-tour > h2{
  font-size:1.25rem;line-height:1.25;margin:0;letter-spacing:-.01em;
}
.itinerary-tour .days{margin-top:1.25rem}
.inclusions{
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3rem;
  list-style:none;margin:0 0 2.5rem;padding:2.25rem 0 0;border-top:1px solid var(--rule);
}
.inclusions-column h2{
  display:flex;align-items:center;gap:.75rem;margin:0 0 1.25rem;
  font-size:1.35rem;line-height:1.2;letter-spacing:-.02em;
}
.inclusions-column ul{margin:0;padding-left:1.45rem;list-style:disc}
.inclusions-column li{margin:.8rem 0;padding-left:.2rem}
.inclusions-column li::marker{color:var(--ink);font-size:1em}
.inclusions-icon{
  display:block;flex:none;width:1.35rem;height:1.35rem;
}
.inclusions-column--included .inclusions-icon{
  filter:invert(65%) sepia(48%) saturate(548%) hue-rotate(61deg) brightness(91%) contrast(88%);
}
.inclusions-column--excluded .inclusions-icon{
  filter:invert(16%) sepia(93%) saturate(3539%) hue-rotate(329deg) brightness(86%) contrast(104%);
}
@media (max-width:40rem){.inclusions{grid-template-columns:1fr;gap:2.5rem}}
.contact{
  position:relative;overflow:hidden;margin-top:3rem;padding:1.75rem 1.5rem 1.5rem;
  background:linear-gradient(155deg,var(--night) 0%,var(--night-2) 100%);
  border-radius:18px;border:1px solid rgba(255,255,255,.08);
}
/* One deliberate flourish, scoped to this card only: a soft crimson glow in
   the corner, decorative only (no content), quiet enough to never fight the
   text for contrast. */
.contact::before{
  content:"";position:absolute;top:-45%;right:-20%;width:65%;aspect-ratio:1;
  background:radial-gradient(circle,rgba(202,16,68,.38),transparent 70%);
  pointer-events:none;
}
.contact h2{
  position:relative;max-width:90%;font-size:1.1875rem;line-height:1.32;
  margin:0 0 1.25rem;letter-spacing:-.01em;font-weight:700;color:#fff;
}
.contact-actions{position:relative;display:flex;flex-direction:column;gap:.75rem}
.contact-button{
  display:flex;align-items:center;gap:.875rem;min-height:4.25rem;
  padding:.75rem 1.125rem;border-radius:14px;text-decoration:none;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);
  transition:background .15s ease,border-color .15s ease;
}
.contact-button--print{width:100%;color:#fff;cursor:pointer;font:inherit;text-align:left}
.contact-button:hover,.contact-button:focus-visible{
  background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.28);text-decoration:none;
}
.contact-button:focus-visible{outline-color:#fff}
.contact-icon{
  display:flex;align-items:center;justify-content:center;flex:none;
  width:2.5rem;height:2.5rem;border-radius:50%;
}
/* height only, width auto: the phone glyph's source SVG is a square viewBox
   but the WhatsApp brand mark isn't (448x512) — forcing both to a fixed
   square stretched the WhatsApp glyph wider than the phone glyph even though
   the badges were the same size. Matching by height keeps both true to their
   own proportions and reading as the same visual weight. */
.contact-icon img{display:block;height:1.125rem;width:auto;max-width:1.375rem;filter:brightness(0) invert(1)}
.contact-button--call .contact-icon{background:var(--crimson)}
.contact-button--whatsapp .contact-icon{background:#087a63}
.contact-copy{display:block;text-align:left}
.contact-label{
  display:block;font-size:.6875rem;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;color:rgba(255,255,255,.6);margin:0 0 .1875rem;
}
.contact-copy strong{display:block;font-size:.9375rem;line-height:1.3;color:#fff;font-weight:600}
.contact-copy small{
  display:block;font-size:.75rem;font-weight:500;line-height:1.35;
  margin-top:.1875rem;color:rgba(255,255,255,.75);
}
:focus-visible{outline:2px solid var(--crimson);outline-offset:3px}
.legal{margin-top:2rem;font-size:.75rem;color:var(--ink-soft)}
.site-footer{
  display:flex;flex-direction:column;align-items:center;gap:.875rem;
  margin-top:3rem;padding-top:1.75rem;border-top:1px solid var(--rule);
  color:var(--ink-soft);font-size:.75rem;text-align:center;
}
.site-footer .brand-logo{width:6rem}
.site-footer p{margin:0}
.copyright{display:block;margin-bottom:.1875rem;font-size:.6875rem;letter-spacing:.01em}
@media print{
  :root{--paper:#fff;--paper-2:#fff;--ink:#000;--ink-soft:#444;--rule:#bbb;--crimson:#000;--night:#fff;--night-2:#fff}
  .wrap{max-width:none}
  .day{break-inside:avoid}
  .contact{background:#fff;border:1px solid #bbb}
  .contact::before{display:none}
  .contact h2{color:#000}
  .contact-button{background:none;border:1px solid #bbb}
  .contact-icon{display:none}
  .contact-label{color:#444}
  .contact-copy strong,.contact-copy small{color:#000}
  .contact-button--whatsapp,.contact-button--print{display:none}
  .details-toggle,.share-button{display:none}
  .day-details:not([open]) .day-content{display:block}
  .day-details summary::after{display:none}
  .hero{break-inside:avoid}
  .hero img{border-radius:0}
}
`.trim();

function renderSections(sections) {
  let dayNumber = 0;
  let expandableDayCount = 0;
  const dayHtml = [];
  const leading = [];

  for (const section of sections) {
    if (section.type === 'day') {
      dayNumber += 1;
      // Prefer the number the itinerary itself carries ("Día 3"); only fall back
      // to counting when the source has no label, as in the weekday format.
      const label = section.label || `Día ${dayNumber}`;
      const paras = section.lines.map(l => `<p>${escapeHtml(l)}</p>`).join('');
      const summary =
        `<span class="daynum">${escapeHtml(label)}</span>` +
        (section.date ? `<span class="daydate">${escapeHtml(section.date)}</span>` : '') +
        (section.place ? `<span class="dayplace">${escapeHtml(section.place)}</span>` : '');
      const content = paras ? `<div class="day-content">${paras}</div>` : '';
      const details = paras
        ? `<details class="day-details" open><summary>${summary}</summary>${content}</details>`
        : summary;
      if (paras) expandableDayCount += 1;
      dayHtml.push(
        `<li class="day">${details}</li>`
      );
    } else if (section.type === 'inclusions') {
      const inclusions = renderInclusions(section);
      if (inclusions) dayHtml.push(inclusions);
    } else {
      const paras = section.lines.map(l => `<p>${escapeHtml(l)}</p>`).join('');
      // Free text before any day belongs above the rail; after, it trails it.
      (dayNumber === 0 ? leading : dayHtml).push(
        dayNumber === 0 ? `<div class="block">${paras}</div>` : `<li class="day">${paras}</li>`
      );
    }
  }

  return {
    leading: leading.join(''),
    days: dayHtml.length ? `<ol class="days">${dayHtml.join('')}</ol>` : '',
    hasExpandableDays: expandableDayCount > 0,
  };
}

function renderInclusions(section) {
  const icon = name =>
    `<img class="inclusions-icon" ` +
      `src="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/solid/${name}.svg" ` +
      'alt="" width="32" height="32" aria-hidden="true">';
  const column = (kind, title, icon) => {
    const items = section[kind];
    if (!items.length) return '';
    return `<section class="inclusions-column inclusions-column--${kind}">` +
      `<h2>${icon}${title}</h2>` +
      `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` +
    '</section>';
  };

  const included = column('included', 'Incluye', icon('circle-check'));
  const excluded = column('excluded', 'No incluye', icon('ban'));
  return included || excluded ? `<li class="inclusions">${included}${excluded}</li>` : '';
}

function page({ title, bodyHtml, metaLine, heroHtml = '', hasExpandableDays = false }) {
  const safeTitle = escapeHtml(title || 'Itinerario');
  return `<!doctype html>
<html lang="es"> <html lang="es" translate="no" class="notranslate">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${safeTitle} · Brinteva Worlds Inc.</title>
<meta property="og:title" content="${safeTitle}">
<meta property="og:site_name" content="Brinteva Worlds">
<meta property="og:description" content="Su itinerario de viaje.">
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <a class="brand-link" href="${COMPANY_URL}" aria-label="Visitar Brinteva Worlds">
      <img class="brand-logo" src="${COMPANY_LOGO_URL}" alt="Brinteva Worlds" width="640" height="180" decoding="async">
    </a>
  </header>
  <main class="text">
    <p class="eyebrow">Itinerario</p>
    <div class="itinerary-heading">
      <h1>${safeTitle}</h1>
      <button class="share-button" type="button" data-share-itinerary aria-label="Compartir itinerario">
        <img src="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/solid/share-nodes.svg" alt="" width="16" height="16" aria-hidden="true"><span data-share-label>Compartir</span>
      </button>
    </div>
    ${metaLine ? `<p class="meta">${escapeHtml(metaLine)}</p>` : ''}
    ${hasExpandableDays ? '<button class="details-toggle" type="button" data-toggle-details data-expand-label="Expandir" data-collapse-label="Comprimir" aria-expanded="true">Comprimir</button>' : ''}
    ${heroHtml}
    ${bodyHtml}
  </main>
  <section class="contact">
    <h2>¿Tiene preguntas sobre este viaje?</h2>
    <div class="contact-actions">
      <a class="contact-button contact-button--call" href="tel:+19256658003">
        <span class="contact-icon"><img src="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/solid/phone.svg" alt="" width="18" height="18" aria-hidden="true"></span>
        <span class="contact-copy"><span class="contact-label">Reservas</span><strong>(925) 665-8003</strong></span>
      </a>
      <a class="contact-button contact-button--whatsapp" href="https://wa.me/19254353077" target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp al +1 925 435 3077">
        <span class="contact-icon"><img class="whatsapp-icon" src="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/whatsapp.svg" alt="" width="16" height="18" aria-hidden="true"></span>
        <span class="contact-copy"><span class="contact-label">Escríbenos por WhatsApp</span><strong>+1 925 435 3077</strong></span>
      </a>
      <button class="contact-button contact-button--print" type="button" data-print-itinerary>
        <span class="contact-icon"><img src="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/solid/print.svg" alt="" width="18" height="18" aria-hidden="true"></span>
        <span class="contact-copy"><span class="contact-label">Itinerario</span><strong>Imprimir o guardar PDF</strong></span>
      </button>
    </div>
  </section>
  <footer class="site-footer">
    <a class="brand-link" href="${COMPANY_URL}" aria-label="Visitar Brinteva Worlds">
      <img class="brand-logo" src="${COMPANY_LOGO_URL}" alt="Brinteva Worlds" width="640" height="180" loading="lazy" decoding="async">
    </a>
    <p><span class="copyright">© 2026 Todos los derechos reservados.</span>Brinteva Worlds, Inc.</p>
  </footer>
</div>
<script src="/vendor/gsap.min.js" defer></script>
<script src="/vendor/hosted-contact.js" defer></script>
</body>
</html>`;
}

// Render a stored message. Never throws on odd content — a seller pasting a
// shopping list still gets a readable page. `row` may carry hero_* columns;
// absent or invalid ones simply render no hero.
function renderHostedPage(row) {
  const { title, body } = row || {};
  const classified = classifyItineraries(body);
  // Explicit arrow, not a bare `map(parseBody)`: map would hand the array index
  // to parseBody's options argument.
  const opts = { allowBareNumber: classified.allowBareNumber };
  const blocks = classified.kind === 'explicit-appended'
    ? classified.blocks.map(block => parseBody(block, opts))
    : [parseBody(body, opts)];
  const parsed = blocks[0];
  const dayCount = blocks.reduce((total, block) => total + block.dayCount, 0);
  let hasExpandableDays = false;
  const bodyHtml = classified.kind === 'explicit-appended'
    ? blocks.map((block, index) => {
      const { leading, days, hasExpandableDays: blockHasExpandableDays } = renderSections(block.sections);
      hasExpandableDays = hasExpandableDays || blockHasExpandableDays;
      const heading = escapeHtml(block.title || `Tour ${index + 1}`);
      const label = index > 0
        ? `<p class="itinerary-tour-label">Itinerario ${index + 1}</p>`
        : '';
      return `<section class="itinerary-tour">${label}<h2>${heading}</h2>${leading}${days}</section>`;
    }).join('')
    : (() => {
      const { leading, days, hasExpandableDays: parsedHasExpandableDays } = renderSections(parsed.sections);
      hasExpandableDays = parsedHasExpandableDays;
      return leading + days;
    })();
  const metaLine = dayCount > 0
    ? `${dayCount} ${dayCount === 1 ? 'día' : 'días'}`
    : '';
  return page({
    title: title || parsed.title,
    bodyHtml,
    metaLine,
    hasExpandableDays,
    heroHtml: renderHero(row && row.hero ? row.hero : heroFromRow(row)),
  });
}

function notFoundPage() {
  return page({
    title: 'Enlace no disponible',
    bodyHtml: '<div class="block"><p>Este enlace no existe. Revise que esté ' +
              'completo, o comuníquese con su asesor para recibir uno nuevo.</p></div>',
    metaLine: '',
  });
}

// Distinct from "not found" on purpose: an expired link is a live customer with
// real intent, and telling them the itinerary expired — next to the phone
// numbers — turns a dead end into a call.
function expiredPage() {
  return page({
    title: 'Este itinerario venció',
    bodyHtml: '<div class="block"><p>Los itinerarios y las cotizaciones tienen ' +
              'una vigencia limitada porque los precios y la disponibilidad ' +
              'cambian.</p><p>Llámenos y con gusto le enviamos uno actualizado.</p></div>',
    metaLine: '',
  });
}

// Absolute: the link is opened from an SMS on someone else's phone.
function publicBase(env) {
  const base = (env && env.PUBLIC_BASE_URL) || 'https://sms.brintevaworlds.com';
  return new URL(base).origin.replace(/\/+$/, '');
}

function hostedUrl(env, code) {
  return `${publicBase(env)}/i/${code}`;
}

// The SMS that carries the link. The title is sanitized (it is going out over
// GSM-7) and trimmed so the whole line stays inside one segment.
function buildLinkSms(env, title, code) {
  const url = hostedUrl(env, code);
  const cleanTitle = sanitizeForSMS(title || '').replace(/\s+/g, ' ').trim();
  if (cleanTitle) {
    const room = SMS_SEGMENT - url.length - 2; // ": "
    if (room >= 12) return `${cleanTitle.slice(0, room).trim()}: ${url}`;
  }
  return `Su itinerario: ${url}`;
}

// Store a body and hand back the code + URL. Retries on the (vanishingly
// unlikely) unique-key collision rather than surfacing a duplicate-key error.
//
// Validates instead of coercing. `String(undefined)` is the literal string
// "undefined", and an unvalidated body would publish that to a customer as
// their itinerary; an empty one would publish a blank page. Both throw here so
// the caller sends a real SMS failure reason rather than a working link to
// nothing.
async function createHostedMessage(deps, { body, title = null, contactId = null, conversationId = null, source = 'kommo' }) {
  const { db, env } = deps;

  const text = (typeof body === 'string' ? body : '').trim();
  if (!text) throw new Error('El mensaje a alojar está vacío');
  const bytes = bodyByteLength(text);
  if (bytes > MAX_BODY_BYTES) {
    throw new Error(`El mensaje ocupa ${bytes} bytes; el máximo es ${MAX_BODY_BYTES}`);
  }

  const classified = classifyItineraries(text);
  if (classified.kind === 'ambiguous') {
    throw new Error('Detecté más de un itinerario sin el separador --- NUEVO ITINERARIO ---');
  }
  if (classified.kind === 'invalid-marker') {
    throw new Error('Cada lado de --- NUEVO ITINERARIO --- debe incluir al menos un día válido');
  }
  const parsed = parseBody(classified.blocks[0], { allowBareNumber: classified.allowBareNumber });
  const resolvedTitle = String(title ?? parsed.title ?? '').trim().slice(0, 200) || null;

  // Exactly one search per hosted message, before the insert: the hero stays
  // stable for the life of the link and customer page views never touch
  // Unsplash. A null here just means the page renders without a photo.
  const destination = extractDestination(parsed);
  const hero = destination ? await fetchUnsplashHero(deps, destination) : null;
  const heroField = name => (hero && hero[name]) || null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const [ins] = await db.execute(
        `INSERT INTO hosted_messages
           (code, title, body, contact_id, conversation_id, source, expires_at,
            hero_destination, hero_photo_id, hero_image_url, hero_photo_url,
            hero_photographer_name, hero_photographer_url)
         VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?)`,
        [code, resolvedTitle, text, contactId, conversationId, source, ttlDays(env),
         heroField('destination'), heroField('photoId'), heroField('imageUrl'),
         heroField('photoUrl'), heroField('photographerName'), heroField('photographerUrl')]
      );

      // Unsplash treats "selected as a page header" as a download and requires
      // one ping. Fire it only once the row is safely stored, and never let it
      // delay or fail the message.
      if (hero && hero.downloadLocation) {
        trackUnsplashDownload(deps, hero.downloadLocation).catch(() => {});
      }

      return { id: ins.insertId, code, url: hostedUrl(env, code), title: resolvedTitle, hero };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('No se pudo generar un código único para el mensaje alojado');
}

function registerHostedRoutes(app, deps) {
  const { db, log } = deps;

  app.get('/i/:code', async (req, res) => {
    const code = String(req.params.code || '');

    const send = (status, html) => {
      // The code is the only credential, so keep this out of shared caches and
      // out of search engines, and never leak the URL via Referer.
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'private, no-store',
        // The body is text a seller pasted. Without nosniff a browser may
        // ignore the declared type and re-interpret the response as something
        // executable; this pins it to the Content-Type we set.
        'X-Content-Type-Options': 'nosniff',
        // No framing: the page carries customer details behind a bearer URL, so
        // it must not be embeddable for clickjacking or silent reading.
        // frame-ancestors is the modern control, X-Frame-Options covers older
        // browsers that ignore it.
        'X-Frame-Options': 'DENY',
        // External images are limited to the Unsplash hero CDN and Brinteva's
        // logo host. The only scripts allowed are same-origin — the vendored
        // GSAP build and its init script under /vendor, both committed static
        // files (see public/vendor/), never a third-party CDN. Every other
        // external resource stays blocked.
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; " +
          "img-src 'self' data: https://images.unsplash.com https://brintevaworlds.com https://cdn.jsdelivr.net; " +
          "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      res.status(status).send(html);
    };

    if (!new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code)) {
      return send(404, notFoundPage());
    }

    try {
      // Expiry is evaluated in SQL, not JS: the VPS and MySQL both run UTC, and
      // comparing there avoids any driver timezone conversion in between.
      const [rows] = await db.execute(
        `SELECT id, title, body,
                hero_destination, hero_photo_id, hero_image_url, hero_photo_url,
                hero_photographer_name, hero_photographer_url,
                (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired
           FROM hosted_messages
          WHERE code = ?
          LIMIT 1`,
        [code]
      );
      if (rows.length === 0) return send(404, notFoundPage());
      // 410, not 404: the link was real, it just aged out.
      if (rows[0].expired) return send(410, expiredPage());

      send(200, renderHostedPage(rows[0]));

      // After responding: the reader should never wait on a counter.
      db.execute(
        `UPDATE hosted_messages
            SET view_count = view_count + 1,
                first_viewed_at = COALESCE(first_viewed_at, NOW()),
                last_viewed_at = NOW()
          WHERE id = ?`,
        [rows[0].id]
      ).catch(e => console.error('[hosted] view counter error:', e.message));
    } catch (err) {
      console.error('[hosted] render error:', err.message);
      if (log) log.error('hosted', 'Error al mostrar mensaje alojado', { code, error: err.message });
      send(500, notFoundPage());
    }
  });
}

module.exports = {
  generateCode,
  escapeHtml,
  normalizeSellerText,
  toComparable,
  matchGreeting,
  matchDeliveryClause,
  matchSellerWrapper,
  splitInlineWrapper,
  parseBody,
  renderHostedPage,
  notFoundPage,
  expiredPage,
  ttlDays,
  hostedUrl,
  buildLinkSms,
  createHostedMessage,
  registerHostedRoutes,
  ALPHABET,
  CODE_LENGTH,
  MAX_BODY_BYTES,
  bodyByteLength,
  matchDay,
  allowsBareNumberDays,
  matchInclusionHeading,
  splitInlineInclusions,
  sourceDayNumber,
  isNewItineraryMarker,
  classifyItineraries,
  extractDestination,
  isConfidentPlace,
  destinationSearchName,
  fetchUnsplashHero,
  trackUnsplashDownload,
  renderHero,
  heroFromRow,
  isUnsplashImageUrl,
  isUnsplashLinkUrl,
  withReferral,
};
