// Admin-only account info: Vonage balance + per-segment SMS price, fetched
// together since the Composer's cost flair needs both at once.
const { getBalance, getSmsPrice } = require('./vonage');

function registerAccountRoutes(app, deps, requireAuth) {
  const { axios, env } = deps;

  app.get('/api/account/balance', requireAuth, async (req, res) => {
    try {
      const [balance, price] = await Promise.all([
        getBalance({ axios, env }),
        getSmsPrice({ axios, env })
      ]);
      res.json({ ...balance, ...price });
    } catch (err) {
      console.error('GET /api/account/balance error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerAccountRoutes };
