-- ================================================================
-- DentalPro Desktop Auth - Phase 1 prerequisites
-- Run in Supabase SQL editor before enabling desktop Supabase auth.
-- ================================================================

-- Ensure profiles table exists with required columns.
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

-- Align profile shape if table already existed.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE RESTRICT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'doctor';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Required indexes.
CREATE INDEX IF NOT EXISTS idx_profiles_clinic_id ON profiles (clinic_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);

-- RLS for desktop auth profile lookup and clinic/device resolution.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_self_read" ON profiles;
CREATE POLICY "profiles_self_read" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "clinics_own_read" ON clinics;
CREATE POLICY "clinics_own_read" ON clinics
  FOR SELECT
  USING (id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "devices_clinic_read" ON devices;
CREATE POLICY "devices_clinic_read" ON devices
  FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid()));
