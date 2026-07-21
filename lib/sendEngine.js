const { sendMessage } = require('./vonage');

const RATE_DEFAULT = 1;

// Send a single SMS via the Vonage Messages API (JWT auth).
// DRY_RUN gate: when set, no Vonage call is made (lets us prove throttle +
// opt-out filtering against broadcast_recipients before spending real money).
async function sendOne({ axios, env }, to, text) {
  if (env.DRY_RUN === '1' || env.DRY_RUN === true) {
    return { messageId: `dryrun-${Date.now()}` };
  }
  // Non-2xx already throws with a readable message from describeError().
  return sendMessage({ axios, env }, to, text);
}

// Throttled send loop over a broadcast's pending recipients. Re-checks opt-out
// at send time, records per-recipient outcome, then rolls counts into the broadcast.
async function runCampaign(deps, broadcastId) {
  const { db, env } = deps;
  const rate = Number(env.SEND_RATE_PER_SEC) > 0 ? Number(env.SEND_RATE_PER_SEC) : RATE_DEFAULT;
  const gap = Math.round(1000 / rate);

  await db.execute(`UPDATE broadcasts SET status = 'sending' WHERE id = ?`, [broadcastId]);

  const [recipients] = await db.execute(
    `SELECT br.id, br.contact_id, c.phone, c.opted_in
       FROM broadcast_recipients br
       JOIN contacts c ON c.id = br.contact_id
      WHERE br.broadcast_id = ? AND br.status = 'pending'`,
    [broadcastId]
  );

  const [bodyRows] = await db.execute(`SELECT body FROM broadcasts WHERE id = ?`, [broadcastId]);
  const body = bodyRows[0].body;

  for (const r of recipients) {
    await deps.sleep(gap);
    if (!r.opted_in) {
      await db.execute(`UPDATE broadcast_recipients SET status = 'opted_out' WHERE id = ?`, [r.id]);
      continue;
    }
    try {
      const { messageId } = await sendOne(deps, r.phone, body);
      await db.execute(
        `UPDATE broadcast_recipients
            SET status = 'sent', vonage_message_id = ?, error = NULL, sent_at = NOW()
          WHERE id = ?`,
        [messageId, r.id]
      );
    } catch (err) {
      await db.execute(
        `UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?`,
        [String(err.message).slice(0, 255), r.id]
      );
    }
  }

  await db.execute(
    `UPDATE broadcasts b SET
        b.sent_count   = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'sent'),
        b.failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed'),
        b.status = 'completed'
      WHERE b.id = ?`,
    [broadcastId]
  );
}

module.exports = { sendOne, runCampaign };
