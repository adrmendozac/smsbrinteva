const cron = require('node-cron');
const sendEngine = require('./sendEngine');

// Every minute, claim scheduled broadcasts whose time has come and run them.
function startScheduler(deps) {
  cron.schedule('* * * * *', async () => {
    try {
      const [due] = await deps.db.execute(
        `SELECT id FROM broadcasts WHERE status = 'scheduled' AND scheduled_at <= NOW()`
      );
      for (const b of due) {
        sendEngine.runCampaign(deps, b.id)
          .catch(err => console.error(`scheduled runCampaign ${b.id} failed:`, err.message));
      }
    } catch (err) {
      console.error('scheduler tick error:', err.message);
    }
  });
}

module.exports = { startScheduler };
