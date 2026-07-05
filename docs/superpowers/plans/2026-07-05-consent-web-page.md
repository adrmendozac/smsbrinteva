# Online SMS Consent Web Page — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a functional, CTIA/10DLC-compliant online opt-in page at `https://sms.brintevaworlds.com/` that records consent, stores an auditable proof-of-consent trail, and sends a confirmation SMS.

**Architecture:** Static HTML page (`public/legal/opt-in.html`) styled like the existing legal pages; a public `POST /api/opt-in` Express handler in `index.js` that upserts `contacts`, appends to a new `consent_records` audit table, and sends a `DRY_RUN`-gated confirmation SMS via the existing `sendSMS` helper; a SQL migration for the audit table; and a root-route swap (`GET /` serves the page, health check moves to `GET /health`).

**Tech Stack:** Node.js + Express, MySQL (`mysql2/promise`), vanilla HTML/CSS/JS, Vonage SMS via existing `sendSMS`. Deploy via `git push production main`; verify on the live VPS DB with `DRY_RUN=1` (no mocked test suites — project convention is real-DB verification, see [[verify-on-real-db]], [[vps-dev-flow]]).

> **⚠️ Two verified facts that shape the handler (checked against `index.js` at plan time):**
> 1. **`sendSMS` (`index.js:320`) does NOT gate on `DRY_RUN`.** Only `lib/sendEngine.js:7` does. So calling `sendSMS` always hits Vonage. The opt-in handler must gate the confirmation on `DRY_RUN` *itself* so testing doesn't send real texts.
> 2. **`sendSMS` always inserts a `messages` row with `conversation_id` (`index.js:332-336`).** Every existing caller passes a real conversation id. Do NOT pass `null` — nullability/FK of `messages.conversation_id` is unconfirmed. Instead create a conversation for the contact first (same pattern as `/inbound` at `index.js:196-201`) and pass its id.

**Spec:** `docs/superpowers/specs/2026-07-05-consent-web-page-design.md`

---

## Reference: existing patterns to mirror

- **Legal page styling/structure:** `public/legal/privacy.html`, `public/legal/sms-terms.html` (purple `#6b3fd4`, system font, `max-width: 760px`, footer with cross-links).
- **Contacts upsert + opt-in/out:** `index.js:141-146` (upsert) and `index.js:213-233` (STOP/START toggling `opted_in`/`opted_out_at`).
- **Route wiring for static legal pages:** `index.js:38-47`.
- **Health check to relocate:** `index.js:34-36`.
- **`sendSMS` helper:** `index.js:320`, signature `sendSMS(to, text, conversationId, sentBy = 'ai')`. It calls Vonage and inserts a `messages` row (`index.js:332-336`). **It does NOT gate `DRY_RUN`** — gate the confirmation call in the handler. Pass a real `conversationId` (create one first), not `null`.
- **Conversation creation pattern:** `index.js:196-201` (`INSERT INTO conversations (contact_id, status) VALUES (?, 'ai_handling')`). For the opt-in confirmation use `status = 'resolved'` (it's a one-off system message, no thread to keep open).
- **Body parsing:** `express.json()` + `express.urlencoded()` already registered at `index.js:15-16`, so `req.body` is available.

## File Structure

- **Create** `migrations/2026-07-05-consent-records.sql` — audit table DDL.
- **Create** `public/legal/opt-in.html` — the opt-in form page.
- **Modify** `index.js` — swap root route, add `/health`, add `POST /api/opt-in`.
- **Modify** `docs/superpowers/specs/...` — none (spec is final).

---

## Chunk 1: Migration + audit table

### Task 1: Create the `consent_records` migration

**Files:**
- Create: `migrations/2026-07-05-consent-records.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Append-only proof-of-consent audit log for online (web) opt-ins.
-- One row per opt-in submission; never updated or deleted. This is the
-- artifact a carrier/TCR audit requests as proof a number consented.
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

- [ ] **Step 2: Commit**

```bash
git add migrations/2026-07-05-consent-records.sql
git commit -m "Add consent_records migration for web opt-in audit trail"
```

*(Migration is applied against the live DB during Chunk 4 verification, not locally — there is no local MySQL. See [[vps-dev-flow]].)*

---

## Chunk 2: Opt-in page (frontend)

### Task 2: Create `public/legal/opt-in.html`

**Files:**
- Create: `public/legal/opt-in.html`
- Reference: `public/legal/privacy.html` (styling to match)

- [ ] **Step 1: Write the page**

Full file content (self-contained; inline CSS/JS to match the other legal pages which have no build step):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Get SMS Updates — Brinteva Worlds Inc.</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           line-height: 1.6; color: #1a1a1a; max-width: 760px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 1.9rem; margin-bottom: 0.25rem; }
    .muted { color: #666; font-size: 0.9rem; }
    a { color: #6b3fd4; }
    label { display: block; font-weight: 600; margin-top: 1.2rem; }
    input[type=text], input[type=tel] { width: 100%; box-sizing: border-box; padding: 10px 12px;
           font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; margin-top: 6px; }
    .consent { display: flex; gap: 10px; align-items: flex-start; margin-top: 1.4rem;
           background: #f4efff; border-left: 3px solid #6b3fd4; padding: 12px 16px; border-radius: 4px; }
    .consent input { margin-top: 5px; }
    .consent label { font-weight: 400; margin: 0; font-size: 0.92rem; }
    button { margin-top: 1.6rem; background: #6b3fd4; color: #fff; border: 0; border-radius: 6px;
           padding: 12px 22px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    #status { margin-top: 1rem; font-weight: 600; }
    #status.ok { color: #1a7f37; }
    #status.err { color: #c0392b; }
    .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    footer { margin-top: 3rem; font-size: 0.85rem; color: #777; border-top: 1px solid #eee; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>Get SMS Updates from Brinteva Worlds</h1>
  <p class="muted">Sign up to receive travel deals, booking updates, and customer-care messages by text.</p>

  <form id="optin">
    <label for="name">Full name</label>
    <input type="text" id="name" name="name" autocomplete="name" required>

    <label for="phone">Mobile phone number</label>
    <input type="tel" id="phone" name="phone" autocomplete="tel" placeholder="(555) 123-4567" required>

    <!-- Honeypot: hidden from users; bots tend to fill it. -->
    <div class="hp" aria-hidden="true">
      <label for="website">Website</label>
      <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
    </div>

    <div class="consent">
      <input type="checkbox" id="consent" name="consent" required>
      <label for="consent">
        I agree to receive recurring automated marketing and customer-care text messages from
        Brinteva Worlds Inc. at the number provided. Consent is not a condition of purchase.
        Msg &amp; data rates may apply. Msg frequency varies. Reply STOP to cancel, HELP for help.
        See our <a href="/privacy">Privacy Policy</a> and
        <a href="/sms-terms">SMS Terms &amp; Conditions</a>.
      </label>
    </div>

    <button type="submit" id="submit">Sign me up</button>
    <div id="status" role="status" aria-live="polite"></div>
  </form>

  <footer>
    &copy; 2026 Brinteva Worlds Inc. All rights reserved. &middot;
    <a href="/privacy">Privacy Policy</a> &middot; <a href="/sms-terms">SMS Terms &amp; Conditions</a>
  </footer>

  <script>
    const form = document.getElementById('optin');
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('submit');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      statusEl.textContent = '';
      statusEl.className = '';
      if (!document.getElementById('consent').checked) {
        statusEl.textContent = 'Please check the consent box to continue.';
        statusEl.className = 'err';
        return;
      }
      btn.disabled = true;
      const payload = {
        name: document.getElementById('name').value,
        phone: document.getElementById('phone').value,
        consent: document.getElementById('consent').checked,
        website: document.getElementById('website').value
      };
      try {
        const res = await fetch('/api/opt-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          form.reset();
          statusEl.textContent = "You're subscribed! Check your phone for a confirmation text.";
          statusEl.className = 'ok';
          btn.disabled = true;
        } else {
          statusEl.textContent = data.error || 'Something went wrong, please try again.';
          statusEl.className = 'err';
          btn.disabled = false;
        }
      } catch (err) {
        statusEl.textContent = 'Network error, please try again.';
        statusEl.className = 'err';
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/legal/opt-in.html
git commit -m "Add online SMS opt-in page"
```

---

## Chunk 3: Backend route + root swap

### Task 3: Add `POST /api/opt-in` and swap the root route

**Files:**
- Modify: `index.js` (root route `:34-36`; static legal routes block `:38-47`)

- [ ] **Step 1: Swap the root route and add `/health`**

Replace the current health check at `index.js:34-36`:

```js
// Health check
app.get('/', (req, res) => {
  res.send('SMS Bot is running');
});
```

with:

```js
// Root serves the public online opt-in page (the 10DLC "Online" consent URL).
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/legal/opt-in.html'));
});

// Health check (moved off / so the root can serve the opt-in page).
app.get('/health', (req, res) => {
  res.send('SMS Bot is running');
});
```

- [ ] **Step 2: Add the opt-in API handler**

Add this immediately after the `/consent-script` route block (after `index.js:47`), so it sits with the other public routes and before the auth gate:

```js
// ── Public online opt-in (10DLC web consent) ───────────────────────────────

// Exact consent language shown on /opt-in; stored verbatim in consent_records.
const OPTIN_CONSENT_TEXT =
  'I agree to receive recurring automated marketing and customer-care text ' +
  'messages from Brinteva Worlds Inc. at the number provided. Consent is not a ' +
  'condition of purchase. Msg & data rates may apply. Msg frequency varies. ' +
  'Reply STOP to cancel, HELP for help.';

// Normalize a user-entered phone to 11-digit US/CA (1XXXXXXXXXX) or return null.
function normalizeUsPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '1' + digits;
  if (digits.length === 11 && digits[0] === '1') return digits;
  return null;
}

app.post('/api/opt-in', async (req, res) => {
  const { name, phone, consent, website } = req.body || {};

  // Honeypot: pretend success, persist nothing.
  if (website) return res.json({ ok: true });

  const cleanName = String(name || '').trim();
  if (!cleanName || consent !== true) {
    return res.status(400).json({ error: 'Name and consent are required.' });
  }

  const normPhone = normalizeUsPhone(phone);
  if (!normPhone) {
    return res.status(400).json({ error: 'Enter a valid US mobile number.' });
  }

  let contactId;
  try {
    await db.execute(
      `INSERT INTO contacts (phone, name, opted_in)
       VALUES (?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         name = COALESCE(VALUES(name), name),
         opted_in = TRUE,
         opted_out_at = NULL,
         updated_at = NOW()`,
      [normPhone, cleanName]
    );
    const [rows] = await db.execute('SELECT id FROM contacts WHERE phone = ?', [normPhone]);
    contactId = rows[0].id;

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || null;
    const ua = (req.headers['user-agent'] || '').slice(0, 512) || null;

    await db.execute(
      `INSERT INTO consent_records (phone, name, consent_text, source, ip_address, user_agent)
       VALUES (?, ?, ?, 'web', ?, ?)`,
      [normPhone, cleanName, OPTIN_CONSENT_TEXT, ip, ua]
    );
  } catch (err) {
    console.error('POST /api/opt-in DB error:', err.message);
    return res.status(500).json({ error: 'Something went wrong, please try again.' });
  }

  // Best-effort confirmation SMS. Gate on DRY_RUN HERE — sendSMS does NOT gate it
  // (only lib/sendEngine.js does). Create a conversation so the messages row that
  // sendSMS writes has a valid conversation_id. Never fail the opt-in on an SMS
  // error — consent is already recorded.
  const confirmText =
    "Brinteva Worlds: you're subscribed to recurring travel updates. " +
    "Msg&data rates may apply. Reply STOP to cancel, HELP for help.";
  if (process.env.DRY_RUN === '1') {
    console.log(`[DRY_RUN] would send opt-in confirmation to ${normPhone}`);
  } else {
    try {
      const [conv] = await db.execute(
        `INSERT INTO conversations (contact_id, status) VALUES (?, 'resolved')`,
        [contactId]
      );
      await sendSMS(normPhone, confirmText, conv.insertId, 'system');
    } catch (err) {
      console.error('POST /api/opt-in confirmation SMS error:', err.message);
    }
  }

  res.json({ ok: true });
});
```

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "Serve opt-in page at root; add POST /api/opt-in handler"
```

---

## Chunk 4: Deploy + verify on the live VPS (real-DB, no mocks)

Per [[verify-on-real-db]] and [[vps-dev-flow]]: there is no local MySQL. Verify against the live DB with `DRY_RUN=1` first, then flip live.

### Task 4: Deploy and run the migration

- [ ] **Step 1: Push to production**

```bash
git push production main
```

- [ ] **Step 2: Apply the migration on the VPS** (run on the server, in the app dir)

Load DB creds from `.env`, then run the migration. Example (adjust to how other migrations are applied on this box — confirm first):

```bash
# On the VPS, in /var/www/sms.brintevaworlds.com
mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < migrations/2026-07-05-consent-records.sql
```

- [ ] **Step 3: Confirm DRY_RUN is on and restart** the `sms-bot` process (note the 26-restart caveat in [[vps-dev-flow]]). Verify `DRY_RUN=1` in `.env`.

### Task 5: Verify behavior against the live DB

- [ ] **Step 1: Page loads at root**

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://sms.brintevaworlds.com/
```
Expected: `200 text/html` and the body contains the opt-in form (`curl -s https://sms.brintevaworlds.com/ | grep -c 'api/opt-in'` → `1`).

- [ ] **Step 2: Health check relocated**

```bash
curl -s https://sms.brintevaworlds.com/health
```
Expected: `SMS Bot is running`.

- [ ] **Step 3: Legal cross-links resolve** (regression)

```bash
for p in /privacy /sms-terms; do curl -s -o /dev/null -w "$p %{http_code}\n" https://sms.brintevaworlds.com$p; done
```
Expected: both `200`.

- [ ] **Step 4: Valid opt-in submission (DRY_RUN)**

```bash
curl -s -X POST https://sms.brintevaworlds.com/api/opt-in \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test User","phone":"(925) 555-0142","consent":true,"website":""}'
```
Expected: `{"ok":true}`. Then confirm in MySQL:
- `SELECT phone,name,opted_in,opted_out_at FROM contacts WHERE phone='19255550142';` → one row, `opted_in=1`, `opted_out_at=NULL`.
- `SELECT phone,source,consent_text,ip_address FROM consent_records WHERE phone='19255550142';` → one row, `source='web'`, full consent text, IP populated.
- App logs show `[DRY_RUN] would send opt-in confirmation to 19255550142`, **no Vonage call**, and **no new `conversations`/`messages` rows** for this contact (the confirmation branch is skipped entirely under DRY_RUN).

- [ ] **Step 5: Validation rejections**

```bash
# missing consent
curl -s -X POST .../api/opt-in -H 'Content-Type: application/json' \
  -d '{"name":"No Consent","phone":"9255550142","consent":false}'
# → 400 {"error":"Name and consent are required."}

# bad phone
curl -s -X POST .../api/opt-in -H 'Content-Type: application/json' \
  -d '{"name":"Bad Phone","phone":"123","consent":true}'
# → 400 {"error":"Enter a valid US mobile number."}

# honeypot filled → 200 {"ok":true} but NO new contacts/consent_records row
curl -s -X POST .../api/opt-in -H 'Content-Type: application/json' \
  -d '{"name":"Bot","phone":"9255550199","consent":true,"website":"spam"}'
```
Confirm no `contacts`/`consent_records` rows exist for `19255550199`.

- [ ] **Step 6: Clean up test rows**

```sql
DELETE FROM consent_records WHERE phone IN ('19255550142');
DELETE FROM contacts WHERE phone IN ('19255550142');
-- Under DRY_RUN no conversations/messages rows are created for the test number,
-- so nothing to clean there. (If you also ran a live test in Task 6, delete that
-- number's messages → conversations → consent_records → contacts, in FK order.)
```

### Task 6: Go live

- [ ] **Step 1:** Set `DRY_RUN=0` in `.env` on the VPS and restart `sms-bot`.
- [ ] **Step 2:** Do ONE real end-to-end opt-in with your own mobile number; confirm you receive the confirmation SMS and that STOP still works (regression via existing `/inbound` handler).
- [ ] **Step 3:** Confirm the `https://sms.brintevaworlds.com` URL in the 10DLC registration form now resolves to the opt-in page, and submit/save the registration.

---

## Done criteria

- `GET /` serves the opt-in page; `GET /health` returns the old text.
- A valid submission creates one `contacts` row (`opted_in=TRUE`) and one append-only `consent_records` row, and (live) sends a confirmation SMS.
- Invalid submissions are rejected with clear messages; honeypot submissions persist nothing.
- `/privacy` and `/sms-terms` still resolve and are linked from the page.
- The 10DLC "Online" consent URL now shows a real consent mechanism to a reviewer.
