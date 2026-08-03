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
6. extract a destination only when confidence is high; and
7. render a complete itinerary even when destination-image enrichment fails.

Parsing must be linear in the number of input characters and lines. A 30-day
itinerary must not cause recursion, quadratic rescanning, or one API call per
day.

## Input normalization

Before classification, the parser must:

- accept only a string as the hosted body;
- normalize `CRLF` and lone `CR` line endings to `LF`;
- trim outer whitespace without modifying meaningful internal text;
- use a deaccented, lowercase copy only for matching;
- retain the original spelling, accents, capitalization, and punctuation for
  display; and
- treat blank lines as paragraph boundaries, not required section boundaries.

Normalization used for matching must never replace the stored raw itinerary.

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

The parser has three logical states:

1. `preamble`: content before the first recognized day;
2. `day`: content belonging to the current recognized day; and
3. `trailing`: free text after the final day when explicitly separated from it.

When a day heading is recognized, the current section is finalized and a new
day section begins. Every following line belongs to that day until another
heading is recognized. Blank lines divide paragraphs inside the current
section.

Before the first day, a short first non-empty line may be used as the document
title. Remaining preamble content becomes a text section. If no headings are
recognized, the entire document is rendered as title plus ordinary paragraphs.

No input line may disappear because it did not match a known format.

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
- attribution and download tracking; and
- unchanged rendering when no hero is available.

Backend verification uses Node tests and `node --check`. There is no local
MySQL, so database changes are statically validated and applied on the VPS.
No admin UI build is required.
