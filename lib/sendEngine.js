const { sendMessage, sendImage } = require('./vonage');
const { smsSegments } = require('./sms');
const { BudgetExhausted } = require('./throughput');

const RATE_DEFAULT = 1;

// A provider-side throughput block, as opposed to anything about this
// recipient. Vonage signals it as error 99 ("partner quota exceeded") or a
// plain HTTP 429; the 2026-08-11 incident produced 5,530 of these because the
// loop could not tell them from an invalid number and kept going.
function isThroughputRejection(err) {
  if (!err) return false;
  if (err.httpStatus === 429) return true;
  if (err.vonageCode === '99') return true;
  const text = `${err.vonageType || ''} ${err.message || ''}`.toLowerCase();
  return /throughput|rate limit|too many requests|quota/.test(text);
}

const isDryRun = env => env.DRY_RUN === '1' || env.DRY_RUN === true;

// Appends the mandatory opt-out instructions if not already present in the text.
function appendOptOut(text, language = 'es') {
  const lower = String(text).toLowerCase();
  // If it already has "stop", assume instructions are present.
  if (lower.includes('stop')) return text;

  const suffix = language === 'en' ? 'Reply STOP to cancel' : 'Responde STOP para cancelar';
  return `${text.trim()}\n\n${suffix}`;
}

// Send a single SMS via the Vonage Messages API (JWT auth).
// DRY_RUN gate: when set, no Vonage call is made (lets us prove throttle +
// opt-out filtering against broadcast_recipients before spending real money).
async function sendOne({ axios, env }, to, text, mediaUrl = null) {
  if (isDryRun(env)) {
    return { messageId: `dryrun-${Date.now()}` };
  }
  // Non-2xx already throws with a readable message from describeError().
  return mediaUrl
    ? sendImage({ axios, env }, to, mediaUrl, text)
    : sendMessage({ axios, env }, to, text);
}

// Throttled send loop over a broadcast's pending recipients. Re-checks opt-out
// at send time, records per-recipient outcome, then rolls counts into the broadcast.
//
// Paces against lib/throughput.js in SEGMENTS, not messages, and stops cleanly
// when the day's budget is spent: remaining recipients stay 'pending' and the
// broadcast goes to 'paused', which lib/scheduler.js picks up on a later tick.
// A campaign larger than one day's allowance therefore spills across days on
// its own instead of being rejected or, as before, submitted all at once.
async function runCampaign(deps, broadcastId) {
  const { db, env, log, throughput } = deps;
  const rate = Number(env.SEND_RATE_PER_SEC) > 0 ? Number(env.SEND_RATE_PER_SEC) : RATE_DEFAULT;
  const gap = Math.round(1000 / rate);

  // Atomic claim. The scheduler tick now re-fires paused broadcasts every
  // minute, so two runs could otherwise walk the same rows; whichever UPDATE
  // flips the status wins and the loser returns having sent nothing. 'sending'
  // is excluded on purpose — a broadcast already in flight must not be picked
  // up again (the scheduler demotes a genuinely orphaned one to 'paused' first).
  const [claim] = await db.execute(
    `UPDATE broadcasts SET status = 'sending'
      WHERE id = ? AND status IN ('draft', 'scheduled', 'paused')`,
    [broadcastId]
  );
  if (claim.affectedRows === 0) return;

  const [recipients] = await db.execute(
    `SELECT br.id, br.contact_id, c.phone, c.opted_in, c.language,
            c.carrier_network_code, c.carrier_checked_at
       FROM broadcast_recipients br
       JOIN contacts c ON c.id = br.contact_id
      WHERE br.broadcast_id = ? AND br.status = 'pending'`,
    [broadcastId]
  );

  const [bodyRows] = await db.execute(`SELECT name, body, media_url FROM broadcasts WHERE id = ?`, [broadcastId]);
  const campaignName = bodyRows[0].name;
  const body = bodyRows[0].body;
  const mediaUrl = bodyRows[0].media_url || null;

  log.info('send', `Campaña iniciada: ${campaignName}`, {
    broadcastId,
    recipients: recipients.length,
    dryRun: isDryRun(env)
  });

  // DISABLED with the lead-tagging call below.
  // Per-campaign cache of Kommo lead id by phone, so hundreds of recipients
  // don't generate hundreds of GET /leads?query= calls.
  // const leadCache = new Map();

  // Check the image once up front: a dead URL would fail every single recipient.
  if (mediaUrl && !isDryRun(env)) {
    try {
      await deps.axios.head(mediaUrl, { timeout: 10000 });
    } catch (err) {
      await db.execute(`UPDATE broadcasts SET status = 'failed' WHERE id = ?`, [broadcastId]);
      throw new Error(`Imagen no accesible (${mediaUrl}): ${err.message}`);
    }
  }

  // Set when the run stops early — budget spent or provider block — so the
  // completion bookkeeping below knows to leave the broadcast resumable.
  let paused = null;

  for (const r of recipients) {
    await deps.sleep(gap);
    if (!r.opted_in) {
      await db.execute(`UPDATE broadcast_recipients SET status = 'opted_out' WHERE id = ?`, [r.id]);
      continue;
    }

    const messageText = appendOptOut(body, r.language || 'es');
    const segments = smsSegments(messageText);
    const bucket = throughput.bucketFor(r);

    // Blocks until the per-minute window has room; throws once the day's
    // campaign allowance is gone. Either way nothing has been submitted yet,
    // so this recipient is simply left pending for the next drain.
    try {
      await throughput.acquire(bucket, segments, 'campaign');
    } catch (err) {
      if (!(err instanceof BudgetExhausted)) throw err;
      paused = { reason: 'budget', bucket, used: err.used, limit: err.limit };
      break;
    }

    try {
      // deps.sendOne is the injection seam the tests use to exercise the
      // circuit breaker without a Vonage private key on disk.
      const send = deps.sendOne || sendOne;
      const { messageId } = await send(deps, r.phone, messageText, mediaUrl);
      await db.execute(
        `UPDATE broadcast_recipients
            SET status = 'sent', vonage_message_id = ?, error = NULL, error_code = NULL,
                segments = ?, sent_at = NOW()
          WHERE id = ?`,
        [messageId, segments, r.id]
      );
      // Mirror into the Kommo chat so sellers see the blast that was sent before
      // any reply lands. Skipped under DRY_RUN — no SMS actually went out, so
      // importing would create real chats for messages nobody received.
      // Never let a Kommo failure fail an already-sent SMS.
      if (deps.mirrorCampaignToKommo && !isDryRun(env)) {
        // Store the amojo message id the import returns -- a delivery receipt
        // arriving later needs it to mark this message delivered in the chat.
        const kommoMsgid = await deps
          .mirrorCampaignToKommo({ phone: r.phone, text: messageText, mediaUrl, msgid: `campaign-${broadcastId}-${r.id}` })
          .catch(e => {
            console.error('[kommo] campaign mirror error:', e.message);
            return null;
          });
        if (kommoMsgid) {
          await db.execute(`UPDATE broadcast_recipients SET kommo_msgid = ? WHERE id = ?`, [
            kommoMsgid,
            r.id
          ]);
        }
      }

      // DISABLED pending review — see deps.tagLeadByPhone in index.js.
      // kommoCrm.searchLeadByPhone falls back to the first `?query=` hit when it
      // cannot confirm the phone, so this would tag the wrong lead, once per
      // recipient, silently (the .catch swallows everything).
      // if (deps.tagLeadByPhone && !isDryRun(env) && campaignName) {
      //   deps.tagLeadByPhone({ phone: r.phone, tags: [campaignName], cache: leadCache })
      //     .catch(() => {});
      // }
    } catch (err) {
      // A throughput block is about the account, not this recipient: marking it
      // 'failed' and moving on is what turned one rejection into 5,530 of them
      // on 2026-08-11. Leave the row pending, stop the run, let the drain tick
      // retry once the window or the block clears.
      if (isThroughputRejection(err)) {
        await db.execute(
          `UPDATE broadcast_recipients SET error = ?, error_code = ? WHERE id = ?`,
          [String(err.message).slice(0, 255), err.vonageCode || String(err.httpStatus || 'throughput'), r.id]
        );
        paused = { reason: 'rejected', error: String(err.message).slice(0, 255) };
        break;
      }

      await db.execute(
        `UPDATE broadcast_recipients SET status = 'failed', error = ?, error_code = ?, segments = ? WHERE id = ?`,
        [String(err.message).slice(0, 255), err.vonageCode || null, segments, r.id]
      );
      log.warn('send', 'Envío fallido en campaña', {
        broadcastId,
        phone: r.phone,
        error: String(err.message).slice(0, 255)
      });
    }
  }

  const [counts] = await db.execute(
    `SELECT
       SUM(status IN ('sent','delivered')) AS sent,
       SUM(status = 'failed') AS failed,
       SUM(status = 'pending') AS pending
       FROM broadcast_recipients WHERE broadcast_id = ?`,
    [broadcastId]
  );
  const pending = Number(counts[0].pending || 0);

  // Only 'completed' once nothing is left to send. A run that stopped on the
  // budget, on a provider block, or that simply had rows it never reached goes
  // to 'paused' — the scheduler's drain tick resumes it.
  const finalStatus = paused || pending > 0 ? 'paused' : 'completed';

  await db.execute(
    // 'delivered' counts as sent: a delivery receipt upgrades the row after the
    // campaign completes, and it must not shrink the total that was sent.
    `UPDATE broadcasts b SET
        b.sent_count   = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status IN ('sent','delivered')),
        b.failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = b.id AND status = 'failed'),
        b.status = ?
      WHERE b.id = ?`,
    [finalStatus, broadcastId]
  );

  if (finalStatus === 'paused') {
    const detail = paused && paused.reason === 'rejected'
      ? 'Campaña pausada: el operador rechazó el envío por límite de throughput, se reintentará automáticamente'
      : 'Campaña pausada: presupuesto diario de segmentos agotado, continuará automáticamente';
    log.info('send', detail, {
      broadcastId,
      sent: counts[0].sent || 0,
      pending,
      ...(paused || {})
    });
    return;
  }

  log.info('send', `Campaña completada: ${campaignName}`, {
    broadcastId,
    sent: counts[0].sent || 0,
    failed: counts[0].failed || 0
  });
}

module.exports = { sendOne, runCampaign, appendOptOut, isThroughputRejection };
