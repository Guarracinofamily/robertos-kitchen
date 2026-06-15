-- Roberto's Kitchen App — Closing Report checklist summary
-- Adds two columns to persist the nightly chef-checklist counts
-- so the 90-day history can show "X checked" per day.
-- Run once in Supabase SQL editor (project zrpglswalgjbtghudmhu).

ALTER TABLE closing_reports
  ADD COLUMN IF NOT EXISTS checks_done      integer,
  ADD COLUMN IF NOT EXISTS checks_attention integer;
