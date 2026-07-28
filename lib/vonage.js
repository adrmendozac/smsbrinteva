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
function describeError(err) {
  const d = err.response && err.response.data;
  if (d) {
    const parts = [d.title, d.detail].filter(Boolean).join(': ');
    if (parts) return parts;
    if (typeof d === 'string') return d.slice(0, 200);
  }
  return err.message;
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
    throw new Error(describeError(err));
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
    throw new Error(describeError(err));
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
    throw new Error(describeError(err));
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
    throw new Error(describeError(err));
  }
}

module.exports = { sendMessage, sendImage, getBalance, getSmsPrice, generateJWT, describeError };
