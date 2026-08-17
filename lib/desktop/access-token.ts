import { createClient } from '@supabase/supabase-js';
import { parseBearerToken } from './bootstrap';

// Verification of an end-user Supabase access token presented by the Desktop.
//
// We deliberately validate against GoTrue (`auth.getUser(jwt)`) rather than
// verifying a JWT signature locally:
//   * no JWT secret has to be provisioned to this service;
//   * expiry, signature, issuer and *revocation* (signed-out / deleted user)
//     are all checked by the identity provider itself;
//   * it fails closed — any transport problem yields "not verified".
//
// The anon key is used for this call because that is the correct public role
// for the GoTrue user endpoint. The service_role key is NEVER involved in
// verifying a caller's identity; it is used only afterwards, for the database
// read, once the subject is already established.

export type TokenVerification =
  | { ok: true; userId: string }
  | { ok: false; reason: 'MISSING' | 'MALFORMED' | 'REJECTED' | 'UNAVAILABLE' };

let cachedClient: ReturnType<typeof createClient> | null = null;

function authClient() {
  if (!cachedClient) {
    cachedClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return cachedClient;
}

/**
 * Resolve the authenticated subject of a request, or fail.
 *
 * The returned id comes exclusively from the identity provider's answer for the
 * presented token. No request-controlled input contributes to it.
 */
export async function verifyRequestSubject(request: Request): Promise<TokenVerification> {
  const header = request.headers.get('authorization');
  if (header == null || header.trim() === '') return { ok: false, reason: 'MISSING' };

  const token = parseBearerToken(header);
  if (!token) return { ok: false, reason: 'MALFORMED' };

  let result: Awaited<ReturnType<ReturnType<typeof createClient>['auth']['getUser']>>;
  try {
    result = await authClient().auth.getUser(token);
  } catch {
    // Network/transport failure — we cannot assert identity, so we do not.
    return { ok: false, reason: 'UNAVAILABLE' };
  }

  if (result.error) {
    // GoTrue answered and refused the token (expired, malformed, revoked,
    // wrong project). Distinguish "the IdP is down" from "the token is bad":
    // a 5xx is an availability problem, anything else is a rejection.
    const status = (result.error as { status?: number }).status;
    if (typeof status === 'number' && status >= 500) return { ok: false, reason: 'UNAVAILABLE' };
    return { ok: false, reason: 'REJECTED' };
  }

  const userId = String(result.data?.user?.id || '').trim();
  if (!userId) return { ok: false, reason: 'REJECTED' };

  return { ok: true, userId };
}
