-- Maps an outbound agent reply (relayed from Kommo) to Kommo's message id, so
-- Vonage delivery receipts (/status) can be reported back to Kommo as
-- delivered/failed on the agent's message.
ALTER TABLE messages
  ADD COLUMN kommo_msgid VARCHAR(64) NULL AFTER vonage_message_id;
