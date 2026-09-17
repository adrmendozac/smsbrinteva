// Kommo CRM lead creation for first-time inbound texters, with a durable
// fallback. A failed create is logged and queued in kommo_lead_retries; the
// scheduler calls retryPendingLeads() every minute to work the queue.
//
// deps: { db, log, createSmsLead, createLeadNote, addLeadTags } as assembled in
// index.js. createSmsLead resolves to { skipped: true } when the CRM isn't
// configured, otherwise { leadId, error }.

// Minutes to wait after the Nth failed attempt. Six attempts over about a day,
// then the row is marked 'failed' and logged as an error.
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 1440];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
// A claimed row is pushed this far out so an overlapping scheduler tick
// can't pick it up while a slow Kommo call is still running.
const CLAIM_MINUTES = 10;
const BATCH_SIZE = 20;
const NOTE_PREVIEW_CHARS = 200;
const TAGS = ['sms'];

// Note + tag on a freshly created lead. Failures are logged but don't undo the
// lead, and aren't retried — the lead itself is what a seller needs.
async function addLeadFollowUps(deps, { leadId, phone, text }) {
  const { log, createLeadNote, addLeadTags } = deps;
  if (createLeadNote) {
    const preview = text.length > NOTE_PREVIEW_CHARS ? text.slice(0, NOTE_PREVIEW_CHARS) + '…' : text;
    const ok = await createLeadNote({ leadId, text: `Primer mensaje: "${preview}"` }).catch(() => null);
    if (!ok) log.warn('kommo', 'No se pudo agregar la nota al lead de Kommo', { leadId, phone });
  }
  if (addLeadTags) {
    const ok = await addLeadTags({ leadId, tags: TAGS }).catch(() => null);
    if (!ok) log.warn('kommo', 'No se pudieron agregar las etiquetas al lead de Kommo', { leadId, phone, tags: TAGS });
  }
}

async function attemptCreate(deps, { phone, text }) {
  try {
    return await deps.createSmsLead({ phone, name: null, text });
  } catch (err) {
    return { leadId: null, error: err.message };
  }
}

async function enqueueRetry(deps, { phone, text, error }) {
  const { db } = deps;
  // One pending retry per phone: a second text before the retry lands would
  // otherwise queue a second lead for the same person.
  const [pending] = await db.execute(
    `SELECT id FROM kommo_lead_retries WHERE phone = ? AND status = 'pending' LIMIT 1`,
    [phone]
  );
  if (pending.length > 0) return;
  await db.execute(
    `INSERT INTO kommo_lead_retries (phone, first_message, attempts, last_error, next_attempt_at)
     VALUES (?, ?, 1, ?, NOW() + INTERVAL ? MINUTE)`,
    [phone, text, String(error || 'unknown error').slice(0, 500), RETRY_DELAYS_MINUTES[0]]
  );
}

// Called from /inbound for a new conversation. Never throws.
async function createInboundLead(deps, { phone, text }) {
  const { log } = deps;
  if (!deps.createSmsLead) return null;
  try {
    const result = await attemptCreate(deps, { phone, text });
    if (!result || result.skipped) return null;

    if (result.leadId) {
      await addLeadFollowUps(deps, { leadId: result.leadId, phone, text });
      return result.leadId;
    }

    log.warn('kommo', 'No se pudo crear el lead en Kommo; se reintentará', { phone, error: result.error });
    await enqueueRetry(deps, { phone, text, error: result.error });
    return null;
  } catch (err) {
    log.error('kommo', 'Error creando o encolando el lead de Kommo', { phone, error: err.message });
    return null;
  }
}

async function retryOne(deps, row) {
  const { db, log } = deps;
  const [claim] = await db.execute(
    `UPDATE kommo_lead_retries SET next_attempt_at = NOW() + INTERVAL ? MINUTE
      WHERE id = ? AND status = 'pending' AND next_attempt_at <= NOW()`,
    [CLAIM_MINUTES, row.id]
  );
  if (!claim || claim.affectedRows !== 1) return;

  const result = await attemptCreate(deps, { phone: row.phone, text: row.first_message });
  // CRM config was removed since the row was queued; leave it pending.
  if (!result || result.skipped) return;

  const attempts = row.attempts + 1;
  if (result.leadId) {
    await db.execute(
      `UPDATE kommo_lead_retries SET status = 'done', attempts = ?, lead_id = ? WHERE id = ?`,
      [attempts, result.leadId, row.id]
    );
    log.info('kommo', 'Lead de Kommo creado tras reintento', { phone: row.phone, leadId: result.leadId, attempts });
    await addLeadFollowUps(deps, { leadId: result.leadId, phone: row.phone, text: row.first_message });
    return;
  }

  const error = String(result.error || 'unknown error').slice(0, 500);
  if (attempts >= MAX_ATTEMPTS) {
    await db.execute(
      `UPDATE kommo_lead_retries SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?`,
      [attempts, error, row.id]
    );
    log.error('kommo', 'Lead de Kommo abandonado tras agotar los reintentos', { phone: row.phone, attempts, error });
    return;
  }

  const delay = RETRY_DELAYS_MINUTES[attempts - 1];
  await db.execute(
    `UPDATE kommo_lead_retries SET attempts = ?, last_error = ?, next_attempt_at = NOW() + INTERVAL ? MINUTE
      WHERE id = ?`,
    [attempts, error, delay, row.id]
  );
  log.warn('kommo', 'Reintento de lead de Kommo falló', { phone: row.phone, attempts, nextInMinutes: delay, error });
}

// Scheduler entry point: works through due retries one at a time.
async function retryPendingLeads(deps) {
  if (!deps.createSmsLead) return;
  const [due] = await deps.db.execute(
    `SELECT id, phone, first_message, attempts FROM kommo_lead_retries
      WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at, id LIMIT ${BATCH_SIZE}`
  );
  for (const row of due) {
    try {
      await retryOne(deps, row);
    } catch (err) {
      deps.log.error('kommo', 'Error en reintento de lead de Kommo', { phone: row.phone, error: err.message });
    }
  }
}

module.exports = {
  createInboundLead,
  retryPendingLeads,
  RETRY_DELAYS_MINUTES,
  MAX_ATTEMPTS,
};
