# Hosted itinerary parsing contract

This document defines the required behavior for parsing and presenting hosted
itineraries. It is a format contract, not a template that sellers must follow.
The parser must accept varied English and Spanish content, preserve everything
it cannot classify, and never depend on a particular destination.

## Core guarantees

The parser must:

1. scan input sequentially, line by line;
2. recognize supported day headings without requiring blank lines;
3. support itineraries of at least 30 days without a hard day-count limit;
4. preserve every non-empty content line in its original order;
5. fall back to ordinary paragraphs when structure is uncertain;
6. extract a destination only when confidence is high;
7. render a complete itinerary even when destination-image enrichment fails; and
8. separate a seller's generic introductory wrapper from the itinerary itself,
   without ever discarding a wrapper-looking line that turns out to be
   meaningful, or one that has no itinerary after it.

Parsing must be linear in the number of input characters and lines. A 30-day
itinerary must not cause recursion, quadratic rescanning, or one API call per
day.

## Input normalization

`hosted_messages.body` always stores the seller's raw text, byte-for-byte,
exactly as pasted. Everything below describes the parser's WORKING COPY —
built fresh from the raw body on every parse — never a value that gets written
back to the database.

Before classification, the parser must:

- accept only a string as the hosted body;
- normalize the working copy to Unicode NFC;
- normalize `CRLF`, lone `CR`, NEL (`U+0085`), line separator (`U+2028`), and
  paragraph separator (`U+2029`) to `LF` — word processors and some webmail
  clients emit the less common separators in place of `\n`, and this parser is
  line-based, so any of them left unconverted would glue two day headings
  together into one unparseable line;
- remove Unicode control and format characters that have no place in
  itinerary prose (bidirectional embeddings, overrides, and isolates among
  them, since their only effect on plain prose is to reorder visible text
  against its logical order — a spoofing primitive, not writing), while
  explicitly preserving tabs, newlines, ZWJ/ZWNJ (they join emoji sequences
  and script letterforms), and LRM/RLM (directional marks with real meaning in
  mixed-direction text);
- trim outer whitespace without modifying meaningful internal text;
- use a deaccented, lowercase, whitespace-collapsed copy only for matching;
- retain the original spelling, accents, capitalization, and punctuation for
  display; and
- treat blank lines as paragraph boundaries, not required section boundaries.

Normalization used for matching must never replace the stored raw itinerary,
and the NFC/control-character pass must never replace it either.

## Supported day headings

Heading recognition must be case-insensitive and support accented and
unaccented Spanish forms.

### Numbered Spanish headings

Required examples:

```text
Día 1: Bangkok
Dia 2: Bangkok
DÍA 03 - Bangkok
Día 4 — Chiang Mai
Día 5 → Phuket
1er día: Bangkok
Primer día: Bangkok
```

### Numbered English headings

Required examples:

```text
Day 1: Bangkok
DAY 02 - Bangkok
Day 3 — Chiang Rai
First day: Bangkok
```

### Spanish weekday and date headings

Required examples:

```text
viernes, 11 de septiembre de 2026: Roma
Sábado 12 de septiembre — Florencia
lunes: Madrid
```

The supported Spanish weekday vocabulary is `lunes`, `martes`, `miércoles`,
`jueves`, `viernes`, `sábado`, and `domingo`, including unaccented equivalents.

### English weekday and date headings

Required examples:

```text
Friday, September 11, 2026: Rome
Saturday, 12 September — Florence
Monday: Madrid
```

The supported English weekday vocabulary is `Monday` through `Sunday`.

### Numeric date headings

Numeric date headings may start a day section only when they contain an
unambiguous destination separator and non-empty place text:

```text
2026-09-11: Rome
09/11/2026 — Rome
11/09/2026 — Roma
```

The parser does not need to decide whether a slash date is month-first or
day-first because it is retained as display text rather than converted into a
calendar value.

## Heading confidence rules

A line becomes a day heading only when it matches an entire supported heading
shape. Incidental phrases such as `visit on Monday`, `day 1 of the conference`,
or `call at 09/11/2026` must remain paragraph text.

A recognized heading produces:

```js
{
  type: 'day',
  label: 'original or normalized day label',
  date: 'optional date text',
  place: 'optional place or route text',
  lines: ['content until the next recognized heading']
}
```

Numbered headings use the renderer's sequential day label and must not display
`Día 1` twice. Weekday/date headings retain their original date text.

## State-machine behavior

The parser has two structural phases, evaluated in a single sequential scan:

1. `leading`: content before the first recognized day; and
2. `day`: content belonging to the current recognized day.

When a day heading is recognized, the current section is finalized and a new
day section begins. Every following line belongs to that day until another
heading is recognized — including free text after the final day, which stays
part of that day's content rather than becoming a separate section. Blank
lines divide paragraphs inside the current section.

The parser defers any decision about the `leading` phase until the scan is
complete: it must not decide a line is a suppressible seller wrapper, a
document title, or something else worth keeping until it knows whether a day
was found at all.

- If no day is ever recognized, the entire normalized input renders as an
  ordinary title-plus-paragraphs fallback. Seller-wrapper classification (see
  below) never runs in this case, and `preamble` is always `null` — a phrase
  that looks exactly like a wrapper must not vanish just because no
  itinerary happened to follow it.
- If a day is recognized, the leading lines before it are classified: a
  recognized seller wrapper is separated into `preamble`; any leading line the
  wrapper does not consume keeps its role as the document title, or as an
  ordinary text section above the itinerary.

No input line may disappear because it did not match a known format.

## Seller-wrapper grammar

A seller wrapper is generic introductory text such as `Le comparto su
itinerario:` or `Hello Ana, here is your itinerary:`. Recognition is an
anchored phrase grammar, not a search for the word "itinerario" or
"itinerary": a wrapper must match a complete, bounded shape, and trip-specific
text must never have a prefix silently stripped from it.

### Suppression requires a proven itinerary

A candidate wrapper is committed to `preamble` — and hidden from the rendered
page — only when at least one day is recognized after it:

```js
parseBody('Le comparto su itinerario:')
// { title: 'Le comparto su itinerario:', preamble: null, sections: [], dayCount: 0 }
```

### Delivery clauses

A delivery clause is the core of a wrapper: a presentation, transfer, or
availability phrase immediately followed by a bounded object token, and
nothing else. Supported families, in Spanish and English:

| Family | Spanish example | English example |
|---|---|---|
| Presentation | `Este es su itinerario` | `This is your itinerary` |
| Transfer | `Le comparto su itinerario` | `I am sharing your itinerary` |
| Availability | `Aquí encontrará su itinerario` | `Please find your itinerary below` |
| "Make it arrive" | `Le hago llegar su itinerario` | — |

Objects are a bounded list — `el itinerario`, `su itinerario`, `tu
itinerario`, `el programa de viaje`, `su programa de viaje`, `los detalles de
su viaje` in Spanish; `the itinerary`, `your itinerary`, `the travel
itinerary`, `your travel itinerary` in English — never an unrestricted
wildcard. Matching is case-insensitive and accent-insensitive. Trailing prose
after the object fails the match rather than having a prefix stripped from it:

```text
Le comparto su itinerario                      — matches
Le comparto su itinerario con el precio final   — does not match
```

A standalone wrapper accepts no terminal punctuation, or exactly one of
`. , ; : ! — -`. A paired leading `¡` is accepted only with a trailing `!`.

### Greetings and courtesy lines

An optional greeting (`Hola`, `Hola Ana`, `Buenos días, Ana`, `Estimada
María`, `Hello`, `Dear customer`, …) may precede a delivery clause. A
recipient name may contain Unicode letters, combining marks, spaces,
apostrophes, hyphens, and the periods used in common honorifics (`Sr.`,
`Sra.`, `Dr.`, `Mr.`, `Mrs.`, `Ms.`), bounded to 80 characters — never digits,
currency symbols, or URLs.

A greeting is never suppressible by itself:

```text
Hola Ana
Día 1: ROMA
```

renders with `preamble: null` and `title: 'Hola Ana'` — only a greeting
immediately followed by a valid delivery clause is classified as part of a
wrapper.

One bounded courtesy line (`Espero que se encuentre bien`, `I hope you are
well`, …) may appear between a greeting and a delivery clause, consumed only
as part of that complete three-line sequence.

### Multi-line and single-line wrappers

Up to three consecutive leading lines are examined — a delivery clause alone,
a greeting plus a delivery clause, or a greeting plus a courtesy line plus a
delivery clause — never lines further into the document, since scanning
deeper could strip a line out of the middle of a meaningful customer note.

```text
Hola Ana,
Le comparto su itinerario:
Día 1: ROMA
```

produces `preamble: 'Hola Ana,\nLe comparto su itinerario:'`.

The same grammar also matches a single combined line, splitting at the first
comma between the greeting and the delivery clause:

```text
Hola Ana, le comparto su itinerario:
Día 1: BANGKOK
```

### Inline wrappers

A wrapper and its day heading may share one line:

```text
Hola Ana, le comparto su itinerario: Día 1: BANGKOK
Llegada.
```

A split is valid only when the prefix independently matches the complete
wrapper grammar AND the suffix independently passes day-heading recognition.
Only `:`, `—`, and `-` are inline terminators — a period commonly ends
ordinary prose, so `Le comparto su itinerario. Día 1: ROMA` is never split.
Candidate terminators are evaluated right to left, bounded to a
500-character prefix and the 8 rightmost terminator candidates, keeping this
constant-bounded per line and linear for the document.

### What is never classified as a wrapper

Meaningful leading content — a trip title, a customer-specific note, a price,
a reservation detail, or any other unrecognized line — is always preserved as
ordinary text, never discarded and never mistaken for a wrapper:

```text
Viaje de aniversario para Ana y Luis
Día 1: ROMA
```

renders with `preamble: null` and `title: 'Viaje de aniversario para Ana y
Luis'`.

### Effects on rendering and the outgoing SMS

`preamble` is parser metadata only — it is never rendered on the hosted page,
since the page already identifies itself as an itinerary. It does change two
things a customer or seller can observe: the derived `title` (used as the page
heading and in the outgoing link SMS) no longer echoes the seller's
boilerplate, and — for the inline case only — a destination that previously
failed to resolve, because the whole line failed day-heading recognition, now
resolves. That can trigger an Unsplash hero lookup that did not happen before
this change; destination extraction and hero rendering are unchanged for
standalone and multi-line wrappers, where day recognition does not move.

## Destination resolution

The hero image is driven by the first confident travel destination, not by the
number of days or by later route segments.

Destination selection follows this order:

1. Use a single place named by the first day heading.
2. If the first day contains a route of named places, use the first real place.
3. Ignore leading generic origin labels and use the next real place.
4. If the first day heading has no place, inspect its first lines for an
   explicit Spanish or English arrival phrase.
5. If no candidate is confident, return `null` and omit the hero.

Examples:

| Input | Destination |
|---|---|
| `Día 1: BANGKOK` | `BANGKOK` |
| `Day 1: Rome - Florence` | `Rome` |
| `CIUDAD DE ORIGEN - ROMA` | `ROMA` |
| `ORIGIN → PARIS` | `PARIS` |
| `Llegada a Madrid` | `Madrid` |
| `Arrival in London` | `London` |

Generic labels include Spanish `origen`, `ciudad de origen`, `destino`, and
English `origin`, `departure city`, and `destination`. Matching is deaccented
and case-insensitive.

Route separators are `-`, `–`, `—`, and `→` surrounded by whitespace.
Requiring whitespace prevents splitting hyphenated names such as
`Aix-en-Provence`.

A destination candidate must:

- be between 2 and 120 characters;
- contain at least one Unicode letter;
- not consist only of a generic label, date, number, or punctuation; and
- preserve its original display spelling after validation.

Destination extraction must never call Unsplash or another external service.

## Unsplash hero enrichment

When a destination is available and `UNSPLASH_ACCESS_KEY` is configured, the
server searches Unsplash once while creating the hosted message:

- query: `<destination> travel landmark`;
- one relevant landscape result;
- `content_filter=high`;
- three-second timeout;
- server-side `Authorization: Client-ID <access key>`; and
- no App ID or Secret Key.

The selected result is stored as nullable metadata. The image remains on
Unsplash and is rendered using the returned hotlinked image URL with its `ixid`
parameter intact.

The page displays a compact hero and visible credit:

```text
Foto de <Photographer> en Unsplash
```

The photographer and Unsplash links include the required referral parameters.
Selecting the image triggers the returned Unsplash `download_location` once.
The Content Security Policy permits images only from
`https://images.unsplash.com` in addition to existing local sources.

Missing credentials, no result, rate limiting, timeouts, invalid URLs, and
tracking failures must not prevent creation or display of the itinerary. These
conditions produce a normal itinerary without a hero and a non-sensitive
structured log entry.

## Content-size limit

The current implementation limits hosted bodies to 32,000 JavaScript
characters. That limit is not sufficient as a universal storage guarantee:
MySQL `TEXT` stores at most 65,535 bytes, JavaScript counts UTF-16 code units,
and UTF-8 characters may require multiple bytes.

The universal implementation must instead enforce:

```text
Maximum hosted itinerary body: 120,000 UTF-8 bytes
```

Required supporting changes:

- change `hosted_messages.body` from `TEXT` to `MEDIUMTEXT`;
- calculate size with `Buffer.byteLength(body, 'utf8')`;
- configure Express JSON and URL-encoded request limits to `256kb`; and
- return a readable validation error before attempting a database insert.

The 120,000-byte limit is independent of day count. It allows detailed
30-day itineraries while leaving room inside the 256 KB webhook envelope for
Kommo metadata. It is approximately 120,000 ASCII characters, but fewer
characters when the text contains multi-byte Unicode.

## Security and privacy

- Escape all seller-provided text before inserting it into HTML.
- Validate stored external URLs with explicit HTTPS host allowlists.
- Never log or return the Unsplash access key.
- Never copy or proxy Unsplash image bytes through the VPS.
- Keep `Referrer-Policy: no-referrer` so bearer itinerary URLs are not leaked.
- Keep hosted pages out of search engines and shared caches.
- Disclose Unsplash image delivery in the English and Spanish privacy pages.
- Preserve the existing behavior for expired and missing hosted links.

## Required verification

Tests must cover:

- Spanish and English numbered headings;
- Spanish and English weekday headings;
- date headings;
- headings with and without blank lines;
- mixed capitalization and missing Spanish accents;
- routes, generic origins, and hyphenated place names;
- explicit Spanish and English arrival phrases;
- free-form content with no recognized days;
- malformed heading-like text that must remain a paragraph;
- generated 30-day input;
- UTF-8 byte limits immediately below and above 120,000 bytes;
- no content loss and stable section order;
- Unsplash success, failure, timeout, and missing-key behavior;
- allowed and rejected external image URLs;
- attribution and download tracking;
- unchanged rendering when no hero is available;
- NFC normalization and every supported line-ending form (CRLF, lone CR, NEL,
  LS, PS);
- control-character removal alongside preservation of tabs, ZWJ/ZWNJ,
  LRM/RLM, emoji, non-Latin scripts, and currency symbols;
- every Spanish and English delivery-clause family, in singular and plural
  voice, with and without accents, and across the documented terminal
  punctuation;
- trip-specific, priced, or instructional text that must never match the
  wrapper grammar;
- greetings with accented, apostrophed, hyphenated, and non-Latin recipient
  names, and greeting-like text that must not qualify;
- a bounded courtesy line consumed only between a greeting and a delivery
  clause;
- standalone, two-line, and three-line wrapper consumption, plus the
  single-line combined form;
- a wrapper with no day anywhere in the document, restored as ordinary text;
- inline wrappers: valid splits, invalid suffixes, meaningful prefixes,
  period boundaries, many terminators evaluated right to left, the
  terminator-candidate cap, and the prefix length cap;
- a synthetic fixture corpus of standalone, multi-line, and inline seller
  wrappers, each with its expected `preamble`, `title`, and `dayCount`;
- line-accounting across every wrapper shape, including generated 30-day
  input;
- wrapper-looking HTML and recipient names carrying apostrophes, ampersands,
  or angle brackets, rendered as inert escaped text; and
- the link SMS carrying the derived itinerary title, never the seller
  wrapper text.

Backend verification uses Node tests and `node --check`. There is no local
MySQL, so database changes are statically validated and applied on the VPS.
No admin UI build is required.
