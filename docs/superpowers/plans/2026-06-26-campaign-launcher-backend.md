# Campaign Launcher Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only SMS campaign launcher to the live Brinteva backend (`index.js`): compose a message, pick an audience (CSV phones + existing contacts), get an AI draft, then send now or on a schedule through a throttled, opt-out-filtered queue.

**Architecture:** New campaign logic lives in isolated, dependency-injected modules under `lib/` (`sms.js`, `sendEngine.js`, `campaigns.js`, `scheduler.js`) that the live `index.js` wires up. The live `/inbound` Haiku engine, `/status`, and `sendSMS()` are left untouched. Campaign sends write **only** to `broadcast_recipients` (a conversation is created only if a recipient later replies via the existing `/inbound`). The three retired inbox endpoints (`/api/conversations`, `/api/messages/:id`, `/api/reply`) are removed per the Kommo pivot.

**Tech Stack:** Node 20, Express 5, mysql2/promise, axios, jsonwebtoken, node-cron. Tests: Jest + supertest with injected DB/axios mocks (no live DB, no real Vonage/Anthropic calls in tests).

**Dev/deploy flow (operator decision):** Development happens **directly on the VPS** at `/var/www/sms.brintevaworlds.com` — that is where the real MySQL DB, `.env` creds, and the running `sms-bot` process already live; local dev would mean stubbing services that already exist server-side. Safety rules carried throughout:
- New code goes in `lib/` modules; `index.js` is only swapped via `mv` after verification, snapshotting first (extend the existing `index.js.bak.<timestamp>` convention).
- Jest + supertest run **on the server** against the real schema (with mocked axios — no real Vonage/Anthropic calls in tests).
- The throttled send engine (real per-SMS cost) stays behind a `DRY_RUN` flag until throttle + opt-out filtering are proven against `broadcast_recipients`.
- **Task 0 first:** investigate the 26 `sms-bot` restarts before adding any routes, so new crashes aren't masked by pre-existing instability.

---

## Context for the implementer (read before starting)

**As-built backend** (`index.js`, 293 lines, mirrors the live VPS file):
- `mysql2/promise` pool `db` (connectionLimit 10), listens `127.0.0.1:${PORT}` behind Nginx, PM2 process `sms-bot`.
- Routes today: `GET /`, `POST /api/login` (PIN→JWT), `requireAuth`, `GET /api/conversations`, `GET /api/messages/:id`, `POST /api/reply`, `POST /inbound` (Haiku engine), `POST /status`.
- Helpers: `sanitizeForSMS()` (strips accents/emoji/markdown → GSM-7 ASCII), `sendSMS(to, text, conversationId, sentBy)` (legacy Nexmo REST `rest.nexmo.com/sms/json`, logs to `messages`).
- The three inbox endpoints + their two helper queries are being deleted in this plan (Task 9).

**Live DB (`brinteva_sms`) — already provisioned:**
- `contacts(id, phone UNIQUE, name, language enum, opted_in tinyint default 1, opted_out_at, created_at, updated_at)`
- `broadcasts(id, name, body TEXT, status enum('draft','scheduled','sending','completed','failed') default 'draft', scheduled_at, sent_count, failed_count, total_count, created_by, created_at, updated_at)`
- `broadcast_recipients(id, broadcast_id FK, contact_id FK, status enum('pending','sent','delivered','failed','opted_out') default 'pending', vonage_message_id, sent_at)` — **no `error` column yet** (added in Task 2).
- `messages`, `conversations`, `promotions` exist and are untouched by this plan.

**Module boundary / DI contract** (so everything is unit-testable without a live DB or real network):
- Every new module takes a `deps` object: `{ db, axios, env, sleep }`.
  - `db` — a mysql2 pool (or a mock exposing `.execute(sql, params) => [rows, fields]`).
  - `axios` — the axios instance (mocked in tests).
  - `env` — `process.env` (or a plain object in tests), reads `ANTHROPIC_API_KEY`, `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_NUMBER`, `SEND_RATE_PER_SEC`.
  - `sleep(ms) => Promise` — injectable so tests run instantly (default `ms => new Promise(r => setTimeout(r, ms))`).
- Route registrars take `(app, deps, requireAuth)` so tests can mount them on a bare Express app with a no-op `requireAuth`.

**New env var:** `SEND_RATE_PER_SEC` (default `1`). Added to `.env` on the VPS in Task 10.

**Recipient model decision:** The frontend parses CSV client-side and posts JSON. The API accepts `{ name, body, contactIds: number[], phones: string[], scheduledAt: string|null }`. New phone numbers in `phones` are upserted into `contacts` (same `ON DUPLICATE KEY` pattern as `/inbound`), then all recipients are filtered to `opted_in = TRUE` and deduped by `contact_id` before `broadcast_recipients` rows are created.

---

## File Structure

- Create `lib/sms.js` — `sanitizeForSMS(text)` extracted for reuse (campaigns + future). Pure function, no deps.
- Create `lib/sendEngine.js` — `sendOne(deps, to, text)` (one Vonage send, returns `{ messageId }` or throws) and `runCampaign(deps, broadcastId)` (throttled loop over pending recipients, re-checks opt-out, updates `broadcast_recipients` + `broadcasts` counters/status).
- Create `lib/campaigns.js` — `resolveRecipients(deps, { contactIds, phones })` and `registerCampaignRoutes(app, deps, requireAuth)` mounting `/api/suggest`, `/api/contacts`, `POST /api/campaigns`, `GET /api/campaigns`, `GET /api/campaigns/:id`, `POST /api/campaigns/:id/send`.
- Create `lib/scheduler.js` — `startScheduler(deps)` registers a node-cron job (every minute) that finds due scheduled broadcasts and runs `runCampaign`.
- Create `migrations/2026-06-26-broadcast-recipients-error.sql` — adds `error` column.
- Modify `index.js` — require new modules, wire `registerCampaignRoutes` + `startScheduler`, replace inline `sanitizeForSMS` with the `lib/sms.js` import, delete the three inbox endpoints.
- Modify `package.json` — add `jsonwebtoken` + `node-cron` to deps, `jest` + `supertest` to devDeps, `"test": "jest"`.
- Create `tests/sms.test.js`, `tests/sendEngine.test.js`, `tests/campaigns.test.js`, `tests/scheduler.test.js`.
- Create `tests/helpers/mockDb.js` — a tiny scripted mysql2 mock used across tests.

---

## Chunk 0: Stabilize before building

### Task 0: Investigate the 26 `sms-bot` restarts

> Do this before adding any routes. New crashes must not be masked by pre-existing instability.

**Where:** VPS, `/var/www/sms.brintevaworlds.com`.

- [ ] **Step 1: Read recent restart history and errors**

```bash
pm2 describe sms-bot | grep -Ei "restart|uptime|status"
pm2 logs sms-bot --lines 200 --nostream | grep -Ei "error|throw|unhandled|econn|fatal" | tail -50
pm2 env 0 | grep -i restart   # check max_restarts / restart policy
```

- [ ] **Step 2: Classify the cause** — DB pool drops? Unhandled promise rejection in `/inbound`? OOM (process is ~36 MB, unlikely)? Determine whether restarts are old (clustered at deploys) or ongoing.

- [ ] **Step 3: Decide gate** — if restarts are ongoing and code-caused, fix or file the root cause before proceeding. If they are historical (e.g., from manual edits/deploys) and the process is currently stable, record that and proceed.

- [ ] **Step 4: Record the finding** in a short note (commit message or `docs/superpowers/notes/`), and update the project memory if the cause is structural.

---

## Chunk 1: Harness, schema, and the pure helper

### Task 1: Test harness + package.json

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`

- [ ] **Step 1: Add deps and test script to `package.json`**

Set `dependencies` to include the already-used-but-unlisted `jsonwebtoken` and the new `node-cron`; add `devDependencies`; set the test script:

```json
{
  "name": "sms.brintevaworlds.com",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "test": "jest",
    "start": "node index.js"
  },
  "dependencies": {
    "@vonage/server-sdk": "^3.27.0",
    "axios": "^1.18.0",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.2",
    "mysql2": "^3.22.5",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create `jest.config.js`**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true
};
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: jest, supertest, node-cron added to `node_modules`; exit 0.

- [ ] **Step 4: Verify jest runs (no tests yet)**

Run: `npx jest --passWithNoTests`
Expected: "No tests found, exiting with code 0".

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json jest.config.js
git commit -m "chore: add jest/supertest harness and node-cron dependency"
```

### Task 2: `error` column migration

**Files:**
- Create: `migrations/2026-06-26-broadcast-recipients-error.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Adds a per-recipient error message so failed campaign sends are debuggable.
ALTER TABLE broadcast_recipients
  ADD COLUMN error VARCHAR(255) NULL AFTER vonage_message_id;
```

- [ ] **Step 2: (Deferred) apply on VPS in Task 10**

This file is applied during deploy (Task 10), not against the live DB now. No code depends on the column existing for local tests (the mock DB ignores it).

- [ ] **Step 3: Commit**

```bash
git add migrations/2026-06-26-broadcast-recipients-error.sql
git commit -m "feat: migration adding error column to broadcast_recipients"
```

### Task 3: Extract `sanitizeForSMS` to `lib/sms.js` (TDD)

**Files:**
- Create: `lib/sms.js`
- Test: `tests/sms.test.js`
- Modify: `index.js` (replace inline function with import)

- [ ] **Step 1: Write the failing test**

```js
// tests/sms.test.js
const { sanitizeForSMS } = require('../lib/sms');

describe('sanitizeForSMS', () => {
  test('strips accents to ASCII', () => {
    expect(sanitizeForSMS('días en París')).toBe('dias en Paris');
  });
  test('removes emoji and non-ASCII', () => {
    expect(sanitizeForSMS('Hola 👋 mundo')).toBe('Hola  mundo');
  });
  test('removes markdown bold markers', () => {
    expect(sanitizeForSMS('**Oferta** __hoy__')).toBe('Oferta hoy');
  });
  test('collapses 3+ blank lines to 2 and trims', () => {
    expect(sanitizeForSMS('a\n\n\n\nb\n')).toBe('a\n\nb');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/sms.test.js`
Expected: FAIL — cannot find module `../lib/sms`.

- [ ] **Step 3: Create `lib/sms.js`** (lift the exact logic from `index.js`)

```js
// Strip emojis, accents, and markdown so SMS sends as clean GSM-7 ASCII.
function sanitizeForSMS(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\*\*/g, '').replace(/__/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { sanitizeForSMS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/sms.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewire `index.js` to use the module**

In `index.js`: after the existing `require` lines add `const { sanitizeForSMS } = require('./lib/sms');` and **delete** the inline `function sanitizeForSMS(text) { ... }` definition (the block under the `// Strip emojis...` comment). Leave every call site unchanged.

- [ ] **Step 6: Smoke-check index loads**

Run: `node -e "require('./lib/sms'); console.log('ok')"`
Expected: prints `ok`. (Full `index.js` boot needs a DB and is covered at deploy time.)

- [ ] **Step 7: Commit**

```bash
git add lib/sms.js tests/sms.test.js index.js
git commit -m "refactor: extract sanitizeForSMS to lib/sms with tests"
```

---

## Chunk 2: Send engine

### Task 4: Mock DB helper + `sendOne` (TDD)

**Files:**
- Create: `tests/helpers/mockDb.js`
- Create: `lib/sendEngine.js`
- Test: `tests/sendEngine.test.js`

- [ ] **Step 1: Create the scripted mock DB helper**

```js
// tests/helpers/mockDb.js
// Minimal mysql2/promise pool stand-in. `execute` is a jest.fn the test scripts.
function makeMockDb() {
  const execute = jest.fn();
  return { execute, _calls: () => execute.mock.calls };
}
module.exports = { makeMockDb };
```

- [ ] **Step 2: Write the failing test for `sendOne`**

```js
// tests/sendEngine.test.js
const { sendOne } = require('../lib/sendEngine');

function deps(overrides = {}) {
  return {
    db: { execute: jest.fn() },
    axios: { post: jest.fn() },
    env: { VONAGE_API_KEY: 'k', VONAGE_API_SECRET: 's', VONAGE_NUMBER: '15550000000', SEND_RATE_PER_SEC: '50' },
    sleep: jest.fn().mockResolvedValue(),
    ...overrides
  };
}

describe('sendOne', () => {
  test('posts to Nexmo REST and returns the message id', async () => {
    const d = deps();
    d.axios.post.mockResolvedValue({ data: { messages: [{ 'message-id': 'abc123' }] } });
    const res = await sendOne(d, '15551234567', 'Hola');
    expect(d.axios.post).toHaveBeenCalledWith(
      'https://rest.nexmo.com/sms/json',
      expect.objectContaining({ to: '15551234567', text: 'Hola', from: '15550000000' })
    );
    expect(res).toEqual({ messageId: 'abc123' });
  });

  test('throws when Vonage returns a non-zero status', async () => {
    const d = deps();
    d.axios.post.mockResolvedValue({ data: { messages: [{ status: '4', 'error-text': 'bad' }] } });
    await expect(sendOne(d, '15551234567', 'Hola')).rejects.toThrow('bad');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest tests/sendEngine.test.js`
Expected: FAIL — cannot find module `../lib/sendEngine`.

- [ ] **Step 4: Implement `sendOne` in `lib/sendEngine.js`**

```js
async function sendOne({ axios, env }, to, text) {
  // DRY_RUN gate: prove throttle + opt-out filtering against broadcast_recipients
  // before spending real money. When set, no Vonage call is made.
  if (env.DRY_RUN === '1' || env.DRY_RUN === true) {
    return { messageId: `dryrun-${Date.now()}` };
  }
  const res = await axios.post('https://rest.nexmo.com/sms/json', {
    api_key: env.VONAGE_API_KEY,
    api_secret: env.VONAGE_API_SECRET,
    from: env.VONAGE_NUMBER,
    to,
    text
  });
  const msg = res.data.messages?.[0] || {};
  if (msg.status && msg.status !== '0') {
    throw new Error(msg['error-text'] || `Vonage status ${msg.status}`);
  }
  return { messageId: msg['message-id'] || null };
}

module.exports = { sendOne };
```

Add a test alongside the others in Task 4 Step 2:

```js
test('sendOne in DRY_RUN makes no Vonage call', async () => {
  const d = deps({ env: { DRY_RUN: '1' } });
  const res = await sendOne(d, '15551234567', 'Hola');
  expect(d.axios.post).not.toHaveBeenCalled();
  expect(res.messageId).toMatch(/^dryrun-/);
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest tests/sendEngine.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/sendEngine.js tests/sendEngine.test.js tests/helpers/mockDb.js
git commit -m "feat: sendOne campaign Vonage send with status-check tests"
```

### Task 5: `runCampaign` throttled loop (TDD)

**Files:**
- Modify: `lib/sendEngine.js`
- Test: `tests/sendEngine.test.js`

`runCampaign` behavior:
1. Set `broadcasts.status = 'sending'`.
2. Load pending recipients joined to contacts: `SELECT br.id, br.contact_id, c.phone, c.opted_in FROM broadcast_recipients br JOIN contacts c ON c.id = br.contact_id WHERE br.broadcast_id = ? AND br.status = 'pending'`.
3. Load the broadcast `body`.
4. For each recipient, throttle with `await sleep(1000 / rate)` (rate from `env.SEND_RATE_PER_SEC`, default 1):
   - If `opted_in` is falsy → mark recipient `opted_out`, continue (do not send).
   - Else `sendOne` → on success mark `sent`, store `vonage_message_id`, `sent_at = NOW()`; on throw mark `failed`, store `error` (truncated 255).
5. Recompute `sent_count` / `failed_count` from `broadcast_recipients`, set `broadcasts.status = 'completed'`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/sendEngine.test.js
const { runCampaign } = require('../lib/sendEngine');

test('runCampaign sends to opted-in, skips opted-out, updates counts', async () => {
  const d = deps();
  // Script db.execute by call order:
  d.db.execute
    .mockResolvedValueOnce([{}])                                   // UPDATE status='sending'
    .mockResolvedValueOnce([[                                       // SELECT pending recipients
      { id: 11, contact_id: 1, phone: '15551110000', opted_in: 1 },
      { id: 12, contact_id: 2, phone: '15552220000', opted_in: 0 }
    ]])
    .mockResolvedValueOnce([[{ body: 'Promo!' }]])                  // SELECT body
    .mockResolvedValueOnce([{}])                                   // UPDATE recipient 11 -> sent
    .mockResolvedValueOnce([{}])                                   // UPDATE recipient 12 -> opted_out
    .mockResolvedValueOnce([{}]);                                  // UPDATE broadcast counts + completed
  d.axios.post.mockResolvedValue({ data: { messages: [{ 'message-id': 'm1' }] } });

  await runCampaign(d, 7);

  // Only the opted-in recipient was actually sent
  expect(d.axios.post).toHaveBeenCalledTimes(1);
  expect(d.axios.post).toHaveBeenCalledWith(expect.any(String),
    expect.objectContaining({ to: '15551110000', text: 'Promo!' }));
  // Throttle was applied per recipient
  expect(d.sleep).toHaveBeenCalled();
  // Final update marks the broadcast completed
  const lastSql = d.db.execute.mock.calls.at(-1)[0];
  expect(lastSql).toMatch(/completed/i);
});

test('runCampaign marks a recipient failed with the error text', async () => {
  const d = deps();
  d.db.execute
    .mockResolvedValueOnce([{}])
    .mockResolvedValueOnce([[{ id: 11, contact_id: 1, phone: '15551110000', opted_in: 1 }]])
    .mockResolvedValueOnce([[{ body: 'Promo!' }]])
    .mockResolvedValueOnce([{}])   // UPDATE recipient -> failed
    .mockResolvedValueOnce([{}]);  // UPDATE broadcast counts
  d.axios.post.mockRejectedValue(new Error('network down'));

  await runCampaign(d, 7);

  const failCall = d.db.execute.mock.calls.find(c => /'failed'|= 'failed'|status = \?/.test(c[0]) && (c[1]||[]).includes('network down'));
  expect(failCall).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/sendEngine.test.js -t runCampaign`
Expected: FAIL — `runCampaign` is not a function.

- [ ] **Step 3: Implement `runCampaign`**

```js
async function runCampaign(deps, broadcastId) {
  const { db, env } = deps;
  const rate = Number(env.SEND_RATE_PER_SEC) > 0 ? Number(env.SEND_RATE_PER_SEC) : 1;
  const gap = Math.round(1000 / rate);

  await db.execute(`UPDATE broadcasts SET status = 'sending' WHERE id = ?`, [broadcastId]);

  const [recipients] = await db.execute(
    `SELECT br.id, br.contact_id, c.phone, c.opted_in
       FROM broadcast_recipients br
       JOIN contacts c ON c.id = br.contact_id
      WHERE br.broadcast_id = ? AND br.status = 'pending'`,
    [broadcastId]
  );
  const [[bcast]] = [await db.execute(`SELECT body FROM broadcasts WHERE id = ?`, [broadcastId])];
  const body = bcast[0].body;

  for (const r of recipients) {
    await deps.sleep(gap);
    if (!r.opted_in) {
      await db.execute(
        `UPDATE broadcast_recipients SET status = 'opted_out' WHERE id = ?`, [r.id]
      );
      continue;
    }
    try {
      const { messageId } = await sendOne(deps, r.phone, body);
      await db.execute(
        `UPDATE broadcast_recipients
            SET status = 'sent', vonage_message_id = ?, error = NULL, sent_at = NOW()
          WHERE id = ?`,
        [messageId, r.id]
      );
    } catch (err) {
      await db.execute(
        `UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?`,
        [String(err.message).slice(0, 255), r.id]
      );
    }
  }

  await db.execute(
    `UPDATE broadcasts b SET
        b.sent_count   = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'sent'),
        b.failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed'),
        b.status = 'completed'
      WHERE b.id = ?`,
    [broadcastId]
  );
}

module.exports = { sendOne, runCampaign };
```

> Note: the `[[bcast]] = [await ...]` line above is awkward; in implementation use the plain form `const [bodyRows] = await db.execute(...); const body = bodyRows[0].body;` and align the test's mock ordering (body SELECT is the 3rd `execute` call). Keep the test and code in lockstep.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/sendEngine.test.js`
Expected: PASS (all sendEngine tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sendEngine.js tests/sendEngine.test.js
git commit -m "feat: runCampaign throttled send loop with opt-out + failure handling"
```

---

## Chunk 3: Campaign routes

### Task 6: `resolveRecipients` (TDD)

**Files:**
- Create: `lib/campaigns.js`
- Test: `tests/campaigns.test.js`

`resolveRecipients(deps, { contactIds, phones })`:
1. Upsert each phone in `phones` into `contacts` (`INSERT ... ON DUPLICATE KEY UPDATE updated_at = NOW()`).
2. Resolve all phones to contact ids.
3. Union with `contactIds`, dedupe.
4. Filter to `opted_in = TRUE`.
5. Return `number[]` of contact ids.

- [ ] **Step 1: Write the failing test**

```js
// tests/campaigns.test.js
const { resolveRecipients } = require('../lib/campaigns');

function deps() {
  return { db: { execute: jest.fn() }, axios: { post: jest.fn() }, env: {}, sleep: jest.fn() };
}

test('resolveRecipients upserts phones, merges ids, dedupes, filters opt-out', async () => {
  const d = deps();
  d.db.execute
    .mockResolvedValueOnce([{}])                          // upsert phone 1
    .mockResolvedValueOnce([[{ id: 2, opted_in: 1 }]])    // resolve phone -> contact 2
    .mockResolvedValueOnce([[                              // final opted-in filter over [1,2,3]
      { id: 1 }, { id: 2 }                                 // 3 is opted out -> excluded
    ]]);
  const ids = await resolveRecipients(d, { contactIds: [1, 3], phones: ['15551112222'] });
  expect(ids.sort()).toEqual([1, 2]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/campaigns.test.js -t resolveRecipients`
Expected: FAIL — cannot find module / not a function.

- [ ] **Step 3: Implement `resolveRecipients`**

```js
async function resolveRecipients({ db }, { contactIds = [], phones = [] }) {
  const ids = new Set(contactIds.map(Number).filter(Boolean));

  for (const phone of phones) {
    const p = String(phone).trim();
    if (!p) continue;
    await db.execute(
      `INSERT INTO contacts (phone) VALUES (?)
       ON DUPLICATE KEY UPDATE updated_at = NOW()`, [p]
    );
    const [rows] = await db.execute(`SELECT id FROM contacts WHERE phone = ?`, [p]);
    if (rows[0]) ids.add(rows[0].id);
  }

  if (ids.size === 0) return [];
  const list = [...ids];
  const placeholders = list.map(() => '?').join(',');
  const [optedIn] = await db.execute(
    `SELECT id FROM contacts WHERE id IN (${placeholders}) AND opted_in = TRUE`, list
  );
  return optedIn.map(r => r.id);
}

module.exports = { resolveRecipients };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/campaigns.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns.js tests/campaigns.test.js
git commit -m "feat: resolveRecipients with phone upsert, dedupe, opt-out filter"
```

### Task 7: Campaign routes — create/list/get + suggest + contacts (TDD)

**Files:**
- Modify: `lib/campaigns.js` (add `registerCampaignRoutes`)
- Test: `tests/campaigns.test.js`

Routes (all behind `requireAuth`):
- `GET /api/contacts` → opted-in contacts `{ id, phone, name }` for the audience picker.
- `POST /api/suggest` `{ prompt }` → one-shot Haiku draft (`claude-haiku-4-5-20251001`, max_tokens 300), returns `{ text }` (sanitized).
- `POST /api/campaigns` `{ name, body, contactIds, phones, scheduledAt }` → `resolveRecipients`, insert `broadcasts` (status `scheduled` if `scheduledAt` else `draft`, `total_count` = recipients, `created_by` from JWT), bulk-insert `broadcast_recipients` (status `pending`). Returns `{ id, total: N }`. 400 if no opted-in recipients.
- `GET /api/campaigns` → list ordered by `created_at DESC`.
- `GET /api/campaigns/:id` → broadcast + per-status recipient counts.

- [ ] **Step 1: Write failing supertest cases**

```js
// append to tests/campaigns.test.js
const express = require('express');
const request = require('supertest');
const { registerCampaignRoutes } = require('../lib/campaigns');

const noAuth = (req, _res, next) => { req.user = { role: 'admin', name: 'admin' }; next(); };

function appWith(d) {
  const app = express();
  app.use(express.json());
  registerCampaignRoutes(app, d, noAuth);
  return app;
}

test('GET /api/contacts returns opted-in contacts', async () => {
  const d = deps();
  d.db.execute.mockResolvedValueOnce([[{ id: 1, phone: '15551110000', name: 'Ana' }]]);
  const res = await request(appWith(d)).get('/api/contacts');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([{ id: 1, phone: '15551110000', name: 'Ana' }]);
});

test('POST /api/campaigns creates a draft and seeds recipients', async () => {
  const d = deps();
  d.db.execute
    .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]])  // resolveRecipients opted-in filter (no phones)
    .mockResolvedValueOnce([{ insertId: 99 }])        // INSERT broadcasts
    .mockResolvedValueOnce([{}]);                     // bulk INSERT broadcast_recipients
  const res = await request(appWith(d))
    .post('/api/campaigns')
    .send({ name: 'Junio', body: 'Promo', contactIds: [1, 2], phones: [], scheduledAt: null });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: 99, total: 2 });
});

test('POST /api/campaigns 400 when no opted-in recipients', async () => {
  const d = deps();
  d.db.execute.mockResolvedValueOnce([[]]); // none opted in
  const res = await request(appWith(d))
    .post('/api/campaigns')
    .send({ name: 'x', body: 'y', contactIds: [5], phones: [], scheduledAt: null });
  expect(res.status).toBe(400);
});

test('POST /api/suggest returns a sanitized Haiku draft', async () => {
  const d = deps();
  d.env.ANTHROPIC_API_KEY = 'k';
  d.axios.post.mockResolvedValueOnce({ data: { content: [{ text: '¡Hola! **Oferta**' }] } });
  const res = await request(appWith(d)).post('/api/suggest').send({ prompt: 'verano' });
  expect(res.status).toBe(200);
  expect(res.body.text).toBe('Hola! Oferta');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/campaigns.test.js`
Expected: FAIL — `registerCampaignRoutes` not exported.

- [ ] **Step 3: Implement `registerCampaignRoutes`**

```js
const { sanitizeForSMS } = require('./sms');

function registerCampaignRoutes(app, deps, requireAuth) {
  const { db, axios, env } = deps;

  app.get('/api/contacts', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT id, phone, name FROM contacts WHERE opted_in = TRUE ORDER BY name IS NULL, name, id`
      );
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/suggest', requireAuth, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    try {
      const ai = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: 'You write short, friendly Spanish SMS marketing copy for Brinteva Worlds, a travel agency. Plain ASCII only, no emoji, no markdown, under 320 characters.',
        messages: [{ role: 'user', content: prompt }]
      }, {
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      });
      res.json({ text: sanitizeForSMS(ai.data.content[0].text) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/campaigns', requireAuth, async (req, res) => {
    const { name, body, contactIds = [], phones = [], scheduledAt = null } = req.body;
    if (!name || !body) return res.status(400).json({ error: 'name and body required' });
    try {
      const ids = await resolveRecipients(deps, { contactIds, phones });
      if (ids.length === 0) return res.status(400).json({ error: 'No opted-in recipients' });

      const status = scheduledAt ? 'scheduled' : 'draft';
      const createdBy = (req.user && req.user.name) || 'admin';
      const [ins] = await db.execute(
        `INSERT INTO broadcasts (name, body, status, scheduled_at, total_count, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, sanitizeForSMS(body), status, scheduledAt, ids.length, createdBy]
      );
      const broadcastId = ins.insertId;

      const values = ids.map(() => '(?, ?, \'pending\')').join(',');
      const params = ids.flatMap(id => [broadcastId, id]);
      await db.execute(
        `INSERT INTO broadcast_recipients (broadcast_id, contact_id, status) VALUES ${values}`,
        params
      );
      res.json({ id: broadcastId, total: ids.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/campaigns', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT id, name, body, status, scheduled_at, sent_count, failed_count, total_count, created_by, created_at
           FROM broadcasts ORDER BY created_at DESC`
      );
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/campaigns/:id', requireAuth, async (req, res) => {
    try {
      const [[b]] = [await db.execute(`SELECT * FROM broadcasts WHERE id = ?`, [req.params.id])];
      if (!b[0]) return res.status(404).json({ error: 'Not found' });
      const [counts] = await db.execute(
        `SELECT status, COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? GROUP BY status`,
        [req.params.id]
      );
      res.json({ ...b[0], recipientCounts: counts });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

module.exports = { resolveRecipients, registerCampaignRoutes };
```

> Implementation note: replace the awkward `const [[b]] = [await ...]` with `const [bRows] = await db.execute(...)` and use `bRows[0]`; keep test mock ordering aligned.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/campaigns.test.js`
Expected: PASS (all campaign tests).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns.js tests/campaigns.test.js
git commit -m "feat: campaign routes (contacts, suggest, create, list, detail)"
```

### Task 8: `POST /api/campaigns/:id/send` + scheduler (TDD)

**Files:**
- Modify: `lib/campaigns.js` (add the send-now route; fire-and-forget `runCampaign`)
- Create: `lib/scheduler.js`
- Test: `tests/campaigns.test.js`, `tests/scheduler.test.js`

- [ ] **Step 1: Write the failing test for send-now**

```js
// append to tests/campaigns.test.js
const sendEngine = require('../lib/sendEngine');

test('POST /api/campaigns/:id/send kicks off runCampaign and returns 202', async () => {
  const d = deps();
  const spy = jest.spyOn(sendEngine, 'runCampaign').mockResolvedValue();
  d.db.execute.mockResolvedValueOnce([[{ id: 5, status: 'draft' }]]); // load broadcast
  const res = await request(appWith(d)).post('/api/campaigns/5/send');
  expect(res.status).toBe(202);
  expect(spy).toHaveBeenCalledWith(d, 5);
  spy.mockRestore();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/campaigns.test.js -t send`
Expected: FAIL — route 404 / runCampaign not called.

- [ ] **Step 3: Implement the send-now route**

Add inside `registerCampaignRoutes`, and require the engine at the top of `lib/campaigns.js` (`const sendEngine = require('./sendEngine');`). Use `sendEngine.runCampaign` (not a destructured import) so the test's `jest.spyOn` intercepts it.

```js
  app.post('/api/campaigns/:id/send', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(`SELECT id, status FROM broadcasts WHERE id = ?`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      if (['sending', 'completed'].includes(rows[0].status)) {
        return res.status(409).json({ error: `Already ${rows[0].status}` });
      }
      // Fire-and-forget: respond immediately, send in the background.
      sendEngine.runCampaign(deps, Number(req.params.id))
        .catch(err => console.error(`runCampaign ${req.params.id} failed:`, err.message));
      res.status(202).json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
```

- [ ] **Step 4: Write the failing scheduler test**

```js
// tests/scheduler.test.js
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
const cron = require('node-cron');
const sendEngine = require('../lib/sendEngine');
const { startScheduler } = require('../lib/scheduler');

test('startScheduler registers a cron job that runs due scheduled broadcasts', async () => {
  const d = { db: { execute: jest.fn() }, axios: {}, env: {}, sleep: jest.fn() };
  const spy = jest.spyOn(sendEngine, 'runCampaign').mockResolvedValue();
  startScheduler(d);
  expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));

  // Invoke the registered tick with two due broadcasts.
  d.db.execute.mockResolvedValueOnce([[{ id: 3 }, { id: 4 }]]);
  const tick = cron.schedule.mock.calls[0][1];
  await tick();
  expect(spy).toHaveBeenCalledWith(d, 3);
  expect(spy).toHaveBeenCalledWith(d, 4);
  spy.mockRestore();
});
```

- [ ] **Step 5: Run to verify both fail**

Run: `npx jest tests/scheduler.test.js`
Expected: FAIL — cannot find module `../lib/scheduler`.

- [ ] **Step 6: Implement `lib/scheduler.js`**

```js
const cron = require('node-cron');
const sendEngine = require('./sendEngine');

function startScheduler(deps) {
  // Every minute: claim scheduled broadcasts whose time has come.
  cron.schedule('* * * * *', async () => {
    try {
      const [due] = await deps.db.execute(
        `SELECT id FROM broadcasts WHERE status = 'scheduled' AND scheduled_at <= NOW()`
      );
      for (const b of due) {
        sendEngine.runCampaign(deps, b.id)
          .catch(err => console.error(`scheduled runCampaign ${b.id} failed:`, err.message));
      }
    } catch (err) {
      console.error('scheduler tick error:', err.message);
    }
  });
}

module.exports = { startScheduler };
```

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: PASS — all suites green.

- [ ] **Step 8: Commit**

```bash
git add lib/campaigns.js lib/scheduler.js tests/campaigns.test.js tests/scheduler.test.js
git commit -m "feat: send-now route + node-cron scheduler for scheduled campaigns"
```

---

## Chunk 4: Wire into index.js, remove retired endpoints, deploy

### Task 9: Wire modules + remove inbox endpoints

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Require the new modules**

Near the top of `index.js`, after `const { sanitizeForSMS } = require('./lib/sms');` (added in Task 3), add:

```js
const { registerCampaignRoutes } = require('./lib/campaigns');
const { startScheduler } = require('./lib/scheduler');
```

- [ ] **Step 2: Delete the three retired inbox endpoints**

Remove these whole blocks from `index.js` (under `// ── Inbox API ──`): `app.get('/api/conversations', ...)`, `app.get('/api/messages/:conversationId', ...)`, and `app.post('/api/reply', ...)`. Keep `/api/login` and `requireAuth` (the campaign UI uses them). Keep `/inbound`, `/status`, `sendSMS`.

- [ ] **Step 3: Build the `deps` object and wire routes + scheduler**

After `db` is created and `requireAuth` is defined, add:

```js
const deps = { db, axios, env: process.env, sleep: ms => new Promise(r => setTimeout(r, ms)) };
registerCampaignRoutes(app, deps, requireAuth);
startScheduler(deps);
```

- [ ] **Step 4: Static-load check**

Run: `node -e "process.env.JWT_SECRET='x'; require('./lib/campaigns'); require('./lib/scheduler'); console.log('modules ok')"`
Expected: prints `modules ok`. (Booting full `index.js` requires DB + valid `.env`; that is verified on the VPS in Task 10.)

- [ ] **Step 5: Run the suite once more**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat: wire campaign routes + scheduler, remove retired inbox endpoints"
```

### Task 10: Activate on the VPS (in-place swap, operator-gated)

> All build work in Tasks 1–9 already happens on the VPS. By now `lib/`, `tests/`, the migration file, and an updated **staging copy** of `index.js` (e.g. `index.new.js`) exist on the server but the running process still serves the old `index.js`. This task flips it live.

- [ ] **Step 1: Suite is green on the server**

Run (on VPS): `npx jest`
Expected: all suites PASS.

- [ ] **Step 2: Back up live file + the two tables**

```bash
cp index.js index.js.bak.$(date +%Y%m%d-%H%M%S)
mysqldump --no-tablespaces "$DB_NAME" broadcasts broadcast_recipients > /home/vuelosmundi/broadcast_tables_backup_$(date +%Y%m%d).sql
```

- [ ] **Step 3: Env vars** — append to `.env`: `SEND_RATE_PER_SEC=1` and `DRY_RUN=1` (dry-run ON for first activation).

- [ ] **Step 4: Apply the migration**

```bash
mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < migrations/2026-06-26-broadcast-recipients-error.sql
```

Verify: `SHOW COLUMNS FROM broadcast_recipients LIKE 'error';` returns one row.

- [ ] **Step 5: Install runtime dep** — `npm install --omit=dev` (pulls `node-cron`; jest/supertest stay as devDeps for the on-server suite).

- [ ] **Step 6: Swap and restart**

```bash
mv index.new.js index.js   # only if a staging copy was used; otherwise edits are already in place
pm2 restart sms-bot && pm2 logs sms-bot --lines 40
```

Expected: `brinteva-sms running on port ...`, no crash loop. Confirm the restart count is **not** climbing (ties back to Task 0).

- [ ] **Step 7: Smoke test (read-only, low-risk)**

```bash
TOKEN=$(curl -s localhost:3001/api/login -H 'Content-Type: application/json' -d "{\"pin\":\"$INBOX_PIN\"}" | sed 's/.*"token":"//;s/".*//')
curl -s localhost:3001/api/contacts  -H "Authorization: Bearer $TOKEN"   # opted-in contacts
curl -s localhost:3001/api/campaigns -H "Authorization: Bearer $TOKEN"   # [] initially
```

- [ ] **Step 8: Prove the send path in DRY_RUN** — create a small draft, call `/api/campaigns/:id/send`, then inspect `broadcast_recipients` (statuses flip to `sent` with `dryrun-…` ids, opt-outs flip to `opted_out`, throttle spacing visible in timestamps). No SMS leaves the system.

- [ ] **Step 9: Go live (operator sign-off required)** — set `DRY_RUN=0` (or remove it), `pm2 restart sms-bot`, and validate one real send to a known test number before any broadcast. Real money + 10DLC apply.

---

## Out of scope (per memory)

- Kommo import of campaign messages → later `KOMMO_ENABLED` phase (see `backend-gateway-plan`).
- Per-recipient personalization / merge fields.
- The seller inbox UI (retired; Kommo handles conversations).
- The `admin-ui` frontend (separate plan — Vite + React + TS + Tailwind, builds to `public/admin/`).

## Open questions for the operator

1. **`SEND_RATE_PER_SEC` default** = 1/sec (≈ conservative pre-10DLC). Confirm the real allowed rate once the 10DLC campaign + LVN are approved.
2. **`/api/suggest` system prompt** is a first draft — refine the brand voice copy if needed.
3. **Staging-copy convention** — Task 9 can either edit `index.js` in place (snapshotting to `.bak` first) or build an `index.new.js` and `mv` it in Task 10. The plan assumes the safer `index.new.js` staging copy; confirm preference.
