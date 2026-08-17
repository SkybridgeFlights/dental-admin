import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyRequestSubject } from '@/lib/desktop/access-token';
import {
  CLINIC_COLUMNS,
  PROFILE_COLUMNS,
  bootstrapFaultTarget,
  forceFailure,
  projectBootstrapBody,
  resolveBootstrap,
  toOutcome,
  type ClinicRow,
  type ProfileRow,
  type QueryOutcome,
} from '@/lib/desktop/bootstrap';
import { isFaultInjectionArmed } from '@/lib/license/status';

// GET /api/desktop/profile
//
// Desktop identity bootstrap. Replaces the Desktop's former direct PostgREST
// read of `profiles`/`clinics`, which is denied by the deny-by-default RLS
// installed in migration 005 and must stay denied.
//
// Contract:
//   Request : Authorization: Bearer <supabase user access token>.  No body,
//             no parameters.  Any query string is ignored entirely.
//   Success : 200 { ok, profile:{id,status,clinic_id}, clinic:{id,clinic_name}|null }
//   Failure : 401 UNAUTHENTICATED | 404 PROFILE_NOT_LINKED
//             503 BOOTSTRAP_UNAVAILABLE
//
// This is NOT an admin endpoint and deliberately does not consult
// ADMIN_EMAIL_WHITELIST: every legitimate clinic user must be able to bootstrap
// their own identity, while only ever seeing their own row.

export const dynamic = 'force-dynamic';

const ROUTE = '/api/desktop/profile';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: 'GET, OPTIONS' } });
}

export async function GET(request: Request) {
  const subject = await verifyRequestSubject(request);

  if (!subject.ok) {
    if (subject.reason === 'UNAVAILABLE') {
      console.warn('[desktop-bootstrap] identity provider unavailable', { route: ROUTE });
      return fail(503, 'BOOTSTRAP_UNAVAILABLE');
    }
    // MISSING / MALFORMED / REJECTED all collapse to one client-visible answer.
    console.info('[desktop-bootstrap] rejected', { route: ROUTE, reason: subject.reason });
    return fail(401, 'UNAUTHENTICATED');
  }

  const userId = subject.userId;
  const admin = createAdminClient();

  // Staging-only, and evaluated strictly AFTER authentication so it can never
  // be used as an unauthenticated probe.
  const fault = bootstrapFaultTarget(request, isFaultInjectionArmed());

  // Identity comes from the verified token only. There is no code path by which
  // a query-string or body value could reach this filter.
  let profile = toOutcome<ProfileRow>(
    (await admin
      .from('profiles')
      .select(PROFILE_COLUMNS.join(', '))
      .eq('id', userId)
      .maybeSingle()) as { data: ProfileRow | null; error: unknown },
  );
  if (fault === 'profiles') profile = forceFailure(profile);

  let clinic: QueryOutcome<ClinicRow> | undefined;
  const clinicId =
    profile.ok && profile.data ? String(profile.data.clinic_id || '').trim() : '';

  if (clinicId) {
    clinic = toOutcome<ClinicRow>(
      (await admin
        .from('clinics')
        .select(CLINIC_COLUMNS.join(', '))
        .eq('id', clinicId)
        .maybeSingle()) as { data: ClinicRow | null; error: unknown },
    );
    if (fault === 'clinics') clinic = forceFailure(clinic);
  }

  const resolved = resolveBootstrap({ subjectUserId: userId, profile, clinic });

  if (!resolved.ok) {
    console.info('[desktop-bootstrap] not served', {
      route: ROUTE,
      code: resolved.code,
      status: resolved.status,
    });
    return fail(resolved.status, resolved.code);
  }

  console.info('[desktop-bootstrap] served', {
    route: ROUTE,
    hasClinic: Boolean(resolved.body.clinic),
    profileStatus: resolved.body.profile.status,
  });

  // Rebuild from the allowlist so nothing extra can ride along.
  return NextResponse.json(projectBootstrapBody(resolved.body), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function fail(status: number, code: string) {
  return NextResponse.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
