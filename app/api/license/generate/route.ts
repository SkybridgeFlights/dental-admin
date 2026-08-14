import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { createSignedLicenseArtifacts } from '@/lib/license/sign';
import { writeAuditLog } from '@/lib/audit/log';
import { createHash } from 'crypto';

// POST /api/license/generate
// Admin-only. Signs a DP3 license server-side and persists the audit record.
export async function POST(request: Request) {
  // 1. Verify admin session
  const authorization = await requireApiAdmin();
  if (!authorization.ok) return authorization.response;
  const user = authorization.user;

  // 2. Parse and validate input
  let body: {
    clinicId: string;
    clinicName: string;
    expiryDate: string; // YYYY-MM-DD
    licenseType: string;
    deviceId: string;   // DPDEV-[8-char-hex]
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const { clinicId, clinicName, expiryDate, licenseType, deviceId } = body;

  if (!clinicId || !clinicName || !expiryDate || !licenseType || !deviceId) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return NextResponse.json({ error: 'INVALID_EXPIRY_DATE_FORMAT' }, { status: 400 });
  }

  if (!/^DPDEV-[0-9a-fA-F]{32}$/.test(deviceId)) {
    return NextResponse.json({ error: 'INVALID_DEVICE_ID_FORMAT' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 3. Verify clinic exists and is active
  const { data: clinic, error: clinicError } = await admin
    .from('clinics')
    .select('id, clinic_name, status, max_devices, plan_type')
    .eq('id', clinicId)
    .single();

  if (clinicError || !clinic) {
    return NextResponse.json({ error: 'CLINIC_NOT_FOUND' }, { status: 404 });
  }

  if (clinic.status !== 'active') {
    return NextResponse.json({ error: 'CLINIC_NOT_ACTIVE' }, { status: 400 });
  }

  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('id, email, full_name, preferred_language, role, status')
    .eq('clinic_id', clinicId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // 4. Check if this device is already registered to a different clinic
  const { data: existingDevice } = await admin
    .from('devices')
    .select('device_id, clinic_id')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (existingDevice && existingDevice.clinic_id !== clinicId) {
    return NextResponse.json({ error: 'DEVICE_BELONGS_TO_ANOTHER_CLINIC' }, { status: 400 });
  }

  // 5. Enforce max_devices — only count if this is a brand-new device for this clinic
  if (!existingDevice) {
    const { count, error: countError } = await admin
      .from('devices')
      .select('device_id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'active');

    if (countError) {
      return NextResponse.json({ error: 'DATABASE_ERROR' }, { status: 500 });
    }

    if (count !== null && count >= clinic.max_devices) {
      return NextResponse.json(
        { error: 'MAX_DEVICES_REACHED', max: clinic.max_devices, current: count },
        { status: 400 },
      );
    }
  }

  // 6. Sign the license — server-side only, secret never leaves this function
  let licenseKey: string;
  let licenseFile;
  try {
    ({ licenseKey, licenseFile } = createSignedLicenseArtifacts(
      clinicName,
      expiryDate,
      licenseType,
      deviceId,
      clinicId,
      ownerProfile
        ? {
            ownerEmail: ownerProfile.email,
            ownerName: ownerProfile.full_name,
            ownerSupabaseUserId: ownerProfile.id,
            preferredLanguage: ownerProfile.preferred_language,
          }
        : null,
    ));
  } catch (err) {
    console.error('[license/generate] signing failed:', err);
    return NextResponse.json({ error: 'SIGNING_FAILED' }, { status: 500 });
  }

  // 7a. Revoke all previous active licenses for this clinic+device pair.
  //     Sets revoked_at on existing non-revoked rows — preserves audit history.
  //     GET /api/license/latest already filters revoked_at IS NULL, so it will
  //     naturally return only the new key after this point.
  //     Failure is logged but does not block generation.
  const { error: replacementError } = await admin.rpc('replace_device_license', {
    p_clinic_id: clinicId,
    p_device_id: deviceId,
    p_license_key: licenseKey,
    p_license_type: licenseType,
    p_expires_at: licenseFile.claims.expiresAt,
    p_generated_by: user.email,
    p_credential_hash: createHash('sha256').update(licenseFile.claims.deviceCredential).digest('hex'),
  });

  if (replacementError) {
    console.error('[license/generate] atomic replacement failed');
    return NextResponse.json({ error: 'DATABASE_ERROR' }, { status: 500 });
  }

  await writeAuditLog({
    actorEmail: user.email!,
    action:     'license.generate',
    targetType: 'license',
    targetId:   clinicId,
    metadata:   { clinic_name: clinicName, device_id: deviceId, license_type: licenseType, expiry_date: expiryDate },
  });

  return NextResponse.json({ licenseKey, licenseFile }, { status: 201 });
}
