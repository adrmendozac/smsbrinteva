# Kommo Chats API — Custom Channel Registration

> Working notes from the 2026-06-30 session. Goal: register a custom SMS chat
> channel in Kommo so the Vonage↔Kommo gateway can post inbound SMS, AI replies,
> and delivery status into the Kommo inbox, and receive agent replies back.

---

## 1. Key conclusion — does Kommo need to "provide the APIs"?

**No, for the standard API.** The CRM REST API + OAuth 2.0 are fully self-service:
you create a private integration in your own account
(*Settings → Integrations → Create Integration*) and Kommo's UI auto-generates
your `client_id` and `client_secret` in the **Keys & Scopes** tab. No support
ticket required. The support reps linking the generic API/OAuth docs were
technically correct but not answering our actual question.

**Yes, for ONE thing — the Chats API channel.** A *custom chat channel* (what we
need for SMS) is the only piece that requires Kommo's side. Kommo's support
registers the channel and returns the credentials we sign every request with:

- **`scope_id`** (a.k.a. channel_id) — goes in every endpoint URL
- **`channel_secret`** — HMAC-SHA1 key for the `X-Signature` header

That is exactly the provisioning step Kommo's Marketplace support started by
sending the 15-field registration form (below).

Docs:
- API overview: https://es-developers.kommo.com/docs/kommo-desarrolladores
- OAuth 2.0: https://es-developers.kommo.com/docs/oauth-20
- Register channel: https://developers.kommo.com/reference/register-channel

---

## 2. The 15-field registration form — our answers

| # | Field (ES) | Answer | Status |
|---|---|---|---|
| 1 | Nombre del servicio | **Brinteva SMS** (latin chars, no leading number) | ✅ ready |
| 2 | URL del webhook | `https://sms.brintevaworlds.com/kommo/webhook/:scope_id` | ✅ ready |
| 3 | IDs de cuenta (account ID) | obtained from `/api/v4/account` | ✅ have it |
| 4 | "Escribir primero" (write-first) | **Sí** — we initiate (campaigns + AI) | ✅ decided |
| 5 | Ventana temporal | **No necesaria** — SMS has no 24h window | ✅ decided |
| 6 | Correo de contacto | **adrmendozac@gmail.com** | ✅ ready |
| 7 | Ícono SVG | **`kommo-sms-icon.svg`** — crimson #c8103c disc + white chat bubble, 14×14, 469 B | ✅ ready |
| 8 | UUID del cliente | = **ID de la integración** (client_uuid), from Keys & scopes | ✅ have it |
| 9 | Código del widget | = **Clave secreta** (secret key) — generate in Keys & scopes; user fills into form directly (secret, not stored here) | ⏳ generate + paste |
| 10 | Usuarios objetivo | **Usuarios específicos** (private, our account only) | ✅ decided |
| 11 | ¿Almacena archivos? | **No** — text-only SMS | ✅ decided |
| 12 | ¿Admite reacciones? | **No** | ✅ decided |
| 13 | ¿Admite citas de mensajes? | **No** | ✅ decided |
| 14 | ¿Admite mensajes de voz? | **No** | ✅ decided |
| 15 | Tamaño máximo de archivo | **0 / N/A — solo texto** | ✅ decided |

`:scope_id` in field #2 stays **literal** — Kommo fills it per account.

---

## 3. What Kommo returns after registering

- **Channel ID** (`scope_id`)
- **Channel Secret** (`channel_secret`)
- Bot parameters (bot id, name, client_id) + config

These two are the blockers for going live; everything else can be built now.

---

## 4. The 3 fields only YOU can supply (not in the repo)

These are Kommo account identifiers — by definition they live in Kommo, not in
any file in this codebase:

1. **#3 Workspace/account ID** — `GET https://‹subdomain›.kommo.com/api/v4/account`
   returns the workspace `id`. NOTE: this is the *account* ID (one per workspace),
   **not** the per-user IDs. All users share the one account ID.
2. **#8 Client UUID** — appears after creating the private integration
   (*Settings → Integrations → Create Integration*), in the Keys & Scopes tab.
3. **#9 Widget code** — same Keys & Scopes tab / "My submissions".

---

## 5. Infrastructure — already live (verified 2026-06-30)

| Piece | Status |
|---|---|
| Domain | ✅ `sms.brintevaworlds.com` |
| TLS / HTTPS | ✅ Live, valid cert (Nginx + Let's Encrypt / Certbot) |
| Reverse proxy → Express `127.0.0.1:3001` | ✅ Working (Vonage `/inbound`, `/status`) |
| `POST /kommo/webhook/:scope_id` route | ❌ Returns 404 — **not built yet** |

**Important correction:** HTTPS webhook handling already exists in production
(Vonage uses it). The only thing missing is the *Kommo route* in `index.js` — a
code addition, not infrastructure. No new domain or cert needed.

**Nginx verified (2026-06-30, live):** the site config has a single catch-all
`location /` that proxies *everything* to `http://localhost:3001`, so `/kommo/*`
already passes through to Express — **no new `location` block needed.** Proven:
`POST https://sms.brintevaworlds.com/kommo/webhook/testscope` returns Express's
own 404 (`Cannot POST /kommo/webhook/testscope`), i.e. proxy OK, route missing.
TLS valid (verify=0), HTTP→HTTPS 301 redirect in place. PM2 `sms-bot` online.
`.env` currently has **no `KOMMO_*` vars** (no `KOMMO_ENABLED`/`scope_id`/secret).

VPS: GoDaddy, IP `72.167.54.34`, deploy via `git push production main`.

---

## 6. Gateway build plan (per docs/superpowers + memory)

MySQL stays the source of truth; Kommo is the agent-facing mirror. Four additions
behind a `KOMMO_ENABLED` flag so the live bot keeps working:

1. **Inbound → Kommo:** in `/inbound`, after storing the customer msg, push to
   `POST https://amojo.kommo.com/v2/origin/custom/{scope_id}`; store returned `msgid`.
2. **AI reply → Kommo:** after Haiku's `sendSMS(...'ai')`, import a copy tagged
   "Brinteva AI".
3. **New `POST /kommo/webhook/:scope_id`:** verify `X-Signature` (HMAC-SHA1,
   channel secret) → agent reply → `sendSMS(phone, text, conversationId, 'human')`
   → set conversation `needs_human` to mute the AI.
4. **`/status` → Kommo:** post delivery status to
   `.../{scope_id}/{msgid}/delivery_status`.

Schema delta: `conversations.kommo_chat_id`, `messages.kommo_msg_id`.

**Auth/signature:** `X-Signature` = HMAC-SHA1 of (UPPERCASE method + concatenated
header values + request path), key = `channel_secret`. Delivery-status headers:
Content-Type, Date (RFC2822, valid 15 min), Content-MD5 (lowercase md5 of body),
X-Signature.

---

## 7. Next actions

- [ ] Create the private integration in Kommo → grab **UUID (#8)** + **widget code (#9)**
- [ ] Read **workspace ID (#3)** from `/api/v4/account` or settings
- [ ] Generate the **14×14 circular SVG icon (#7)**
- [ ] Add `POST /kommo/webhook/:scope_id` route to `index.js` (flagged, with HMAC verify)
- [ ] Send completed form to Kommo support → receive `scope_id` + `channel_secret`
- [ ] Set creds in env, flip `KOMMO_ENABLED=1`, deploy, verify with `register-channel` → `connect`

---

*Brinteva Worlds, Inc. — EIN 92-3293741 — Pittsburg, CA*
