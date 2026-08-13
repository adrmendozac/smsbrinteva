// Verification for the carrier throughput budget (lib/throughput.js) and the
// send engine's use of it (lib/sendEngine.js).
//
// The 2026-08-11/12 incident these guard against: 1,112 recipients x 5 segments
// submitted in one burst, 100% rejected with Vonage error 99 for two days.
//
// No database and no network — db and axios come in through the dependency
// injection seam the app already uses, and the clock is injected too so the
// per-minute window can be exercised without waiting a minute.
const test = require('node:test');
const assert = require('node:assert');
const throughput = require('../lib/throughput');
const { createThroughput, bucketFor, readLimits, BudgetExhausted, TMOBILE, OTHER } = throughput;
const { runCampaign, isThroughputRejection } = require('../lib/sendEngine');
const { smsSegments } = require('../lib/sms');

// ── Segment math ───────────────────────────────────────────────────────────

test('counts segments the way carriers meter them', () => {
  assert.equal(smsSegments(''), 0);
  assert.equal(smsSegments('a'.repeat(160)), 1);
  assert.equal(smsSegments('a'.repeat(161)), 2);
  // The body from the incident: 686 chars is 5 segments per recipient, which is
  // why 1,112 recipients became 5,530 segments.
  assert.equal(smsSegments('a'.repeat(686)), 5);
  assert.equal(smsSegments(null), 0);
});

// ── Bucket assignment ──────────────────────────────────────────────────────

const fresh = new Date('2026-08-13T12:00:00Z');
const recent = new Date('2026-08-01T12:00:00Z');
const ancient = new Date('2026-01-01T12:00:00Z');

test('T-Mobile numbers use the strict bucket', () => {
  assert.equal(bucketFor({ carrier_network_code: '310260', carrier_checked_at: recent }, fresh), TMOBILE);
  // Sprint's estate rides the same brand allowance.
  assert.equal(bucketFor({ carrier_network_code: '310120', carrier_checked_at: recent }, fresh), TMOBILE);
});

test('other resolved mobile carriers use the loose bucket', () => {
  assert.equal(bucketFor({ carrier_network_code: '310410', carrier_checked_at: recent }, fresh), OTHER);
});

test('anything unresolved falls back to the strict bucket', () => {
  // Never looked up. Guessing 'other' here is exactly how the cap gets blown.
  assert.equal(bucketFor({ carrier_network_code: null, carrier_checked_at: null }, fresh), TMOBILE);
  assert.equal(bucketFor(null, fresh), TMOBILE);
  // Landline / unusable number sentinels.
  assert.equal(bucketFor({ carrier_network_code: 'NON_MOBILE', carrier_checked_at: recent }, fresh), TMOBILE);
  assert.equal(bucketFor({ carrier_network_code: 'INVALID', carrier_checked_at: recent }, fresh), TMOBILE);
  // Stale beyond the TTL: the number may have ported since.
  assert.equal(bucketFor({ carrier_network_code: '310410', carrier_checked_at: ancient }, fresh), TMOBILE);
});

// ── Limit configuration ────────────────────────────────────────────────────

test('limits default below the carrier ceilings', () => {
  const l = readLimits({});
  assert.equal(l.segmentsPerMinute, 50);              // AT&T allows 75
  assert.equal(l.tmobileSegmentsPerDay, 1500);        // T-Mobile allows 2000
  assert.equal(l.tmobileCampaignSegmentsPerDay, 1200); // reserves room for replies
});

test('env cannot raise a limit past what the carrier allows', () => {
  const l = readLimits({ SEGMENTS_PER_MINUTE: '5000', TMOBILE_SEGMENTS_PER_DAY: '99999' });
  assert.equal(l.segmentsPerMinute, 75);
  assert.equal(l.tmobileSegmentsPerDay, 2000);
});

test('a junk env value falls back to the default rather than disabling the limit', () => {
  const l = readLimits({ SEGMENTS_PER_MINUTE: 'abc', TMOBILE_SEGMENTS_PER_DAY: '0' });
  assert.equal(l.segmentsPerMinute, 50);
  assert.equal(l.tmobileSegmentsPerDay, 1500);
});

// ── Test doubles ───────────────────────────────────────────────────────────

// Minimal db stub. usedToday() issues two SUM queries — campaign traffic then
// reply traffic — and adds them, so attribute the whole figure to the first and
// zero to the second.
function fakeDb(usedSegments = 0) {
  let call = 0;
  return {
    async query() {
      call++;
      return [[{ n: call % 2 === 1 ? usedSegments : 0 }]];
    }
  };
}

function fakeClock(startIso = '2026-08-13T12:00:00Z') {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    advance: ms => { t += ms; }
  };
}

// ── Minute window ──────────────────────────────────────────────────────────

test('paces sends so the per-minute segment ceiling is never crossed', async () => {
  const clock = fakeClock();
  const db = fakeDb(0);
  let slept = 0;
  const t = createThroughput({
    db,
    env: { SEGMENTS_PER_MINUTE: '10' },
    now: clock.now,
    // Sleeping advances the injected clock, standing in for real elapsed time.
    sleep: async ms => { slept += ms; clock.advance(ms); }
  });

  await t.acquire(OTHER, 5);
  await t.acquire(OTHER, 5);   // window now full at 10
  assert.equal(slept, 0);

  await t.acquire(OTHER, 5);   // must wait for the window to roll
  assert.ok(slept > 0, 'third send should have waited for the next minute');
});

test('a message bigger than the whole minute allowance still goes out', async () => {
  const clock = fakeClock();
  const t = createThroughput({
    db: fakeDb(0),
    env: { SEGMENTS_PER_MINUTE: '3' },
    now: clock.now,
    sleep: async ms => clock.advance(ms)
  });
  // 5 segments against a 3-segment window would otherwise deadlock the loop.
  await t.acquire(OTHER, 5);
  assert.ok(true);
});

// ── Daily budget ───────────────────────────────────────────────────────────

test('campaigns stop at the campaign ceiling, below the absolute ceiling', async () => {
  const t = createThroughput({
    db: fakeDb(1198),
    env: {},
    now: () => new Date(),
    sleep: async () => {}
  });
  await assert.rejects(() => t.acquire(TMOBILE, 5, 'campaign'), BudgetExhausted);
});

test('seller replies keep flowing after campaigns have been cut off', async () => {
  // 1,198 segments spent: past the 1,200 campaign ceiling for a 5-segment
  // message, still under the 1,500 absolute ceiling.
  const t = createThroughput({
    db: fakeDb(1198),
    env: {},
    now: () => new Date(),
    sleep: async () => {}
  });
  await t.acquire(TMOBILE, 5, 'reply');
  assert.ok(true, 'a reply must not be blocked by a campaign having filled the day');
});

test('replies stop too once the absolute daily ceiling is reached', async () => {
  const t = createThroughput({
    db: fakeDb(1499),
    env: {},
    now: () => new Date(),
    sleep: async () => {}
  });
  await assert.rejects(() => t.acquire(TMOBILE, 5, 'reply'), BudgetExhausted);
});

test('the loose bucket has no daily ceiling', async () => {
  const t = createThroughput({
    db: fakeDb(99999),
    env: {},
    now: () => new Date(),
    sleep: async () => {}
  });
  await t.acquire(OTHER, 5, 'campaign');
  assert.ok(true);
});

test('reports the campaign budget left for the day', async () => {
  const t = createThroughput({ db: fakeDb(200), env: {}, now: () => new Date(), sleep: async () => {} });
  assert.equal(await t.remainingCampaignSegments(), 1000);
});

// ── Throughput-rejection detection ─────────────────────────────────────────

test('recognizes a provider throughput block, not a bad recipient', () => {
  assert.ok(isThroughputRejection({ vonageCode: '99', message: 'Partner quota exceeded' }));
  assert.ok(isThroughputRejection({ httpStatus: 429, message: 'Too Many Requests' }));
  assert.ok(isThroughputRejection({ message: 'Throughput limit exceeded for this account' }));
  // A genuinely bad number must stay a per-recipient failure.
  assert.ok(!isThroughputRejection({ httpStatus: 422, vonageCode: '3', message: 'Invalid recipient' }));
});

// ── Engine integration ─────────────────────────────────────────────────────

// Records every UPDATE so assertions can inspect what the engine wrote.
function engineDb({ recipients, broadcast }) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/^UPDATE broadcasts SET status = 'sending'/.test(sql.trim())) {
        const claimable = ['draft', 'scheduled', 'paused'].includes(broadcast.status);
        if (claimable) broadcast.status = 'sending';
        return [{ affectedRows: claimable ? 1 : 0 }];
      }
      if (/FROM broadcast_recipients br/.test(sql)) return [recipients];
      if (/SELECT name, body, media_url/.test(sql)) return [[broadcast]];
      if (/SUM\(status IN \('sent','delivered'\)\)/.test(sql)) {
        const pending = recipients.filter(r => r.status === 'pending').length;
        return [[{ sent: recipients.length - pending, failed: 0, pending }]];
      }
      if (/UPDATE broadcasts b SET/.test(sql)) {
        broadcast.status = params[0];
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE broadcast_recipients/.test(sql)) {
        const row = recipients.find(r => r.id === params[params.length - 1]);
        if (row && /status = 'sent'/.test(sql)) row.status = 'sent';
        if (row && /status = 'failed'/.test(sql)) row.status = 'failed';
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
    async query() { return [[{ n: 0 }]]; }
  };
}

const silentLog = { info: async () => {}, warn: async () => {}, error: async () => {} };

function makeRecipients(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    contact_id: i + 1,
    phone: `+1555000${String(i).padStart(4, '0')}`,
    opted_in: 1,
    language: 'es',
    status: 'pending',
    // Unresolved carrier — the conservative default, and what production looks
    // like before the backfill runs.
    carrier_network_code: null,
    carrier_checked_at: null
  }));
}

test('a campaign larger than the daily budget pauses instead of blasting', async () => {
  const recipients = makeRecipients(400);
  const broadcast = { name: 'Promo', body: 'a'.repeat(686), media_url: null, status: 'draft' };
  const db = engineDb({ recipients, broadcast });

  let sent = 0;
  const usage = { segments: 0 };
  // Injected clock: the per-minute window is real, so without advancing time
  // this test would sit through 24 actual minutes of pacing.
  const clock = fakeClock();
  let queryCall = 0;
  const t = createThroughput({
    // Budget usage tracks what this run has actually sent, as the real
    // DB-derived counter would. Two SUM queries per check, as in fakeDb().
    db: {
      query: async () => {
        queryCall++;
        return [[{ n: queryCall % 2 === 1 ? usage.segments : 0 }]];
      }
    },
    env: {},
    now: clock.now,
    sleep: async ms => clock.advance(ms)
  });

  await runCampaign({
    db,
    env: { DRY_RUN: '1', SEND_RATE_PER_SEC: '1000' },
    log: silentLog,
    sleep: async () => {},
    axios: { head: async () => ({}) },
    throughput: {
      ...t,
      acquire: async (bucket, segments, kind) => {
        await t.acquire(bucket, segments, kind);
        usage.segments += segments;
        sent++;
      }
    }
  }, 7);

  // 5 segments each against a 1,200-segment campaign ceiling: 240 recipients
  // fit, the other 160 must be left for tomorrow.
  assert.equal(sent, 240, 'should stop at the campaign ceiling');
  assert.equal(broadcast.status, 'paused', 'must be resumable, not completed');
  const stillPending = recipients.filter(r => r.status === 'pending').length;
  assert.equal(stillPending, 160, 'unsent recipients stay pending for the drain tick');
});

test('a provider throughput rejection pauses the run and does not fail the recipient', async () => {
  const recipients = makeRecipients(50);
  const broadcast = { name: 'Promo', body: 'hola', media_url: null, status: 'draft' };
  const db = engineDb({ recipients, broadcast });

  let attempts = 0;
  const rejection = Object.assign(new Error('Partner quota exceeded'), {
    httpStatus: 429, vonageCode: '99'
  });

  await runCampaign({
    db,
    env: { SEND_RATE_PER_SEC: '1000' },
    log: silentLog,
    sleep: async () => {},
    axios: { head: async () => ({}) },
    // Every send is rejected, as during the incident.
    sendOne: async () => { attempts++; throw rejection; },
    throughput: createThroughput({
      db: { query: async () => [[{ n: 0 }]] },
      env: {},
      now: () => new Date(),
      sleep: async () => {}
    })
  }, 7).catch(() => {});

  assert.equal(attempts, 1, 'must stop after the first rejection, not retry 50 times');
  assert.equal(broadcast.status, 'paused');
  assert.equal(
    recipients.filter(r => r.status === 'failed').length, 0,
    'a provider block is not the recipient\'s fault — rows stay pending'
  );
});

test('a broadcast already in flight cannot be claimed twice', async () => {
  const recipients = makeRecipients(5);
  const broadcast = { name: 'Promo', body: 'hola', media_url: null, status: 'sending' };
  const db = engineDb({ recipients, broadcast });

  await runCampaign({
    db,
    env: { DRY_RUN: '1' },
    log: silentLog,
    sleep: async () => {},
    axios: {},
    throughput: createThroughput({ db, env: {}, now: () => new Date(), sleep: async () => {} })
  }, 7);

  // Only the failed claim should have run; no recipient query, no sends.
  assert.equal(db.calls.length, 1);
  assert.equal(recipients.every(r => r.status === 'pending'), true);
});
