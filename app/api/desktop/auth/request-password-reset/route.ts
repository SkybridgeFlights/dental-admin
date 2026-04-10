import { NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { isDesktopInternalRequest } from '@/lib/desktop/internal';

function resolveCallbackUrl(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}/api/auth/callback?next=/reset-password`;
}

export async function POST(request: Request) {
  if (!isDesktopInternalRequest(request)) {
    return NextResponse.json({ success: false, code: 'FORBIDDEN' }, { status: 403 });
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

  return NextResponse.json({
    success: true,
    code: 'RESET_EMAIL_REQUESTED',
    redirectTo,
    deliveryNote:
      'Supabase accepted the reset request, but email delivery still depends on the project email configuration. Without working SMTP/email settings, the message may not arrive.',
  });
}

