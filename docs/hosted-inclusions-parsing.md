# Hosted itinerary inclusions parsing contract

This document defines a proposed parser and renderer contract for the
`Incluye` and `No incluye` material often supplied after a travel itinerary.
It extends the hosted itinerary page without changing the meaning of the
seller's source text.

Implemented in `lib/hosted.js`. This document remains the behavioral contract
for future changes.

## Goal

When an itinerary contains explicit inclusion headings, render a clear,
customer-facing comparison block:

- an included column headed `Incluye`, with a positive status icon;
- an excluded column headed `No incluye`, with a neutral exclusion icon; and
- a single-column stacked layout on narrow screens.

The design should follow the reference: generous whitespace, readable bullets,
strong section headings, and a quiet divider between the two groups. It must
use the existing hosted-page color tokens and dark-mode behavior.

## Core guarantees

The inclusion parser must:

1. run after the existing input normalization pass;
2. recognize headings only when the complete normalized line is a supported
   heading, optionally followed by a single terminal colon;
3. preserve every non-empty item in its original order and spelling;
4. never remove, deduplicate, reconcile, or reinterpret conflicting items;
5. treat option qualifiers such as `solo en la opción -SI` as part of the
   item's text;
6. preserve unrecognized content through the existing ordinary-text fallback;
7. make no API calls and add no AI dependency; and
8. remain linear in the number of input lines.

In particular, the parser must not infer that one item cancels another. An
agency may intentionally list an activity as included for one option and
excluded for another option.

## Supported headings

Matching is case-insensitive, accent-insensitive, and whitespace-collapsed.
The original heading is not displayed; rendering uses the canonical label for
the page language.

### Included headings

```text
Incluye
Incluye:
Servicios incluidos
Servicios incluidos:
```

### Excluded headings

```text
No incluye
No incluye:
No incluidos
No incluidos:
Servicios no incluidos
Servicios no incluidos:
```

The following are not headings because they contain substantive item text and
must remain ordinary content:

```text
No incluye vuelos internacionales
Incluye desayuno todos los días
Servicios incluidos según disponibilidad
```

## Recognition and ownership

The existing day parser continues to recognize day headings first. An explicit
inclusion heading begins an `inclusions` section only when it is not a day
heading.

The parser enters one of two states after a recognized heading:

- `included-items`
- `excluded-items`

Every following non-empty line belongs to that state until one of these events
occurs:

1. another recognized inclusion heading begins the other state;
2. a recognized day heading begins a new day section; or
3. end of input is reached.

Blank lines separate visual groups inside the same inclusion list. They do not
end the section and do not create empty list items.

### Inline headings in poorly formatted text

The parser also recognizes a supported heading directly after the start of a
line or a sentence terminator (`.`, `!`, or `?`) when the heading has a colon.
No space is required before or after the terminator:

```text
Fin de los servicios.Incluye: Traslado del hotel.
Fin de los servicios. No incluye: Visado y bebidas.
Incluye: Traslado del hotel.No incluye: Visado y bebidas.
```

The text before the heading remains ordinary itinerary content and the text
after the colon becomes the first item in the matching list. A colon is
required for this inline form, so ordinary prose remains untouched:

```text
El paquete incluye traslado del hotel.
```

An empty recognized heading has no customer-facing output by itself. For
example, a trailing `No incluye:` with no following item remains omitted from
the comparison block. Its raw source remains stored in `hosted_messages.body`.

## Item normalization

For each non-empty line inside an inclusion state:

1. retain the original Unicode-normalized text for display;
2. remove one presentational list prefix only: `•`, `●`, `◦`, `-`, `–`, `—`,
   `*`, or a numbered prefix such as `1.`;
3. trim surrounding whitespace after prefix removal; and
4. retain all remaining punctuation, accents, option names, prices, and text.

Prefix removal is presentation-only. It must not remove a hyphen that is part
of the actual item, for example `opción -SI`.

Multi-line wrapped items are not inferred in the first implementation. Each
non-empty source line is one list item. This avoids joining two legitimate
short items by accident.

## Proposed parsed shape

The current parser returns ordered `sections`. This feature adds an ordered
section only when at least one included or excluded item is present:

```js
{
  type: 'inclusions',
  included: [
    'Traslados de llegada y salida del aeropuerto principal en Dubái.',
    '12 noches de alojamiento en los hoteles indicados.'
  ],
  excluded: [
    'Bebidas no incluidas en las comidas.',
    'Visado no incluido.'
  ]
}
```

The section remains in source order relative to days and ordinary text. The
two arrays preserve the order of their respective headings and items.

If an itinerary repeats `Incluye` or `No incluye`, later items append to the
matching array in the same `inclusions` section until a day heading or end of
input. This supports seller content that inserts a qualifier or normal text
between two same-kind headings without changing the visual grouping.

## Rendering contract

For an `inclusions` section:

1. render a semantic `<section>` with an accessible label;
2. render an `<h2>` for each non-empty column: `Incluye` and/or `No incluye`;
3. render every item as an `<li>` within that column's `<ul>`;
4. use a check-in-circle icon for included content and a slash-in-circle icon
   for excluded content, both marked decorative with `aria-hidden="true"`;
5. never show a heading or empty list for an empty column; and
6. escape every seller-provided item through the existing HTML escaping path.

Desktop layout uses two equal columns with a substantial gap. Mobile layout
stacks included content before excluded content. The first rendered inclusion
block has a top rule and adequate spacing from the preceding itinerary day.

The colors must use the existing semantic tokens:

- included icon: the existing positive green token;
- excluded icon and heading: `var(--ink)` or `var(--ink-soft)`;
- list text: `var(--ink)`;
- rules: `var(--rule)`.

No card background, shadow, gradient, or extra promotional copy is required.

## Example input

```text
INCLUYE
• Asistencia a la llegada en el aeropuerto por personal de habla hispana.
• Traslados de llegada y salida del aeropuerto principal en Dubái.
• 12 noches de alojamiento en los hoteles indicados.
• Espectáculo "Noche Turca" en Capadocia, sólo en la opción -SI.

NO INCLUYE
• Bebidas no incluidas en las comidas.
• Espectáculo "Noche Turca" en Capadocia, excepto en la opción -SI.
• Ticket aéreo Estambul - Dubái no incluido.
• Visado no incluido.
```

Expected display structure:

```text
Incluye                                  No incluye

• Asistencia a la llegada...             • Bebidas no incluidas en las comidas.
• Traslados de llegada y salida...       • Espectáculo "Noche Turca"..., excepto...
• 12 noches de alojamiento...             • Ticket aéreo Estambul - Dubái no incluido.
• Espectáculo "Noche Turca"..., sólo...  • Visado no incluido.
```

Both statements about `Noche Turca` remain visible because their qualifiers
refer to different options.

## Required tests before implementation

1. Spanish headings work in uppercase, lowercase, and without accents.
2. A heading with no items renders nothing for that side.
3. Heading-like sentences remain ordinary paragraphs.
4. Existing day parsing continues after an inclusion section.
5. Mixed bullets, hyphens, stars, and numbered items render as clean list
   items.
6. A literal `opción -SI` retains its hyphen.
7. Items with HTML-like text are escaped.
8. All non-empty source content is either rendered in the comparison block or
   retained by the ordinary-text fallback.
9. Desktop renders two columns when both sides have items; mobile stacks the
    same content in the same order.
10. The existing one-itinerary and appended-itinerary tests remain unchanged.

## Non-goals for the first implementation

- extracting prices, optional excursions, or booking conditions into separate
  structured fields;
- deciding whether an item is contradictory;
- translating seller-provided item text;
- merging wrapped lines into one item;
- supporting headings embedded inside a sentence; and
- changing SMS delivery, hosted-message storage, or itinerary append behavior.
