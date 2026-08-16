-- ================================================================
-- DentalPro — Phase 1: Profiles table + RLS updates
-- Apply via: Supabase Dashboard > SQL Editor > Run
-- Run AFTER schema.sql (requires clinics/devices/licenses to exist)
--
-- SUPERSEDES supabase/phase1_desktop_auth.sql. That file creates the same
-- profiles table and the same three read policies but omits the anon-block
-- policy changes and the clinic_summary view update below. Apply THIS file
-- only — applying both will fail on duplicate policy names.
--
-- ORDERING CONTRACT (do not reorder):
--   The clinics_own_read and devices_clinic_read policies contain
--   `SELECT clinic_id FROM profiles`. Postgres parses and validates a policy
--   expression at CREATE POLICY time, so the profiles TABLE must exist before
--   those policies are created. An earlier revision of this file created the
--   policies first and failed on a fresh database with:
--       42P01: relation "profiles" does not exist
--   Sections are therefore ordered: table -> RLS enable -> policies -> view.
--   test/schema-sql-ordering.test.ts enforces this and will fail if the
--   dependency order regresses.
-- ================================================================

-- ================================================================
-- SECTION 1: profiles table  (MUST precede the policies in SECTION 2)
--
-- One row per Supabase Auth user.
-- clinic_id ties a user to a clinic.
-- The desktop login verifies:
--   Primary:  device.clinic_id === profile.clinic_id  (UUID match via devices table)
--   Fallback: clinics.clinic_name matches license.clinicName  (string match)
-- ================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id                 UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT        NOT NULL,
  full_name          TEXT        NOT NULL,
  clinic_id          UUID        NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  role               TEXT        NOT NULL DEFAULT 'doctor'
                                 CHECK (role IN ('owner', 'admin', 'doctor', 'reception')),
  status             TEXT        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'inactive', 'suspended')),
  avatar_color       TEXT,
  preferred_language TEXT        NOT NULL DEFAULT 'en',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_profiles_clinic_id ON profiles (clinic_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email     ON profiles (email);

-- RLS on before any policy is defined.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices  ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- SECTION 2: RLS policies
--
-- schema.sql ships `AS RESTRICTIVE USING (false)` on clinics and devices,
-- which blocks EVERYONE including authenticated users. These are replaced
-- with the anon-scoped restriction below so the desktop app (user JWT) can
-- read its own clinic and device rows. The admin dashboard uses the service
-- role key, which bypasses RLS entirely and is unaffected either way.
--
-- NOTE: the restriction predicate is preserved verbatim from the previous
-- revision of this file. See the review note at the bottom before changing it.
-- ================================================================

-- clinics
DROP POLICY IF EXISTS "deny anon" ON clinics;
CREATE POLICY "deny anon" ON clinics
  AS RESTRICTIVE
  USING (auth.role() = 'anon');

DROP POLICY IF EXISTS "clinics_own_read" ON clinics;
CREATE POLICY "clinics_own_read" ON clinics
  FOR SELECT
  USING (
    -- Authenticated user can read the clinic they belong to
    id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid())
  );

-- devices
DROP POLICY IF EXISTS "deny anon" ON devices;
CREATE POLICY "deny anon" ON devices
  AS RESTRICTIVE
  USING (auth.role() = 'anon');

DROP POLICY IF EXISTS "devices_clinic_read" ON devices;
CREATE POLICY "devices_clinic_read" ON devices
  FOR SELECT
  USING (
    -- Authenticated user can read devices belonging to their clinic
    clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid())
  );

-- profiles
DROP POLICY IF EXISTS "deny anon" ON profiles;
CREATE POLICY "deny anon" ON profiles
  AS RESTRICTIVE
  USING (auth.role() = 'anon');

-- Authenticated user can read ONLY their own profile row
DROP POLICY IF EXISTS "profiles_self_read" ON profiles;
CREATE POLICY "profiles_self_read" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- ================================================================
-- SECTION 3: Helper view update — include profile count per clinic
-- ================================================================
CREATE OR REPLACE VIEW clinic_summary AS
SELECT
  c.id,
  c.clinic_name,
  c.owner_name,
  c.plan_type,
  c.status,
  c.expires_at,
  c.max_devices,
  COUNT(DISTINCT d.device_id)  AS device_count,
  COUNT(DISTINCT l.id)         AS license_count,
  COUNT(DISTINCT p.id)         AS user_count,
  MAX(d.last_seen_at)          AS last_device_seen
FROM clinics c
LEFT JOIN devices  d ON d.clinic_id = c.id
LEFT JOIN licenses l ON l.clinic_id = c.id
LEFT JOIN profiles p ON p.clinic_id = c.id
GROUP BY c.id;

-- ================================================================
-- REVIEW NOTE — unresolved, deliberately NOT changed here
--
-- The three `AS RESTRICTIVE USING (auth.role() = 'anon')` policies read as
-- inverted relative to the stated intent. RESTRICTIVE policies are ANDed, so
-- a row is visible only when the predicate is true: this grants the check to
-- anon and DENIES every authenticated user, which would stop the desktop app
-- reading its own clinic/device/profile rows. Blocking anon while allowing
-- authenticated users requires `USING (auth.role() <> 'anon')`.
--
-- This is fail-closed (more restrictive than intended), not a data leak, so
-- the predicate is preserved verbatim rather than silently relaxed. Flip it
-- only as a deliberate, reviewed change once desktop read access is tested.
-- ================================================================
