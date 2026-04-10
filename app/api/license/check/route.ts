import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// POST /api/license/check
// Called by the desktop app's background sync (license-sync-service.js).
// No admin auth — but any non-2xx response is treated as "offline" by the desktop app,
// which is the correct behaviour: only confirmed data drives status changes.

export async function POST(request: Request) {
  // Parse body — malformed JSON is a client error, not a server error
  let body: {
    deviceId?: string;
    clinicName?: string;
    licenseType?: string;
    expiryDate?: string;
    appVersion?: string;
    platform?: string;
    lastCheckAt?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const { deviceId } = body;

  if (!deviceId) {
    return NextResponse.json({ error: 'MISSING_DEVICE_ID' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Look up the device — returns 404 so the desktop treats this as offline
  const { data: device, error: deviceError } = await admin
    .from('devices')
    .select('device_id, clinic_id, status')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (deviceError) {
    // Database error — tell the desktop to treat this as offline
    console.error('[license/check] device lookup failed:', deviceError);
    return NextResponse.json({ error: 'DATABASE_ERROR' }, { status: 500 });
  }

  if (!device) {
    // Device not registered — 404, desktop treats non-2xx as offline
    return NextResponse.json({ error: 'DEVICE_NOT_FOUND' }, { status: 404 });
  }

  // Update last_seen_at — failure is non-fatal but still an error
  const { error: updateError } = await admin
    .from('devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('device_id', deviceId);

  if (updateError) {
    console.error('[license/check] last_seen_at update failed:', updateError);
    return NextResponse.json({ error: 'DATABASE_ERROR' }, { status: 500 });
  }

  // Look up the clinic
  const { data: clinic, error: clinicError } = await admin
    .from('clinics')
    .select('clinic_name, status, expires_at, plan_type')
    .eq('id', device.clinic_id)
    .single();

  if (clinicError || !clinic) {
    console.error('[license/check] clinic lookup failed:', clinicError);
    return NextResponse.json({ error: 'CLINIC_NOT_FOUND' }, { status: 500 });
  }

  // Determine license status from confirmed database data
  let status: 'active' | 'expired' | 'revoked';

  if (device.status === 'revoked' || device.status === 'blocked' || clinic.status === 'suspended') {
    status = 'revoked';
  } else if (clinic.status === 'inactive' || new Date(clinic.expires_at) < new Date()) {
    status = 'expired';
  } else {
    status = 'active';
  }

  return NextResponse.json({
    status,
    clinicId: device.clinic_id,
    clinicName: clinic?.clinic_name ?? null,
    expiryDate: clinic.expires_at,
    notices: [],    // Phase 2: populate from a notices table
    config: {
      maxOfflineDays: 14,
      graceDays:      30,
    },
  });
}
