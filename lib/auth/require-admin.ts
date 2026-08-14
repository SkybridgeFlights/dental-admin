import { redirect } from 'next/navigation';
import { createSessionClient } from '@/lib/supabase/server';
import { authorizeAdminEmail } from './admin-policy';

export async function requireAdmin() {
  const supabase = await createSessionClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const decision = authorizeAdminEmail(user.email, process.env.ADMIN_EMAIL_WHITELIST);
  if (!decision.ok) {
    await supabase.auth.signOut();
    redirect(decision.reason.startsWith('ADMIN_CONFIG_')
      ? '/login?error=ADMIN_AUTH_UNAVAILABLE'
      : '/login?error=NOT_AUTHORIZED_ADMIN');
  }
  return user;
}
