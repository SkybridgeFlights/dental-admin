/**
 * License status classification.
 *
 * SECURITY INVARIANT
 * ------------------
 * A licence may be reported `revoked` ONLY when the backend successfully
 * established the state required to classify it as revoked. A failed query
 * must never be classified — it degrades to STATUS_UNAVAILABLE.
 *
 * The previous implementation destructured `{ data: license }` from the
 * licences query and discarded its `error`. A transient failure therefore
 * produced `license === undefined`, which fell into the `!license` branch and
 * reported `revoked`. A database outage would have told every device in the
 * field that it had been revoked. This module makes the distinction between
 * "confirmed absent" and "could not be determined" explicit and unavoidable in
 * the type system.
 */

/**
 * The outcome of a status-critical read.
 * `ok: true` means the query SUCCEEDED; `data: null` is then a confirmed
 * absence (a real "no row" answer). `ok: false` means the query FAILED and
 * nothing may be concluded from it.
 */
export type QueryOutcome<T> = { ok: true; data: T | null } | { ok: false };

export type DeviceRow = { status: string };
export type ClinicRow = { status: string; expires_at: string };
export type LicenseRow = { revoked_at: string | null; expires_at: string };

export type LicenseStatus = 'active' | 'expired' | 'revoked';

export type Classification =
  | { ok: true; status: LicenseStatus; expiryDate: string }
  | { ok: false; reason: 'STATUS_UNAVAILABLE' };

const UNAVAILABLE = { ok: false as const, reason: 'STATUS_UNAVAILABLE' as const };

/**
 * Wrap a supabase-js `{ data, error }` result into a QueryOutcome.
 * Any error at all — network, PostgREST, permission, malformed — is a failure.
 */
export function toOutcome<T>(result: { data: T | null; error: unknown }): QueryOutcome<T> {
  if (result.error) return { ok: false };
  return { ok: true, data: result.data ?? null };
}

/**
 * Pure classifier. Every status-critical input is a QueryOutcome, so a caller
 * cannot accidentally pass an undefined row that came from a failed query.
 */
export function classifyLicenseStatus(input: {
  device: DeviceRow;
  clinic: QueryOutcome<ClinicRow>;
  license: QueryOutcome<LicenseRow>;
  now?: Date;
}): Classification {
  const now = input.now ?? new Date();

  // 1. Clinic read must have succeeded AND returned a row. A device row always
  //    references a clinic via FK, so a missing clinic is an inconsistent
  //    backend, not a revocation.
  if (!input.clinic.ok) return UNAVAILABLE;
  const clinic = input.clinic.data;
  if (!clinic) return UNAVAILABLE;

  // 2. Licence read must have SUCCEEDED. A null row here is a confirmed
  //    absence and is meaningful; a failed query is not.
  if (!input.license.ok) return UNAVAILABLE;
  const license = input.license.data;

  const expiryDate = license?.expires_at || clinic.expires_at;

  // 3. Confirmed revocation states.
  //    - the device itself is revoked/blocked
  //    - the clinic is suspended
  //    - the device has no non-revoked licence (confirmed absence)
  if (['revoked', 'blocked'].includes(input.device.status)) {
    return { ok: true, status: 'revoked', expiryDate };
  }
  if (clinic.status === 'suspended') {
    return { ok: true, status: 'revoked', expiryDate };
  }
  if (!license) {
    return { ok: true, status: 'revoked', expiryDate };
  }

  // 4. Confirmed expiry.
  if (clinic.status === 'inactive' || new Date(license.expires_at) < now) {
    return { ok: true, status: 'expired', expiryDate };
  }

  // 5. Confirmed active.
  return { ok: true, status: 'active', expiryDate };
}

/**
 * STAGING-ONLY fault injection for the backend-unavailable regression test.
 *
 * Guarantees:
 *  - inert unless DENTALPRO_ENVIRONMENT === 'staging' (so unreachable in prod)
 *  - stateless: driven by a per-request header, nothing persists, so it cannot
 *    accidentally remain enabled
 *  - callers apply it only AFTER device authentication has already succeeded,
 *    so it grants no access and weakens no authentication
 *  - it can only turn a successful read into a *failure*, never the reverse,
 *    so it can never manufacture access or a more permissive status
 */
export function stagingFaultTarget(request: { headers: { get(name: string): string | null } }): string | null {
  if (process.env.DENTALPRO_ENVIRONMENT !== 'staging') return null;
  const target = request.headers.get('x-staging-fault-injection');
  return target === 'licenses' || target === 'clinics' ? target : null;
}

/** Force an outcome to failure. Only ever narrows availability. */
export function forceFailure<T>(_outcome: QueryOutcome<T>): QueryOutcome<T> {
  return { ok: false };
}
