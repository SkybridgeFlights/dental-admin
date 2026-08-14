ALTER TABLE devices ADD COLUMN IF NOT EXISTS credential_hash TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS credential_issued_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS device_request_nonces (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, nonce)
);
ALTER TABLE device_request_nonces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny anon" ON device_request_nonces AS RESTRICTIVE USING (false);

CREATE OR REPLACE FUNCTION replace_device_license(
  p_clinic_id UUID, p_device_id TEXT, p_license_key TEXT, p_license_type plan_type,
  p_expires_at TIMESTAMPTZ, p_generated_by TEXT, p_credential_hash TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  UPDATE licenses SET revoked_at = NOW()
    WHERE clinic_id = p_clinic_id AND device_id = p_device_id AND revoked_at IS NULL;
  INSERT INTO devices(device_id, clinic_id, status, credential_hash, credential_issued_at)
    VALUES(p_device_id, p_clinic_id, 'active', p_credential_hash, NOW())
    ON CONFLICT(device_id) DO UPDATE SET clinic_id=EXCLUDED.clinic_id, status='active',
      credential_hash=EXCLUDED.credential_hash, credential_issued_at=NOW();
  INSERT INTO licenses(clinic_id,device_id,license_key,license_type,expires_at,generated_by)
    VALUES(p_clinic_id,p_device_id,p_license_key,p_license_type,p_expires_at,p_generated_by)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION replace_device_license(UUID,TEXT,TEXT,plan_type,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC;
