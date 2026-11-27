-- ════════════════════════════════════════════════════════════
-- COSEC ATTENDANCE INTEGRATION — SETUP (ADDITIVE ONLY)
-- Run once in: https://supabase.com/dashboard/project/zrpglswalgjbtghudmhu/sql/new
-- No existing tables/rows are modified except adding staff.emp_id
-- ════════════════════════════════════════════════════════════

-- 1. Employee ID on staff (matches Matrix COSEC / HR employee code)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS emp_id text;

-- 2. Attendance punches synced from COSEC (written only by the edge function)
CREATE TABLE IF NOT EXISTS attendance (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emp_id text NOT NULL,
  att_date date NOT NULL,
  first_in text,            -- HH:MM
  last_out text,            -- HH:MM
  punch_count int DEFAULT 0,
  punches jsonb,            -- raw list of times for debugging
  synced_at timestamptz DEFAULT now(),
  UNIQUE (emp_id, att_date)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance read" ON attendance;
CREATE POLICY "attendance read" ON attendance FOR SELECT USING (true);
-- intentionally NO insert/update policy for anon: only the edge function
-- (service role) can write attendance rows.

-- 3. Sync state (throttling + diagnostics)
CREATE TABLE IF NOT EXISTS cosec_sync_state (
  id int PRIMARY KEY DEFAULT 1,
  last_sync timestamptz,
  last_status text,
  last_raw text
);
INSERT INTO cosec_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE cosec_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync state read" ON cosec_sync_state;
CREATE POLICY "sync state read" ON cosec_sync_state FOR SELECT USING (true);

-- 4. Map COSEC employee IDs onto existing staff rows by name.
--    Only fills where emp_id is still NULL — safe to re-run.
--    Andrea Falcone intentionally NOT mapped (no clock in/out).
UPDATE staff SET emp_id='000115' WHERE emp_id IS NULL AND name ILIKE '%suleman%';
UPDATE staff SET emp_id='000322' WHERE emp_id IS NULL AND name ILIKE '%kunwar%';
UPDATE staff SET emp_id='000460' WHERE emp_id IS NULL AND name ILIKE '%genendra%';
UPDATE staff SET emp_id='000490' WHERE emp_id IS NULL AND name ILIKE '%shrestha%';
UPDATE staff SET emp_id='000760' WHERE emp_id IS NULL AND name ILIKE '%salido%';
UPDATE staff SET emp_id='000835' WHERE emp_id IS NULL AND name ILIKE '%valla%';
UPDATE staff SET emp_id='000836' WHERE emp_id IS NULL AND name ILIKE '%gajendra%';
UPDATE staff SET emp_id='100033' WHERE emp_id IS NULL AND name ILIKE '%mastu%';
UPDATE staff SET emp_id='100034' WHERE emp_id IS NULL AND (name ILIKE '%birendra%' OR name ILIKE '%shahi%');
UPDATE staff SET emp_id='100081' WHERE emp_id IS NULL AND name ILIKE '%ajay%';
UPDATE staff SET emp_id='100097' WHERE emp_id IS NULL AND (name ILIKE '%ankush%' OR name ILIKE '%rana%');
UPDATE staff SET emp_id='100139' WHERE emp_id IS NULL AND (name ILIKE '%chirag%' OR name ILIKE '%rathod%');
UPDATE staff SET emp_id='100141' WHERE emp_id IS NULL AND name ILIKE '%subash%';
UPDATE staff SET emp_id='100142' WHERE emp_id IS NULL AND name ILIKE '%amal%';
UPDATE staff SET emp_id='100168' WHERE emp_id IS NULL AND name ILIKE '%stellacci%';
UPDATE staff SET emp_id='100196' WHERE emp_id IS NULL AND name ILIKE '%kamal%';

-- 5. Check the result — any active staff still without an ID
--    (except Andrea) can be set directly in the app by tapping the ID under the name.
SELECT name, designation, emp_id FROM staff WHERE active = true ORDER BY station_key, sort_order;
