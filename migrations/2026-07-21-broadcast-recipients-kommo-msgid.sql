-- Kommo's delivery_status endpoint only accepts the amojo-side message id
-- returned by the import (new_message.msgid); the ref_id we supply is echoed
-- back but 404s. Store it per recipient so a delivery receipt arriving later
-- can be reported back into the campaign's Kommo chat.
ALTER TABLE broadcast_recipients
  ADD COLUMN kommo_msgid VARCHAR(64) NULL AFTER vonage_message_id;
