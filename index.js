require('dotenv').config();
const path = require('path');
const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { sanitizeForSMS } = require('./lib/sms');
const { registerCampaignRoutes } = require('./lib/campaigns');
const { startScheduler } = require('./lib/scheduler');
const kommo = require('./lib/kommo');
const { sendMessage } = require('./lib/vonage');

const app = express();
// Capture the raw request bytes so the Kommo webhook can verify X-Signature
// (HMAC of the exact body) even though the body is also JSON-parsed for handlers.
const captureRaw = (req, res, buf) => { req.rawBody = buf; };
app.use(express.json({ verify: captureRaw }));
app.use(express.urlencoded({ extended: true, verify: captureRaw }));

// Admin campaign-launcher SPA, served same-origin at /admin (built to public/admin).
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// DB connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

// Root serves the public online opt-in page (the 10DLC "Online" consent URL).
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/legal/opt-in.html'));
});

// Health check (moved off / so the root can serve the opt-in page).
app.get('/health', (req, res) => {
  res.send('SMS Bot is running');
});

// Public legal pages (referenced by the 10DLC campaign opt-in flow).
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/legal/privacy.html'));
});
app.get('/sms-terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/legal/sms-terms.html'));
});
app.get('/consent-script', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/legal/consent-script.html'));
});

// ── Public online opt-in (10DLC web consent) ───────────────────────────────

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

// ── Auth: shared PIN gate ──────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  if (String(pin) !== String(process.env.INBOX_PIN)) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  const token = jwt.sign({ role: 'agent' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Campaign launcher API + scheduler ──────────────────────────────────────
// Admin-only campaign sender (compose, pick audience, AI draft, send/schedule).
// Routes live in lib/campaigns.js; scheduled sends are driven by lib/scheduler.js.

const deps = {
  db,
  axios,
  env: process.env,
  sleep: ms => new Promise(r => setTimeout(r, ms))
};
registerCampaignRoutes(app, deps, requireAuth);
startScheduler(deps);

// ── Kommo Chats API gateway ────────────────────────────────────────────────
// MySQL stays the source of truth; Kommo is the agent-facing mirror. Everything
// is gated behind KOMMO_ENABLED so the live bot keeps working if it's off.

const KOMMO = {
  enabled: String(process.env.KOMMO_ENABLED) === '1',
  scopeId: process.env.KOMMO_SCOPE_ID,
  secret: process.env.KOMMO_CHANNEL_SECRET,
  mirrorAi: String(process.env.KOMMO_MIRROR_AI) === '1',
  botId: process.env.KOMMO_BOT_ID // integration bot id from channel registration
};

// Push a customer's inbound SMS into the Kommo chat so agents can see it.
async function mirrorInboundToKommo({ phone, name, text, msgid }) {
  if (!KOMMO.enabled || !KOMMO.scopeId || !KOMMO.secret) return;
  try {
    const res = await kommo.importMessage({
      axios, scopeId: KOMMO.scopeId, secret: KOMMO.secret,
      payload: kommo.inboundPayload({ phone, name, text, msgid })
    });
    if (res.status >= 300) console.error('[kommo] inbound import failed', res.status, JSON.stringify(res.data));
  } catch (err) {
    console.error('[kommo] mirrorInbound error:', err.message);
  }
}

// Mirror a message WE sent (AI/system) into the Kommo thread (silent, no re-send).
// `force` bypasses the KOMMO_MIRROR_AI gate: that flag governs AI replies, while
// campaign blasts are mirrored on their own merits.
async function mirrorOutboundToKommo({ phone, text, msgid, senderName, force = false }) {
  if (!KOMMO.enabled || (!force && !KOMMO.mirrorAi) || !KOMMO.scopeId || !KOMMO.secret || !KOMMO.botId) return;
  try {
    const res = await kommo.importMessage({
      axios, scopeId: KOMMO.scopeId, secret: KOMMO.secret,
      payload: kommo.outboundPayload({ phone, text, msgid, senderName, botRefId: KOMMO.botId })
    });
    if (res.status >= 300) console.error('[kommo] outbound import failed', res.status, JSON.stringify(res.data));
  } catch (err) {
    console.error('[kommo] mirrorOutbound error:', err.message);
  }
}

// Campaign blasts are mirrored into Kommo as they send, so a seller opening the
// chat sees what the customer was sent before any reply arrives. Attached to the
// existing deps object (defined above, read at call time by lib/sendEngine.js).
deps.mirrorCampaignToKommo = ({ phone, text, msgid }) =>
  mirrorOutboundToKommo({ phone, text, msgid, senderName: 'Brinteva Worlds', force: true });

// Report delivery progress of an agent reply back to Kommo (amojo enum:
// -1 error, 0 sent, 1 delivered, 2 read).
async function pushKommoDeliveryStatus(msgid, deliveryStatus, error) {
  if (!KOMMO.enabled || !KOMMO.scopeId || !KOMMO.secret) return;
  try {
    const res = await kommo.updateDeliveryStatus({
      axios, scopeId: KOMMO.scopeId, secret: KOMMO.secret,
      msgid, deliveryStatus,
      errorCode: deliveryStatus === -1 ? 905 : undefined, // 905 = unknown error
      error: deliveryStatus === -1 ? (error || 'delivery failed') : undefined
    });
    if (res.status >= 300) console.error('[kommo] delivery_status failed', res.status, JSON.stringify(res.data));
  } catch (err) {
    console.error('[kommo] pushDeliveryStatus error:', err.message);
  }
}

// Kommo -> us: an agent typed a reply inside Kommo. Deliver it over SMS and mute
// the AI for that conversation. (Kommo only webhooks manager-authored messages,
// so there is no client echo to filter.)
kommo.registerKommoRoutes(app, { env: process.env }, async (payload) => {
  const m = (payload && payload.message) || {};
  const text = m.message && m.message.text;
  let phone = m.receiver && m.receiver.phone;
  if (!phone && m.conversation && m.conversation.client_id) {
    const digits = String(m.conversation.client_id).replace(/\D/g, '');
    if (digits) phone = digits;
  }
  if (!text || !phone) {
    console.warn('[kommo] webhook missing text/phone — ignoring');
    return;
  }

  await db.execute(
    `INSERT INTO contacts (phone) VALUES (?) ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [phone]
  );
  const [contacts] = await db.execute('SELECT id FROM contacts WHERE phone = ?', [phone]);
  const contactId = contacts[0].id;

  let [convRows] = await db.execute(
    `SELECT id FROM conversations WHERE contact_id = ? AND status != 'resolved'
     ORDER BY created_at DESC LIMIT 1`,
    [contactId]
  );
  let conversationId;
  if (convRows.length === 0) {
    const [nc] = await db.execute(
      `INSERT INTO conversations (contact_id, status) VALUES (?, 'needs_human')`, [contactId]
    );
    conversationId = nc.insertId;
  } else {
    conversationId = convRows[0].id;
  }

  const sent = await sendSMS(phone, sanitizeForSMS(text), conversationId, 'human');
  await db.execute(`UPDATE conversations SET status = 'needs_human' WHERE id = ?`, [conversationId]);

  // Remember Kommo's msgid for this relay so /status DLRs can be reported back
  // to Kommo as delivered/failed on the agent's message.
  const kommoMsgid = m.message && m.message.id;
  if (sent && kommoMsgid) {
    await db.execute(
      `UPDATE messages SET kommo_msgid = ? WHERE id = ?`,
      [String(kommoMsgid), sent.dbId]
    ).catch(e => console.error('[kommo] kommo_msgid save error:', e.message));
  } else if (!sent && kommoMsgid) {
    // SMS never left Vonage — tell Kommo immediately so the agent sees the failure.
    await pushKommoDeliveryStatus(String(kommoMsgid), -1, 'SMS send failed');
  }
  console.log(`[kommo] agent reply relayed to ${phone} (conv ${conversationId})`);
});

// ── Inbound SMS handler ────────────────────────────────────────────────────

app.post('/inbound', async (req, res) => {
  const { from: msisdn, text, message_uuid: messageId } = req.body;
  console.log(`Inbound SMS from ${msisdn}: ${text}`);

  res.sendStatus(200);

  // Non-text inbound (MMS, unexpected webhook formats) lacks these fields;
  // skip instead of passing undefined binds to MySQL.
  if (!msisdn || !text) {
    console.warn('[inbound] missing from/text — ignoring');
    return;
  }

  try {
    const [contactRows] = await db.execute(
      `INSERT INTO contacts (phone) VALUES (?)
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [msisdn]
    );

    const [contacts] = await db.execute(
      'SELECT id FROM contacts WHERE phone = ?', [msisdn]
    );
    const contactId = contacts[0].id;

    let [convRows] = await db.execute(
      `SELECT id FROM conversations
       WHERE contact_id = ? AND status != 'resolved'
       ORDER BY created_at DESC LIMIT 1`,
      [contactId]
    );

    let conversationId;
    if (convRows.length === 0) {
      const [newConv] = await db.execute(
        `INSERT INTO conversations (contact_id, status) VALUES (?, 'ai_handling')`,
        [contactId]
      );
      conversationId = newConv.insertId;
    } else {
      conversationId = convRows[0].id;
    }

    const [inboundMsg] = await db.execute(
      `INSERT INTO messages (conversation_id, direction, body, vonage_message_id, status, sent_by)
       VALUES (?, 'inbound', ?, ?, 'received', 'human')`,
      [conversationId, text, messageId || null]
    );
    const inboundMsgId = inboundMsg.insertId;

    if (/^(stop|unsubscribe|cancel|quit|end)$/i.test(text.trim())) {
      await db.execute(
        `UPDATE contacts SET opted_in = FALSE, opted_out_at = NOW() WHERE id = ?`,
        [contactId]
      );
      await db.execute(
        `UPDATE conversations SET status = 'resolved' WHERE id = ?`,
        [conversationId]
      );
      await sendSMS(msisdn, 'Brinteva Worlds: You have been successfully unsubscribed and will no longer receive messages. Reply START to resubscribe.', conversationId, 'system');
      return;
    }

    if (/^start$/i.test(text.trim())) {
      await db.execute(
        `UPDATE contacts SET opted_in = TRUE, opted_out_at = NULL WHERE id = ?`,
        [contactId]
      );
      await sendSMS(msisdn, 'Brinteva Worlds: You have subscribed to receive recurring promotional messages. Message frequency varies. Message and data rates may apply. Reply STOP to cancel, HELP for help.', conversationId, 'system');
      return;
    }

    // HELP auto-responder (registered 10DLC help keyword; must always reply,
    // even for opted-out contacts, so it runs before any AI/Kommo handling).
    if (/^(help|info)$/i.test(text.trim())) {
      await sendSMS(msisdn, 'Brinteva Worlds: For help, email us at nicoll@brintevaworlds.com or call +1 (925) 262-8150. Message and data rates may apply. Reply STOP to cancel.', conversationId, 'system');
      return;
    }

    // Mirror the customer's message into Kommo (after opt-in/out so those aren't mirrored).
    await mirrorInboundToKommo({ phone: msisdn, name: null, text, msgid: inboundMsgId });

    const [convStatus] = await db.execute(
      'SELECT status FROM conversations WHERE id = ?', [conversationId]
    );
    if (convStatus[0].status === 'needs_human') {
      console.log(`Conversation ${conversationId} flagged for human — skipping AI`);
      return;
    }

    // AI auto-reply is opt-in: set AI_AUTOREPLY=1 to enable. Default off so a
    // missing env var never results in unattended messages to customers.
    // The inbound message is still stored and mirrored into Kommo above, where
    // an agent answers it. STOP/START/HELP compliance replies run earlier and
    // are unaffected, as is the /api/suggest campaign drafting endpoint.
    if (process.env.AI_AUTOREPLY !== '1') {
      console.log(`AI auto-reply off — conversation ${conversationId} left for an agent`);
      return;
    }

    // Load active promotions and build the catalog block injected into the prompt
    const [promos] = await db.execute(
      'SELECT title, flag, month, duration, description FROM promotions WHERE active = TRUE ORDER BY sort_order'
    );
    const catalog = promos.map(p =>
      `${p.title}\n${p.month} | ${p.duration}\n${p.description}`
    ).join('\n\n');

    const aiResponse = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You are a helpful bilingual travel assistant for Brinteva Worlds, a travel agency.
Answer in the same language the customer uses (English or Spanish).

GREETING: Greet warmly and briefly. Always mention we have group trip promotions ("tenemos promociones grupales" / "we have group trip deals"). Keep the greeting itself short.

GROUP TRIPS / PROMOCIONES GRUPALES (current live catalog):
${catalog}

RULES:
- Always use plain ASCII only. No emojis, no markdown (no ** or __), no accent marks or tildes. Write "dias" not "dias" with accent, "Paris" not with accent.
- Normal chat and greetings: keep replies under 160 characters.
- When the customer asks about group trips, promotions, or asks for more details ("cuentame mas"): list the full catalog above, one trip per block, plain text only.
- If the customer wants pricing, wants to book, asks a complex question, has a complaint, or needs account access: respond briefly and end your reply with the exact tag [NEEDS_HUMAN]`,
      messages: [{ role: 'user', content: text }]
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });

    let reply = aiResponse.data.content[0].text;
    const needsHuman = reply.includes('[NEEDS_HUMAN]');
    reply = reply.replace('[NEEDS_HUMAN]', '').trim();

    if (needsHuman) {
      await db.execute(
        `UPDATE conversations SET status = 'needs_human' WHERE id = ?`,
        [conversationId]
      );
      console.log(`Conversation ${conversationId} escalated to human`);
    }

    const cleanReply = sanitizeForSMS(reply);
    await sendSMS(msisdn, cleanReply, conversationId, 'ai');
    await mirrorOutboundToKommo({ phone: msisdn, text: cleanReply, msgid: `ai-${inboundMsgId}`, senderName: 'Brinteva AI' });

  } catch (err) {
    console.error('Inbound handler error:', err.message);
  }
});

// Delivery status handler
app.post('/status', async (req, res) => {
  // Messages API reports message_uuid; the legacy SMS API sent messageId.
  // Accept both so receipts still resolve if the account API type ever changes.
  const messageId = req.body.message_uuid || req.body.messageId;
  const { status } = req.body;
  console.log(`Status update for ${messageId}: ${status}`);
  res.sendStatus(200);

  if (messageId && status) {
    try {
      await db.execute(
        `UPDATE messages SET status = ? WHERE vonage_message_id = ?`,
        [status.toLowerCase(), messageId]
      );

      // If this message was an agent reply relayed from Kommo, report the
      // carrier verdict back so the agent sees delivered/failed in the chat.
      const s = status.toLowerCase();
      const kommoStatus = s === 'delivered' ? 1
        : ['failed', 'rejected', 'expired', 'undeliverable'].includes(s) ? -1
        : null; // intermediate states (accepted/buffered) stay as imported
      if (kommoStatus !== null) {
        const [rows] = await db.execute(
          `SELECT kommo_msgid FROM messages WHERE vonage_message_id = ? AND kommo_msgid IS NOT NULL`,
          [messageId]
        );
        if (rows.length > 0) {
          await pushKommoDeliveryStatus(rows[0].kommo_msgid, kommoStatus, `carrier status: ${s}`);
        }
      }
    } catch (err) {
      console.error('Status update error:', err.message);
    }
  }
});

// ── Helper: send SMS + log to DB ──────────────────────────────────────────

async function sendSMS(to, text, conversationId, sentBy = 'ai') {
  try {
    const { messageId } = await sendMessage({ axios, env: process.env }, to, text);

    const [ins] = await db.execute(
      `INSERT INTO messages (conversation_id, direction, body, vonage_message_id, status, sent_by)
       VALUES (?, 'outbound', ?, ?, 'sent', ?)`,
      [conversationId, text, messageId || null, sentBy]
    );

    console.log(`Sent to ${to} [${sentBy}]: ${text}`);
    return { messageId: messageId || null, dbId: ins.insertId };
  } catch (err) {
    console.error('sendSMS error:', err.message);
    await db.execute(
      `INSERT INTO messages (conversation_id, direction, body, status, sent_by)
       VALUES (?, 'outbound', ?, 'failed', ?)`,
      [conversationId, text, sentBy]
    ).catch(e => console.error('Failed to log failed message:', e.message));
    return null;
  }
}

// SPA fallback: deep links under /admin return the app shell (Express 5 regex route).
app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`brinteva-sms running on port ${PORT}`);
});
