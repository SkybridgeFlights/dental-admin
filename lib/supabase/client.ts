import { createBrowserClient } from '@supabase/ssr';

// Browser client — uses anon key, subject to RLS (which denies all for anon)
// Used only for auth session management (sign-in, sign-out)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
