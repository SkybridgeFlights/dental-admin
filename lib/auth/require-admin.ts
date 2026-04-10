import { redirect } from 'next/navigation';
import { createSessionClient } from '@/lib/supabase/server';

function getAllowedEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAIL_WHITELIST ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Use in every dashboard Server Component layout/page.
 * Returns the authenticated admin user or redirects to /login with an explicit reason.
 *
 * Reason codes:
 *   (no param)      — not authenticated
 *   ?error=NOT_AUTHORIZED_ADMIN — authenticated but not in whitelist
 */
export async function requireAdmin() {
  const supabase = await createSessionClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    console.warn('[require-admin] no session — redirecting to /login');
    redirect('/login');
  }

  const allowedEmails = getAllowedEmails();

  if (allowedEmails.size === 0) {
    // Misconfiguration: whitelist empty means no one can pass — log clearly
    console.error(
      '[require-admin] ADMIN_EMAIL_WHITELIST is empty — all users blocked. ' +
      'Set the variable in .env.local and restart the server.',
    );
    await supabase.auth.signOut();
    redirect('/login?error=WHITELIST_EMPTY');
  }

  const email = user.email?.toLowerCase() ?? '';
  if (!allowedEmails.has(email)) {
    console.warn(
      `[require-admin] NOT_AUTHORIZED_ADMIN — "${email}" is authenticated ` +
      `but not in ADMIN_EMAIL_WHITELIST (${[...allowedEmails].join(', ')})`,
    );
    await supabase.auth.signOut();
    redirect('/login?error=NOT_AUTHORIZED_ADMIN');
  }

  return user;
}
