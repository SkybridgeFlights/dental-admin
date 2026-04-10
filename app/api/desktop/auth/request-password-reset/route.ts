import { NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { inspectDesktopInternalRequest } from '@/lib/desktop/internal';

const ROUTE_INFO = {
  route: '/api/desktop/auth/request-password-reset',
  methods: ['GET', 'POST', 'OPTIONS'],
};

function resolveCallbackUrl(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}/api/auth/callback?next=/reset-password`;
}

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
  console.info('[desktop-auth][request-password-reset] request received', {
    method: request.method,
    url: request.url,
  });

  const auth = inspectDesktopInternalRequest(request);
  if (!auth.ok) {
    console.error('[desktop-auth][request-password-reset] forbidden', auth);
    return NextResponse.json(
      {
        success: false,
        code: 'FORBIDDEN',
        reason: auth.reason,
      },
      { status: 403 },
    );
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ success: false, code: 'EMAIL_REQUIRED' }, { status: 400 });
  }

  const redirectTo = resolveCallbackUrl(request);
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    console.error('[desktop-auth][request-password-reset] supabase error', {
      email,
      redirectTo,
      message: error.message,
    });
    return NextResponse.json(
      {
        success: false,
        code: 'RESET_REQUEST_FAILED',
        message: error.message,
        redirectTo,
      },
      { status: 502 },
    );
  }

  console.info('[desktop-auth][request-password-reset] accepted', {
    email,
    redirectTo,
  });

  return NextResponse.json({
    success: true,
    code: 'RESET_EMAIL_REQUESTED',
    redirectTo,
    deliveryNote:
      'Supabase accepted the reset request, but email delivery still depends on the project email configuration. Without working SMTP/email settings, the message may not arrive.',
  });
}
