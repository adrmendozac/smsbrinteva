// Resolve each contact's current mobile carrier once and store it, so
// lib/throughput.js can tell T-Mobile numbers (2000 SMS/day, the binding cap)
// apart from everything else instead of treating the whole audience as
// T-Mobile.
//
//   node scripts/backfill-carriers.js --dry-run --limit 20
//   node scripts/backfill-carriers.js
//
// Resumable by construction: it only selects contacts that are unresolved or
// stale, so a crash, a rate limit, or a Ctrl-C just means the next run picks up
// where this one stopped. Safe to schedule as well as to run by hand.
//
// Uses Number Insight Standard (api_key/api_secret), not Identity Insights —
// see lib/vonage.js lookupCarrier() for why.
require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');
const { lookupCarrier } = require('../lib/vonage');
const { CARRIER_TTL_DAYS, NON_MOBILE, INVALID } = require('../lib/throughput');

// Number Insight has its own rate limit and answers a burst with status 1
// (throttled). Three per second is comfortably under it and still clears a
// few thousand contacts in minutes.
const LOOKUPS_PER_SEC = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Number Insight signals failure inside a 200 response, and the failures are
// not interchangeable: a throttled request must be retried, a malformed number
// must never be, and bad credentials must stop the run rather than burn one
// wasted lookup per contact.
//
// Returns { action, networkCode, carrierName } where action is:
//   'store'  — write the result
//   'retry'  — leave unresolved, try again on a later run
//   'abort'  — our configuration is broken; stop everything
function classify(result) {
  switch (result.status) {
    case 0:
      // network_type is 'mobile' | 'landline' | 'virtual' | 'unknown'.
      if (result.networkType === 'mobile' && result.networkCode) {
        return { action: 'store', networkCode: result.networkCode, carrierName: result.carrierName };
      }
      // Resolved, but not something that can receive SMS. Recorded so the
      // limiter keeps it in the strict bucket and so the number can be pruned
      // from audiences later.
      return { action: 'store', networkCode: NON_MOBILE, carrierName: result.carrierName };

    case 1: // throttled
    case 5: // internal error
    case 9: // partner quota exceeded
      return { action: 'retry' };

    case 3: // invalid params — the number itself is unusable
      return { action: 'store', networkCode: INVALID, carrierName: null };

    case 4: // invalid credentials
      return { action: 'abort' };

    default:
      return { action: 'retry' };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit'));
  const limit = limitArg ? Number(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1]) : 0;

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    const [contacts] = await db.query(
      `SELECT id, phone
         FROM contacts
        WHERE archived_at IS NULL
          AND (carrier_network_code IS NULL
               OR carrier_checked_at IS NULL
               OR carrier_checked_at < UTC_TIMESTAMP() - INTERVAL ? DAY)
        ORDER BY id
        ${limit > 0 ? 'LIMIT ' + Number(limit) : ''}`,
      [CARRIER_TTL_DAYS]
    );

    console.log(`${contacts.length} contact(s) to resolve${dryRun ? ' (dry run)' : ''}`);
    const tally = { stored: 0, retry: 0, nonMobile: 0, invalid: 0 };

    for (const contact of contacts) {
      await sleep(Math.round(1000 / LOOKUPS_PER_SEC));

      let result;
      try {
        result = await lookupCarrier({ axios, env: process.env }, contact.phone);
      } catch (err) {
        // Transport-level failure (timeout, 429). Treat as retryable and keep
        // going; the next run will pick this contact up again.
        console.warn(`  ${contact.phone}: request failed (${err.message}) — will retry`);
        tally.retry++;
        continue;
      }

      const verdict = classify(result);

      if (verdict.action === 'abort') {
        throw new Error(
          `Number Insight rejected our credentials (status 4: ${result.statusMessage}). ` +
          'Check VONAGE_API_KEY / VONAGE_API_SECRET — aborting before wasting lookups.'
        );
      }

      if (verdict.action === 'retry') {
        console.warn(`  ${contact.phone}: status ${result.status} (${result.statusMessage}) — will retry`);
        tally.retry++;
        continue;
      }

      if (verdict.networkCode === NON_MOBILE) tally.nonMobile++;
      else if (verdict.networkCode === INVALID) tally.invalid++;
      else tally.stored++;

      console.log(`  ${contact.phone}: ${verdict.networkCode} ${verdict.carrierName || ''}`.trimEnd());

      if (!dryRun) {
        await db.execute(
          `UPDATE contacts
              SET carrier_network_code = ?, carrier_name = ?, carrier_checked_at = UTC_TIMESTAMP()
            WHERE id = ?`,
          [verdict.networkCode, verdict.carrierName, contact.id]
        );
      }
    }

    console.log(
      `Done. resolved=${tally.stored} non-mobile=${tally.nonMobile} ` +
      `invalid=${tally.invalid} retry-later=${tally.retry}`
    );
  } finally {
    await db.end();
  }
}

// Only run when invoked directly, so tests/carrier-backfill.test.js can import
// classify() without opening a DB connection.
if (require.main === module) {
  main().catch(err => {
    console.error('backfill-carriers failed:', err.message);
    process.exit(1);
  });
}

module.exports = { classify };
