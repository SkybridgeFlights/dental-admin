import { NextResponse } from 'next/server';
import { createSessionClient, createAdminClient } from '@/lib/supabase/server';

// GET /api/license/latest?clinicId=<uuid>
// Returns the most recently generated license for a clinic.
// Reads from the licenses audit table — no signing secret is involved.
export async function GET(request: Request) {
  // --- Auth guard ---
  const sessionClient = await createSessionClient();
  const { data: { user }, error: authError } = await sessionClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 403 });
  }

  const whitelist = (process.env.ADMIN_EMAIL_WHITELIST ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (whitelist.length > 0 && !whitelist.includes(user.email?.toLowerCase() ?? '')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // --- Parse query param ---
  const { searchParams } = new URL(request.url);
  const clinicId = searchParams.get('clinicId')?.trim();
  if (!clinicId) {
    return NextResponse.json({ error: 'MISSING_CLINIC_ID' }, { status: 400 });
  }

  // --- Fetch latest license ---
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('licenses')
    .select('license_key, expires_at, device_id, created_at')
    .eq('clinic_id', clinicId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[license/latest]', error);
    return NextResponse.json({ error: 'DATABASE_ERROR' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'NO_LICENSE_FOUND' }, { status: 404 });
  }

  return NextResponse.json({
    license_key: data.license_key,
    expires_at:  data.expires_at,
    device_id:   data.device_id,
    generated_at: data.created_at,
  });
}
