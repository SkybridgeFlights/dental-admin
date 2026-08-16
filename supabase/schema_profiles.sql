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
--   Postgres parses and validates a policy expression at CREATE POLICY time,
--   so every table a policy references must already exist. An earlier revision
--   created policies selecting `FROM profiles` before the profiles table and
--   failed on any fresh database with:
--       42P01: relation "profiles" does not exist
--   Sections are therefore ordered: table -> RLS enable -> policies -> view.
--   The current policies are deny-all and reference no other table, but the
--   ordering is kept so that adding a referencing policy later stays safe.
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
-- SECTION 2: RLS policies — DENY BY DEFAULT
--
-- Trust model, traced from production code:
--   every read/write of these tables goes through createAdminClient()
--   (service_role, server-side only). The browser Supabase client and
--   createSessionClient use the anon key for auth calls ONLY and never call
--   .from(). The Desktop app uses the anon key only against /auth/v1/* and
--   gets licence state from the Render API (/api/license/check); it never
--   calls PostgREST. So NO component needs anon or authenticated access here.
--
-- An earlier revision shipped `AS RESTRICTIVE USING (auth.role() = 'anon')`,
-- intending to block anon while letting authenticated users read. Because
-- PostgreSQL composes policies as
--     visible <=> (any PERMISSIVE passes) AND (all RESTRICTIVE pass)
-- that predicate passed the restrictive gate for anon and FAILED it for
-- authenticated — the inverse of its name — which also made the accompanying
-- permissive read policies permanently dead. It was fail-closed (nothing
-- leaked) but structurally wrong.
--
-- The correct minimum architecture is a single unambiguous deny-all per
-- table. service_role bypasses RLS and is how the application operates.
-- Do NOT relax this to enable direct desktop reads; add a narrowly scoped
-- permissive policy in a separate reviewed migration if that is ever needed.
-- See supabase/005_rls_deny_by_default.sql.
-- ================================================================

-- clinics
DROP POLICY IF EXISTS "deny anon"        ON clinics;
DROP POLICY IF EXISTS "clinics_own_read" ON clinics;
DROP POLICY IF EXISTS "deny_all"         ON clinics;
CREATE POLICY "deny_all" ON clinics AS RESTRICTIVE USING (false) WITH CHECK (false);

-- devices
DROP POLICY IF EXISTS "deny anon"           ON devices;
DROP POLICY IF EXISTS "devices_clinic_read" ON devices;
DROP POLICY IF EXISTS "deny_all"            ON devices;
CREATE POLICY "deny_all" ON devices AS RESTRICTIVE USING (false) WITH CHECK (false);

-- profiles
DROP POLICY IF EXISTS "deny anon"          ON profiles;
DROP POLICY IF EXISTS "profiles_self_read" ON profiles;
DROP POLICY IF EXISTS "deny_all"           ON profiles;
CREATE POLICY "deny_all" ON profiles AS RESTRICTIVE USING (false) WITH CHECK (false);

-- ================================================================
-- SECTION 3: Helper view update — include profile count per clinic
--
-- MUST drop first. schema.sql already defines clinic_summary ending in
-- last_device_seen; this revision inserts user_count BEFORE it. CREATE OR
-- REPLACE VIEW can only APPEND columns — it cannot rename or reorder them —
-- so replacing in place fails on any fresh database with:
--     42P16: cannot change name of view column "last_device_seen" to "user_count"
-- clinic_summary is a debugging helper with no dependants, so dropping it is
-- safe. Caught by the fresh-schema empirical test; do not remove this DROP.
-- ================================================================
DROP VIEW IF EXISTS clinic_summary;
CREATE VIEW clinic_summary AS
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
