-- Long agent messages (itineraries, quotes) hosted as a web page instead of
-- being sent as SMS. Vonage rejects any text over 3200 characters outright, and
-- even below that a multi-thousand-character itinerary costs ~$0.012 per 153-char
-- segment; a one-segment link costs $0.012 total and stays readable on a phone.
--
-- `code` IS the credential — the recipient has no login — so it is generated
-- from crypto.randomBytes and the page is served noindex. Nothing here is ever
-- updated except the view counters.
CREATE TABLE IF NOT EXISTS hosted_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  title VARCHAR(200) NULL,
  -- MEDIUMTEXT because the app allows 120,000 UTF-8 BYTES (lib/hosted.js
  -- MAX_BODY_BYTES) to fit a detailed 30-day itinerary, and TEXT tops out at
  -- 65,535 bytes. The type is a ceiling, not an allocation: InnoDB stores these
  -- variable-length, so a typical 8 KB itinerary occupies 8 KB. The app rejects
  -- anything larger with a readable error before MySQL can truncate.
  body MEDIUMTEXT NOT NULL,
  contact_id INT NULL,
  conversation_id INT NULL,
  -- The `messages` row that actually carried the link, so the panel can join
  -- what was sent to what was hosted.
  message_id INT NULL,
  source ENUM('kommo','campaign','admin') NOT NULL DEFAULT 'kommo',
  view_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_viewed_at TIMESTAMP NULL,
  last_viewed_at TIMESTAMP NULL,
  -- Every link written by the app gets an expiry (90 days by default, see
  -- HOSTED_LINK_TTL_DAYS). The URL is a bearer credential over customer names,
  -- travel dates and reservation details, so it must not resolve forever — and
  -- tours change and quotes go stale anyway. NULL is reserved for a deliberate
  -- admin-created permanent link; the app never writes it.
  expires_at TIMESTAMP NULL,
  -- Unsplash destination hero, chosen once at creation so the image is stable
  -- and customer page views never call the API. All nullable: no key, no
  -- result, a timeout or a rejected URL must still produce a working itinerary.
  -- The image is hotlinked from Unsplash, never copied here, so only metadata
  -- lives in these columns. download_location is used immediately after insert
  -- and is deliberately not stored — it is never needed again.
  hero_destination VARCHAR(120) NULL,
  hero_photo_id VARCHAR(64) NULL,
  hero_image_url VARCHAR(2048) NULL,
  hero_photo_url VARCHAR(2048) NULL,
  hero_photographer_name VARCHAR(200) NULL,
  hero_photographer_url VARCHAR(2048) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_hosted_code (code),
  KEY idx_hosted_created_at (created_at),
  KEY idx_hosted_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
