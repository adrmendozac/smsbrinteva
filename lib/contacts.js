// Admin contact manager: list every contact and edit name/phone, add, delete.
//
// Distinct from the audience picker's GET /api/contacts, which returns only
// opted-in contacts. This list shows everyone — including opted-out numbers —
// because managing a contact you can no longer message is still valid; the UI
// tags those rows rather than hiding them.

// Same canonical 11-digit US form used by opt-in, the audience picker, and the
// frontend's phone.ts, so a number typed here is indistinguishable from one
// that arrived by CSV or inbound SMS.
function normalizeUsPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '1' + digits;
  if (digits.length === 11 && digits[0] === '1') return digits;
  return null;
}

// The imported phone book arrived with every Ñ turned into a semicolon
// (MU;OZ, CASTA;EDA, PE;A) by whatever encoding it passed through. A semicolon
// is never legitimate inside a name, so restore it here rather than leaving the
// damage to spread into Kommo. Case comes from the neighbouring letter, which
// keeps an all-caps book all-caps.
function restoreEnye(raw) {
  const s = String(raw ?? '');
  return s.replace(/;/g, (_, i) => {
    const near = s[i - 1] || s[i + 1] || '';
    return near && near === near.toLowerCase() && near !== near.toUpperCase()
      ? 'ñ'
      : 'Ñ';
  });
}

// MySQL returns BOOLEAN columns as 0/1; hand the UI a real boolean. archived_at
// is NULL for active contacts, a timestamp once archived.
function shape(row) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    opted_in: !!row.opted_in,
    archived_at: row.archived_at ?? null,
  };
}

function registerContactRoutes(app, deps, requireAuth) {
  const { db } = deps;

  // Every contact — active and archived, opted-in or not. The manager splits
  // them into Activos/Archivados tabs by archived_at.
  app.get('/api/contacts/all', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT id, phone, name, opted_in, archived_at FROM contacts ORDER BY name IS NULL, name, id`
      );
      res.json(rows.map(shape));
    } catch (err) {
      console.error('GET /api/contacts/all error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Add a contact by hand. opted_in = TRUE: the admin is asserting they have
  // consent to message this number. A duplicate phone is a conflict, not a
  // silent merge, so the UI can say so.
  app.post('/api/contacts', requireAuth, async (req, res) => {
    const name = restoreEnye(req.body.name || '').trim();
    const normPhone = normalizeUsPhone(req.body.phone);
    if (!normPhone) return res.status(400).json({ error: 'Número de EE. UU. inválido' });

    try {
      const [existing] = await db.execute('SELECT id FROM contacts WHERE phone = ?', [normPhone]);
      if (existing[0]) return res.status(409).json({ error: 'Ese número ya existe' });

      const [ins] = await db.execute(
        `INSERT INTO contacts (phone, name, opted_in) VALUES (?, ?, TRUE)`,
        [normPhone, name || null]
      );
      res.status(201).json(shape({ id: ins.insertId, phone: normPhone, name: name || null, opted_in: true }));
    } catch (err) {
      console.error('POST /api/contacts error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Edit name and/or phone. A phone change re-normalizes and re-checks the
  // dedupe key against every other contact. Editing re-affirms consent
  // (opted_in = TRUE), same as adding.
  app.patch('/api/contacts/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const hasName = req.body.name !== undefined;
    const hasPhone = req.body.phone !== undefined;
    if (!hasName && !hasPhone) return res.status(400).json({ error: 'Nada que actualizar' });

    let normPhone;
    if (hasPhone) {
      normPhone = normalizeUsPhone(req.body.phone);
      if (!normPhone) return res.status(400).json({ error: 'Número de EE. UU. inválido' });
    }

    try {
      const [current] = await db.execute('SELECT id, phone, name FROM contacts WHERE id = ?', [id]);
      if (!current[0]) return res.status(404).json({ error: 'Contacto no encontrado' });

      if (hasPhone) {
        const [clash] = await db.execute(
          'SELECT id FROM contacts WHERE phone = ? AND id <> ?',
          [normPhone, id]
        );
        if (clash[0]) return res.status(409).json({ error: 'Ese número ya existe' });
      }

      const name = hasName ? (restoreEnye(req.body.name).trim() || null) : current[0].name;
      const phone = hasPhone ? normPhone : current[0].phone;
      await db.execute(
        `UPDATE contacts SET name = ?, phone = ?, opted_in = TRUE, opted_out_at = NULL, updated_at = NOW() WHERE id = ?`,
        [name, phone, id]
      );
      res.json(shape({ id, phone, name, opted_in: true }));
    } catch (err) {
      console.error('PATCH /api/contacts/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Archive / restore. Deliberately not a DELETE: a contact referenced by past
  // sends is protected by a foreign key, and its broadcast_recipients rows
  // evidence what went out under 10DLC. archived_at only decides which tab the
  // contact shows under and whether it reaches the audience picker — NULL is
  // active, a timestamp is archived. Same pattern as broadcasts.
  app.patch('/api/contacts/:id/archive', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const archived = req.body.archived !== false; // absent body means archive
    try {
      const [result] = await db.execute(
        archived
          ? `UPDATE contacts SET archived_at = NOW() WHERE id = ?`
          : `UPDATE contacts SET archived_at = NULL WHERE id = ?`,
        [id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Contacto no encontrado' });
      const [rows] = await db.execute(
        'SELECT id, phone, name, opted_in, archived_at FROM contacts WHERE id = ?',
        [id]
      );
      res.json(shape(rows[0]));
    } catch (err) {
      console.error('PATCH /api/contacts/:id/archive error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { normalizeUsPhone, restoreEnye, registerContactRoutes };
