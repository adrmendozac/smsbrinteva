# Online SMS Consent Web Page — Design

**Date:** 2026-07-05
**Status:** Approved (brainstorming)
**Author:** Adrian + Claude

## Problem

The 10DLC campaign registration form ("Select and describe where the consent is
collected from the subscribers") has **Online (website, mobile app)** checked with
the URL `https://sms.brintevaworlds.com`. A TCR/carrier reviewer who visits that
URL to verify the online consent mechanism currently sees only the plain-text
response `"SMS Bot is running"` (the `GET /` health route in `index.js`). There is
no online opt-in page, so the "Online" consent channel is unsubstantiated.

We need a real, hosted opt-in page at the site root that:
1. Lets a subscriber give explicit, CTIA-compliant consent to receive SMS.
2. Captures that consent with an audit trail carriers can inspect.
3. Displays the required disclosures and links to the Privacy Policy and SMS Terms.

## Goals

- Serve a functional opt-in form at `https://sms.brintevaworlds.com/` (root).
- Persist real opt-ins into the existing `contacts` table (same table the SMS
  STOP/START flow uses), so web opt-ins are immediately usable as campaign
  recipients.
- Keep an append-only proof-of-consent audit log (`consent_records`).
- Send a one-time confirmation SMS on opt-in (confirmed opt-in), respecting the
  `DRY_RUN` gate used elsewhere.
- Match the existing `public/legal/` page styling and the project's route wiring
  conventions.

## Non-Goals (YAGNI)

- No CAPTCHA / third-party bot service (a hidden honeypot field is enough for now).
- No account system, no email verification, no double opt-in link click.
- No admin UI for browsing consent records in this iteration (they live in MySQL
  and can be queried directly / audited on demand).
- No i18n toggle on the page itself (copy is English; the verbal script already
  covers Spanish for the live-operator channel).

## Architecture

Three pieces, following the existing static-page + Express-route + MySQL pattern.

### 1. Frontend — `public/legal/opt-in.html`

Static HTML/CSS/vanilla-JS page, styled to match `privacy.html` / `sms-terms.html`
(purple `#6b3fd4`, system font stack, `max-width: 760px`). Contents:

- Heading: "Get SMS Updates from Brinteva Worlds" + one-line intro.
- Form fields:
  - **Name** (`text`, required)
  - **Mobile phone number** (`tel`, required)
  - **Consent checkbox** — **unchecked by default** (TCR prohibits pre-checked
    consent). Label is the exact consent language (see Consent Language below),
    with inline `<a href="/privacy">` and `<a href="/sms-terms">` links.
  - **Honeypot** — a visually hidden `website` field; if filled, treat as bot.
- Submit button.
- Inline status region (`<div id="status">`) for success/error messages.
  **No `alert()`/`confirm()`** — browser modal dialogs are forbidden in this
  environment and are bad UX anyway.
- Client JS: `fetch('POST /api/opt-in')` with the form values as JSON; on
  `{ ok: true }` show a success message and disable the form; on error show the
  server's message inline.
- Footer with Privacy Policy + SMS Terms links (consistent with other legal pages).

### 2. Backend — `POST /api/opt-in` in `index.js`

Public endpoint (no PIN gate — this is the public opt-in path). Logic:

1. Parse `{ name, phone, consent, website }` from the JSON body.
2. Reject if `website` (honeypot) is non-empty → `200 { ok: true }` silently
   (don't tell bots they were caught) but persist nothing.
3. Validate: `name` non-empty (trimmed), `consent === true`. On failure →
   `400 { error: 'Name and consent are required.' }`.
4. Normalize phone: strip non-digits. If 10 digits, prepend `1`. Accept only a
   resulting 11-digit string beginning with `1` (US/CA). Otherwise →
   `400 { error: 'Enter a valid US mobile number.' }`.
5. Upsert `contacts`:
   ```sql
   INSERT INTO contacts (phone, name, opted_in)
   VALUES (?, ?, TRUE)
   ON DUPLICATE KEY UPDATE
     name = COALESCE(VALUES(name), name),
     opted_in = TRUE,
     opted_out_at = NULL,
     updated_at = NOW();
   ```
6. Insert an append-only audit row into `consent_records` (see schema) with the
   exact `consent_text` shown on the page, `source = 'web'`, the client IP
   (`req.headers['x-forwarded-for']` first hop, falling back to
   `req.socket.remoteAddress` — nginx is the proxy), and `user_agent`.
7. Send a one-time confirmation SMS via the existing `sendSMS` helper (which
   already honors `DRY_RUN`):
   `"Brinteva Worlds: you're subscribed to recurring travel updates. Msg&data rates may apply. Reply STOP to cancel, HELP for help."`
   Wrap in try/catch so an SMS failure does not fail the opt-in (consent is
   already recorded); log the error.
8. Respond `200 { ok: true }`.

Ordering note: respond only after the DB writes succeed so the user isn't told
"subscribed" if persistence failed. The confirmation SMS is best-effort after
the writes.

### 3. Migration — `migrations/2026-07-05-consent-records.sql`

```sql
CREATE TABLE consent_records (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  phone        VARCHAR(20)  NOT NULL,
  name         VARCHAR(255) NULL,
  consent_text TEXT         NOT NULL,
  source       VARCHAR(32)  NOT NULL DEFAULT 'web',
  ip_address   VARCHAR(64)  NULL,
  user_agent   VARCHAR(512) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_consent_phone (phone),
  INDEX idx_consent_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Append-only: rows are never updated or deleted. This is the artifact a carrier
audit asks for ("show me proof this number consented"). Kept separate from
`contacts` (which is mutable current-state) on purpose.

### 4. Route change in `index.js`

- Change `GET /` from `res.send('SMS Bot is running')` to
  `res.sendFile('public/legal/opt-in.html')`.
- Add `GET /health` returning `SMS Bot is running` so any uptime/monitoring
  check that hit `/` keeps working (repoint it to `/health`).

## Consent Language (canonical)

Shown as the checkbox label on the page AND stored verbatim in
`consent_records.consent_text`:

> I agree to receive recurring automated marketing and customer-care text
> messages from Brinteva Worlds Inc. at the number provided. Consent is not a
> condition of purchase. Msg & data rates may apply. Msg frequency varies. Reply
> STOP to cancel, HELP for help. See our Privacy Policy and SMS Terms &
> Conditions.

## Data Flow

```
Subscriber → opt-in.html form
          → POST /api/opt-in (JSON)
          → validate + normalize phone
          → UPSERT contacts (opted_in = TRUE)
          → INSERT consent_records (audit)
          → sendSMS confirmation (DRY_RUN-gated, best-effort)
          → 200 { ok: true } → inline success on page
```

## Error Handling

| Case | Response |
|------|----------|
| Honeypot filled | `200 { ok: true }`, nothing persisted |
| Missing name / consent not checked | `400 { error }`, inline message |
| Invalid phone | `400 { error }`, inline message |
| DB write fails | `500 { error: 'Something went wrong, please try again.' }`, logged |
| SMS send fails | Opt-in still succeeds; error logged, not surfaced |

## Testing / Verification (VPS flow)

Per project convention (verify on the real DB, no mocked suites):
1. Deploy via `git push production main`.
2. Run the migration against the live MySQL DB.
3. With `DRY_RUN=1`: submit the form (or `curl -X POST /api/opt-in`) and confirm
   a `contacts` row (`opted_in = TRUE`) and a `consent_records` row appear, and
   the confirmation SMS is logged but not actually sent.
4. Spot-check `GET /` returns the page and `/privacy` + `/sms-terms` links
   resolve; `GET /health` returns the old text.
5. Flip `DRY_RUN=0` when satisfied.

## Compliance Notes

- Checkbox unchecked by default (no pre-checked consent) — TCR requirement.
- "Consent is not a condition of purchase" present — TCR requirement.
- Msg frequency + msg&data rates + STOP/HELP disclosures on the same screen as
  the consent action — CTIA requirement.
- Links to Privacy Policy and SMS Terms adjacent to consent — carrier requirement.
- Confirmation SMS = confirmed opt-in, and itself carries STOP/HELP.
- `consent_records` provides the auditable proof-of-consent trail.
