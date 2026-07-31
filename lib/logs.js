// Structured event log: every notable thing the server does lands in `logs`
// (migrations/2026-07-31-logs.sql) so the admin panel can browse a timeline
// without shelling into PM2. Write calls are fire-and-forget best effort — a
// logging failure must never take down the path that produced the event.

const LEVELS = ['info', 'warn', 'error'];

// Categories the admin UI filters on. Kept in one place so the picker cannot
// drift from what the server actually emits.
const CATEGORIES = [
  'send', 'dlr', 'inbound', 'kommo', 'voice',
  'auth', 'campaign', 'contact', 'media', 'system'
];

const LIMIT_MAX = 500;

function createLogger(db) {
  async function write(level, category, message, meta) {
    try {
      await db.execute(
        `INSERT INTO logs (level, category, message, meta) VALUES (?, ?, ?, ?)`,
        [
          LEVELS.includes(level) ? level : 'info',
          String(category || 'system').slice(0, 32),
          String(message || '').slice(0, 500),
          meta == null ? null : JSON.stringify(meta)
        ]
      );
    } catch (err) {
      console.error('[logs] write failed:', err.message);
    }
  }

  return {
    info: (category, message, meta) => write('info', category, message, meta),
    warn: (category, message, meta) => write('warn', category, message, meta),
    error: (category, message, meta) => write('error', category, message, meta),

    // Newest-first page of the log. `before` is an id for keyset pagination
    // (rows older than it); returns the last id so the UI can ask for more.
    async list({ level, category, before, limit = 100 } = {}) {
      const where = [];
      const params = [];
      if (level && LEVELS.includes(level)) { where.push('level = ?'); params.push(level); }
      if (category) { where.push('category = ?'); params.push(category); }
      if (before) { where.push('id < ?'); params.push(Number(before)); }

      const n = Math.min(Math.max(Number(limit) || 100, 1), LIMIT_MAX);
      const [rows] = await db.execute(
        `SELECT id, level, category, message, meta, created_at FROM logs
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY id DESC LIMIT ${n}`,
        params
      );
      return {
        logs: rows.map(r => ({
          ...r,
          // mysql2 already decodes JSON columns into objects; only a driver
          // that hands back the raw text needs parsing. Parsing an object
          // would stringify it to "[object Object]" and throw.
          meta: typeof r.meta === 'string' ? JSON.parse(r.meta) : (r.meta ?? null)
        })),
        // Only offer another page when this one came back full — otherwise the
        // UI shows "Cargar más" on the last page and it fetches nothing.
        nextBefore: rows.length === n ? rows[rows.length - 1].id : null
      };
    }
  };
}

module.exports = { createLogger, CATEGORIES };
