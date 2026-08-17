import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bootstrapFaultTarget,
  forceFailure,
  parseBearerToken,
  projectBootstrapBody,
  resolveBootstrap,
  toOutcome,
  RESPONSE_ALLOWLIST,
  PROFILE_COLUMNS,
  CLINIC_COLUMNS,
  type ClinicRow,
  type ProfileRow,
  type QueryOutcome,
} from '../lib/desktop/bootstrap';

// Authorization and data-boundary proofs for the Desktop identity bootstrap
// endpoint that replaced the Desktop's direct PostgREST read of profiles/clinics.
//
// The numbered tests map 1:1 onto the required proof list.

const ROOT = join(import.meta.dirname, '..');
const ROUTE_SRC = readFileSync(join(ROOT, 'app/api/desktop/profile/route.ts'), 'utf8');
const TOKEN_SRC = readFileSync(join(ROOT, 'lib/desktop/access-token.ts'), 'utf8');
const LOGIC_SRC = readFileSync(join(ROOT, 'lib/desktop/bootstrap.ts'), 'utf8');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CLINIC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLINIC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const profileA: QueryOutcome<ProfileRow> = {
  ok: true,
  data: { id: USER_A, status: 'active', clinic_id: CLINIC_A },
};
const clinicA: QueryOutcome<ClinicRow> = {
  ok: true,
  data: { id: CLINIC_A, clinic_name: 'Clinic A' },
};
const FAILED = { ok: false as const };

// ── 1/2/3. token rejection ───────────────────────────────────────────────────

test('1. a request with no Authorization header cannot yield a subject', () => {
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken(''), null);
  assert.equal(parseBearerToken('   '), null);
  // and with no subject, resolution refuses
  const r = resolveBootstrap({ subjectUserId: '', profile: profileA, clinic: clinicA });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 401);
  assert.equal(!r.ok && r.code, 'UNAUTHENTICATED');
});

test('2. malformed authorization values are rejected before any network call', () => {
  const malformed = [
    'Basic abc',
    'Bearer',
    'Bearer ',
    'bearer', // no token
    'Bearer not-a-jwt',
    'Bearer a.b', // two segments
    'Bearer a.b.c.d', // four segments
    'Bearer short.a.b',
    'Bearer aaa.bbb.ccc extra', // trailing junk
    'Bearer aaa.bbb.ccc, Bearer ddd.eee.fff', // header smuggling
    `Bearer ${'x'.repeat(9000)}.y.z`, // oversized
    'Bearer abc\ndef.ghi.jkl', // header injection attempt
    'Bearer <script>.a.b',
    "Bearer ' OR 1=1--.a.b",
  ];
  for (const value of malformed) {
    assert.equal(parseBearerToken(value), null, `must reject: ${JSON.stringify(value)}`);
  }
});

test('2b. a well-formed bearer token is extracted verbatim, case-sensitively', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJlLXZhbHVl';
  assert.equal(parseBearerToken(`Bearer ${jwt}`), jwt);
  // lowercase scheme is not accepted — we require the RFC 6750 form we emit
  assert.equal(parseBearerToken(`bearer ${jwt}`), null);
});

test('3. expiry/revocation is delegated to GoTrue, not decided locally', () => {
  // An expired token is syntactically valid, so local parsing cannot and must
  // not adjudicate it. The guarantee we assert is architectural: verification
  // asks the identity provider, and any refusal collapses to a failure.
  assert.match(TOKEN_SRC, /auth\.getUser\(token\)/, 'must validate the token against GoTrue');
  assert.ok(
    !/jwt\.verify|jsonwebtoken|decodeJwt|atob\(/.test(TOKEN_SRC),
    'must not hand-roll local JWT validation',
  );
  assert.match(TOKEN_SRC, /if \(result\.error\)/, 'a GoTrue error must be handled');
  assert.match(TOKEN_SRC, /reason: 'REJECTED'/, 'a refused token must fail closed');
  // A 5xx from the IdP must not be treated as a valid or as an invalid token.
  assert.match(TOKEN_SRC, /status >= 500/, 'IdP outage must be distinguished from rejection');
});

test('3b. the route maps every non-availability token failure to a single 401', () => {
  assert.match(ROUTE_SRC, /fail\(401, 'UNAUTHENTICATED'\)/);
  // MISSING, MALFORMED and REJECTED must not be separately distinguishable —
  // differing responses would let a caller probe token validity.
  const distinct = ROUTE_SRC.match(/fail\(401, '[A-Z_]+'\)/g) ?? [];
  assert.equal(new Set(distinct).size, 1, 'all 401s must be identical to the client');
});

// ── 4. valid user gets own data ──────────────────────────────────────────────

test('4. a valid subject receives exactly its own profile and clinic', () => {
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: profileA, clinic: clinicA });
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  assert.equal(r.body.profile.id, USER_A);
  assert.equal(r.body.profile.status, 'active');
  assert.equal(r.body.profile.clinic_id, CLINIC_A);
  assert.equal(r.body.clinic?.id, CLINIC_A);
  assert.equal(r.body.clinic?.clinic_name, 'Clinic A');
});

test('4b. a profile without a clinic link resolves with clinic = null, not an error', () => {
  const r = resolveBootstrap({
    subjectUserId: USER_A,
    profile: { ok: true, data: { id: USER_A, status: 'active', clinic_id: null } },
  });
  assert.ok(r.ok);
  assert.equal(r.body.clinic, null);
  assert.equal(r.body.profile.clinic_id, null);
});

test('4c. inactive status is reported faithfully rather than masked', () => {
  // The Desktop enforces ACCOUNT_INACTIVE; the server must not silently
  // upgrade or hide a non-active status.
  const r = resolveBootstrap({
    subjectUserId: USER_A,
    profile: { ok: true, data: { id: USER_A, status: 'INACTIVE', clinic_id: null } },
  });
  assert.ok(r.ok);
  assert.equal(r.body.profile.status, 'inactive');
});

// ── 5. cannot select another subject ─────────────────────────────────────────

test('5. the subject cannot be influenced by any caller-supplied value', () => {
  // Structural proof: the route reads no request input other than the header
  // consumed by token verification.
  const forbidden: [RegExp, string][] = [
    [/searchParams/, 'query-string parameters'],
    [/nextUrl/, 'URL inspection'],
    [/new URL\(/, 'URL parsing'],
    [/request\.json\(\)/, 'a request body'],
    [/request\.text\(\)/, 'a request body'],
    [/formData\(/, 'form data'],
    [/user_id|userId\s*=\s*request|x-user-id/i, 'a caller-supplied user id'],
  ];
  for (const [re, what] of forbidden) {
    assert.ok(!re.test(ROUTE_SRC), `route must not read ${what}`);
  }
  // The only filter value is the verified subject.
  assert.match(ROUTE_SRC, /\.eq\('id', userId\)/, 'profile lookup must filter on the verified subject');
  assert.match(ROUTE_SRC, /const userId = subject\.userId/, 'subject must come from token verification');
});

test('5b. resolution refuses if a returned row does not belong to the subject', () => {
  // Defence in depth: if a future refactor loosened the query filter, emitting
  // another user's row would be a critical breach. It must fail closed instead.
  const r = resolveBootstrap({
    subjectUserId: USER_A,
    profile: { ok: true, data: { id: USER_B, status: 'active', clinic_id: CLINIC_B } },
    clinic: { ok: true, data: { id: CLINIC_B, clinic_name: 'Clinic B' } },
  });
  assert.equal(r.ok, false, "another user's row must never be emitted");
  assert.equal(!r.ok && r.status, 503);
  // and specifically it must not leak the other identity in the error
  assert.ok(!JSON.stringify(r).includes(USER_B));
  assert.ok(!JSON.stringify(r).includes(CLINIC_B));
});

test('5c. the resolver has no parameter through which a caller identity can enter', () => {
  // resolveBootstrap accepts exactly: subjectUserId, profile, clinic.
  const signature = /resolveBootstrap\(input: \{\s*subjectUserId: string;/;
  assert.match(LOGIC_SRC, signature);
});

// ── 6. cannot obtain another clinic's data ───────────────────────────────────

test("6. a clinic row that does not match the profile's clinic_id is refused", () => {
  const r = resolveBootstrap({
    subjectUserId: USER_A,
    profile: profileA, // clinic_id = CLINIC_A
    clinic: { ok: true, data: { id: CLINIC_B, clinic_name: 'Clinic B' } },
  });
  assert.equal(r.ok, false, 'a mismatched clinic must never be emitted');
  assert.ok(!JSON.stringify(r).includes('Clinic B'));
});

test('6b. the clinic read is keyed off the profile row, never off caller input', () => {
  assert.match(
    ROUTE_SRC,
    /const clinicId =\s*profile\.ok && profile\.data \? String\(profile\.data\.clinic_id \|\| ''\)\.trim\(\) : '';/,
    'clinic id must be derived from the fetched profile row',
  );
  assert.match(ROUTE_SRC, /\.eq\('id', clinicId\)/);
});

test('6c. two different subjects never resolve to each other', () => {
  const a = resolveBootstrap({ subjectUserId: USER_A, profile: profileA, clinic: clinicA });
  const b = resolveBootstrap({
    subjectUserId: USER_B,
    profile: { ok: true, data: { id: USER_B, status: 'active', clinic_id: CLINIC_B } },
    clinic: { ok: true, data: { id: CLINIC_B, clinic_name: 'Clinic B' } },
  });
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.body.profile.id, b.body.profile.id);
  assert.notEqual(a.body.clinic?.id, b.body.clinic?.id);
  assert.ok(!JSON.stringify(a.body).includes(USER_B));
  assert.ok(!JSON.stringify(b.body).includes(USER_A));
});

// ── 7. missing profile link fails safely ─────────────────────────────────────

test('7. a valid token with no profile row yields 404, not a fabricated identity', () => {
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: { ok: true, data: null } });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 404);
  assert.equal(!r.ok && r.code, 'PROFILE_NOT_LINKED');
});

test('7b. a dangling clinic FK is unavailable, never silently clinic-less', () => {
  // profile.clinic_id points at a clinic that does not resolve. Emitting
  // clinic:null here would let the Desktop fall through to a weaker clinic
  // match, so it must refuse instead.
  const r = resolveBootstrap({
    subjectUserId: USER_A,
    profile: profileA,
    clinic: { ok: true, data: null },
  });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 'BOOTSTRAP_UNAVAILABLE');
});

test('7c. a clinic_id present with no clinic read attempted is refused', () => {
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: profileA /* clinic omitted */ });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 'BOOTSTRAP_UNAVAILABLE');
});

// ── 8. backend failure → unavailable, never fabricated ───────────────────────

test('8. a failed profile read is unavailable, never "no profile"', () => {
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: FAILED });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 503);
  assert.equal(!r.ok && r.code, 'BOOTSTRAP_UNAVAILABLE');
  assert.notEqual(!r.ok && r.code, 'PROFILE_NOT_LINKED');
});

test('8b. a failed clinic read is unavailable, never clinic-less success', () => {
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: profileA, clinic: FAILED });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 'BOOTSTRAP_UNAVAILABLE');
});

test('8c. no combination of failed reads ever produces a success body', () => {
  const profiles: QueryOutcome<ProfileRow>[] = [FAILED, profileA, { ok: true, data: null }];
  const clinics: (QueryOutcome<ClinicRow> | undefined)[] = [FAILED, clinicA, { ok: true, data: null }, undefined];
  for (const p of profiles) {
    for (const c of clinics) {
      const r = resolveBootstrap({ subjectUserId: USER_A, profile: p, clinic: c });
      if (!p.ok || (p.ok && p.data && c && !c.ok)) {
        assert.equal(r.ok, false, 'a failed read must never be classified as an answer');
      }
      if (r.ok) {
        // any success must be internally consistent
        assert.equal(r.body.profile.id, USER_A);
      }
    }
  }
});

test('8d. toOutcome separates "confirmed absent" from "query failed"', () => {
  assert.deepEqual(toOutcome({ data: null, error: null }), { ok: true, data: null });
  assert.deepEqual(toOutcome({ data: null, error: { message: 'boom' } }), { ok: false });
  assert.deepEqual(toOutcome({ data: null, error: { code: '42501' } }), { ok: false });
  assert.deepEqual(toOutcome({ data: { id: 'x' }, error: null }), { ok: true, data: { id: 'x' } });
});

// ── 9. response contains only allowed fields ─────────────────────────────────

test('9. the emitted body contains exactly the allowlisted keys', () => {
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: profileA, clinic: clinicA });
  assert.ok(r.ok);
  const body = projectBootstrapBody(r.body);
  assert.deepEqual(Object.keys(body).sort(), [...RESPONSE_ALLOWLIST.root].sort());
  assert.deepEqual(Object.keys(body.profile).sort(), [...RESPONSE_ALLOWLIST.profile].sort());
  assert.deepEqual(Object.keys(body.clinic!).sort(), [...RESPONSE_ALLOWLIST.clinic].sort());
});

test('9b. extra columns on a row cannot ride along into the response', () => {
  // Simulates a future migration adding sensitive columns to profiles/clinics.
  const contaminated = {
    ok: true as const,
    data: {
      id: USER_A,
      status: 'active',
      clinic_id: CLINIC_A,
      email: 'owner@example.com',
      password_hash: '$2b$12$deadbeef',
      recovery_token: 'tok_secret',
      preferred_language: 'ar',
    } as unknown as ProfileRow,
  };
  const contaminatedClinic = {
    ok: true as const,
    data: {
      id: CLINIC_A,
      clinic_name: 'Clinic A',
      owner_phone: '+100000000',
      credential_hash: 'abc123',
    } as unknown as ClinicRow,
  };
  const r = resolveBootstrap({
    subjectUserId: USER_A,
    profile: contaminated,
    clinic: contaminatedClinic,
  });
  assert.ok(r.ok);
  const serialized = JSON.stringify(projectBootstrapBody(r.body));
  for (const leak of [
    'owner@example.com',
    'password_hash',
    '$2b$12$deadbeef',
    'recovery_token',
    'tok_secret',
    'preferred_language',
    'owner_phone',
    'credential_hash',
  ]) {
    assert.ok(!serialized.includes(leak), `response must not contain ${leak}`);
  }
});

test('9c. the database reads request an explicit column list, never select(*)', () => {
  assert.ok(!/select\(\s*['"`]\*/.test(ROUTE_SRC), 'the endpoint must never select *');
  assert.match(ROUTE_SRC, /PROFILE_COLUMNS\.join/);
  assert.match(ROUTE_SRC, /CLINIC_COLUMNS\.join/);
  assert.deepEqual([...PROFILE_COLUMNS], ['id', 'status', 'clinic_id']);
  assert.deepEqual([...CLINIC_COLUMNS], ['id', 'clinic_name']);
  // the projected columns and the allowlist must not drift apart
  assert.deepEqual([...PROFILE_COLUMNS].sort(), [...RESPONSE_ALLOWLIST.profile].sort());
  assert.deepEqual([...CLINIC_COLUMNS].sort(), [...RESPONSE_ALLOWLIST.clinic].sort());
});

// ── 10. no secret material may appear in a response ──────────────────────────

test('10. no response path can carry service-role or signing-key material', () => {
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: profileA, clinic: clinicA });
  assert.ok(r.ok);
  const serialized = JSON.stringify(projectBootstrapBody(r.body));
  for (const secret of [
    'service_role',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LICENSE_ED25519_PRIVATE_KEY',
    'BEGIN PRIVATE KEY',
    'ADMIN_EMAIL_WHITELIST',
    'eyJ', // any JWT-looking value
  ]) {
    assert.ok(!serialized.includes(secret), `response must not contain ${secret}`);
  }
});

test('10b. the route never serialises an environment value or an error object', () => {
  assert.ok(!/process\.env/.test(ROUTE_SRC), 'the route must not read env directly');
  assert.ok(
    !/NextResponse\.json\([^)]*error[^)]*\)/.test(ROUTE_SRC),
    'raw error objects must never be returned to the client',
  );
  // failures are emitted only through the single generic helper
  const jsonCalls = ROUTE_SRC.match(/NextResponse\.json\(/g) ?? [];
  assert.equal(jsonCalls.length, 2, 'exactly one success body and one generic failure body');
});

test('10c. the service_role client is used only after the subject is verified', () => {
  const verifyAt = ROUTE_SRC.indexOf('verifyRequestSubject(request)');
  const adminAt = ROUTE_SRC.indexOf('createAdminClient()');
  assert.ok(verifyAt !== -1 && adminAt !== -1);
  assert.ok(verifyAt < adminAt, 'identity must be established before service_role is touched');
  // and the unauthenticated branch must return before reaching it
  const guardAt = ROUTE_SRC.indexOf("fail(401, 'UNAUTHENTICATED')");
  assert.ok(guardAt < adminAt, 'the 401 guard must precede any privileged client use');
});

test('10d. token verification uses the anon key, never the service-role key', () => {
  assert.match(TOKEN_SRC, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.ok(
    !/SERVICE_ROLE/.test(TOKEN_SRC),
    'the service-role key must play no part in verifying a caller identity',
  );
});

// ── endpoint classification: this is not an admin endpoint ───────────────────

/** Remove // and /* *\/ comments so documentation prose is not mistaken for code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

test('the bootstrap endpoint does not consult the admin whitelist', () => {
  // Explicit owner requirement: this is a Desktop user identity endpoint, so
  // gating it on the admin whitelist would lock out every real clinic user.
  // Checked against code with comments stripped — the route documents in prose
  // that it deliberately does not use it.
  for (const src of [ROUTE_SRC, TOKEN_SRC, LOGIC_SRC]) {
    const bare = code(src);
    assert.ok(!/ADMIN_EMAIL_WHITELIST/.test(bare), 'no code path may read the admin whitelist');
    assert.ok(!/requireApiAdmin|requireAdmin|authorizeAdminEmail/.test(bare));
  }
});

// ── staging fault injection safety ───────────────────────────────────────────

test('fault injection is inert unless explicitly armed', () => {
  const req = (v: string) => ({ headers: { get: () => v } });
  for (const target of ['profiles', 'clinics', 'devices', 'anything']) {
    assert.equal(
      bootstrapFaultTarget(req(target), false), null,
      `must be inert when disarmed (target=${target})`,
    );
  }
});

test('fault injection accepts only the two known targets when armed', () => {
  const req = (v: string | null) => ({ headers: { get: () => v } });
  assert.equal(bootstrapFaultTarget(req('profiles'), true), 'profiles');
  assert.equal(bootstrapFaultTarget(req('clinics'), true), 'clinics');
  assert.equal(bootstrapFaultTarget(req('devices'), true), null);
  assert.equal(bootstrapFaultTarget(req('__proto__'), true), null);
  assert.equal(bootstrapFaultTarget(req(null), true), null, 'absent header must be inert');
});

test('an injected fault can only ever reduce availability', () => {
  assert.deepEqual(forceFailure({ ok: true, data: { id: 'x' } }), { ok: false });
  assert.deepEqual(forceFailure({ ok: false }), { ok: false });
  // and a forced failure must produce 503, never a 200 or a 404
  const r = resolveBootstrap({ subjectUserId: USER_A, profile: forceFailure(profileA) });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 503);
});

test('fault injection is evaluated only after authentication', () => {
  const authAt = ROUTE_SRC.indexOf('verifyRequestSubject(request)');
  const guardAt = ROUTE_SRC.indexOf("fail(401, 'UNAUTHENTICATED')");
  const faultAt = ROUTE_SRC.indexOf('bootstrapFaultTarget(request');
  assert.ok(authAt !== -1 && guardAt !== -1 && faultAt !== -1);
  assert.ok(authAt < faultAt, 'authentication must precede fault evaluation');
  assert.ok(
    guardAt < faultAt,
    'the 401 guard must precede fault evaluation so it cannot be an unauthenticated probe',
  );
  // and it must be gated on the shared armed check, not its own looser rule
  assert.match(ROUTE_SRC, /bootstrapFaultTarget\(request, isFaultInjectionArmed\(\)\)/);
});

test('RLS must never be opened to accommodate the Desktop bootstrap', () => {
  // The whole point of this endpoint is that `profiles`/`clinics` stay closed to
  // the `authenticated` role. If a future change makes the Desktop read them
  // directly again, that must break loudly here rather than be "fixed" by
  // granting a permissive SELECT policy.
  const sql = readFileSync(join(ROOT, 'supabase/005_rls_deny_by_default.sql'), 'utf8');
  const bare = sql.replace(/^\s*--.*$/gm, '');

  for (const table of ['profiles', 'clinics']) {
    assert.match(
      bare,
      new RegExp(`CREATE\\s+POLICY\\s+"?deny_all"?\\s+ON\\s+(public\\.)?${table}\\b`, 'i'),
      `${table} must keep its deny_all policy`,
    );
  }
  assert.match(bare, /AS\s+RESTRICTIVE/i);
  assert.ok(!/USING\s*\(\s*true\s*\)/i.test(bare), 'deny_all must never be relaxed to USING (true)');
  assert.ok(
    !/TO\s+authenticated/i.test(bare),
    'no policy in 005 may target the authenticated role',
  );

  // And the Desktop must not be reintroducing a PostgREST path of its own.
  assert.ok(!/rest\/v1/.test(ROUTE_SRC));
});

test('the endpoint is not cacheable and exposes only GET/OPTIONS', () => {
  assert.match(ROUTE_SRC, /'Cache-Control': 'no-store'/);
  assert.match(ROUTE_SRC, /Allow: 'GET, OPTIONS'/);
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE_SRC));
});
