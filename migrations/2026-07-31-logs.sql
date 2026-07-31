-- Structured event log for the whole server: sends, deliveries, webhooks,
-- auth, and admin actions. `meta` holds JSON context (ids, phones, statuses).
CREATE TABLE IF NOT EXISTS logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level ENUM('info','warn','error') NOT NULL DEFAULT 'info',
  category VARCHAR(32) NOT NULL,
  message VARCHAR(500) NOT NULL,
  meta JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_logs_created_at (created_at),
  KEY idx_logs_level_created (level, created_at),
  KEY idx_logs_category_created (category, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
