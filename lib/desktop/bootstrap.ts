// Desktop identity bootstrap — pure logic.
//
// WHY THIS EXISTS
// The Electron Desktop used to read `GET /rest/v1/profiles?select=*,clinics!clinic_id(clinic_name)`
// directly with the end user's JWT. That required `profiles`/`clinics` to be
// readable by the `authenticated` role, which contradicts the deny-by-default
// RLS posture installed by migration 005. Rather than weakening RLS, the lookup
// moved behind this server endpoint, which uses `service_role` strictly
// server-side and returns a deliberately tiny projection.
//
// This module contains NO network or Supabase imports so the authorization and
// projection rules can be tested exhaustively and deterministically.
//
// SECURITY INVARIANTS (each is covered by test/desktop-bootstrap.test.ts):
//   1. The subject is ALWAYS the id carried by the verified access token.
//      Nothing the caller can write — query string, body, headers — may select
//      a different subject.
//   2. Only fields in RESPONSE_ALLOWLIST may leave this service. A future
//      column added to `profiles` (a token, a hash, a phone number) cannot leak
//      by accident, even if a query is later changed to `select=*`.
//   3. A failed read is never rendered as an answer. "Confirmed absent" and
//      "could not determine" are distinct outcomes, mirroring
//      lib/license/status.ts.

/** Result of a database read: success (with possibly-null row) or failure. */
export type QueryOutcome<T> = { ok: true; data: T | null } | { ok: false };

export function toOutcome<T>(result: { data: T | null; error: unknown }): QueryOutcome<T> {
  if (result.error) return { ok: false };
  return { ok: true, data: result.data ?? null };
}

/** The only `profiles` columns this endpoint is permitted to read. */
export const PROFILE_COLUMNS = ['id', 'status', 'clinic_id'] as const;

/** The only `clinics` columns this endpoint is permitted to read. */
export const CLINIC_COLUMNS = ['id', 'clinic_name'] as const;

export type ProfileRow = {
  id: string;
  status: string | null;
  clinic_id: string | null;
};

export type ClinicRow = {
  id: string;
  clinic_name: string | null;
};

/** Exact set of keys allowed in a success response body. */
export const RESPONSE_ALLOWLIST = {
  root: ['ok', 'profile', 'clinic'],
  profile: ['id', 'status', 'clinic_id'],
  clinic: ['id', 'clinic_name'],
} as const;

export type BootstrapBody = {
  ok: true;
  profile: { id: string; status: string; clinic_id: string | null };
  clinic: { id: string; clinic_name: string } | null;
};

export type BootstrapResult =
  | { ok: true; body: BootstrapBody }
  | { ok: false; status: number; code: BootstrapErrorCode };

/**
 * Deliberately coarse error codes. They describe what the *caller* should do,
 * never what exists in the database, so they cannot be used to probe state.
 */
export type BootstrapErrorCode =
  | 'UNAUTHENTICATED' // no/malformed/expired/invalid token
  | 'PROFILE_NOT_LINKED' // token is valid, but this user has no active profile
  | 'BOOTSTRAP_UNAVAILABLE'; // a required read failed — we refuse to guess

/**
 * Extract a bearer token. Returns null for anything that is not exactly one
 * `Bearer <token>` pair with a plausible JWT shape. Format checking here is a
 * cheap filter only — cryptographic validation is GoTrue's job.
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer[ ]([A-Za-z0-9._-]+)$/.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  // A JWT is three dot-separated base64url segments. Reject obvious junk before
  // spending a network round-trip on it.
  if (token.split('.').length !== 3) return null;
  if (token.length < 20 || token.length > 8192) return null;
  return token;
}

/**
 * Decide the response from an authenticated subject plus the two reads.
 *
 * `subjectUserId` MUST come from a verified token. This function has no
 * parameter through which a caller-supplied identity could enter — that is
 * enforced structurally, not by convention.
 */
export function resolveBootstrap(input: {
  subjectUserId: string;
  profile: QueryOutcome<ProfileRow>;
  /**
   * Clinic read. `undefined` means "not attempted because the profile carries
   * no clinic_id", which is a legitimate state, not a failure.
   */
  clinic?: QueryOutcome<ClinicRow>;
}): BootstrapResult {
  const subject = String(input.subjectUserId || '').trim();
  if (!subject) {
    // No verified subject ⇒ this is not an authenticated request at all.
    return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  }

  // A failed profile read must never degrade into "no profile".
  if (!input.profile.ok) {
    return { ok: false, status: 503, code: 'BOOTSTRAP_UNAVAILABLE' };
  }

  const profile = input.profile.data;
  if (!profile) {
    return { ok: false, status: 404, code: 'PROFILE_NOT_LINKED' };
  }

  // Defence in depth: the query filters on the subject, but if a future refactor
  // ever loosened that filter, returning another user's row would be a critical
  // data-boundary breach. Verify the identity we are about to emit.
  if (String(profile.id) !== subject) {
    return { ok: false, status: 503, code: 'BOOTSTRAP_UNAVAILABLE' };
  }

  const clinicId = emptyToNull(profile.clinic_id);

  let clinic: BootstrapBody['clinic'] = null;
  if (clinicId) {
    if (!input.clinic) {
      // clinic_id present but no read supplied — caller of this function is
      // internally inconsistent; refuse rather than emit a half answer.
      return { ok: false, status: 503, code: 'BOOTSTRAP_UNAVAILABLE' };
    }
    if (!input.clinic.ok) {
      return { ok: false, status: 503, code: 'BOOTSTRAP_UNAVAILABLE' };
    }
    const row = input.clinic.data;
    if (!row) {
      // Dangling FK: the profile points at a clinic that is not readable even
      // with service_role. Not a confirmed "no clinic" — refuse.
      return { ok: false, status: 503, code: 'BOOTSTRAP_UNAVAILABLE' };
    }
    if (String(row.id) !== clinicId) {
      return { ok: false, status: 503, code: 'BOOTSTRAP_UNAVAILABLE' };
    }
    const name = String(row.clinic_name ?? '').trim();
    clinic = { id: clinicId, clinic_name: name };
  }

  return {
    ok: true,
    body: {
      ok: true,
      profile: {
        id: profile.id,
        status: String(profile.status ?? '').trim().toLowerCase(),
        clinic_id: clinicId,
      },
      clinic,
    },
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Final egress filter. Rebuilds the body from the allowlist so that no field
 * can reach a client merely because it was present on a row object.
 */
export function projectBootstrapBody(body: BootstrapBody): BootstrapBody {
  return {
    ok: true,
    profile: {
      id: body.profile.id,
      status: body.profile.status,
      clinic_id: body.profile.clinic_id,
    },
    clinic: body.clinic ? { id: body.clinic.id, clinic_name: body.clinic.clinic_name } : null,
  };
}
