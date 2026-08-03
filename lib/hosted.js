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
const DEFAULT_TTL_DAYS = 90;

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

// Day headings arrive in several shapes from different tour operators, in two
// languages, and are NOT reliably separated by blank lines — real itineraries
// run day/body/day/body with nothing between them. Parsing is therefore
// line-based and sequential; an earlier block-based version split on blank
// lines and collapsed such a document into one wall of text with zero days.
//
// A line is a heading only when it matches a whole supported shape. That is
// what keeps "day 1 of the conference", "visit on Monday" and "call at
// 09/11/2026" as ordinary paragraph text.

// Route/heading separator: a colon, or a dash/arrow with whitespace around it.
// The whitespace requirement is what preserves hyphenated names such as
// "Aix-en-Provence" and "Baden-Baden".
const SEPARATOR = /:|\s[–—→-]\s/;
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
function matchDay(rawLine) {
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
function parseBody(raw) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')   // CRLF and lone CR both normalize to LF
    .trim();

  let title = null;
  const sections = [];
  let currentDay = null;
  let intro = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue; // blank lines only separate; they carry no content

    const day = matchDay(line);
    if (day) {
      currentDay = { type: 'day', ...day, lines: [] };
      sections.push(currentDay);
      continue;
    }

    if (currentDay) { currentDay.lines.push(line); continue; }

    // Anything before the first day: the opening line titles the document and
    // the rest is introductory text.
    if (title === null) { title = line; continue; }
    if (!intro) { intro = { type: 'text', lines: [] }; sections.push(intro); }
    intro.lines.push(line);
  }

  const dayCount = sections.filter(s => s.type === 'day').length;
  return { title: title || deriveTitle(sections), sections, dayCount };
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

  try {
    const res = await axios.get(UNSPLASH_SEARCH_URL, {
      params: {
        query: `${destination} travel landmark`,
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
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#171a26; --paper-2:#1f2333; --ink:#e8eaf2; --ink-soft:#a0a6bd;
    --crimson:#ca1044; --rule:#2e3345;
  }
}
*,*::before,*::after{box-sizing:border-box}
body{
  margin:0; background:var(--paper); color:var(--ink); line-height:1.62;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-text-size-adjust:100%; font-size:16px;
}
.wrap{max-width:34rem;margin:0 auto;padding:0 1.25rem 3.5rem}
.masthead{
  display:flex;align-items:center;padding:1.25rem 0;
  border-bottom:1px solid var(--rule);margin-bottom:2rem;
}
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
.meta{color:var(--ink-soft);font-size:.875rem;margin:.75rem 0 0}
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
.day h2{font-size:1.0625rem;line-height:1.3;margin:.375rem 0 .5rem;letter-spacing:-.005em}
.day p,.block p{margin:0 0 .75rem}
.day p:last-child,.block p:last-child{margin-bottom:0}
.block{margin:0 0 1.5rem}
.contact{
  margin-top:3rem;padding:1.5rem;background:var(--crimson);
  border-radius:12px;border:1px solid var(--crimson);
}
.contact h2{font-size:.9375rem;margin:0 0 .875rem;letter-spacing:-.005em}
.contact h2,.contact a,.contact span{color:#fff}
.contact a{
  display:block;text-decoration:none;font-weight:600;
  padding:.375rem 0;
}
.contact a:hover,.contact a:focus-visible{text-decoration:underline;text-underline-offset:3px}
.contact a:focus-visible{outline-color:#fff}
.contact-label{
  display:block;font-size:.6875rem;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;opacity:.82;
}
.contact .whatsapp-button{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;
  min-height:5rem;margin-top:1rem;padding:1rem 1.125rem;
  border-radius:10px;background:#087a63;color:#fff;
}
.contact .whatsapp-button:hover,.contact .whatsapp-button:focus-visible{
  background:#066652;text-decoration:none;transform:translateY(-1px);
}
.contact .whatsapp-button:active{transform:translateY(0)}
.whatsapp-icon{display:block;width:2rem;height:2rem;filter:brightness(0) invert(1);flex:none}
.contact .whatsapp-copy{
  display:block;margin-left:auto;text-align:left;opacity:1;
  text-transform:none;letter-spacing:0;
}
.whatsapp-copy strong,.whatsapp-copy small{display:block;color:#fff}
.whatsapp-copy strong{font-size:.875rem;line-height:1.3}
.whatsapp-copy small{font-size:.75rem;font-weight:500;line-height:1.35;margin-top:.125rem}
:focus-visible{outline:2px solid var(--crimson);outline-offset:3px}
.legal{margin-top:2rem;font-size:.75rem;color:var(--ink-soft)}
.site-footer{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;
  margin-top:2rem;padding-top:1.25rem;border-top:1px solid var(--rule);
  color:var(--ink-soft);font-size:.75rem;
}
.site-footer .brand-logo{width:7.5rem}
.site-footer p{margin:0;text-align:right}
.copyright{display:block;margin-bottom:.125rem;font-size:.6875rem}
@media print{
  :root{--paper:#fff;--paper-2:#fff;--ink:#000;--ink-soft:#444;--rule:#bbb;--crimson:#000}
  .wrap{max-width:none}
  .day{break-inside:avoid}
  .contact{background:#fff;border:1px solid #bbb}
  .contact h2,.contact a,.contact span{color:#000}
  .whatsapp-button{display:none}
  .hero{break-inside:avoid}
  .hero img{border-radius:0}
}
`.trim();

function renderSections(sections) {
  let dayNumber = 0;
  const dayHtml = [];
  const leading = [];

  for (const section of sections) {
    if (section.type === 'day') {
      dayNumber += 1;
      // Prefer the number the itinerary itself carries ("Día 3"); only fall back
      // to counting when the source has no label, as in the weekday format.
      const label = section.label || `Día ${dayNumber}`;
      const paras = section.lines.map(l => `<p>${escapeHtml(l)}</p>`).join('');
      dayHtml.push(
        `<li class="day">` +
          `<span class="daynum">${escapeHtml(label)}</span>` +
          (section.date ? `<span class="daydate">${escapeHtml(section.date)}</span>` : '') +
          (section.place ? `<h2>${escapeHtml(section.place)}</h2>` : '') +
          paras +
        `</li>`
      );
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
  };
}

function page({ title, bodyHtml, metaLine, heroHtml = '' }) {
  const safeTitle = escapeHtml(title || 'Itinerario');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${safeTitle} · Brinteva Worlds</title>
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
  <p class="eyebrow">Itinerario</p>
  <h1>${safeTitle}</h1>
  ${metaLine ? `<p class="meta">${escapeHtml(metaLine)}</p>` : ''}
  ${heroHtml}
  ${bodyHtml}
  <section class="contact">
    <h2>¿Tiene preguntas sobre este viaje?</h2>
    <span class="contact-label">Reservas</span><a href="tel:+19256658003">(925) 665-8003</a>
    <a class="whatsapp-button" href="https://wa.me/19256658003" target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp al +1 925 665 8003">
      <img class="whatsapp-icon" src="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/whatsapp.svg" alt="" width="26" height="26" aria-hidden="true">
      <span class="whatsapp-copy"><strong>Escríbenos por WhatsApp</strong><small>+1 925 665 8003</small></span>
    </a>
  </section>
  <footer class="site-footer">
    <a class="brand-link" href="${COMPANY_URL}" aria-label="Visitar Brinteva Worlds">
      <img class="brand-logo" src="${COMPANY_LOGO_URL}" alt="Brinteva Worlds" width="640" height="180" loading="lazy" decoding="async">
    </a>
    <p><span class="copyright">© 2026 Todos los derechos reservados.</span>Brinteva Worlds, Inc.</p>
  </footer>
</div>
</body>
</html>`;
}

// Render a stored message. Never throws on odd content — a seller pasting a
// shopping list still gets a readable page. `row` may carry hero_* columns;
// absent or invalid ones simply render no hero.
function renderHostedPage(row) {
  const { title, body } = row || {};
  const parsed = parseBody(body);
  const { leading, days } = renderSections(parsed.sections);
  const metaLine = parsed.dayCount > 0
    ? `${parsed.dayCount} ${parsed.dayCount === 1 ? 'día' : 'días'}`
    : '';
  return page({
    title: title || parsed.title,
    bodyHtml: leading + days,
    metaLine,
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

  const parsed = parseBody(text);
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
        // logo host. Scripts and every other external resource stay blocked.
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; " +
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
  extractDestination,
  isConfidentPlace,
  fetchUnsplashHero,
  trackUnsplashDownload,
  renderHero,
  heroFromRow,
  isUnsplashImageUrl,
  isUnsplashLinkUrl,
  withReferral,
};
