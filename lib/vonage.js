const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Messages API rather than the legacy SMS API. The account's Messaging API type
// is set to "Messages API", and delivery receipts follow whichever API sent the
// message — legacy sends produced DLRs that were routed by the (disabled) legacy
// callback and silently dropped, so messages.status never left 'sent'. Sending
// here makes DLRs arrive at the application's configured status_url instead.
const MESSAGES_URL = 'https://api.nexmo.com/v1/messages';

let cachedKey = null;

function readPrivateKey(env) {
  if (cachedKey) return cachedKey;
  const configured = env.VONAGE_PRIVATE_KEY_PATH || './private.key';
  // Resolve against the app root so the key is found regardless of cwd.
  const candidates = [
    path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured),
    path.resolve(__dirname, '..', configured.replace(/^\.\//, '')),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cachedKey = fs.readFileSync(p);
      return cachedKey;
    }
  }
  throw new Error(`Vonage private key not found (tried: ${candidates.join(', ')})`);
}

// Short-lived RS256 JWT, per Vonage application auth.
function generateJWT(env) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      application_id: env.VONAGE_APPLICATION_ID,
      iat: now,
      exp: now + 60,
      jti: crypto.randomUUID(),
    },
    readPrivateKey(env),
    { algorithm: 'RS256' }
  );
}

// Vonage returns problem-details JSON on failure; surface something readable
// instead of a bare "Request failed with status code 401".
//
// `invalid_parameters` is the only part that names WHICH field was wrong and
// why — without it a 422 reads "The value of one or more parameters is
// invalid.", which is what made the oversized-itinerary failures undiagnosable
// for days. Always append it.
function describeError(err) {
  const d = err.response && err.response.data;
  if (d) {
    const parts = [d.title, d.detail].filter(Boolean).join(': ');
    const invalid = Array.isArray(d.invalid_parameters)
      ? d.invalid_parameters
          .map(p => [p && p.name, p && p.reason].filter(Boolean).join(': '))
          .filter(Boolean)
          .join('; ')
      : '';
    if (parts || invalid) return [parts, invalid && `(${invalid})`].filter(Boolean).join(' ');
    if (typeof d === 'string') return d.slice(0, 200);
  }
  return err.message;
}

// Wrap an axios failure as an Error whose message stays exactly what
// describeError() produced — every existing caller relays that string to a
// seller or into broadcast_recipients.error — while also carrying the machine
// fields the send engine needs to tell a throughput rejection apart from a bad
// phone number. Before this, error 99 ("partner quota exceeded") was
// indistinguishable from an invalid recipient, so the 2026-08-11 campaign kept
// hammering a blocked account for 5,530 rejections.
function vonageError(err) {
  const wrapped = new Error(describeError(err));
  const res = err.response;
  const data = res && res.data;
  wrapped.httpStatus = res ? res.status : null;
  // Messages API returns RFC-7807 `type`; the older REST APIs return a numeric
  // `status`/`error-code`. Keep whichever is present, as a string.
  const code =
    (data && (data['error-code'] || data.code)) ??
    (data && typeof data.status === 'number' ? data.status : null);
  wrapped.vonageCode = code == null ? null : String(code);
  wrapped.vonageType = (data && data.type) || null;
  wrapped.cause = err;
  return wrapped;
}

// Send one SMS. Resolves to { messageId } where messageId is the Messages API
// message_uuid — the same value the status webhook reports back. Cost is not
// available here: Vonage's synchronous send response only ever contains
// message_uuid/workflow_id — the price comes later via the /status webhook's
// usage.price, which is where lib/webhooks.js reads it.
async function sendMessage({ axios, env }, to, text) {
  try {
    const res = await axios.post(
      MESSAGES_URL,
      { message_type: 'text', text, to, from: env.VONAGE_NUMBER, channel: 'sms' },
      {
        headers: {
          Authorization: `Bearer ${generateJWT(env)}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return { messageId: res.data.message_uuid || null };
  } catch (err) {
    throw vonageError(err);
  }
}

// Send one MMS. `url` must be publicly reachable — Vonage fetches it itself.
// US and Canada only; caption is capped by the caller.
async function sendImage({ axios, env }, to, url, caption) {
  try {
    const res = await axios.post(
      MESSAGES_URL,
      {
        message_type: 'image',
        image: caption ? { url, caption } : { url },
        to,
        from: env.VONAGE_NUMBER,
        channel: 'mms',
      },
      {
        headers: {
          Authorization: `Bearer ${generateJWT(env)}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return { messageId: res.data.message_uuid || null };
  } catch (err) {
    throw vonageError(err);
  }
}

// Account balance. This is the older Account API, not the Messages API above —
// separate host and auth (api_key/api_secret query params, not a JWT).
async function getBalance({ axios, env }) {
  try {
    const res = await axios.get('https://rest.nexmo.com/account/get-balance', {
      params: { api_key: env.VONAGE_API_KEY, api_secret: env.VONAGE_API_SECRET }
    });
    return { balance: res.data.value, autoReload: !!res.data.autoReload };
  } catch (err) {
    throw vonageError(err);
  }
}

// Per-segment SMS price for a country. Same Account API family as getBalance.
// US only — every recipient in this system is a US/CA number (10DLC).
async function getSmsPrice({ axios, env }) {
  try {
    const res = await axios.get('https://rest.nexmo.com/account/get-pricing/outbound/sms', {
      params: { api_key: env.VONAGE_API_KEY, api_secret: env.VONAGE_API_SECRET, country: 'US' }
    });
    return { pricePerSegment: res.data.defaultPrice, currency: res.data.currency };
  } catch (err) {
    throw vonageError(err);
  }
}

// Current carrier for one number, via Number Insight Standard — same Account
// API family (api_key/api_secret) as getBalance/getSmsPrice above.
//
// Deliberately NOT Identity Insights: that product needs production vetting, a
// declared `purpose`, and sales-quoted pricing, and its extra insights (SIM
// swap, subscriber match) are irrelevant here. All the throughput limiter needs
// is the network code, which Standard returns.
//
// Returns the raw outcome — classification lives in scripts/backfill-carriers.js
// — because Number Insight signals failure INSIDE a 200 response via a numeric
// `status`, so callers must inspect it rather than rely on a thrown error:
//   0 success · 1 throttled · 3 invalid params · 4 invalid credentials
//   5 internal error · 9 partner quota exceeded
//
// `current_carrier` (not original_carrier): a ported number is metered by the
// carrier serving it today, which is the whole point of the lookup.
async function lookupCarrier({ axios, env }, phone) {
  const res = await axios.get('https://rest.nexmo.com/ni/standard/json', {
    params: {
      api_key: env.VONAGE_API_KEY,
      api_secret: env.VONAGE_API_SECRET,
      number: String(phone).replace(/[^\d]/g, ''),
      country: 'US'
    },
    timeout: 15000
  });
  const d = res.data || {};
  const carrier = d.current_carrier || {};
  return {
    status: Number(d.status),
    statusMessage: d.status_message || null,
    networkCode: carrier.network_code || null,
    carrierName: carrier.name || null,
    // Standard reports 'mobile' | 'landline' | 'virtual' | 'unknown'.
    networkType: carrier.network_type || null
  };
}

module.exports = {
  sendMessage,
  sendImage,
  getBalance,
  getSmsPrice,
  lookupCarrier,
  generateJWT,
  describeError,
  vonageError
};
