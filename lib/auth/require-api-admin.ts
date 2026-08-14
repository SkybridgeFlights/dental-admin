import { NextResponse } from 'next/server';
import { authorizeAdminEmail } from './admin-policy';
import { createSessionClient } from '@/lib/supabase/server';

export async function requireApiAdmin() {
  const client = await createSessionClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    return { ok: false as const, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  const decision = authorizeAdminEmail(user.email, process.env.ADMIN_EMAIL_WHITELIST);
  if (!decision.ok) {
    const configurationError = decision.reason.startsWith('ADMIN_CONFIG_');
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: configurationError ? 'ADMIN_AUTH_UNAVAILABLE' : 'FORBIDDEN' },
        { status: configurationError ? 503 : 403 },
      ),
    };
  }
  return { ok: true as const, user: { id: user.id, email: decision.email } };
}
