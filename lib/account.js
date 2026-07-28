// Admin-only account info (currently just Vonage balance).
const { getBalance } = require('./vonage');

function registerAccountRoutes(app, deps, requireAuth) {
  const { axios, env } = deps;

  app.get('/api/account/balance', requireAuth, async (req, res) => {
    try {
      const balance = await getBalance({ axios, env });
      res.json(balance);
    } catch (err) {
      console.error('GET /api/account/balance error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerAccountRoutes };
