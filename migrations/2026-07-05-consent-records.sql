-- Append-only proof-of-consent audit log for online (web) opt-ins.
-- One row per opt-in submission; never updated or deleted. This is the
-- artifact a carrier/TCR audit requests as proof a number consented.
CREATE TABLE consent_records (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  phone        VARCHAR(20)  NOT NULL,
  name         VARCHAR(255) NULL,
  consent_text TEXT         NOT NULL,
  source       VARCHAR(32)  NOT NULL DEFAULT 'web',
  ip_address   VARCHAR(64)  NULL,
  user_agent   VARCHAR(512) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_consent_phone (phone),
  INDEX idx_consent_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
