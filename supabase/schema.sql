-- ================================================================
-- DentalPro Admin — Supabase Schema
-- Apply via: Supabase Dashboard > SQL Editor > Run
-- ================================================================

-- ================================================================
-- ENUMS
-- ================================================================
CREATE TYPE clinic_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE plan_type     AS ENUM ('standard', 'pro', 'enterprise');
CREATE TYPE device_status AS ENUM ('active', 'revoked', 'blocked');

-- ================================================================
-- FUNCTION: auto-update updated_at on every row change
-- ================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TABLE: clinics
-- ================================================================
CREATE TABLE clinics (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name  TEXT          NOT NULL,
  owner_name   TEXT          NOT NULL,
  phone        TEXT,
  plan_type    plan_type     NOT NULL DEFAULT 'standard',
  expires_at   TIMESTAMPTZ   NOT NULL,
  max_devices  INTEGER       NOT NULL DEFAULT 1 CHECK (max_devices > 0),
  status       clinic_status NOT NULL DEFAULT 'active',
  notes        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clinics_status     ON clinics (status);
CREATE INDEX idx_clinics_expires_at ON clinics (expires_at);

CREATE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: devices
--
-- device_id TEXT is the primary key — it IS the DPDEV-XXXX string
-- used in the signed license key. One source of truth, no UUID mix.
-- ================================================================
CREATE TABLE devices (
  device_id    TEXT          PRIMARY KEY,          -- DPDEV-[8-char-hex]
  clinic_id    UUID          NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  activated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,                        -- updated by POST /api/license/check
  status       device_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_clinic_id ON devices (clinic_id);
CREATE INDEX idx_devices_status    ON devices (status);

CREATE TRIGGER trg_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: licenses  (audit trail — one row per generated key)
--
-- device_id TEXT FK → devices.device_id
-- Same string that appears inside the signed DP3 license key.
-- No UUID mix, no device_id_raw duplication.
-- ================================================================
CREATE TABLE licenses (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        NOT NULL REFERENCES clinics(id)     ON DELETE CASCADE,
  device_id     TEXT        NOT NULL REFERENCES devices(device_id) ON DELETE RESTRICT,
  license_key   TEXT        NOT NULL,
  license_type  plan_type   NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  generated_by  TEXT,                               -- admin email
  revoked_at    TIMESTAMPTZ,                        -- reserved for Phase 2
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_licenses_clinic_id ON licenses (clinic_id);
CREATE INDEX idx_licenses_device_id ON licenses (device_id);

-- ================================================================
-- ROW LEVEL SECURITY
-- The admin dashboard uses the service role key which bypasses RLS.
-- RLS is enabled as a safety net so the anon key can access nothing.
-- ================================================================
ALTER TABLE clinics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- Deny all access via anon key
CREATE POLICY "deny anon" ON clinics  AS RESTRICTIVE USING (false);
CREATE POLICY "deny anon" ON devices  AS RESTRICTIVE USING (false);
CREATE POLICY "deny anon" ON licenses AS RESTRICTIVE USING (false);

-- ================================================================
-- HELPFUL VIEWS (optional, for debugging in Supabase dashboard)
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
  MAX(d.last_seen_at)          AS last_device_seen
FROM clinics c
LEFT JOIN devices  d ON d.clinic_id = c.id
LEFT JOIN licenses l ON l.clinic_id = c.id
GROUP BY c.id;
