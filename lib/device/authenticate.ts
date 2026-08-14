import { createHash, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';

const attempts = new Map<string, { count: number; reset: number }>();

export async function authenticateDeviceRequest(request: Request, deviceId: string) {
  const source = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now(); const rate = attempts.get(source);
  if (!rate || rate.reset < now) attempts.set(source, { count: 1, reset: now + 60_000 });
  else if (++rate.count > 30) return { ok: false as const, status: 429 };
  const credential = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const nonce = request.headers.get('x-device-nonce') || '';
  const timestamp = Number(request.headers.get('x-device-timestamp'));
  if (!/^DPDEV-[0-9A-F]{32}$/.test(deviceId) || !/^[A-Za-z0-9_-]{43}$/.test(credential)
      || !/^[0-9a-f-]{36}$/i.test(nonce) || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300_000) {
    return { ok: false as const, status: 401 };
  }
  const admin = createAdminClient();
  const { data: device } = await admin.from('devices').select('device_id, clinic_id, status, credential_hash').eq('device_id', deviceId).maybeSingle();
  const candidate = Buffer.from(createHash('sha256').update(credential).digest('hex'));
  const expected = Buffer.from(String(device?.credential_hash || '').padEnd(64, '0').slice(0, 64));
  if (!device || !timingSafeEqual(candidate, expected)) return { ok: false as const, status: 401 };
  const { error } = await admin.from('device_request_nonces').insert({ device_id: deviceId, nonce });
  if (error) return { ok: false as const, status: 409 };
  return { ok: true as const, admin, device };
}
