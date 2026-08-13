const cron = require('node-cron');
const sendEngine = require('./sendEngine');

// A broadcast left in 'sending' with nothing happening for this long is an
// orphan: the process restarted mid-run (pm2 deploy, crash) and the in-memory
// loop that owned it is gone. Before the drain tick existed these sat in
// 'sending' forever with recipients stuck on 'pending'.
const ORPHAN_MINUTES = 10;

// Every minute: start scheduled broadcasts whose time has come, then resume
// anything the throughput budget or a provider block paused, then rescue
// orphans. runCampaign claims each atomically, so re-firing is safe and a
// broadcast whose budget is still spent just re-pauses cheaply.
function startScheduler(deps) {
  cron.schedule('* * * * *', async () => {
    try {
      const [due] = await deps.db.execute(
        `SELECT id FROM broadcasts WHERE status = 'scheduled' AND scheduled_at <= NOW()`
      );

      // Demote stalled in-flight runs to 'paused' first: runCampaign refuses to
      // claim a 'sending' broadcast, which is what stops a live run from being
      // picked up twice. Only rows with work genuinely left over qualify.
      await deps.db.execute(
        `UPDATE broadcasts b
            SET b.status = 'paused'
          WHERE b.status = 'sending'
            AND EXISTS (
              SELECT 1 FROM broadcast_recipients br
               WHERE br.broadcast_id = b.id AND br.status = 'pending'
            )
            AND COALESCE(
              (SELECT MAX(br2.sent_at) FROM broadcast_recipients br2 WHERE br2.broadcast_id = b.id),
              b.created_at
            ) < NOW() - INTERVAL ? MINUTE`,
        [ORPHAN_MINUTES]
      );

      const [resumable] = await deps.db.execute(
        `SELECT id FROM broadcasts WHERE status = 'paused'`
      );

      for (const b of [...due, ...resumable]) {
        sendEngine.runCampaign(deps, b.id)
          .catch(err => {
            console.error(`scheduled runCampaign ${b.id} failed:`, err.message);
            deps.log && deps.log.error('send', 'Campaña programada falló al ejecutarse', { broadcastId: b.id, error: err.message });
          });
      }
    } catch (err) {
      console.error('scheduler tick error:', err.message);
      deps.log && deps.log.error('system', 'Error en tick del scheduler', { error: err.message });
    }
  });
}

module.exports = { startScheduler };
