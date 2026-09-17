-- Kommo CRM leads that failed to create for a first-time inbound texter.
-- lib/kommoLeads.js queues them here and the scheduler retries each one with
-- increasing delays until it succeeds ('done') or runs out of attempts
-- ('failed'). `first_message` is the text the lead's custom field and note use.
CREATE TABLE IF NOT EXISTS kommo_lead_retries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(32) NOT NULL,
  first_message TEXT NOT NULL,
  status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  lead_id BIGINT UNSIGNED NULL,
  next_attempt_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_kommo_lead_retries_due (status, next_attempt_at),
  KEY idx_kommo_lead_retries_phone (phone, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
