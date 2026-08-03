// Verification for the hosted-itinerary parsing contract
// (docs/hosted-itinerary-parsing.md). Run with: npm test
//
// These are pure-function tests plus the Unsplash calls exercised through the
// dependency-injection seam the app already uses (deps.axios / deps.db). No
// database is touched and no network request is made, so this suite is safe to
// run anywhere — the live-DB verification stays a separate, manual step.
const test = require('node:test');
const assert = require('node:assert');
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

test('numbered headings do not print the day label twice', () => {
  // label stays null so the renderer supplies exactly one sequential "Día N".
  assert.equal(h.matchDay('Día 1: BANGKOK').label, null);
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });
  assert.equal(html.match(/Día 1/g).length, 1);
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
  assert.match(html, /© 2026 Todos los derechos reservados\.<\/span>[\s\S]*Brinteva Worlds, Inc\./);
  assert.doesNotMatch(html, /class="mark"|class="brand"/);
});

test('renders the questions card in Brinteva crimson with high-contrast text', () => {
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });

  assert.match(html, /\.contact\{[\s\S]*?background:var\(--crimson\)/);
  assert.match(html, /\.contact h2,[\s\S]*?color:#fff/);
  assert.match(html, /href="tel:\+19256658003">\(925\) 665-8003<\/a>/);
});

test('renders a green WhatsApp button with icon, label, and phone number', () => {
  const html = h.renderHostedPage({ body: 'Día 1: BANGKOK\nLlegada.' });

  assert.match(html, /fontawesome-free@6\.7\.2\/svgs\/brands\/whatsapp\.svg/);
  assert.match(html, /class="whatsapp-icon"[^>]*alt=""/);
  assert.match(html, /href="https:\/\/wa\.me\/19256658003"/);
  assert.match(html, /Escríbenos por WhatsApp/);
  assert.match(html, /\+1 925 665 8003/);
  assert.match(html, /\.contact \.whatsapp-button\{[\s\S]*?display:flex;align-items:center;justify-content:space-between/);
  assert.match(html, /\.contact \.whatsapp-button\{[\s\S]*?background:#087a63/);
  assert.match(html, /\.contact \.whatsapp-copy\{[\s\S]*?text-align:left/);
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
  const html = h.renderHostedPage({ body: 'Día 1: <script>alert(1)</script>\nTexto.' });
  const inner = html.slice(html.indexOf('<div class="wrap">'));
  assert.ok(!inner.includes('<script'), 'no attacker-opened tag');
  assert.ok(html.includes('&lt;script&gt;'));

  const injected = h.renderHero({ ...validHero, photographerName: '"><script>alert(1)</script>' });
  assert.ok(!injected.includes('<script'), 'photographer name must be escaped');
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
