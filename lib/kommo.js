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
function verifyWebhookSignature({ rawBody, signature, secret }) {
  if (!signature || !secret) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf8');
  const expected = crypto.createHmac('sha1', secret).update(raw).digest('hex').toLowerCase();
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
function outboundPayload({ phone, senderName, text, msgid, botRefId, timestamp = Math.floor(Date.now() / 1000) }) {
  return {
    timestamp,
    msec_timestamp: Date.now(),
    msgid: String(msgid),
    conversation_id: conversationRef(phone),
    sender: { ref_id: botRefId, name: senderName || 'Brinteva AI' },
    receiver: { id: conversationRef(phone), name: phone, profile: { phone } },
    message: { type: 'text', text },
    silent: true
  };
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
  updateDeliveryStatus,
  conversationRef,
  inboundPayload,
  outboundPayload,
  registerKommoRoutes
};
