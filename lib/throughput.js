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

// T-Mobile US network codes (MCC 310 / 311 + MNC). Includes the Sprint estate
// it absorbed and the Metro/Mint-style MVNOs that ride the same network and
// therefore share the same brand throughput allowance.
const TMOBILE_NETWORK_CODES = new Set([
  '310026', '310160', '310170', '310200', '310210', '310220', '310230',
  '310240', '310250', '310260', '310270', '310280', '310290', '310300',
  '310310', '310330', '310580', '310660', '310800',
  '311660', '311882', '311883',
  // Sprint, now T-Mobile.
  '310120', '311490', '311870', '311880', '312530'
]);

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

// Which budget a recipient draws from. Accepts a contact/recipient row; only
// carrier_network_code and carrier_checked_at matter.
function bucketFor(contact, now = new Date()) {
  if (!contact) return TMOBILE;
  const code = contact.carrier_network_code;
  if (!code || code === NON_MOBILE || code === INVALID) return TMOBILE;

  const checkedAt = contact.carrier_checked_at ? new Date(contact.carrier_checked_at) : null;
  if (!checkedAt || Number.isNaN(checkedAt.getTime())) return TMOBILE;
  const ageDays = (now.getTime() - checkedAt.getTime()) / 86400000;
  if (ageDays > CARRIER_TTL_DAYS) return TMOBILE;

  return TMOBILE_NETWORK_CODES.has(String(code)) ? TMOBILE : OTHER;
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
  // Carrier days roll at midnight UTC; MySQL UTC_DATE() keeps the boundary
  // independent of the VPS timezone.
  const carrierPredicate = tmobileOnly
    ? `(c.carrier_network_code IS NULL
        OR c.carrier_checked_at IS NULL
        OR c.carrier_checked_at < UTC_TIMESTAMP() - INTERVAL ${CARRIER_TTL_DAYS} DAY
        OR c.carrier_network_code IN (?))`
    : `(c.carrier_network_code IN (?)
        AND c.carrier_checked_at IS NOT NULL
        AND c.carrier_checked_at >= UTC_TIMESTAMP() - INTERVAL ${CARRIER_TTL_DAYS} DAY)`;

  const strictCodes = [...TMOBILE_NETWORK_CODES, NON_MOBILE, INVALID];
  const looseCodes = [...TMOBILE_NETWORK_CODES];
  // For 'other' the IN list must be a NOT IN — inverted here rather than in the
  // template so the placeholder count stays the same.
  const predicate = tmobileOnly
    ? carrierPredicate
    : carrierPredicate.replace('c.carrier_network_code IN (?)', 'c.carrier_network_code NOT IN (?)');
  const codes = tmobileOnly ? strictCodes : looseCodes;

  const [campaignRows] = await db.query(
    `SELECT COALESCE(SUM(br.segments), 0) AS n
       FROM broadcast_recipients br
       JOIN contacts c ON c.id = br.contact_id
      WHERE br.sent_at >= UTC_DATE()
        AND br.status IN ('sent', 'delivered')
        AND ${predicate}`,
    [codes]
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
    [codes]
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
  TMOBILE_NETWORK_CODES,
  CARRIER_TTL_DAYS,
  DEFAULTS,
  CARRIER_MAX_PER_MINUTE,
  CARRIER_MAX_TMOBILE_PER_DAY
};
