const { sanitizeForSMS } = require('./sms');
const sendEngine = require('./sendEngine');
const { publicBase } = require('./media');

// Vonage caps image.caption at 300 (a text-type MMS gets 1600, an image's caption does not).
const MMS_CAPTION_MAX = 300;

// Only URLs we produced. Blocks an admin token from pointing a send at any host.
function validateMediaUrl(env, url) {
  if (!url) return null;
  const prefix = `${publicBase(env)}/media/`;
  if (!String(url).startsWith(prefix)) throw new Error('URL de imagen no válida');
  return String(url);
}

// Turn a {contactIds, phones} audience into a deduped list of opted-in contact ids.
// New phone numbers are upserted into contacts (same pattern as /inbound).
async function resolveRecipients({ db }, { contactIds = [], phones = [] }) {
  const ids = new Set(contactIds.map(Number).filter(Boolean));

  for (const phone of phones) {
    const p = String(phone).trim();
    if (!p) continue;
    await db.execute(
      `INSERT INTO contacts (phone) VALUES (?)
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [p]
    );
    const [rows] = await db.execute(`SELECT id FROM contacts WHERE phone = ?`, [p]);
    if (rows[0]) ids.add(rows[0].id);
  }

  if (ids.size === 0) return [];
  const list = [...ids];
  const placeholders = list.map(() => '?').join(',');
  const [optedIn] = await db.execute(
    `SELECT id FROM contacts WHERE id IN (${placeholders}) AND opted_in = TRUE AND archived_at IS NULL`,
    list
  );
  return optedIn.map(r => r.id);
}

function registerCampaignRoutes(app, deps, requireAuth) {
  const { db, axios, env } = deps;

  // Opted-in contacts for the audience picker.
  app.get('/api/contacts', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT id, phone, name FROM contacts WHERE opted_in = TRUE AND archived_at IS NULL ORDER BY name IS NULL, name, id`
      );
      res.json(rows);
    } catch (err) {
      console.error('GET /api/contacts error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // One-shot Haiku draft for the campaign body.
  app.post('/api/suggest', requireAuth, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    try {
      const ai = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: 'You write short, friendly Spanish SMS marketing copy for Brinteva Worlds, a travel agency. Plain ASCII only, no emoji, no markdown, under 320 characters.',
        messages: [{ role: 'user', content: prompt }]
      }, {
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      });
      res.json({ text: sanitizeForSMS(ai.data.content[0].text) });
    } catch (err) {
      console.error('POST /api/suggest error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Create a campaign (draft, or scheduled if scheduledAt given) + seed recipients.
  app.post('/api/campaigns', requireAuth, async (req, res) => {
    const { name, body, contactIds = [], phones = [], scheduledAt = null, mediaUrl = null } = req.body;
    if (!name || !body) return res.status(400).json({ error: 'name and body required' });
    try {
      const media = validateMediaUrl(env, mediaUrl);
      const text = sanitizeForSMS(body);
      // With an image the body becomes the MMS caption, which carriers cap.
      if (media && text.length > MMS_CAPTION_MAX) {
        return res.status(400).json({ error: `Con imagen, el mensaje no puede pasar de ${MMS_CAPTION_MAX} caracteres` });
      }

      // A schedule in the past does not wait: scheduler.js claims every row with
      // scheduled_at <= now on a one-minute cron, so it would blast the whole
      // audience within 60 seconds. The UI blocks this too; this is the gate
      // that holds for a direct API call.
      let scheduledSql = null;
      if (scheduledAt) {
        const when = new Date(scheduledAt);
        if (isNaN(when.getTime())) {
          return res.status(400).json({ error: 'Fecha de programación inválida' });
        }
        if (when.getTime() <= Date.now()) {
          return res.status(400).json({ error: 'La fecha de programación ya pasó' });
        }
        // MySQL DATETIME cannot parse the ISO 'T' separator and 'Z' suffix that
        // toISOString() produces, so hand it a plain 'YYYY-MM-DD HH:MM:SS'. Kept
        // in UTC, which is what the frontend's parseUTC() assumes on read.
        scheduledSql = when.toISOString().slice(0, 19).replace('T', ' ');
      }

      const ids = await resolveRecipients(deps, { contactIds, phones });
      if (ids.length === 0) return res.status(400).json({ error: 'No opted-in recipients' });

      const status = scheduledAt ? 'scheduled' : 'draft';
      const createdBy = (req.user && req.user.name) || 'admin';
      const [ins] = await db.execute(
        `INSERT INTO broadcasts (name, body, media_url, status, scheduled_at, total_count, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, text, media, status, scheduledSql, ids.length, createdBy]
      );
      const broadcastId = ins.insertId;

      const values = ids.map(() => `(?, ?, 'pending')`).join(',');
      const params = ids.flatMap(id => [broadcastId, id]);
      await db.execute(
        `INSERT INTO broadcast_recipients (broadcast_id, contact_id, status) VALUES ${values}`,
        params
      );

      res.json({ id: broadcastId, total: ids.length });
    } catch (err) {
      console.error('POST /api/campaigns error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Campaign history.
  app.get('/api/campaigns', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT id, name, body, media_url, status, scheduled_at, sent_count, failed_count, total_count, created_by, created_at, archived_at
           FROM broadcasts ORDER BY created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error('GET /api/campaigns error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Archive / restore. Deliberately not a DELETE: the broadcasts row and every
  // broadcast_recipients row stay exactly as they were, so the record of what
  // was sent to whom survives. archived_at only decides which tab the campaign
  // shows under — NULL is active, a timestamp is archived and says when.
  app.patch('/api/campaigns/:id/archive', requireAuth, async (req, res) => {
    try {
      const archived = req.body.archived !== false; // absent body means archive
      const [result] = await db.execute(
        archived
          ? `UPDATE broadcasts SET archived_at = NOW() WHERE id = ?`
          : `UPDATE broadcasts SET archived_at = NULL WHERE id = ?`,
        [req.params.id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });

      const [rows] = await db.execute(
        `SELECT archived_at FROM broadcasts WHERE id = ?`,
        [req.params.id]
      );
      res.json({ ok: true, id: Number(req.params.id), archived_at: rows[0].archived_at });
    } catch (err) {
      console.error('PATCH /api/campaigns/:id/archive error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Campaign detail + per-status recipient counts.
  app.get('/api/campaigns/:id', requireAuth, async (req, res) => {
    try {
      const [bRows] = await db.execute(`SELECT * FROM broadcasts WHERE id = ?`, [req.params.id]);
      if (!bRows[0]) return res.status(404).json({ error: 'Not found' });
      const [counts] = await db.execute(
        `SELECT status, COUNT(*) AS n FROM broadcast_recipients WHERE broadcast_id = ? GROUP BY status`,
        [req.params.id]
      );
      // Per-recipient detail so the admin UI can show exactly which numbers the
      // message reached, and why any of them did not.
      const [recipients] = await db.execute(
        `SELECT br.id, c.phone, c.name, br.status, br.vonage_message_id, br.error, br.sent_at
           FROM broadcast_recipients br
           JOIN contacts c ON c.id = br.contact_id
          WHERE br.broadcast_id = ?
          ORDER BY br.id`,
        [req.params.id]
      );
      res.json({ ...bRows[0], recipientCounts: counts, recipients });
    } catch (err) {
      console.error('GET /api/campaigns/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Send now: fire-and-forget the throttled engine, respond immediately.
  app.post('/api/campaigns/:id/send', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(`SELECT id, status FROM broadcasts WHERE id = ?`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      if (['sending', 'completed'].includes(rows[0].status)) {
        return res.status(409).json({ error: `Already ${rows[0].status}` });
      }
      sendEngine.runCampaign(deps, Number(req.params.id))
        .catch(err => console.error(`runCampaign ${req.params.id} failed:`, err.message));
      res.status(202).json({ ok: true });
    } catch (err) {
      console.error('POST /api/campaigns/:id/send error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { resolveRecipients, registerCampaignRoutes };
