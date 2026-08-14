// Carrier-aware outbound throughput budget.
//
// WHY THIS EXISTS: on 2026-08-11/12 a seller launched 1,112 recipients of a
// 686-char body — 5 segments each, 5,530 segments — in one burst. The old
// engine paced by MESSAGES per second with no daily ceiling, so it submitted
// ~300 segments/minute against an AT&T limit of 75/min and blew straight past
// T-Mobile's 2,000/day. Vonage's fraud system blocked the API key and rejected
// 100% of traffic with error 99 for two days.
//
// Our 10DLC throughput allowances:
//   AT&T      75 SMS per minute   (message class T)
//   T-Mobile  2000 SMS per day    (brand tier LOW)
//   Verizon, US Cellular, Liberty, ClearSky, Interop — no published figure.
//
// T-Mobile's daily cap is the binding constraint: it is the only hard daily
// ceiling we know, so it is what the budget is built around. Two buckets:
//
//   'tmobile' — numbers resolved to T-Mobile, PLUS every number whose carrier
//               is unknown, stale, or unresolvable. Strict daily budget.
//   'other'   — numbers resolved to some other mobile carrier. Paced by the
//               minute window only, since no daily figure is published.
//
// Unknown defaults to the strict bucket on purpose: guessing 'other' for an
// unlooked-up number is exactly how the cap gets exceeded again.
//
// Everything is counted in SEGMENTS, never messages — that is the unit the
// carrier meters.

const TMOBILE = 'tmobile';
const OTHER = 'other';

// Carrier-side ceilings. Env overrides are clamped to these; a typo in .env
// must not be able to raise a limit past what the carrier actually allows.
const CARRIER_MAX_PER_MINUTE = 75;   // AT&T message class T
const CARRIER_MAX_TMOBILE_PER_DAY = 2000; // T-Mobile brand tier LOW

const DEFAULTS = {
  // Below AT&T's 75 so seller replies always have room alongside a campaign.
  segmentsPerMinute: 50,
  // 500 segments of the carrier's 2000 held back as a safety margin.
  tmobileSegmentsPerDay: 1500,
  // Campaigns stop here, reserving >=300 T-Mobile segments/day for the Kommo
  // conversations sellers run all day.
  tmobileCampaignSegmentsPerDay: 1200
};

// Classification runs off the carrier NAME that Number Insight returns and we
// store in contacts.carrier_name — not off a hand-maintained table of MCC/MNC
// codes. The name comes from Vonage; a code table would come from us
// remembering one correctly, and a single wrong entry sending a T-Mobile MVNO
// to the loose bucket is precisely the failure this module exists to prevent.
//
// Matches the T-Mobile brand family, whose members share one throughput
// allowance: T-Mobile itself, the Sprint estate it absorbed, and the MVNOs
// riding that network.
const TMOBILE_NAME = /t-?mobile|sprint|metro ?pcs|mint mobile|ultra mobile|google fi/i;

// The only codes we have actually observed in our own contacts, kept as a
// fallback for rows resolved before carrier_name was stored. Anything else is
// classified by name alone. Verified against production on 2026-08-13:
//   310260 T-mobile USA, Inc. · 310090 AT&T Mobility · 310004 Verizon Wireless
const KNOWN_CODES = {
  '310260': 'tmobile',
  '310090': 'other',
  '310004': 'other'
};

// Sentinels stored in contacts.carrier_network_code by the backfill for numbers
// that will never resolve to a mobile carrier. Both stay in the strict bucket:
// a landline should not be receiving SMS at all, and an invalid number costs
// nothing to be careful with.
const NON_MOBILE = 'NON_MOBILE';
const INVALID = 'INVALID';

// A cached carrier older than this is treated as unknown. Numbers port, and a
// stale "not T-Mobile" answer is precisely the kind of silent error that would
// let the daily cap be exceeded.
const CARRIER_TTL_DAYS = 90;

class BudgetExhausted extends Error {
  constructor(bucket, used, limit) {
    super(`Daily segment budget exhausted for ${bucket} (${used}/${limit})`);
    this.name = 'BudgetExhausted';
    this.bucket = bucket;
    this.used = used;
    this.limit = limit;
  }
}

function clampLimit(raw, fallback, ceiling) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), ceiling);
}

function readLimits(env = {}) {
  return {
    segmentsPerMinute: clampLimit(
      env.SEGMENTS_PER_MINUTE, DEFAULTS.segmentsPerMinute, CARRIER_MAX_PER_MINUTE
    ),
    tmobileSegmentsPerDay: clampLimit(
      env.TMOBILE_SEGMENTS_PER_DAY, DEFAULTS.tmobileSegmentsPerDay, CARRIER_MAX_TMOBILE_PER_DAY
    ),
    tmobileCampaignSegmentsPerDay: clampLimit(
      env.TMOBILE_CAMPAIGN_SEGMENTS_PER_DAY,
      DEFAULTS.tmobileCampaignSegmentsPerDay,
      CARRIER_MAX_TMOBILE_PER_DAY
    )
  };
}

// Which budget a recipient draws from. Reads carrier_name, carrier_network_code
// and carrier_checked_at off a contact/recipient row.
//
// Every uncertain case resolves to the strict bucket: no lookup yet, a stale
// one, a landline, an unusable number, or a carrier we cannot identify. Sending
// an unknown number down the loose path is the only mistake here that can
// exceed the daily cap, so it is the one the default rules out.
function bucketFor(contact, now = new Date()) {
  if (!contact) return TMOBILE;
  const code = contact.carrier_network_code;
  if (!code || code === NON_MOBILE || code === INVALID) return TMOBILE;

  const checkedAt = contact.carrier_checked_at ? new Date(contact.carrier_checked_at) : null;
  if (!checkedAt || Number.isNaN(checkedAt.getTime())) return TMOBILE;
  const ageDays = (now.getTime() - checkedAt.getTime()) / 86400000;
  if (ageDays > CARRIER_TTL_DAYS) return TMOBILE;

  const name = contact.carrier_name;
  if (name) return TMOBILE_NAME.test(name) ? TMOBILE : OTHER;

  // No name stored (a row resolved before we recorded it): fall back to the
  // handful of codes we have actually seen, and treat anything else as
  // T-Mobile rather than guessing.
  return KNOWN_CODES[String(code)] === 'other' ? OTHER : TMOBILE;
}

// Segments already sent today in a bucket, read straight from the tables that
// record real sends rather than an in-process counter. A counter would reset on
// every pm2 restart and drift from reality; this cannot.
//
// Counts BOTH campaign traffic (broadcast_recipients) and one-off/Kommo replies
// (messages), because the carrier meters the number, not the feature that used
// it. On a chatty day campaigns automatically get less room.
async function usedToday(db, bucket, now = new Date()) {
  const tmobileOnly = bucket === TMOBILE;
  // Mirrors bucketFor(): a contact escapes the strict budget only with a fresh
  // lookup naming a carrier outside the T-Mobile family. Unresolved, stale,
  // sentinel, and unrecognised rows all count as T-Mobile.
  //
  // Carrier days roll at midnight UTC; UTC_DATE() keeps the boundary
  // independent of the VPS timezone.
  const isLoose = `(c.carrier_name IS NOT NULL
        AND c.carrier_name NOT REGEXP ?
        AND c.carrier_network_code NOT IN (?, ?)
        AND c.carrier_checked_at IS NOT NULL
        AND c.carrier_checked_at >= UTC_TIMESTAMP() - INTERVAL ${CARRIER_TTL_DAYS} DAY)`;
  const predicate = tmobileOnly ? `NOT ${isLoose}` : isLoose;
  // MySQL REGEXP is case-insensitive for non-binary collations, matching the
  // /i on TMOBILE_NAME.
  const params = [TMOBILE_NAME.source, NON_MOBILE, INVALID];

  const [campaignRows] = await db.query(
    `SELECT COALESCE(SUM(br.segments), 0) AS n
       FROM broadcast_recipients br
       JOIN contacts c ON c.id = br.contact_id
      WHERE br.sent_at >= UTC_DATE()
        AND br.status IN ('sent', 'delivered')
        AND ${predicate}`,
    params
  );

  const [replyRows] = await db.query(
    `SELECT COALESCE(SUM(m.segments), 0) AS n
       FROM messages m
       JOIN conversations conv ON conv.id = m.conversation_id
       JOIN contacts c ON c.id = conv.contact_id
      WHERE m.created_at >= UTC_DATE()
        AND m.direction = 'outbound'
        AND m.status IN ('sent', 'delivered')
        AND ${predicate}`,
    params
  );

  return Number(campaignRows[0].n || 0) + Number(replyRows[0].n || 0);
}

// One limiter per process. The minute window lives in memory (single pm2
// process, and a restart losing a partial minute is harmless — the daily
// budget, the one that matters, is re-read from the DB).
function createThroughput({ db, env = {}, sleep, now = () => new Date() }) {
  const limits = readLimits(env);
  let windowStart = 0;
  let windowSegments = 0;

  function minuteWindowFree(segments) {
    const t = now().getTime();
    if (t - windowStart >= 60000) {
      windowStart = t;
      windowSegments = 0;
    }
    // A single message larger than the whole per-minute allowance would
    // deadlock the loop; let it through alone in its own window instead.
    if (windowSegments === 0) return true;
    return windowSegments + segments <= limits.segmentsPerMinute;
  }

  function msUntilWindowReset() {
    return Math.max(0, 60000 - (now().getTime() - windowStart));
  }

  // Reserve capacity for one outbound message.
  //
  // `kind: 'campaign'` obeys the lower campaign ceiling so bulk sends stop
  // early and leave the remainder for sellers. `kind: 'reply'` obeys only the
  // absolute ceiling: a seller mid-conversation is never told "come back
  // tomorrow" by a campaign that filled the budget.
  async function acquire(bucket, segments, kind = 'campaign') {
    if (segments <= 0) return;

    if (bucket === TMOBILE) {
      const limit = kind === 'campaign'
        ? limits.tmobileCampaignSegmentsPerDay
        : limits.tmobileSegmentsPerDay;
      const used = await usedToday(db, bucket, now());
      if (used + segments > limit) throw new BudgetExhausted(bucket, used, limit);
    }

    while (!minuteWindowFree(segments)) {
      await sleep(Math.min(msUntilWindowReset(), 5000));
    }
    windowSegments += segments;
  }

  // Segments that a campaign may still spend today. Feeds the admin UI so a
  // seller can see why a blast is spilling into tomorrow.
  async function remainingCampaignSegments() {
    const used = await usedToday(db, TMOBILE, now());
    return Math.max(0, limits.tmobileCampaignSegmentsPerDay - used);
  }

  return {
    limits,
    bucketFor,
    acquire,
    remainingCampaignSegments,
    usedToday: bucket => usedToday(db, bucket, now())
  };
}

module.exports = {
  createThroughput,
  bucketFor,
  readLimits,
  BudgetExhausted,
  TMOBILE,
  OTHER,
  NON_MOBILE,
  INVALID,
  TMOBILE_NAME,
  CARRIER_TTL_DAYS,
  DEFAULTS,
  CARRIER_MAX_PER_MINUTE,
  CARRIER_MAX_TMOBILE_PER_DAY
};
