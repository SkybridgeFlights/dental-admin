/**
 * POST /api/auth/verify-admin
 *
 * Called by the login page immediately after Supabase signInWithPassword succeeds.
 * Checks the logged-in user's email against ADMIN_EMAIL_WHITELIST server-side.
 *
 * Returns an explicit reason code so the UI can show the exact failure cause.
 * No credentials are passed in the request body — we read the session from the cookie.
 */
import { NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';

export type VerifyAdminResult =
  | { ok: true;  email: string }
  | { ok: false; reason: 'NOT_AUTHENTICATED' | 'NOT_AUTHORIZED_ADMIN' | 'WHITELIST_EMPTY' };

export async function POST() {
  const supabase = await createSessionClient();

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    console.warn('[verify-admin] NOT_AUTHENTICATED —', error?.message ?? 'no user in session');
    return NextResponse.json<VerifyAdminResult>(
      { ok: false, reason: 'NOT_AUTHENTICATED' },
      { status: 401 },
    );
  }

  const raw = process.env.ADMIN_EMAIL_WHITELIST ?? '';
  const allowedEmails = new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  );

  if (allowedEmails.size === 0) {
    // Whitelist not configured — treat as server misconfiguration, not a user error
    console.error('[verify-admin] WHITELIST_EMPTY — ADMIN_EMAIL_WHITELIST is not set');
    return NextResponse.json<VerifyAdminResult>(
      { ok: false, reason: 'WHITELIST_EMPTY' },
      { status: 503 },
    );
  }

  const email = user.email?.toLowerCase() ?? '';
  if (!allowedEmails.has(email)) {
    console.warn(`[verify-admin] NOT_AUTHORIZED_ADMIN — ${email} is not in whitelist`);
    // Sign them out so the rejected user doesn't get a dashboard session
    await supabase.auth.signOut();
    return NextResponse.json<VerifyAdminResult>(
      { ok: false, reason: 'NOT_AUTHORIZED_ADMIN' },
      { status: 403 },
    );
  }

  console.info(`[verify-admin] ✅ admin verified: ${email}`);
  return NextResponse.json<VerifyAdminResult>({ ok: true, email });
}
