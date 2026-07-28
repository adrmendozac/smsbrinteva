// Kommo Chats API gateway.
//
// Two signing contexts (see developers.kommo.com/reference):
//   - Outbound (you -> Kommo): sign the string
//       METHOD\nContent-MD5\nContent-Type\nDate\npath
//     with HMAC-SHA1(channel secret), lowercase hex. Send Date, Content-Type,
//     Content-MD5 and X-Signature headers. The signed bytes MUST equal the sent
//     body bytes, so we serialize once and hand axios the exact string.
//   - Inbound (Kommo -> you): X-Signature = HMAC-SHA1(raw request body, channel
//     secret). Verify against the untouched raw body.
//
// Everything is dependency-injected (axios, env) to match the other lib modules
// and to keep the amojo primitives unit-runnable outside Express.

const crypto = require('crypto');

const AMOJO_BASE = 'https://amojo.kommo.com';

// ── Signing primitives ──────────────────────────────────────────────────────

function md5Lower(body) {
  return crypto.createHash('md5').update(body, 'utf8').digest('hex').toLowerCase();
}

// RFC-2822 date, e.g. "Tue, 01 Jul 2026 12:00:00 +0000". Node's toUTCString()
// yields "...GMT"; Kommo's examples use the numeric offset.
function rfc2822Date(d = new Date()) {
  return d.toUTCString().replace('GMT', '+0000');
}

function signOutbound({ method, contentMd5, contentType, date, path, secret }) {
  const str = [method.toUpperCase(), contentMd5, contentType, date, path].join('\n');
  return crypto.createHmac('sha1', secret).update(str).digest('hex').toLowerCase();
}

// HMAC-SHA1(raw body, secret); constant-time compare against the header.
// Kommo signs the JSON *without* the trailing newline it appends to the wire
// body (observed live 2026-07-06), so a strict mismatch is retried with
// trailing CR/LF stripped.
function verifyWebhookSignature({ rawBody, signature, secret }) {
  if (!signature || !secret) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf8');
  const sig = Buffer.from(String(signature).toLowerCase());
  const matches = (buf) => {
    const expected = Buffer.from(crypto.createHmac('sha1', secret).update(buf).digest('hex'));
    return expected.length === sig.length && crypto.timingSafeEqual(expected, sig);
  };
  if (matches(raw)) return true;
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) end--;
  return end < raw.length && matches(raw.slice(0, end));
}

// ── Outbound request helper ─────────────────────────────────────────────────

// Serialize once, sign the exact bytes, and stop axios from re-serializing.
async function amojoRequest({ axios, secret, method, path, bodyObj }) {
  const body = JSON.stringify(bodyObj);
  const contentType = 'application/json';
  const contentMd5 = md5Lower(body);
  const date = rfc2822Date();
  const signature = signOutbound({ method, contentMd5, contentType, date, path, secret });

  return axios({
    method,
    url: AMOJO_BASE + path,
    data: body,
    transformRequest: [d => d], // send `body` verbatim; do not re-JSON it
    headers: {
      Date: date,
      'Content-Type': contentType,
      'Content-MD5': contentMd5,
      'X-Signature': signature
    },
    validateStatus: () => true
  });
}

// ── Chats API operations ────────────────────────────────────────────────────

// One-time: bind the registered channel to an account. Returns the amojo
// response; a 200 body carries { account_id, scope_id, title, ... }.
function connectChannel({ axios, channelId, secret, accountId, title, isTimeWindowDisabled = false }) {
  return amojoRequest({
    axios,
    secret,
    method: 'POST',
    path: `/v2/origin/custom/${channelId}/connect`,
    bodyObj: { account_id: accountId, title, hook_api_version: 'v2', is_time_window_disabled: isTimeWindowDisabled }
  });
}

// Import a message into a connected chat. `payload` is the full amojo payload
// (msgid, conversation_id, sender, receiver, message, ...).
function importMessage({ axios, scopeId, secret, payload }) {
  return amojoRequest({
    axios,
    secret,
    method: 'POST',
    path: `/v2/origin/custom/${scopeId}`,
    bodyObj: { event_type: 'new_message', payload }
  });
}

// Show "typing" in Kommo when the customer is sending an SMS.
function sendTyping({ axios, scopeId, secret, conversationId, senderId, durationMs = 5000 }) {
  return amojoRequest({
    axios, secret,
    method: 'POST',
    path: `/v2/origin/custom/${scopeId}/typing`,
    bodyObj: { conversation_id: conversationId, sender: { id: senderId }, duration_ms: durationMs }
  });
}

// Update the delivery status of a previously-imported message.
// deliveryStatus: -1 error, 0 sent, 1 delivered, 2 read (amojo enum).
function updateDeliveryStatus({ axios, scopeId, secret, msgid, deliveryStatus, errorCode, error }) {
  const bodyObj = { msgid, delivery_status: deliveryStatus };
  if (errorCode != null) bodyObj.error_code = errorCode;
  if (error != null) bodyObj.error = error;
  return amojoRequest({
    axios,
    secret,
    method: 'POST',
    path: `/v2/origin/custom/${scopeId}/${msgid}/delivery_status`,
    bodyObj
  });
}

// ── Payload builders ────────────────────────────────────────────────────────

// A stable conversation ref per contact so all of a contact's SMS land in one
// Kommo chat. Prefixed to stay unique within our integration's namespace.
function conversationRef(phone) {
  return `brinteva-${String(phone).replace(/[^\d]/g, '')}`;
}

// Build the import payload for an inbound customer SMS.
function inboundPayload({ phone, name, text, msgid, timestamp = Math.floor(Date.now() / 1000) }) {
  return {
    timestamp,
    msec_timestamp: Date.now(),
    msgid: String(msgid),
    conversation_id: conversationRef(phone),
    sender: {
      id: conversationRef(phone),
      name: name || phone,
      profile: { phone }
    },
    message: { type: 'text', text },
    silent: false
  };
}

// Build the import payload for a message WE sent to the customer (AI or system),
// so agents see it in the Kommo thread. `silent: true` records it without asking
// Kommo to (re)deliver it — we already sent the SMS, so this prevents a loop.
// `botRefId` must be the integration bot id issued at channel registration;
// amojo rejects arbitrary sender ids on outgoing messages ("sender: user not found").
function outboundPayload({ phone, senderName, text, mediaUrl = null, msgid, botRefId, timestamp = Math.floor(Date.now() / 1000) }) {
  return {
    timestamp,
    msec_timestamp: Date.now(),
    msgid: String(msgid),
    conversation_id: conversationRef(phone),
    sender: { ref_id: botRefId, name: senderName || 'Brinteva AI' },
    receiver: { id: conversationRef(phone), name: phone, profile: { phone } },
    // An MMS mirrors as a picture with the caption as its text; amojo fetches
    // media itself, so the URL has to be the public one.
    message: mediaUrl
      ? { type: 'picture', media: mediaUrl, text }
      : { type: 'text', text },
    silent: true
  };
}

// ── CRM API (leads) ─────────────────────────────────────────────────────────
// A separate system from the Chats API above: different host (subdomain.kommo.com,
// not amojo.kommo.com) and different auth (a long-lived Bearer token issued once
// from Kommo's integration settings, not per-request HMAC signing).

function crmRequest({ axios, subdomain, token, method, path, data }) {
  return axios({
    method,
    url: `https://${subdomain}.kommo.com/api/v4${path}`,
    data,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    validateStatus: () => true
  });
}

// Kommo's contact search is a substring match over name/phone/email; a phone
// query reliably finds the contact the Chats API auto-created for this number
// (if any), so the lead can link to it instead of creating a duplicate.
async function findContactIdByPhone({ axios, subdomain, token, phone }) {
  const res = await crmRequest({
    axios, subdomain, token, method: 'GET',
    path: `/contacts?query=${encodeURIComponent(phone)}&limit=1`
  });
  if (res.status !== 200) return null;
  const hit = res.data && res.data._embedded && res.data._embedded.contacts && res.data._embedded.contacts[0];
  return hit ? hit.id : null;
}

// Create a Kommo contact for a phone that has none yet. Returns the new id, or
// null on failure.
async function createContact({ axios, subdomain, token, phone, name }) {
  const body = [{
    name: name || phone,
    custom_fields_values: [
      { field_code: 'PHONE', values: [{ value: phone, enum_code: 'MOB' }] }
    ]
  }];
  const res = await crmRequest({ axios, subdomain, token, method: 'POST', path: '/contacts', data: body });
  if (res.status >= 300) {
    console.error('[kommo] createContact failed', res.status, JSON.stringify(res.data));
    return null;
  }
  const contact = res.data && res.data._embedded && res.data._embedded.contacts && res.data._embedded.contacts[0];
  return contact ? contact.id : null;
}

// Create a lead for a first-time inbound texter using the complex endpoint,
// which creates the lead + embedded contact in one call. If a contact already
// exists for this phone (e.g. auto-created by the Kommo Chats API), it links
// by ID instead of creating a duplicate. Returns the created lead id, or null
// on failure — this is a best-effort CRM mirror and must never be the reason
// /inbound fails.
async function createSmsLead({ axios, subdomain, token, pipelineId, statusId, mensajeClienteFieldId, phone, name, text }) {
  try {
    const existingContactId = await findContactIdByPhone({ axios, subdomain, token, phone });

    const body = [{
      name: name ? `${name} (SMS)` : `SMS ${phone}`,
      pipeline_id: pipelineId,
      status_id: statusId,
      custom_fields_values: [
        { field_id: mensajeClienteFieldId, values: [{ value: text }] }
      ],
      _embedded: {
        contacts: existingContactId
          ? [{ id: existingContactId }]
          : [{
              name: name || phone,
              custom_fields_values: [
                { field_code: 'PHONE', values: [{ value: phone, enum_code: 'MOB' }] }
              ]
            }]
      }
    }];

    const res = await crmRequest({ axios, subdomain, token, method: 'POST', path: '/leads/complex', data: body });
    if (res.status >= 300) {
      console.error('[kommo] createSmsLead failed', res.status, JSON.stringify(res.data));
      return null;
    }
    const lead = res.data && res.data[0];
    return lead ? lead.id : null;
  } catch (err) {
    console.error('[kommo] createSmsLead error:', err.message);
    return null;
  }
}

// ── Express wiring ──────────────────────────────────────────────────────────

// Registers POST /kommo/webhook/:scope_id. `onAgentMessage(payload)` is called
// with the verified webhook payload (an agent reply typed inside Kommo) so the
// caller can relay it over SMS and mute the AI.
function registerKommoRoutes(app, deps, onAgentMessage) {
  const { env } = deps;

  // Body is JSON-parsed by the global parser; req.rawBody holds the exact bytes
  // (captured via the parser's verify hook) for signature verification.
  app.post('/kommo/webhook/:scope_id', async (req, res) => {
    const secret = env.KOMMO_CHANNEL_SECRET;
    const signature = req.headers['x-signature'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');

    const ok = verifyWebhookSignature({ rawBody, signature, secret });
    if (!ok) {
      // In test_mode the exact inbound scheme is still being validated against
      // the live channel; log the mismatch but don't hard-drop agent replies.
      console.warn(`[kommo] webhook signature mismatch (scope ${req.params.scope_id})`);
      if (String(env.KOMMO_ENFORCE_SIGNATURE) === '1') {
        return res.status(401).json({ error: 'bad signature' });
      }
    }

    // Ack fast (Kommo sends each webhook once), then process async.
    res.sendStatus(200);

    try {
      await onAgentMessage(req.body || {}, req.params.scope_id);
    } catch (err) {
      console.error('[kommo] onAgentMessage error:', err.message);
    }
  });
}

module.exports = {
  AMOJO_BASE,
  md5Lower,
  rfc2822Date,
  signOutbound,
  verifyWebhookSignature,
  amojoRequest,
  connectChannel,
  importMessage,
  sendTyping,
  updateDeliveryStatus,
  conversationRef,
  inboundPayload,
  outboundPayload,
  registerKommoRoutes,
  crmRequest,
  findContactIdByPhone,
  createContact,
  createSmsLead
};
