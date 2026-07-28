// Unauthenticated public routes: legal pages and the 10DLC web opt-in form.
const path = require('path');

// Exact consent language shown on the opt-in page; stored verbatim in consent_records.
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

// Registers the public GETs (opt-in page, health check, legal pages) plus
// POST /api/opt-in. `deps.sendSMS` sends the confirmation text; it lives in
// index.js because it also writes to `messages`, shared with the Kommo and
// inbound-SMS paths.
function registerPublicRoutes(app, deps) {
  const { db, env, sendSMS } = deps;
  const legalDir = path.join(__dirname, '..', 'public/legal');

  // Root serves the public online opt-in page (the 10DLC "Online" consent URL).
  app.get('/', (req, res) => {
    res.sendFile(path.join(legalDir, 'opt-in.html'));
  });

  // Health check (moved off / so the root can serve the opt-in page).
  app.get('/health', (req, res) => {
    res.send('SMS Bot is running');
  });

  // Public legal pages (referenced by the 10DLC campaign opt-in flow).
  app.get('/privacy', (req, res) => {
    res.sendFile(path.join(legalDir, 'privacy.html'));
  });
  app.get('/sms-terms', (req, res) => {
    res.sendFile(path.join(legalDir, 'sms-terms.html'));
  });
  app.get('/consent-script', (req, res) => {
    res.sendFile(path.join(legalDir, 'consent-script.html'));
  });

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
    if (env.DRY_RUN === '1') {
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
}

module.exports = { registerPublicRoutes, normalizeUsPhone, OPTIN_CONSENT_TEXT };
