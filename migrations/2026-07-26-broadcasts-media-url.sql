-- MMS support: media_url set means send as image with body as the caption.
-- NULL keeps the text-only SMS path unchanged.
-- Stores the URL, not the bytes: Vonage and Kommo both fetch it from us.
ALTER TABLE broadcasts
  ADD COLUMN media_url VARCHAR(500) NULL DEFAULT NULL AFTER body;
