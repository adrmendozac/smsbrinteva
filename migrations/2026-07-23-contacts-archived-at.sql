-- Deleting a contact that has message history would orphan the
-- broadcast_recipients rows that evidence what was sent under 10DLC campaign
-- VCBCFN4Y, so the DB (correctly) blocks it with a foreign key. Mirror the
-- broadcasts.archived_at pattern: "delete" in the contact manager soft-archives
-- instead of destroying — the row and its send history stay, but it drops out
-- of the manager list. NULL means active; a timestamp means archived.
ALTER TABLE contacts
  ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL;
