-- Persist the one-time Haiku interpretation used by hosted pages. Customer
-- page views read this validated structure and never call Anthropic.
ALTER TABLE hosted_messages
  ADD COLUMN ai_structure JSON NULL AFTER body,
  ADD COLUMN parse_method ENUM('haiku','deterministic') NOT NULL DEFAULT 'deterministic' AFTER ai_structure,
  ADD COLUMN parse_model VARCHAR(80) NULL AFTER parse_method,
  ADD COLUMN parse_duration_ms INT UNSIGNED NULL AFTER parse_model,
  ADD COLUMN parse_input_tokens INT UNSIGNED NULL AFTER parse_duration_ms,
  ADD COLUMN parse_output_tokens INT UNSIGNED NULL AFTER parse_input_tokens,
  ADD COLUMN parse_cost_usd DECIMAL(10,6) NULL AFTER parse_output_tokens,
  ADD COLUMN title_origin ENUM('provided','source','suggested','deterministic','fallback') NULL AFTER parse_cost_usd,
  ADD COLUMN parsed_at TIMESTAMP NULL AFTER title_origin;
