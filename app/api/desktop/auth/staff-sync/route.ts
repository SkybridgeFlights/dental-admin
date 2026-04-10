import { NextResponse } from 'next/server';
import { isDesktopInternalRequest } from '@/lib/desktop/internal';
import { upsertClinicAuthUser } from '@/lib/supabase/admin-users';

const ROUTE_INFO = {
  route: '/api/desktop/auth/staff-sync',
  methods: ['GET', 'POST', 'OPTIONS'],
};

type StaffSyncRequest = {
  email?: string;
  password?: string;
  full_name?: string;
  role?: string;
  clinic_id?: string;
  is_active?: boolean;
  can_login?: boolean;
  preferred_language?: string;
  existing_supabase_user_id?: string | null;
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    ...ROUTE_INFO,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, OPTIONS',
    },
  });
}

export async function POST(request: Request) {
  console.info('[desktop-auth][staff-sync] request received', {
    method: request.method,
    url: request.url,
  });

  if (!isDesktopInternalRequest(request)) {
    return NextResponse.json({ success: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: StaffSyncRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const canLogin = Boolean(body.can_login);
  if (!canLogin) {
    console.info('[desktop-auth][staff-sync] skipped because can_login=false', {
      email: body.email || null,
      clinicId: body.clinic_id || null,
    });
    return NextResponse.json({
      success: true,
      code: 'LOGIN_DISABLED',
      userId: null,
      profileStatus: 'inactive',
      mode: 'skipped',
    });
  }

  try {
    const result = await upsertClinicAuthUser({
      email: String(body.email || ''),
      password: body.password || null,
      fullName: String(body.full_name || ''),
      clinicId: String(body.clinic_id || ''),
      role: String(body.role || ''),
      status: body.is_active === false ? 'inactive' : 'active',
      existingSupabaseUserId: body.existing_supabase_user_id || null,
    });

    console.info('[desktop-auth][staff-sync] completed', {
      email: body.email || null,
      clinicId: body.clinic_id || null,
      userId: result.userId,
      mode: result.mode,
      profileStatus: result.profileStatus,
    });

    return NextResponse.json({
      success: true,
      code: 'STAFF_AUTH_SYNCED',
      ...result,
    });
  } catch (error: any) {
    const code = String(error?.name || error?.message || 'STAFF_AUTH_SYNC_FAILED');
    console.error('[desktop-auth][staff-sync] failed', {
      email: body.email || null,
      clinicId: body.clinic_id || null,
      code,
      message: error?.message || 'Failed to sync staff auth user',
    });
    return NextResponse.json(
      {
        success: false,
        code,
        message: error?.message || 'Failed to sync staff auth user',
      },
      { status: 400 },
    );
  }
}
