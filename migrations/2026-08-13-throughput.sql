-- Carrier-aware throughput budget (see docs/superpowers/plans/2026-08-13-throughput-limits.md).
--
-- Segments are the unit carriers meter, so they must be recorded per send:
-- the 2026-08-11/12 block was 1,112 recipients but 5,530 segments, and nothing
-- in the schema could tell those two numbers apart.
ALTER TABLE broadcast_recipients ADD COLUMN segments SMALLINT NULL AFTER cost;
ALTER TABLE messages ADD COLUMN segments SMALLINT NULL AFTER cost;

-- Distinguishes a throughput rejection (error 99 / HTTP 429) from a bad phone
-- number. Previously both landed in `error` as prose and were indistinguishable.
ALTER TABLE broadcast_recipients ADD COLUMN error_code VARCHAR(16) NULL AFTER error;

-- Current carrier per contact, resolved once by scripts/backfill-carriers.js.
-- carrier_network_code also carries the sentinels 'NON_MOBILE' and 'INVALID';
-- carrier_checked_at drives the 90-day staleness rule (numbers port).
ALTER TABLE contacts ADD COLUMN carrier_network_code VARCHAR(16) NULL;
ALTER TABLE contacts ADD COLUMN carrier_name VARCHAR(64) NULL;
ALTER TABLE contacts ADD COLUMN carrier_checked_at DATETIME NULL;

-- 'paused' = deferred by the daily budget, with recipients still pending.
-- Deliberately distinct from 'failed': nothing went wrong and the scheduler
-- will drain the rest automatically.
ALTER TABLE broadcasts
  MODIFY status ENUM('draft','scheduled','sending','paused','completed','failed')
  NOT NULL DEFAULT 'draft';

-- The drain tick queries these every minute.
CREATE INDEX idx_broadcast_recipients_sent_at ON broadcast_recipients (sent_at);
CREATE INDEX idx_contacts_carrier ON contacts (carrier_network_code, carrier_checked_at);
