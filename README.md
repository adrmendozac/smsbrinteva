# Brinteva SMS — `sms.brintevaworlds.com`

SMS/MMS platform for Brinteva Worlds, Inc. It provides bulk campaigns with
AI-assisted copywriting, bilingual 10DLC opt-out handling, and a bidirectional
bridge to Kommo CRM, where sales agents manage conversations.

> **This repository contains no secrets.** Credentials, IP addresses, keys, and
> account numbers belong in `.env` or on the VPS. This README documents variable
> names and procedures, never their values.

---

## Stack

| Layer | Technology |
|---|---|
| Server | Ubuntu 24.04 VPS (GoDaddy) |
| Runtime | Node.js 20 + PM2 (`sms-bot` process) |
| Web server | Nginx + Let's Encrypt, proxying to `127.0.0.1:3001` |
| Database | MySQL 8.4 (`brinteva_sms`) |
| AI | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) |
| SMS / MMS / Voice | Vonage **Messages API** (RS256 JWT) + NCCO |
| CRM | Kommo Chats API (external channel) |
| Admin UI | React + Vite + Tailwind 4, built into `public/admin/` |

---

## Repository layout

```text
.
├── index.js                 # Assembles Express, auth, and the Kommo relay
├── lib/
│   ├── campaigns.js         # Campaigns and audience resolution
│   ├── contacts.js          # Contact creation, editing, and archiving
│   ├── database.js          # UTC-safe MySQL pools and connections
│   ├── hosted.js            # Hosted long messages and `/i/:code`
│   ├── hostedInterpreter.js # Haiku interpretation and validation
│   ├── media.js             # MMS image upload and optimization
│   ├── sendEngine.js        # Campaign send engine
│   ├── throughput.js        # Carrier-aware segment budgets
│   ├── kommo.js             # Chats channel and X-Signature verification
│   ├── kommoCrm.js          # Administrative CRM operations
│   ├── webhooks.js          # Inbound messages and delivery receipts
│   └── ...                  # Account, logs, public routes, scheduler, voice
├── shared/
│   ├── api-contract.js      # Shared CommonJS schemas and validator
│   └── api-contract.d.ts    # TypeScript types inferred from the contract
├── test/                    # Shared API contract tests
├── tests/                   # Backend tests with injected dependencies
├── migrations/              # Dated SQL, applied in order during deployment
├── scripts/                 # Migrations, DLR, carrier backfill, reprocessing
├── admin-ui/                # React source; builds into `public/admin/`
├── public/
│   ├── admin/               # Committed admin build
│   ├── legal/               # Bilingual opt-in and legal pages
│   └── vendor/              # Vendored JavaScript for hosted itineraries
└── docs/                    # Itinerary parser contracts and design notes
```

---

## Environment variables

The `.env` file is never committed.

```env
PORT

# Vonage Messages API
VONAGE_APPLICATION_ID
VONAGE_PRIVATE_KEY_PATH
VONAGE_NUMBER
VONAGE_API_KEY          # Balance, pricing, Number Insight, and scripts/dlr.js
VONAGE_API_SECRET       # Same uses as VONAGE_API_KEY

# Anthropic
ANTHROPIC_API_KEY

# MySQL
DB_HOST  DB_PORT  DB_NAME  DB_USER  DB_PASSWORD

# Admin authentication
JWT_SECRET
INBOX_PIN

# Sending
SEND_RATE_PER_SEC       # Additional campaign-engine pacing
DRY_RUN                 # 1 skips Vonage and simulates message IDs
SMS_PRICE_PER_SEGMENT   # Fallback when the Pricing API is unavailable

# Carrier throughput limits, measured in segments rather than messages.
# Defaults live in lib/throughput.js. Environment values may lower the limits,
# but the code clamps them so they cannot exceed the carrier ceilings.
SEGMENTS_PER_MINUTE               # Default 50; AT&T ceiling 75/minute
TMOBILE_SEGMENTS_PER_DAY          # Default 1500; T-Mobile ceiling 2000/day
TMOBILE_CAMPAIGN_SEGMENTS_PER_DAY # Default 1200; reserves room for agent replies
AI_AUTOREPLY                      # 1 enables AI replies; 0 leaves replies to agents

# Hosted long messages
PUBLIC_BASE_URL         # Default https://sms.brintevaworlds.com
HOSTED_LINK_THRESHOLD   # Character count that switches to a hosted link; default 2000
HOSTED_LINK_TTL_DAYS    # Hosted-link lifetime; default 365 days
HOSTED_AI_TIMEOUT_MS    # Haiku interpretation timeout; default 12000 ms
UNSPLASH_ACCESS_KEY     # Optional destination image lookup

# Campaign images (MMS)
MEDIA_DIR               # Outside the checkout; default /var/www/sms-media

# Kommo Chats channel
KOMMO_ENABLED  KOMMO_SCOPE_ID  KOMMO_CHANNEL_SECRET  KOMMO_BOT_ID
KOMMO_MIRROR_AI  KOMMO_ENFORCE_SIGNATURE

# Kommo CRM API
KOMMO_CRM_TOKEN  KOMMO_CRM_SUBDOMAIN
KOMMO_SMS_PIPELINE_ID  KOMMO_SMS_STATUS_ID
KOMMO_LEAD_MENSAJE_CLIENTE_FIELD_ID

# Voice
VOICE_CONNECT  VOICE_EVENT_URL  VOICE_GREETING
VOICE_RING_TIMEOUT  VOICE_FALLBACK_NUMBER
```

---

## Database

| Table | Purpose |
|---|---|
| `contacts` | Phone number, name, opt-in state, archive state, and carrier metadata |
| `conversations` | Per-contact threads with AI, escalation, and resolution state |
| `messages` | One-to-one inbound/outbound messages, delivery state, sender, cost, and segments |
| `broadcasts` | Campaigns in `draft`, `scheduled`, `sending`, `paused`, `completed`, or `failed` state |
| `broadcast_recipients` | Per-recipient state, delivery identifiers, errors, cost, and segments |
| `promotions` | Catalog injected into the AI prompt |
| `consent_records` | Evidence captured by the public 10DLC consent form |
| `logs` | Structured events for sends, receipts, webhooks, auth, and admin actions |
| `hosted_messages` | Raw long-message text, validated Haiku structure, parsing metadata, and cost |

There is no `users` table. A shared PIN protects the admin panel and issues a
12-hour JWT.

Contacts and campaigns are archived rather than deleted. Their
`broadcast_recipients` rows remain the audit trail of what was sent and to whom.

### Migrations

Every schema change is a `YYYY-MM-DD-description.sql` file in `migrations/`.
The production hook applies **all** migration files in order after `npm install`
and before restarting PM2. The runner treats already-applied operations as
idempotent. If a migration fails, deployment stops before the restart, leaving
the previous process active.

Run a migration directly only for a manual or out-of-band operation:

```bash
node scripts/apply-migration.js migrations/YYYY-MM-DD-description.sql
```

The runner loads database credentials through `dotenv`, keeping secrets out of
shell history. There is no local MySQL instance; normal backend verification is
static or uses injected dependencies.

All Node.js MySQL access must use the helpers in `lib/database.js`. They set
mysql2's date conversion to UTC (`timezone: 'Z'`) and pin every MySQL session to
`+00:00`. Both settings are required: the first controls JavaScript `Date`
conversion, while the second keeps `NOW()`, `CURRENT_TIMESTAMP`, and the UTC
day boundary used by the carrier throughput budget aligned if the VPS timezone
changes.

---

## Endpoints

### Public routes and webhooks

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/` | Public 10DLC opt-in form |
| `GET` | `/health` | Health check |
| `GET` | `/robots.txt` | Global crawler exclusion |
| `GET` | `/privacy`, `/sms-terms`, `/consent-script` | 10DLC legal pages and consent script |
| `GET` | `/media/:file` | Optimized campaign image |
| `GET` | `/i/:code` | Hosted itinerary or long message; 404 when absent, 410 when expired |
| `POST` | `/api/opt-in` | Records web consent in `consent_records` |
| `POST` | `/inbound` | Vonage inbound-message webhook |
| `POST` | `/status` | Vonage delivery-receipt webhook |
| `GET`, `POST` | `/voice/answer` | NCCO for inbound calls |
| `POST` | `/voice/events` | Vonage call lifecycle events |
| `POST` | `/kommo/webhook/:scope_id` | Sales-agent replies from Kommo |

Configure `/inbound`, `/status`, `/voice/answer`, and `/voice/events` in the
Vonage application dashboard.

### Admin routes

`POST /api/login` accepts the shared PIN and returns a 12-hour JWT. The SPA shell
is served at `/admin/*`; the application itself presents the login gate.

The following API routes require `Authorization: Bearer <jwt>`:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/contacts` | Active, opted-in contacts for audience selection |
| `GET` | `/api/contacts/all` | All contacts, including archived and opted-out rows |
| `POST`, `PATCH` | `/api/contacts`, `/api/contacts/:id` | Create or edit a contact |
| `PATCH` | `/api/contacts/:id/archive` | Archive or restore a contact |
| `POST` | `/api/suggest` | Draft campaign copy with Claude Haiku |
| `GET`, `POST` | `/api/campaigns` | Campaign history and creation |
| `GET` | `/api/campaigns/:id` | Campaign detail and per-recipient state |
| `POST` | `/api/campaigns/:id/send` | Start an asynchronous send |
| `PATCH` | `/api/campaigns/:id/archive` | Archive or restore a campaign |
| `POST` | `/api/media` | Upload and optimize an MMS image |
| `GET` | `/api/account/balance` | Balance, estimated price, and segment budget |
| `GET` | `/api/logs` | Structured log page with filters and keyset pagination |
| Various | `/api/kommo/*` | Kommo fields, tasks, pipelines, notes, tags, and Salesbot |

### Shared API contract

`shared/api-contract.js` is the executable source of truth for the admin API's
request and response shapes. It is independent of Express and the browser and
exports schema builders, `validate()`, and named contracts for authentication,
contacts, campaigns, media, account balance, and logs.

`shared/api-contract.d.ts` exposes the same contracts to TypeScript and infers
the validated result from the selected contract:

```js
const { contracts, validate } = require('./shared/api-contract');

const result = validate(contracts.createCampaignRequest, req.body);
if (!result.ok) {
  return res.status(400).json({ error: 'Invalid request', issues: result.issues });
}
```

Validation never performs implicit coercion. Raw HTTP parameters such as `id`,
`before`, and `limit` remain strings until the route layer converts them.
Objects reject unknown fields unless their contract explicitly permits them.

The admin typecheck consumes the declarations, and the test suite validates the
runtime contracts. Express handlers still validate inputs manually and do not
yet import the shared module.

```bash
npm test
cd admin-ui && npx tsc --noEmit
```

---

## Inbound SMS flow

```text
1. Upsert the contact and open conversation
2. Store the inbound message
3. HELP / INFO / SOPORTE?  -> send the registered help copy before opt-out checks
4. Opt-out keyword?        -> set opted_in = FALSE and resolve the conversation
5. Opt-in keyword?         -> set opted_in = TRUE
6. Mirror into Kommo       -> the sales agent can view and answer the thread
7. AI_AUTOREPLY = 1        -> Claude Haiku replies; [NEEDS_HUMAN] escalates
```

With `AI_AUTOREPLY=0`, sales agents answer from Kommo. With `1`, Haiku may reply
and escalate the thread. Campaign copy generation does not depend on this flag.

### 10DLC compliance

Keywords are recognized after case, punctuation, and accent normalization:

- **Opt out:** `stop`, `unsubscribe`, `cancel`, `quit`, `end`, `alto`, `pare`,
  `parar`, `detener`, `cancelar`, `fin`, `basta`, `eliminar`, `quitar`
- **Opt in:** `start`, `alta`, `empezar`, `iniciar`, `comenzar`, `suscribir`,
  `suscribirme`
- **Help:** `help`, `info`, `soporte`

`sí` and `yes` are intentionally excluded from the opt-in list. They are normal
conversational replies and must not resubscribe someone accidentally. Confirmation
messages use the English copy registered with the carriers.

> **Opt-out has two independent layers.** `contacts.opted_in` controls what this
> service attempts to send. The mobile carrier maintains its own block, which is
> removed only when the subscriber texts START. Restoring a contact in the admin
> UI repairs only the local state; carrier-blocked messages can appear successful
> without reaching the phone.

---

## Campaign sending

`resolveRecipients` selects only contacts where `opted_in = TRUE` and
`archived_at IS NULL`. The engine checks opt-in again immediately before every
send. A contact who opted out after campaign creation is marked `opted_out`
instead of receiving the message.

The engine also applies `SEND_RATE_PER_SEC`, continues after individual failures,
and stores the Vonage error on each affected recipient.

### Carrier throughput limits

On August 11–12, 2026, a campaign with 1,112 recipients and five segments per
recipient submitted 5,530 segments at once. Vonage rejected all traffic with
error 99 for two days. `lib/throughput.js` exists to prevent a repeat.

Outbound volume is measured in **segments**, the unit carriers meter. The
limiter uses two buckets:

- T-Mobile numbers, stale carrier records, and all unresolved numbers use the
  strict daily budget. The carrier ceiling is 2,000 segments per day.
- Other positively identified mobile carriers use the per-minute budget.

When a campaign exhausts the daily budget, its state becomes `paused` and its
remaining recipients stay `pending`. The scheduler retries paused work every
minute and resumes it after the budget resets. A provider throughput rejection,
including Vonage error 99 or HTTP 429, also pauses the campaign rather than
marking the recipient as failed.

Kommo agent replies consume the same carrier allowance. They obey the absolute
daily limit but can use the reserve above the lower campaign limit, so campaigns
yield before active sales conversations do.

The system resolves each contact's carrier through Number Insight Standard and
stores the result in `contacts.carrier_*`:

```bash
node scripts/backfill-carriers.js --dry-run --limit 20   # Preview
node scripts/backfill-carriers.js                        # Perform lookups
```

The backfill is resumable. It checks only unresolved contacts or records older
than 90 days because phone numbers can be ported. Invalid credentials abort the
run immediately instead of spending one failed request per contact.

Campaign sends are mirrored to Kommo but are not inserted into `messages`, so
they do not appear inside the local conversation thread.

With `DRY_RUN=1`, the campaign engine executes database work, throttling, and
counting without calling Vonage.

### Campaign images (MMS)

The composer accepts JPG, PNG, and GIF files up to **5 MB**. `lib/media.js`
checks magic bytes, requires a minimum 180 px edge, and serializes compression
to protect the VPS from concurrent image-processing spikes. Outbound files are
limited to 480 KiB. JPG and PNG become JPEG; GIF animation is retained when it
can fit within the target.

Files live in `MEDIA_DIR`, outside the checkout, and Express publishes them at
`/media/`. A campaign accepts only URLs under `PUBLIC_BASE_URL/media/`. With an
image attached, the message body becomes an MMS caption and is limited to 300
characters. Campaign history retains the thumbnail, and Kommo receives the
outbound message as an image.

---

## Hosted long messages and itineraries

Vonage rejects SMS text longer than **3,200 characters**. This limit was verified
against the API on August 3, 2026; the then-current 1,000-character documentation
did not match the observed API behavior. Sales agents routinely paste itineraries
of 5,000–12,000 characters into Kommo, so the relay hosts them instead.

```text
Agent submits a 12,103-character itinerary in Kommo
        ↓ exceeds HOSTED_LINK_THRESHOLD (default 2,000)
Store it in hosted_messages and generate a 10-character code
        ↓
Send a one-segment SMS containing the itinerary title and hosted URL
```

This costs one segment instead of dozens, has no practical itinerary-length
limit below the application cap, and preserves characters that GSM-7 cannot
represent. The database stores raw text rather than the SMS-sanitized version.

The URL is the credential; recipients do not log in. Codes are unpredictable
(10 characters, roughly 49 bits). Responses include `noindex`, `no-store`,
`nosniff`, and anti-framing protections. Links expire after 365 days by default
because itineraries may contain customer names, travel dates, booking details,
and time-sensitive prices. Expired links return 410 with a contact page.

All seller-provided text is escaped before rendering.

### What the sales agent sees

After sending a hosted link, the service imports a notice into the same Kommo
thread. The notice states that the original text was sent as a link, includes
its character count and threshold, and provides the hosted URL.

The notice uses the same `importMessage` path as campaigns with `silent: true`,
so Kommo records it without attempting another SMS delivery or sending a reply
webhook back to this service.

### Itinerary parsing

The parsing contract lives in `docs/hosted-itinerary-parsing.md`. It is not a
template that sales agents must follow. The deterministic parser accepts Spanish
and English headings such as `Día 1: BANGKOK`, `1er día:`,
`Day 1 — Chiang Rai`, `viernes, 11 de septiembre de 2026: Roma`, and
`2026-09-11: Rome`. Blank lines between days are optional. A line is a day
heading only when it matches a complete supported shape, so ordinary prose is
not silently reclassified or discarded.

When a hosted message is created, Haiku interprets the flexible input once and
returns references to original source lines for the title, preamble, tours, and
days. This supports separator-free headings such as `Día 1 AEROPUERTO OAXACA`
and documents containing several travel offers. The response is validated
before storage. Visible content always comes from the original text, not a model
rewrite. If Haiku fails, times out, or returns an unsafe structure, the service
falls back to the deterministic parser.

Validated structure is stored in `hosted_messages.ai_structure`. Loading
`/i/:code` never calls Anthropic. Parsing records also store the method, model,
duration, token counts, estimated cost, title origin, and parsing time when
available. At 30 interpretations per day, estimated typical usage is about
**$5.40 USD per month**, with a reference range of $2.25 for short inputs to
$13.95 for long inputs at Haiku 4.5 pricing of $1/M input tokens and $5/M output
tokens.

Existing rows continue using the deterministic parser until explicitly
reprocessed:

```bash
node scripts/reprocess-hosted.js --code 4kq66yjbaq
node scripts/reprocess-hosted.js --limit 25
```

The body limit is **120,000 UTF-8 bytes**, not characters. MySQL counts bytes,
while JavaScript counts UTF-16 code units. The column is therefore `MEDIUMTEXT`,
and the Express JSON and URL-encoded body limits are `256kb`.

### Destination images from Unsplash

When `UNSPLASH_ACCESS_KEY` is configured, message creation performs one lookup
for the first confidently detected destination. For example, `Día 1: BANGKOK`
maps to Bangkok and `CIUDAD DE ORIGEN - ROMA` maps to Rome.

The service links to the Unsplash image instead of copying it to the VPS,
preserves its `ixid`, and includes the required photographer and Unsplash
attribution parameters. The hosted-page CSP permits only
`https://images.unsplash.com` for this external image source.

Without a key, a result, a timely response, or an allowlisted URL, the page
renders normally without a hero image. The English and Spanish privacy pages
disclose that Unsplash may receive the visitor's IP address.

---

## Deployment

Build the admin UI before creating the deployment commit. The commit must
contain both source changes and the regenerated `public/admin/` assets.

```bash
(cd admin-ui && npm run build)
git status --short
# Create a commit containing the source changes and public/admin/ before pushing.
git push origin main
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_smsbrinteva_vps" git push production main
```

The explicit SSH identity is required because default key resolution fails for
the production remote.

The VPS bare repository's `post-receive` hook checks out the new revision, runs
`npm install`, applies every `migrations/*.sql` file in order, and restarts PM2
only after all earlier steps succeed. `origin` is GitHub; `production` is the
VPS.

Run these operational checks on the VPS:

```bash
pm2 list
pm2 logs sms-bot --lines 50
pm2 restart sms-bot

sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w '%{http_code}\n' https://sms.brintevaworlds.com/
```

### Admin UI

```bash
cd admin-ui
npm install
npm run build           # Builds into ../public/admin/
npm run dev             # Vite development server; /api proxies to production
```

The `public/admin/` build is intentionally committed because the VPS does not
compile frontend assets.

For the hosted-itinerary template, the root Vite dependency can serve the
gitignored `itinerario.html` scratch file when it is present. That file is only
for visual review; production renders the real page from `lib/hosted.js` at
`/i/:code`.

---

## Verification

```bash
npm test                              # tests/*.test.js + test/*.test.js
node --check index.js                 # Repeat for each edited backend file
cd admin-ui && npm run build          # Runs tsc -b and regenerates public/admin/
```

The test suite covers itinerary parsing and Haiku validation, crawler controls,
Kommo CRM, MMS processing, carrier throughput, carrier backfill, contact routes,
and the shared API contract. Tests use pure functions or injected dependencies
and require neither local MySQL nor network access.

For deployed verification, check `/health` with `curl` and use `DRY_RUN=1` when
appropriate before sending to a controlled phone number. `scripts/dlr.js`
queries delivery receipts when carrier delivery is uncertain.

---

## Open work

- [ ] Recognize `unstop` as an opt-in keyword
- [ ] Show `opted_out_at` in the admin UI
- [ ] Process inbound MMS payloads instead of discarding them
- [ ] Harden the VPS firewall and bind MySQL to `127.0.0.1`

---

*Brinteva Worlds, Inc.*
