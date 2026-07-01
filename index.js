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

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Health check
app.get('/', (req, res) => {
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
  mirrorAi: String(process.env.KOMMO_MIRROR_AI) === '1'
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
async function mirrorOutboundToKommo({ phone, text, msgid, senderName }) {
  if (!KOMMO.enabled || !KOMMO.mirrorAi || !KOMMO.scopeId || !KOMMO.secret) return;
  try {
    const res = await kommo.importMessage({
      axios, scopeId: KOMMO.scopeId, secret: KOMMO.secret,
      payload: kommo.outboundPayload({ phone, text, msgid, senderName })
    });
    if (res.status >= 300) console.error('[kommo] outbound import failed', res.status, JSON.stringify(res.data));
  } catch (err) {
    console.error('[kommo] mirrorOutbound error:', err.message);
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

  await sendSMS(phone, sanitizeForSMS(text), conversationId, 'human');
  await db.execute(`UPDATE conversations SET status = 'needs_human' WHERE id = ?`, [conversationId]);
  console.log(`[kommo] agent reply relayed to ${phone} (conv ${conversationId})`);
});

// ── Inbound SMS handler ────────────────────────────────────────────────────

app.post('/inbound', async (req, res) => {
  const { from: msisdn, text, message_uuid: messageId } = req.body;
  console.log(`Inbound SMS from ${msisdn}: ${text}`);

  res.sendStatus(200);

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
      await sendSMS(msisdn, 'You have been unsubscribed. Reply START to opt back in.', conversationId, 'system');
      return;
    }

    if (/^start$/i.test(text.trim())) {
      await db.execute(
        `UPDATE contacts SET opted_in = TRUE, opted_out_at = NULL WHERE id = ?`,
        [contactId]
      );
      await sendSMS(msisdn, 'You have been re-subscribed to Brinteva Worlds updates. Reply STOP to unsubscribe.', conversationId, 'system');
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
  const { messageId, status } = req.body;
  console.log(`Status update for ${messageId}: ${status}`);
  res.sendStatus(200);

  if (messageId && status) {
    try {
      await db.execute(
        `UPDATE messages SET status = ? WHERE vonage_message_id = ?`,
        [status.toLowerCase(), messageId]
      );
    } catch (err) {
      console.error('Status update error:', err.message);
    }
  }
});

// ── Helper: send SMS + log to DB ──────────────────────────────────────────

async function sendSMS(to, text, conversationId, sentBy = 'ai') {
  try {
    const response = await axios.post('https://rest.nexmo.com/sms/json', {
      api_key: process.env.VONAGE_API_KEY,
      api_secret: process.env.VONAGE_API_SECRET,
      from: process.env.VONAGE_NUMBER,
      to,
      text
    });

    const messageId = response.data.messages?.[0]?.['message-id'];

    await db.execute(
      `INSERT INTO messages (conversation_id, direction, body, vonage_message_id, status, sent_by)
       VALUES (?, 'outbound', ?, ?, 'sent', ?)`,
      [conversationId, text, messageId || null, sentBy]
    );

    console.log(`Sent to ${to} [${sentBy}]: ${text}`);
  } catch (err) {
    console.error('sendSMS error:', err.message);
    await db.execute(
      `INSERT INTO messages (conversation_id, direction, body, status, sent_by)
       VALUES (?, 'outbound', ?, 'failed', ?)`,
      [conversationId, text, sentBy]
    ).catch(e => console.error('Failed to log failed message:', e.message));
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
