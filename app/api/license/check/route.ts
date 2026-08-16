import { NextResponse } from 'next/server';
import { authenticateDeviceRequest } from '@/lib/device/authenticate';
import {
  classifyLicenseStatus,
  forceFailure,
  stagingFaultTarget,
  toOutcome,
  type ClinicRow,
  type LicenseRow,
} from '@/lib/license/status';

export async function POST(request: Request) {
  let body: { deviceId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  const deviceId = String(body.deviceId || '').trim().toUpperCase();

  const authentication = await authenticateDeviceRequest(request, deviceId);
  if (!authentication.ok) return NextResponse.json({ error: 'DEVICE_AUTH_FAILED' }, { status: authentication.status });
  const { admin, device } = authentication;

  // Staging-only fault injection. Evaluated AFTER authentication so it can
  // never grant access, and it can only turn a read into a failure.
  const fault = stagingFaultTarget(request);

  // ── status-critical read 1: clinic ─────────────────────────────────────────
  let clinic = toOutcome<ClinicRow>(
    await admin.from('clinics').select('status, expires_at').eq('id', device.clinic_id).single(),
  );
  if (fault === 'clinics') clinic = forceFailure(clinic);

  // ── status-critical read 2: latest non-revoked licence ─────────────────────
  // The `error` here is deliberately inspected: a failed query must NOT be
  // allowed to look like "no licence" and become a revocation.
  let license = toOutcome<LicenseRow>(
    await admin.from('licenses').select('revoked_at, expires_at')
      .eq('device_id', deviceId).is('revoked_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  );
  if (fault === 'licenses') license = forceFailure(license);

  const classification = classifyLicenseStatus({ device, clinic, license });

  // Never leak internal database errors to the client.
  if (!classification.ok) {
    return NextResponse.json({ error: classification.reason }, { status: 503 });
  }

  // Non-status-critical side effect: a failure here must not change the answer.
  await admin.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('device_id', deviceId);

  return NextResponse.json({
    status: classification.status,
    expiryDate: classification.expiryDate,
    notices: [],
    config: { maxOfflineDays: 14, graceDays: 30 },
  });
}
