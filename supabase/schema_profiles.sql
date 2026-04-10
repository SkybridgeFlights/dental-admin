-- ================================================================
-- DentalPro — Phase 1: Profiles table + RLS updates
-- Apply via: Supabase Dashboard > SQL Editor > Run
-- Run AFTER schema.sql (requires clinics table to exist)
-- ================================================================

-- ================================================================
-- SECTION 1: Fix restrictive RLS on clinics + devices
--
-- Current policy: AS RESTRICTIVE USING (false) — blocks EVERYONE,
-- including authenticated users. Replace with anon-only block so
-- authenticated users (desktop app using user JWT) can read their
-- own clinic and device record.
-- ================================================================

-- clinics
DROP POLICY IF EXISTS "deny anon" ON clinics;
CREATE POLICY "deny anon" ON clinics
  AS RESTRICTIVE
  USING (auth.role() = 'anon');

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

CREATE POLICY "devices_clinic_read" ON devices
  FOR SELECT
  USING (
    -- Authenticated user can read devices belonging to their clinic
    clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid())
  );

-- ================================================================
-- SECTION 2: profiles table
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

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_profiles_clinic_id ON profiles (clinic_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email     ON profiles (email);

-- RLS: deny all by default
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Block anonymous access
CREATE POLICY "deny anon" ON profiles
  AS RESTRICTIVE
  USING (auth.role() = 'anon');

-- Authenticated user can read ONLY their own profile row
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
