-- Adds a per-recipient error message so failed campaign sends are debuggable.
ALTER TABLE broadcast_recipients
  ADD COLUMN error VARCHAR(255) NULL AFTER vonage_message_id;
