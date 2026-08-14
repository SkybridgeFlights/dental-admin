import { NextResponse } from 'next/server';
import { authenticateDeviceRequest } from '@/lib/device/authenticate';

export async function POST(request: Request) {
  let body: { deviceId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
  const deviceId = String(body.deviceId || '').trim().toUpperCase();
  const authentication = await authenticateDeviceRequest(request, deviceId);
  if (!authentication.ok) return NextResponse.json({ error: 'DEVICE_AUTH_FAILED' }, { status: authentication.status });
  const { admin, device } = authentication;
  const { data: clinic, error } = await admin.from('clinics').select('status, expires_at').eq('id', device.clinic_id).single();
  if (error || !clinic) return NextResponse.json({ error: 'STATUS_UNAVAILABLE' }, { status: 503 });
  const { data: license } = await admin.from('licenses').select('revoked_at, expires_at')
    .eq('device_id', deviceId).is('revoked_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  let status: 'active' | 'expired' | 'revoked' = 'active';
  if (!license || ['revoked', 'blocked'].includes(device.status) || clinic.status === 'suspended') status = 'revoked';
  else if (clinic.status === 'inactive' || new Date(license.expires_at) < new Date()) status = 'expired';
  await admin.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('device_id', deviceId);
  return NextResponse.json({ status, expiryDate: license?.expires_at || clinic.expires_at, notices: [], config: { maxOfflineDays: 14, graceDays: 30 } });
}
