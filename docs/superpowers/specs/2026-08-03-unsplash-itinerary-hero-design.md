# Unsplash destination hero for hosted itineraries

**Date:** 2026-08-03  
**Status:** Approved design; implementation pending

## Goal

Add a compact destination photograph to hosted itinerary pages. The first
travel destination in the itinerary determines the Unsplash search. Images are
loaded directly from Unsplash and are never copied to the VPS.

The itinerary remains the primary content. A missing destination, missing API
key, empty search result, timeout, rate limit, or other Unsplash failure must
never prevent the hosted message from being created or displayed.

The normative parsing and size requirements are defined in
`docs/hosted-itinerary-parsing.md`. If this design summary and that contract
differ, the parsing contract takes precedence.

## Destination extraction

`lib/hosted.js` will expose a pure helper that accepts the result of
`parseBody()` and returns the first confident destination or `null`.

The production itinerary sample uses consecutive headings such as `Día 1:
BANGKOK`, `Día 2: BANGKOK`, and `Día 3: BANGKOK - CHIANG RAI`, without blank
lines between day blocks. The current parser recognizes only weekday names and
splits primarily on blank lines, so it incorrectly treats the entire sample as
one text section with `dayCount: 0`.

`parseBody()` will therefore be extended before destination extraction. It will
scan lines sequentially and recognize both existing weekday headings and the
numbered form `Día <positive integer>: <place>`, case-insensitively and with or
without the accent on `Día`. Each recognized heading starts a new `day` section;
following lines belong to that section until the next heading. Blank lines are
preserved only as paragraph boundaries and are not required between days. A
numbered heading uses the renderer's generated `Día N` label and leaves the
optional date line empty, avoiding a duplicated day label.

With the supplied nine-day Thailand sample, parsing must produce nine `day`
sections and `dayCount: 9`. The first section's place must be `BANGKOK`, so the
hero search destination is Bangkok. On day 3, `BANGKOK - CHIANG RAI` remains a
route value; it does not affect the already selected first destination.

The helper reads the first parsed `day` section. It uses the section's `place`
value and treats `-`, `–`, `—`, and `→` surrounded by whitespace as route
separators. Requiring surrounding whitespace preserves hyphenated place names.
For a value such as `CIUDAD DE ORIGEN - ROMA`, the last non-empty segment is
`ROMA`, so Rome drives the hero. A place that contains no route separator is
used as-is after trimming.

The helper rejects empty values, the generic labels `origen`, `ciudad de
origen`, and `destino`, values that are only punctuation or numbers, and
candidates longer than 120 characters. Comparisons are case-insensitive and
deaccented. It does not fall back to the itinerary title: an omitted hero is
preferable to an unrelated image.

## Unsplash search

An asynchronous helper receives injected `axios` and `env` dependencies plus
the extracted destination. It returns normalized hero metadata or `null`.

The request is server-side:

- Endpoint: `GET https://api.unsplash.com/search/photos`
- Authentication: `Authorization: Client-ID <UNSPLASH_ACCESS_KEY>`
- API version: `Accept-Version: v1`
- Query: `<destination> travel landmark`
- Options: `per_page=1`, `order_by=relevant`, `orientation=landscape`, and
  `content_filter=high`
- Timeout: 3 seconds

Only `UNSPLASH_ACCESS_KEY` is required. The Unsplash App ID and Secret Key are
not used. The access key remains in the VPS `.env`, is never sent to the
browser, and is never logged.

The first relevant result is normalized into:

- destination
- photo ID
- hotlinked image URL from `photo.urls.regular` (1080 pixels wide)
- photo page URL
- photographer name
- photographer profile URL
- download tracking URL from `photo.links.download_location`
- a useful alt-text fallback derived from the destination

The image URL must retain Unsplash's `ixid` query parameter. Links back to
Unsplash receive `utm_source=brinteva_worlds` and `utm_medium=referral`.

## Selection timing and persistence

The search runs once inside `createHostedMessage()`, before inserting the
hosted message. This produces a stable hero, avoids API calls on customer page
views, and keeps page rendering fast.

The existing, not-yet-deployed
`migrations/2026-08-03-hosted-messages.sql` will be extended with these nullable
columns:

- `hero_destination VARCHAR(120)`
- `hero_photo_id VARCHAR(64)`
- `hero_image_url VARCHAR(2048)`
- `hero_photo_url VARCHAR(2048)`
- `hero_photographer_name VARCHAR(200)`
- `hero_photographer_url VARCHAR(2048)`

All fields remain nullable so existing rows and Unsplash failures continue to
work. The download-tracking URL is used immediately after insertion and is not
stored because it is not needed again.

After the database insert succeeds, the application triggers the exact
`download_location` URL once with server-side authentication. Unsplash defines
selecting an image as a page header as a download-like event. Tracking is
best-effort and asynchronous; a failure is logged without failing the customer
message or exposing credentials.

At demo limits, a new hero normally consumes two API requests: one search and
one download-tracking call. If traffic approaches the demo quota, the Unsplash
application should be submitted for Production status rather than bypassing
the limit.

## Rendering and security

`renderHostedPage()` accepts nullable hero metadata. When valid metadata is
present, it renders a small landscape hero between the itinerary metadata and
the itinerary body:

- responsive width within the existing 34rem content column
- restrained fixed aspect ratio with `object-fit: cover`
- rounded corners consistent with the contact card
- `decoding="async"` and explicit 1080×540 dimensions to reduce layout shift
- meaningful Spanish alt text based on the destination
- print-safe behavior

The image links to the Unsplash photo page. Directly beneath it, visible credit
uses this structure:

`Foto de <Photographer> en Unsplash`

The photographer name links to the photographer's Unsplash profile, and
`Unsplash` links to Unsplash. Both links include the required referral
parameters.

Before rendering, URLs are parsed and allowlisted:

- image source: HTTPS on `images.unsplash.com`
- photo/profile/credit links: HTTPS on `unsplash.com` or its subdomains

Invalid metadata suppresses the whole hero. All text and attributes continue
through HTML escaping. The hosted-page Content Security Policy adds only
`https://images.unsplash.com` to `img-src`; scripts and all other external
resources remain blocked. The existing `Referrer-Policy: no-referrer` remains,
so the private itinerary URL is not disclosed to Unsplash or attribution-link
destinations.

## Privacy and compliance

Unsplash requires API consumers to hotlink returned `photo.urls` images,
preserve tracking identifiers, attribute both the photographer and Unsplash,
link to the photographer profile with referral parameters, keep API keys
confidential, and trigger the supplied download endpoint when a photo is
selected for use.

Hotlinking means the customer's browser contacts Unsplash. Unsplash may receive
the client's IP address and image interaction data. The English and Spanish
Brinteva privacy pages will therefore disclose that hosted itineraries may load
destination imagery from Unsplash and link to the Unsplash Privacy Policy.

The implementation will not copy, proxy, cache, or re-host the image. It will
not expose the API credential, remove `ixid`, suppress attribution, or attempt
to bypass rate limits.

## Error handling and logging

Destination extraction is pure and does not log. Search and tracking failures
use the injected structured logger with the existing `system` category, a
concise Spanish message, and non-sensitive context such as
`component: "hosted"`, destination, HTTP status, or error type. Response bodies
and request headers are not logged because they may contain operational details
or credentials.

Every failure path returns `null` or continues after logging. The core hosted
itinerary flow remains available independently of Unsplash.

## Verification

Automated tests will cover:

- the supplied numbered-day format without blank lines, producing nine days
- continued support for weekday-and-date headings and free-form hosted text
- first-destination extraction from representative Spanish itinerary lines
- safe behavior for ambiguous or malformed content
- normalized Unsplash request parameters and authentication
- successful result normalization
- missing key, empty results, timeout, and API-error fallbacks
- preservation of the `ixid` parameter
- URL host allowlists and HTML escaping
- hero markup, attribution, referral parameters, and no-hero rendering
- creation continuing when Unsplash is unavailable
- exactly one download-tracking request after a successfully stored selection

Backend files will receive `node --check` validation. There is no local MySQL,
so migration behavior is statically reviewed and applied only on the VPS. No
admin UI files or built assets are involved.

## Files in scope

- `lib/hosted.js`: extraction, search, tracking, validation, and rendering
- `index.js`: existing injected `axios`, `env`, and logger flow only if needed
- `migrations/2026-08-03-hosted-messages.sql`: nullable hero metadata columns
- `public/legal/privacy.html`: English Unsplash disclosure
- `public/legal/privacy-es.html`: Spanish Unsplash disclosure
- backend tests for destination, API, rendering, and fallback behavior
- deployment documentation for `UNSPLASH_ACCESS_KEY`

No frontend build is required.
