// Admin-only account info: Vonage balance + per-segment SMS price, fetched
// together since the Composer's cost flair needs both at once.
const { getBalance, getSmsPrice } = require('./vonage');

function registerAccountRoutes(app, deps, requireAuth) {
  const { axios, env, throughput } = deps;

  app.get('/api/account/balance', requireAuth, async (req, res) => {
    // Independent, not Promise.all: this account's API key can read the
    // balance but gets 403 Forbidden on the Pricing API (a separate Vonage
    // product/permission), so a missing price must not also hide a balance
    // that's actually available.
    const [balanceResult, priceResult] = await Promise.allSettled([
      getBalance({ axios, env }),
      getSmsPrice({ axios, env })
    ]);

    if (balanceResult.status === 'rejected') {
      console.error('GET /api/account/balance error:', balanceResult.reason.message);
      return res.status(500).json({ error: balanceResult.reason.message });
    }
    if (priceResult.status === 'rejected') {
      console.error('GET /api/account/balance price error:', priceResult.reason.message);
    }

    // SMS_PRICE_PER_SEGMENT backstops the Pricing API 403: the value comes
    // from real delivery receipts (a 1-segment send charged 0.0120, a
    // 2-segment send 0.0240), so the estimates it feeds match what Vonage
    // actually bills. Update it in .env if a receipt shows a different rate.
    const priceOk = priceResult.status === 'fulfilled';
    const fallbackPrice = env.SMS_PRICE_PER_SEGMENT || null;

    // Segments a campaign may still spend today against the T-Mobile daily cap.
    // The Composer shows it so a seller understands up front that a large blast
    // will finish tomorrow, instead of discovering a "paused" campaign later.
    // Never let this fail the balance response — it is informational.
    let remainingCampaignSegments = null;
    try {
      remainingCampaignSegments = await throughput.remainingCampaignSegments();
    } catch (err) {
      console.error('GET /api/account/balance segment budget error:', err.message);
    }

    res.json({
      ...balanceResult.value,
      pricePerSegment: priceOk ? priceResult.value.pricePerSegment : fallbackPrice,
      currency: priceOk ? priceResult.value.currency : (fallbackPrice ? 'USD' : null),
      remainingCampaignSegments,
      dailyCampaignSegmentLimit: throughput.limits.tmobileCampaignSegmentsPerDay,
      segmentsPerMinuteLimit: throughput.limits.segmentsPerMinute
    });
  });
}

module.exports = { registerAccountRoutes };
