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

// MySQL returns BOOLEAN columns as 0/1; hand the UI a real boolean.
function shape(row) {
  return { id: row.id, phone: row.phone, name: row.name, opted_in: !!row.opted_in };
}

function registerContactRoutes(app, deps, requireAuth) {
  const { db } = deps;

  // Every contact, opted-in or not, for the manager.
  app.get('/api/contacts/all', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.execute(
        `SELECT id, phone, name, opted_in FROM contacts ORDER BY name IS NULL, name, id`
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
    const name = String(req.body.name || '').trim();
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

      const name = hasName ? (String(req.body.name).trim() || null) : current[0].name;
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

  // Hard delete. A contact referenced by past messages/consent may be protected
  // by a foreign key; rather than 500, report the conflict so the UI can explain
  // that a contact with history can't be removed.
  app.delete('/api/contacts/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    try {
      const [result] = await db.execute('DELETE FROM contacts WHERE id = ?', [id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Contacto no encontrado' });
      res.json({ ok: true, id });
    } catch (err) {
      if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
        return res.status(409).json({
          error: 'No se puede eliminar: el contacto tiene historial de mensajes'
        });
      }
      console.error('DELETE /api/contacts/:id error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { normalizeUsPhone, registerContactRoutes };
