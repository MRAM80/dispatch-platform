-- 002 base columns
--
-- Columns added to the hand-made base tables over time.
-- Most are already in 001; these ALTERs make the file safe against an older project.
--
-- Ported verbatim from the runbook in CLAUDE.md; every statement is idempotent.

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS bin_number text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS workflow_step text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS parent_order_id uuid;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS dump_site_address text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS delivery_photo_url text;
ALTER TABLE dump_sites ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS province text DEFAULT 'ON';
ALTER TABLE job_sites ADD COLUMN IF NOT EXISTS postal_code text;
UPDATE customers SET status = 'active' WHERE status IS NULL;
