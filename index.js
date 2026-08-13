require('dotenv').config();
const path = require('path');
const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { sanitizeForSMS, smsSegments, MMS_CAPTION_MAX } = require('./lib/sms');
const { createThroughput } = require('./lib/throughput');
const { createHostedMessage, buildLinkSms, classifyItineraries, registerHostedRoutes } = require('./lib/hosted');
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
const { createLogger } = require('./lib/logs');
const { registerCrawlerProtection } = require('./lib/crawlers');

const app = express();
registerCrawlerProtection(app);
// Capture the raw request bytes so the Kommo webhook can verify X-Signature
// (HMAC of the exact body) even though the body is also JSON-parsed for handlers.
const captureRaw = (req, res, buf) => { req.rawBody = buf; };
// 256kb, up from the 100kb default: a seller pasting a 30-day itinerary into
// Kommo can exceed 100kb, and the webhook would be rejected before any handler
// saw it. The verify hook still captures the exact bytes for the signature
// check — raising the ceiling does not change what gets hashed.
const REQUEST_LIMIT = '256kb';
app.use(express.json({ limit: REQUEST_LIMIT, verify: captureRaw }));
app.use(express.urlencoded({ extended: true, limit: REQUEST_LIMIT, verify: captureRaw }));

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

// Carrier throughput budget, shared by campaigns and one-off replies — both
// spend the same 10DLC allowance, so both must draw from the same counter.
deps.throughput = createThroughput({
  db,
  env: process.env,
  sleep: deps.sleep
});

// ── Auth: shared PIN gate ──────────────────────────────────────────────────

const log = createLogger(db);
deps.log = log;

app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  if (String(pin) !== String(process.env.INBOX_PIN)) {
    // The PIN itself must never reach the log table.
    log.warn('auth', 'Intento de login con PIN incorrecto', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  const token = jwt.sign({ role: 'agent' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  log.info('auth', 'Login exitoso');
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
    log.warn('auth', 'Request con token inválido o expirado', { path: req.path });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Logs: browsable event timeline for the admin panel ────────────────────
// Written by lib/logs.js from every instrumented path; this route is the
// read side. `before` pages older entries (keyset by id), level/category
// filter the timeline.

app.get('/api/logs', requireAuth, async (req, res) => {
  try {
    const page = await log.list({
      level: req.query.level,
      category: req.query.category,
      before: req.query.before,
      limit: req.query.limit
    });
    res.json(page);
  } catch (err) {
    console.error('GET /api/logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: send SMS + log to DB ──────────────────────────────────────────
// Lives here (not in a lib/ module) because both the Kommo agent-reply relay
// below and lib/webhooks.js / lib/public.js need it, and it owns the
// `messages` insert that all three paths share.

// Always resolves — never throws — to { ok, messageId, dbId } on success or
// { ok: false, error, dbId } on failure. The failure branch carries the reason
// because callers relay it to the agent in Kommo: a bare "SMS send failed" is
// what left the oversized-itinerary rejections undiagnosed for days. Check
// `.ok`, not truthiness — the failure value is an object too.
async function sendSMS(to, text, conversationId, sentBy = 'ai', mediaUrl = null) {
  const segments = smsSegments(text);
  try {
    // Replies pace against the same carrier budget as campaigns, but as
    // kind 'reply': they obey the per-minute window and the absolute daily
    // ceiling, never the lower campaign ceiling. A seller mid-conversation is
    // not made to wait for tomorrow because a blast filled the day's quota —
    // campaigns are what yield.
    const [carrierRows] = await db.execute(
      `SELECT carrier_network_code, carrier_checked_at FROM contacts WHERE phone = ? LIMIT 1`,
      [to]
    );
    await deps.throughput.acquire(
      deps.throughput.bucketFor(carrierRows[0]),
      segments,
      'reply'
    );

    const { messageId } = mediaUrl
      ? await sendImage({ axios, env: process.env }, to, mediaUrl, text)
      : await sendMessage({ axios, env: process.env }, to, text);

    const [ins] = await db.execute(
      `INSERT INTO messages (conversation_id, direction, body, vonage_message_id, status, sent_by, segments)
       VALUES (?, 'outbound', ?, ?, 'sent', ?, ?)`,
      [conversationId, text, messageId || null, sentBy, segments]
    );

    console.log(`Sent to ${to} [${sentBy}]: ${text}`);
    return { ok: true, messageId: messageId || null, dbId: ins.insertId };
  } catch (err) {
    console.error(`sendSMS error (${String(text ?? '').length} chars):`, err.message);
    let dbId = null;
    try {
      const [ins] = await db.execute(
        `INSERT INTO messages (conversation_id, direction, body, status, sent_by, segments)
         VALUES (?, 'outbound', ?, 'failed', ?, ?)`,
        [conversationId, text, sentBy, segments]
      );
      dbId = ins.insertId;
    } catch (e) {
      console.error('Failed to log failed message:', e.message);
    }
    return { ok: false, error: err.message, dbId };
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
    log.warn('kommo', 'Fallo al reflejar SMS entrante hacia Kommo', { phone, error: err.message });
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
      log.warn('kommo', 'Fallo al reflejar SMS saliente hacia Kommo', { phone, status: res.status });
      return null;
    }
    return (res.data && res.data.new_message && res.data.new_message.msgid) || null;
  } catch (err) {
    console.error('[kommo] mirrorOutbound error:', err.message);
    log.warn('kommo', 'Error reflejando SMS saliente hacia Kommo', { phone, error: err.message });
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

// DISABLED pending review — campaign lead-tagging, unrelated to the logs work
// it shipped alongside. Blocker: kommoCrm.searchLeadByPhone returns the first
// `?query=` hit when it cannot confirm the phone (Kommo matches substrings
// across name/phone/email), so a campaign would tag arbitrary leads, one per
// recipient, with every failure swallowed. Re-enable together with the call in
// lib/sendEngine.js once the search confirms the phone or returns null.
//
// Search for a lead by phone, tag it. Returns true/false; never throws.
// Cache is per-call-site — pass a Map to reuse lookups across a batch.
// deps.tagLeadByPhone = async ({ phone, tags, cache }) => {
//   if (!KOMMO_CRM.token || !KOMMO_CRM.subdomain) return false;
//   const normalized = phone.replace(/\D/g, '');
//   if (cache && cache.has(normalized)) {
//     const leadId = cache.get(normalized);
//     if (leadId) await kommoCrm.addLeadTags({ axios, subdomain: KOMMO_CRM.subdomain, token: KOMMO_CRM.token, leadId, tags }).catch(() => {});
//     return !!leadId;
//   }
//   const leadId = await kommoCrm.searchLeadByPhone({ axios, subdomain: KOMMO_CRM.subdomain, token: KOMMO_CRM.token, phone: normalized });
//   if (cache) cache.set(normalized, leadId);
//   if (leadId) {
//     await kommoCrm.addLeadTags({ axios, subdomain: KOMMO_CRM.subdomain, token: KOMMO_CRM.token, leadId, tags }).catch(() => {});
//     return true;
//   }
//   return false;
// };

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
    log.warn('kommo', 'Webhook de Kommo sin texto/teléfono/media — ignorado');
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
    log.warn('kommo', 'Respuesta de vendedor omitida — contacto dado de baja', { phone });
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

  // Sanitize before deciding anything: it strips accents and emoji, so it
  // determines both whether there is anything left to send and how long the
  // outgoing SMS actually is.
  const clean = sanitizeForSMS(text);
  const kommoMsgid = m.message && m.message.id;

  // One exit for every failure, so the agent always gets the real reason in
  // Kommo instead of a generic string, and the Registro row records why.
  const failRelay = async (reason) => {
    console.warn(`[kommo] agent reply NOT sent to ${phone}: ${reason}`);
    log.warn('kommo', 'Respuesta de vendedor no pudo enviarse por SMS',
      { phone, conversationId, reason, length: clean.length });
    if (kommoMsgid) await pushKommoDeliveryStatus(String(kommoMsgid), -1, String(reason).slice(0, 200));
  };

  // The guard at the top of this handler tested the RAW text. An all-emoji or
  // all-accent reply survives it and only collapses to '' here — that used to
  // reach Vonage as an empty SMS.
  if (!clean && !mediaUrl) {
    await failRelay('El mensaje quedó vacío al convertirlo a texto SMS (solo emojis o símbolos)');
    return;
  }

  // Long replies go out as a one-segment link to a hosted page: Vonage rejects
  // text over 3200 characters outright, and an image's caption is capped far
  // lower still. Under the threshold nothing changes.
  const threshold = Number(process.env.HOSTED_LINK_THRESHOLD) || 2000;
  const outgoingMax = mediaUrl ? MMS_CAPTION_MAX : threshold;
  let outgoing = clean;
  let hosted = null;
  // A fresh source Día 1 after another numbered day is unsafe without an
  // explicit same-client boundary. Check the raw body before sending anything.
  const itineraryKind = classifyItineraries(text);
  if (itineraryKind.kind === 'ambiguous') {
    await failRelay('Detecté más de un itinerario. Separe los tours del mismo cliente con --- NUEVO ITINERARIO ---');
    return;
  }
  if (itineraryKind.kind === 'invalid-marker') {
    await failRelay('Cada lado de --- NUEVO ITINERARIO --- debe incluir al menos un Día válido');
    return;
  }

  // An explicit appended tour always needs a hosted page, even if its SMS text
  // would fit, because the page restarts each tour at Día 1 and hides the marker.
  if (clean.length > outgoingMax || itineraryKind.kind === 'explicit-appended') {
    try {
      // Store the RAW text, not `clean`: the page is HTML and can render the
      // accents and ñ that GSM-7 cannot.
      hosted = await createHostedMessage(deps, {
        body: text, contactId, conversationId, source: 'kommo',
      });
      outgoing = buildLinkSms(process.env, hosted.title, hosted.code);
    } catch (err) {
      await failRelay(`No se pudo alojar el mensaje largo: ${err.message}`);
      return;
    }
  }

  const sent = await sendSMS(phone, outgoing, conversationId, 'human', mediaUrl);
  await db.execute(`UPDATE conversations SET status = 'needs_human' WHERE id = ?`, [conversationId]);

  if (!sent.ok) {
    await failRelay(sent.error || 'SMS send failed');
    return;
  }

  // Remember Kommo's msgid for this relay so /status DLRs can be reported back
  // to Kommo as delivered/failed on the agent's message.
  if (kommoMsgid) {
    await db.execute(
      `UPDATE messages SET kommo_msgid = ? WHERE id = ?`,
      [String(kommoMsgid), sent.dbId]
    ).catch(e => console.error('[kommo] kommo_msgid save error:', e.message));
  }

  if (hosted) {
    // Join the hosted page to the SMS row that carried its link.
    db.execute(`UPDATE hosted_messages SET message_id = ? WHERE id = ?`, [sent.dbId, hosted.id])
      .catch(e => console.error('[hosted] message link error:', e.message));

    // Post a notice into the same Kommo thread the seller is looking at.
    // Without it they see their full itinerary and a delivered receipt, and
    // have no way to know the customer received a link instead of the text —
    // which reads like the system silently truncated their work.
    //
    // This rides the same import path campaign blasts use: `silent: true`, so
    // Kommo records the message in the conversation without trying to deliver
    // it as an SMS and without firing the agent-reply webhook back at us.
    // `force: true` because KOMMO_MIRROR_AI gates ordinary AI mirroring, and
    // this notice must appear whether or not the AI responder is on.
    mirrorOutboundToKommo({
      phone,
      text: `Enviado como enlace (${clean.length} caracteres, máximo ${outgoingMax} por SMS).\n` +
            `Link al itinerario: ${hosted.url}`,
      msgid: `hosted-${hosted.id}`,
      senderName: 'Brinteva Worlds',
      force: true,
    }).catch(e => console.error('[kommo] hosted notice error:', e.message));

    console.log(`[kommo] agent reply hosted (${clean.length} chars) -> ${hosted.url} (conv ${conversationId})`);
    log.info('kommo', 'Respuesta larga enviada como enlace',
      { phone, conversationId, url: hosted.url, originalLength: clean.length });
    return;
  }

  console.log(`[kommo] agent reply relayed to ${phone} (conv ${conversationId})`);
  log.info('kommo', 'Respuesta de vendedor enviada por SMS', { phone, conversationId });
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
// Public, unauthenticated: /i/:code serves a hosted long message. The code is
// the only credential, so the page is noindex, no-store and unframeable.
registerHostedRoutes(app, deps);
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

// A crash nobody caught is exactly the event the log table is for: the admin
// sees it on the Registro tab instead of discovering it via a dead campaign.
//
// Both handlers must still end the process. Registering a listener for either
// event *replaces* Node's default crash (since Node 15 that includes
// unhandledRejection), so logging without exiting would leave us running on top
// of whatever broken state threw — PM2 sees a healthy process and never
// restarts it. Record the event, then exit non-zero so PM2 brings up a clean
// one. Exiting is the recovery; the log row is just the evidence.
let crashing = false;

function fatal(kind, err) {
  // A second fault while the first is still being written must not restart the
  // sequence or delay the exit.
  if (crashing) return;
  crashing = true;

  console.error(`${kind}:`, err);

  // Never let a slow or hung DB write keep a broken process alive: whichever
  // settles first wins. unref() so the timer itself can't hold the loop open if
  // the write finishes fast. log.error swallows its own failures, so the race
  // always settles.
  const deadline = new Promise(resolve => setTimeout(resolve, 2000).unref());
  Promise.race([
    log.error('system', kind, { error: String((err && err.stack) || err) }),
    deadline
  ]).finally(() => process.exit(1));
}

process.on('uncaughtException', (err) => fatal('uncaughtException', err));
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));
