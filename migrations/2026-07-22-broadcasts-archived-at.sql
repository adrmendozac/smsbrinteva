-- Archiving a campaign hides it from the default Historial view without
-- destroying anything: the row stays, and broadcast_recipients keeps the
-- per-recipient send record that evidences what went out under 10DLC campaign
-- VCBCFN4Y. NULL means active; a timestamp means archived, and records when.
ALTER TABLE broadcasts
  ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL AFTER created_by;
