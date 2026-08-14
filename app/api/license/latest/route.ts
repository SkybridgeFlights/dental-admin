import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { createLicenseFilePayload, parseDP3LicenseKey } from '@/lib/license/sign';

function normalizeStatus(input: {
  clinicStatus?: string | null;
  deviceStatus?: string | null;
  expiresAt?: string | null;
}) {
  if (['revoked', 'blocked'].includes(String(input.deviceStatus || '').toLowerCase())) {
    return 'revoked';
  }

  if (String(input.clinicStatus || '').toLowerCase() === 'suspended') {
    return 'revoked';
  }

  const expiresAt = String(input.expiresAt || '').trim();
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return 'expired';
  }

  return 'active';
}

export async function GET(request: Request) {
  const authorization = await requireApiAdmin();
  if (!authorization.ok) return authorization.response;

  const { searchParams } = new URL(request.url);
  const clinicId = searchParams.get('clinicId')?.trim();
  if (!clinicId) {
    return NextResponse.json({ error: 'MISSING_CLINIC_ID' }, { status: 400 });
  }

  const admin = createAdminClient();
  const [{ data: clinic }, { data: latestLicense, error: licenseError }, { data: ownerProfile }] = await Promise.all([
    admin
      .from('clinics')
      .select('id, clinic_name, owner_name, plan_type, expires_at, status')
      .eq('id', clinicId)
      .maybeSingle(),
    admin
      .from('licenses')
      .select('license_key, expires_at, device_id, license_type, created_at')
      .eq('clinic_id', clinicId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('profiles')
      .select('id, email, full_name, preferred_language, role, status')
      .eq('clinic_id', clinicId)
      .eq('role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!clinic) {
    return NextResponse.json({ error: 'CLINIC_NOT_FOUND' }, { status: 404 });
  }

  if (licenseError) {
    console.error('[license/latest]', licenseError);
    return NextResponse.json({ error: 'DATABASE_ERROR' }, { status: 500 });
  }

  if (!latestLicense) {
    return NextResponse.json({ error: 'NO_LICENSE_FOUND' }, { status: 404 });
  }

  const parsedLicense = parseDP3LicenseKey(latestLicense.license_key);
  if (!parsedLicense) {
    return NextResponse.json({ error: 'LICENSE_PARSE_FAILED' }, { status: 500 });
  }

  const { data: device } = await admin
    .from('devices')
    .select('status')
    .eq('device_id', latestLicense.device_id)
    .maybeSingle();

  const licenseFile = createLicenseFilePayload(
    parsedLicense.clinicName,
    parsedLicense.expiresAt.slice(0, 10),
    parsedLicense.edition,
    parsedLicense.deviceId,
    parsedLicense.clinicId || clinic.id,
    ownerProfile
      ? {
          ownerEmail: ownerProfile.email,
          ownerName: ownerProfile.full_name,
          ownerSupabaseUserId: ownerProfile.id,
          preferredLanguage: ownerProfile.preferred_language,
        }
      : null,
  );

  return NextResponse.json({
    clinic: {
      id: clinic.id,
      clinic_name: clinic.clinic_name,
      owner_name: clinic.owner_name,
      plan_type: clinic.plan_type,
      expires_at: clinic.expires_at,
      status: clinic.status,
    },
    owner: ownerProfile
      ? {
          id: ownerProfile.id,
          email: ownerProfile.email,
          full_name: ownerProfile.full_name,
          preferred_language: ownerProfile.preferred_language,
          status: ownerProfile.status,
        }
      : null,
    license_key: latestLicense.license_key,
    license_file: licenseFile,
    expires_at: latestLicense.expires_at,
    device_id: latestLicense.device_id,
    license_type: latestLicense.license_type,
    generated_at: latestLicense.created_at,
    license_status: normalizeStatus({
      clinicStatus: clinic.status,
      deviceStatus: device?.status,
      expiresAt: latestLicense.expires_at,
    }),
  });
}
