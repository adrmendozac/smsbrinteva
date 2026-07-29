// Admin-only account info: Vonage balance + per-segment SMS price, fetched
// together since the Composer's cost flair needs both at once.
const { getBalance, getSmsPrice } = require('./vonage');

function registerAccountRoutes(app, deps, requireAuth) {
  const { axios, env } = deps;

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

    res.json({
      ...balanceResult.value,
      pricePerSegment: priceResult.status === 'fulfilled' ? priceResult.value.pricePerSegment : null,
      currency: priceResult.status === 'fulfilled' ? priceResult.value.currency : null
    });
  });
}

module.exports = { registerAccountRoutes };
