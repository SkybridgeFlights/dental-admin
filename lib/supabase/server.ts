import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options?: object };

// Session client — anon key + cookie-based session (for middleware and auth checks)
export async function createSessionClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]),
            );
          } catch {
            // Called from a Server Component — cookie writes are a no-op,
            // handled by middleware instead.
          }
        },
      },
    },
  );
}

// Admin client — service role key, bypasses RLS entirely
// NEVER import this in any client component or expose to browser
export function createAdminClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // No cookies needed for service role — stateless admin operations
      cookies: { getAll: () => [], setAll: () => {} },
    },
  );
}
