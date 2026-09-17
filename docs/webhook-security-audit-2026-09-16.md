# Webhook security and reliability audit

Date: 2026-09-16

Scope: Kommo Chats, Kommo CRM, and Vonage webhook handling in `smsbrinteva`.

The production checks used for this audit were read-only. No VPS environment
variables, Nginx configuration, database data, or database schema were changed.
The VPS remains the authoritative source for production databases and environment
files; the local environment is only a development copy.

## Verified production context

- Kommo integration is enabled.
- Kommo webhook signature enforcement is enabled.
- A Vonage signature secret is configured, but application code does not use it.
- Nginx proxies all paths to Express without a webhook IP allowlist or separate
  authentication layer.
- `messages.vonage_message_id` and `messages.kommo_msgid` have no unique indexes.
- `broadcast_recipients.vonage_message_id` and
  `broadcast_recipients.kommo_msgid` also have no unique indexes.

No credential values were collected or recorded.

## Critical findings

### 1. Vonage webhooks are unauthenticated

`POST /inbound` and `POST /status` accept public requests without validating a
Vonage signature. Production has `VONAGE_SIGNATURE_SECRET` configured, but the
application never consumes it.

Potential impact:

- Forge inbound STOP, START, or HELP messages.
- Trigger outbound compliance SMS and consume carrier allowance.
- Create contacts, conversations, CRM leads, notes, and logs.
- Forge delivery status or cost updates when a message identifier is known.

Relevant code: `lib/webhooks.js`.

### 2. Webhooks acknowledge before durable processing

The Vonage inbound and Kommo webhook handlers send HTTP 200 before database and
message-delivery work completes.

If PM2 restarts, MySQL fails, or the process crashes after acknowledgement, the
provider considers the webhook delivered and may not retry it. An agent reply or
customer message can therefore disappear permanently.

Relevant code:

- `lib/webhooks.js`: `POST /inbound`
- `lib/kommo.js`: `POST /kommo/webhook/:scope_id`

## High-severity findings

### 3. No durable webhook idempotency

Provider message identifiers are stored, but they are not protected by unique
database constraints and are not claimed before side effects occur.

Consequences:

- A repeated Vonage inbound webhook can be stored twice.
- Repeated STOP, START, or HELP events can produce duplicate SMS replies.
- A repeated Kommo agent webhook can send the same customer SMS twice.
- Repeated delivery events can be pushed to Kommo multiple times.

A webhook-event inbox table or carefully scoped unique provider-message
constraints should claim each event before SMS, CRM, or other external effects.

### 4. Kommo URL scope is not validated

`POST /kommo/webhook/:scope_id` verifies the request signature but does not
require the URL parameter to equal `KOMMO_SCOPE_ID`.

Production signature enforcement limits exposure, but checking the configured
scope would prevent cross-channel and path confusion.

### 5. `KOMMO_ENABLED` does not disable inbound Kommo webhooks

Outbound mirroring checks `KOMMO_ENABLED`, but the inbound Kommo webhook route
is always registered and can still relay agent messages through Vonage.

Setting `KOMMO_ENABLED=0` therefore does not disable the complete integration.

## Medium-severity findings

### 6. Minimal Kommo payload validation

The handler extracts nested fields opportunistically but has no strict schema
for:

- Event type
- Provider message identifier
- Recipient phone number format
- Expected scope
- Media URL
- Maximum text length before expensive processing

A validly signed but unexpected Kommo event could enter the SMS relay path.

### 7. Failed Kommo operations are not retried

Failed inbound imports, typing events, hosted notices, and delivery updates are
mostly logged and discarded. Temporary Kommo failures can leave MySQL and Kommo
inconsistent.

A transactional outbox with bounded retry and dead-letter visibility would make
these operations recoverable.

### 8. Full inbound messages reach PM2 logs

The inbound handler writes the complete phone number and customer message to
stdout. The structured database log limits the body to a preview, but PM2 still
receives the full content.

Production logs should use a redacted phone number and omit or strictly truncate
message text.

## Low-severity cleanup

Names and comments remain from the deleted incoming-SMS AI responder:

- `KOMMO_MIRROR_AI`
- `mirrorAi`
- Comments referring to AI/system messages
- Comments saying a Kommo reply mutes AI

These do not currently change behavior, but they obscure the integration's
current human-agent workflow.

## Recommended remediation order

1. Authenticate Vonage webhooks.
2. Add durable idempotency before any SMS or CRM side effects.
3. Acknowledge only after durable acceptance, preferably using an inbox/outbox
   queue rather than waiting for all external work.
4. Validate the Kommo scope and honor `KOMMO_ENABLED` for inbound requests.
5. Add strict webhook payload validation.
6. Add retryable Kommo delivery jobs and dead-letter visibility.
7. Redact sensitive PM2 logging.
8. Remove stale AI configuration and comments.

## Important implementation constraint

Webhook hardening must preserve the existing carrier-throughput invariant:
every outbound SMS path, including compliance and Kommo-agent replies, must
continue through `sendSMS` and `lib/throughput.js`. Idempotency must be claimed
before calling that path so retries cannot spend the carrier allowance twice.
