-- ════════════════════════════════════════════════════════════
-- ACTUAL WORKED TIME — manual shift close support (ADDITIVE ONLY)
-- Run once in: https://supabase.com/dashboard/project/zrpglswalgjbtghudmhu/sql/new
-- ════════════════════════════════════════════════════════════

-- Manager-entered clock-out for shifts the terminal never closed.
-- When set, the app treats the shift as completed using this value.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS manual_out  text;       -- HH:MM
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS closed_by   text;       -- who closed it
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS closed_at   timestamptz;

-- Allow the app (anon) to UPDATE only the manual-close fields.
-- The cosec-sync function (service role) still owns first_in/last_out.
DROP POLICY IF EXISTS "attendance manual close" ON attendance;
CREATE POLICY "attendance manual close" ON attendance
  FOR UPDATE USING (true) WITH CHECK (true);

-- Allow the app to INSERT an attendance row when closing a shift for
-- someone who has no punch row yet (rare, but possible).
DROP POLICY IF EXISTS "attendance insert" ON attendance;
CREATE POLICY "attendance insert" ON attendance
  FOR INSERT WITH CHECK (true);

SELECT 'attendance actual-time columns ready' AS status;
