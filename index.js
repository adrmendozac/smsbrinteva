require('dotenv').config();
const path = require('path');
const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { sanitizeForSMS } = require('./lib/sms');
const { registerCampaignRoutes } = require('./lib/campaigns');
const { registerContactRoutes } = require('./lib/contacts');
const { registerMediaRoutes } = require('./lib/media');
const { registerPublicRoutes } = require('./lib/public');
const { registerAccountRoutes } = require('./lib/account');
const { registerWebhookRoutes } = require('./lib/webhooks');
const { startScheduler } = require('./lib/scheduler');
const kommo = require('./lib/kommo');
const kommoCrm = require('./lib/kommoCrm');
const { sendMessage, sendImage } = require('./lib/vonage');
const { registerVoiceRoutes } = require('./lib/voice');

const app = express();
// Capture the raw request bytes so the Kommo webhook can verify X-Signature
// (HMAC of the exact body) even though the body is also JSON-parsed for handlers.
const captureRaw = (req, res, buf) => { req.rawBody = buf; };
app.use(express.json({ verify: captureRaw }));
app.use(express.urlencoded({ extended: true, verify: captureRaw }));

// Admin campaign-launcher SPA, served same-origin at /admin (built to public/admin).
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
// Root static files: favicon.ico, etc. Legal pages are served by public.js routes.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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

const deps = {
  db,
  axios,
  env: process.env,
  sleep: ms => new Promise(r => setTimeout(r, ms))
};

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

// ── Helper: send SMS + log to DB ──────────────────────────────────────────
// Lives here (not in a lib/ module) because both the Kommo agent-reply relay
// below and lib/webhooks.js / lib/public.js need it, and it owns the
// `messages` insert that all three paths share.

async function sendSMS(to, text, conversationId, sentBy = 'ai', mediaUrl = null) {
  try {
    const { messageId } = mediaUrl
      ? await sendImage({ axios, env: process.env }, to, mediaUrl, text)
      : await sendMessage({ axios, env: process.env }, to, text);

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
deps.sendSMS = sendSMS;

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
// Resolves to the amojo-side message id, which is the only id the
// delivery_status endpoint accepts (our own ref_id 404s there).
async function mirrorOutboundToKommo({ phone, text, mediaUrl = null, msgid, senderName, force = false }) {
  if (!KOMMO.enabled || (!force && !KOMMO.mirrorAi) || !KOMMO.scopeId || !KOMMO.secret || !KOMMO.botId) return null;
  try {
    const res = await kommo.importMessage({
      axios, scopeId: KOMMO.scopeId, secret: KOMMO.secret,
      payload: kommo.outboundPayload({ phone, text, mediaUrl, msgid, senderName, botRefId: KOMMO.botId })
    });
    if (res.status >= 300) {
      console.error('[kommo] outbound import failed', res.status, JSON.stringify(res.data));
      return null;
    }
    return (res.data && res.data.new_message && res.data.new_message.msgid) || null;
  } catch (err) {
    console.error('[kommo] mirrorOutbound error:', err.message);
    return null;
  }
}

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

deps.mirrorInboundToKommo = mirrorInboundToKommo;
deps.mirrorOutboundToKommo = mirrorOutboundToKommo;
deps.pushKommoDeliveryStatus = pushKommoDeliveryStatus;

async function sendKommoTyping({ phone }) {
  if (!KOMMO.enabled || !KOMMO.scopeId || !KOMMO.secret) return;
  try {
    await kommo.sendTyping({
      axios, scopeId: KOMMO.scopeId, secret: KOMMO.secret,
      conversationId: kommo.conversationRef(phone),
      senderId: kommo.conversationRef(phone)
    });
  } catch (err) {
    console.error('[kommo] typing error:', err.message);
  }
}
deps.sendKommoTyping = sendKommoTyping;
// Campaign blasts are mirrored into Kommo as they send, so a seller opening the
// chat sees what the customer was sent before any reply arrives.
deps.mirrorCampaignToKommo = ({ phone, text, mediaUrl, msgid }) =>
  mirrorOutboundToKommo({ phone, text, mediaUrl, msgid, senderName: 'Brinteva Worlds', force: true });

// ── Kommo CRM API (leads) ───────────────────────────────────────────────────
// Separate from the Chats API above: creates an actual CRM lead (not just a
// mirrored chat message) in the dedicated "Brinteva SMS" pipeline, so a
// first-time inbound texter shows up on a seller's board, not only in Chats.

const KOMMO_CRM = {
  token: process.env.KOMMO_CRM_TOKEN,
  subdomain: process.env.KOMMO_CRM_SUBDOMAIN,
  pipelineId: Number(process.env.KOMMO_SMS_PIPELINE_ID),
  statusId: Number(process.env.KOMMO_SMS_STATUS_ID),
  mensajeClienteFieldId: Number(process.env.KOMMO_LEAD_MENSAJE_CLIENTE_FIELD_ID)
};

deps.createSmsLead = ({ phone, name, text }) => {
  if (!KOMMO_CRM.token || !KOMMO_CRM.subdomain || !KOMMO_CRM.pipelineId || !KOMMO_CRM.statusId || !KOMMO_CRM.mensajeClienteFieldId) {
    return Promise.resolve(null);
  }
  return kommo.createSmsLead({ axios, ...KOMMO_CRM, phone, name, text });
};

deps.createLeadNote = ({ leadId, text }) => {
  if (!KOMMO_CRM.token || !KOMMO_CRM.subdomain) return Promise.resolve(null);
  return kommoCrm.createLeadNote({ axios, subdomain: KOMMO_CRM.subdomain, token: KOMMO_CRM.token, leadId, text });
};

deps.addLeadTags = ({ leadId, tags }) => {
  if (!KOMMO_CRM.token || !KOMMO_CRM.subdomain) return Promise.resolve(null);
  return kommoCrm.addLeadTags({ axios, subdomain: KOMMO_CRM.subdomain, token: KOMMO_CRM.token, leadId, tags });
};

// Kommo -> us: an agent typed a reply inside Kommo. Deliver it over SMS and mute
// the AI for that conversation. (Kommo only webhooks manager-authored messages,
// so there is no client echo to filter.)
kommo.registerKommoRoutes(app, { env: process.env }, async (payload) => {
  const m = (payload && payload.message) || {};
  const text = (m.message && m.message.text) || '';
  const mediaUrl = (m.message && m.message.media) || null;
  let phone = m.receiver && m.receiver.phone;
  if (!phone && m.conversation && m.conversation.client_id) {
    const digits = String(m.conversation.client_id).replace(/\D/g, '');
    if (digits) phone = digits;
  }
  if ((!text && !mediaUrl) || !phone) {
    console.warn('[kommo] webhook missing text/phone/media — ignoring');
    return;
  }

  await db.execute(
    `INSERT INTO contacts (phone) VALUES (?) ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [phone]
  );
  const [contacts] = await db.execute('SELECT id, opted_in FROM contacts WHERE phone = ?', [phone]);
  const contactId = contacts[0].id;

  if (!contacts[0].opted_in) {
    console.log(`[kommo] agent reply skipped — contact ${phone} opted out`);
    const kommoMsgid = m.message && m.message.id;
    if (kommoMsgid) await pushKommoDeliveryStatus(String(kommoMsgid), -1, 'Contact opted out');
    return;
  }

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

  const sent = await sendSMS(phone, sanitizeForSMS(text), conversationId, 'human', mediaUrl);
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

// ── Kommo CRM API routes (admin-facing) ──────────────────────────────────
// Authenticated endpoints exposing custom field sync, task creation, pipeline
// management, and Salesbot trigger. All gated behind KOMMO_CRM_TOKEN.

const KOMMO_CRM_DEPS = { axios, subdomain: KOMMO_CRM.subdomain, token: KOMMO_CRM.token };

// GET /api/kommo/custom-fields — list custom field definitions for leads.
app.get('/api/kommo/custom-fields', requireAuth, async (req, res) => {
  const fields = await kommoCrm.getLeadCustomFields(KOMMO_CRM_DEPS);
  if (!fields) return res.status(502).json({ error: 'Failed to fetch custom fields from Kommo' });
  res.json({ custom_fields: fields });
});

// POST /api/kommo/custom-fields/sync — push DB values to a Kommo lead.
// Body: { leadId, fields: [{ field_id, values: [{ value }] }] }
app.post('/api/kommo/custom-fields/sync', requireAuth, async (req, res) => {
  const { leadId, fields } = req.body;
  if (!leadId || !fields) return res.status(400).json({ error: 'leadId and fields required' });
  const ok = await kommoCrm.updateLeadCustomFields({ ...KOMMO_CRM_DEPS, leadId, fields });
  if (!ok) return res.status(502).json({ error: 'Failed to sync custom fields' });
  res.json({ ok: true });
});

// POST /api/kommo/tasks — create a task linked to a lead or contact.
// Body: { leadId?, contactId?, text, taskTypeId?, completeTill? }
app.post('/api/kommo/tasks', requireAuth, async (req, res) => {
  const { leadId, contactId, text, taskTypeId, completeTill } = req.body;
  if (!text || (!leadId && !contactId)) {
    return res.status(400).json({ error: 'text and either leadId or contactId required' });
  }
  const task = await kommoCrm.createTask({ ...KOMMO_CRM_DEPS, leadId, contactId, text, taskTypeId, completeTill });
  if (!task) return res.status(502).json({ error: 'Failed to create task in Kommo' });
  res.json({ task });
});

// GET /api/kommo/pipelines — list all pipelines with their stages.
app.get('/api/kommo/pipelines', requireAuth, async (req, res) => {
  const pipelines = await kommoCrm.getPipelines(KOMMO_CRM_DEPS);
  if (!pipelines) return res.status(502).json({ error: 'Failed to fetch pipelines from Kommo' });
  res.json({ pipelines });
});

// POST /api/kommo/leads/:id/notes — create a text note on a lead.
// Body: { text }
app.post('/api/kommo/leads/:id/notes', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const ok = await kommoCrm.createLeadNote({ ...KOMMO_CRM_DEPS, leadId: req.params.id, text });
  if (!ok) return res.status(502).json({ error: 'Failed to create note in Kommo' });
  res.json({ ok: true });
});

// POST /api/kommo/leads/:id/tags — add tags to a lead (merges with existing).
// Body: { tags: ["tag1", "tag2"] }
app.post('/api/kommo/leads/:id/tags', requireAuth, async (req, res) => {
  const { tags } = req.body;
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'tags array required' });
  }
  const ok = await kommoCrm.addLeadTags({ ...KOMMO_CRM_DEPS, leadId: req.params.id, tags });
  if (!ok) return res.status(502).json({ error: 'Failed to add tags in Kommo' });
  res.json({ ok: true });
});

// PATCH /api/kommo/leads/:id/pipeline — move a lead to a different stage.
// Body: { statusId }
app.patch('/api/kommo/leads/:id/pipeline', requireAuth, async (req, res) => {
  const { statusId } = req.body;
  if (!statusId) return res.status(400).json({ error: 'statusId required' });
  const ok = await kommoCrm.moveLead({ ...KOMMO_CRM_DEPS, leadId: req.params.id, statusId });
  if (!ok) return res.status(502).json({ error: 'Failed to move lead in Kommo' });
  res.json({ ok: true });
});

// POST /api/kommo/salesbot — trigger a Salesbot automation for a lead.
// Body: { botId, leadId }
app.post('/api/kommo/salesbot', requireAuth, async (req, res) => {
  const { botId, leadId } = req.body;
  if (!botId || !leadId) return res.status(400).json({ error: 'botId and leadId required' });
  const ok = await kommoCrm.triggerSalesbot({ ...KOMMO_CRM_DEPS, botId, leadId });
  if (!ok) return res.status(502).json({ error: 'Failed to trigger Salesbot' });
  res.json({ ok: true });
});

// ── Route wiring ─────────────────────────────────────────────────────────
// Route logic lives in lib/; index.js only assembles deps and registers it.

registerPublicRoutes(app, deps);
registerWebhookRoutes(app, deps);
registerCampaignRoutes(app, deps, requireAuth);
registerContactRoutes(app, deps, requireAuth);
registerMediaRoutes(app, deps, requireAuth);
registerAccountRoutes(app, deps, requireAuth);
startScheduler(deps);

// The SMS number also carries VOICE and is published as the support line, so
// calls route to the VBC call group. Inert until the Vonage application gains a
// voice capability pointing at /voice/answer.
registerVoiceRoutes(app, deps);

// SPA fallback: deep links under /admin return the app shell (Express 5 regex route).
app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`brinteva-sms running on port ${PORT}`);
});
