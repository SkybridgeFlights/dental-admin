import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RLS architecture regression tests.
 *
 * Verified trust model (traced from production code):
 *   - every access to these tables uses createAdminClient() = service_role
 *   - the browser/session Supabase clients use the anon key for auth calls only
 *   - the Desktop app uses the anon key only against /auth/v1/* and reads
 *     licence state from the Render API, never from PostgREST
 * Therefore anon and authenticated must have NO access to any of these tables.
 */

const SUPABASE_DIR = join(import.meta.dirname, '..', 'supabase');
const APP_DIR = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(SUPABASE_DIR, f), 'utf8');

const SENSITIVE_TABLES = [
  'clinics', 'devices', 'licenses', 'profiles',
  'admin_audit_logs', 'device_request_nonces',
];

const stripComments = (sql: string) =>
  sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');

/** All CREATE POLICY statements across the whole applied schema. */
function allPolicies(): { table: string; name: string; body: string; file: string }[] {
  const out: { table: string; name: string; body: string; file: string }[] = [];
  for (const f of readdirSync(SUPABASE_DIR).filter((x) => x.endsWith('.sql'))) {
    if (/SUPERSEDED/i.test(read(f))) continue;
    const sql = stripComments(read(f));
    const re = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([a-z_][a-z0-9_]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const end = sql.indexOf(';', m.index);
      out.push({ name: m[1], table: m[2].toLowerCase(), file: f, body: sql.slice(m.index, end === -1 ? sql.length : end) });
    }
  }
  return out;
}

test('REGRESSION: no policy uses the inverted `auth.role() = \'anon\'` restrictive predicate', () => {
  for (const p of allPolicies()) {
    assert.ok(
      !/auth\.role\(\)\s*=\s*'anon'/i.test(p.body),
      `${p.file}: policy "${p.name}" on ${p.table} uses AS RESTRICTIVE USING (auth.role() = 'anon'). ` +
        `RESTRICTIVE policies are ANDed, so this passes the gate for anon and FAILS it for ` +
        `authenticated — the inverse of its intent.`,
    );
  }
});

test('every sensitive table carries a deny-all RESTRICTIVE policy', () => {
  const policies = allPolicies();
  for (const table of SENSITIVE_TABLES) {
    const denyAll = policies.filter(
      (p) => p.table === table && /AS\s+RESTRICTIVE/i.test(p.body) && /USING\s*\(\s*false\s*\)/i.test(p.body),
    );
    assert.ok(denyAll.length > 0, `table "${table}" has no deny-all RESTRICTIVE policy`);
  }
});

test('no PERMISSIVE policy grants anon or authenticated access to a sensitive table', () => {
  for (const p of allPolicies()) {
    if (!SENSITIVE_TABLES.includes(p.table)) continue;
    const isRestrictive = /AS\s+RESTRICTIVE/i.test(p.body);
    // A PERMISSIVE policy is only acceptable if it can never grant anything,
    // i.e. its USING clause is literally false. Anything else would open the
    // table to anon/authenticated, which the verified trust model forbids.
    const grantsNothing = /USING\s*\(\s*false\s*\)/i.test(p.body);
    assert.ok(
      isRestrictive || grantsNothing,
      `${p.file}: policy "${p.name}" on ${p.table} is PERMISSIVE with a non-false USING clause. ` +
        `The verified trust model requires deny-by-default; server code uses service_role which ` +
        `bypasses RLS, so no permissive grant is needed.`,
    );
  }
});

test('RLS is enabled on every sensitive table', () => {
  let combined = '';
  for (const f of readdirSync(SUPABASE_DIR).filter((x) => x.endsWith('.sql'))) {
    if (/SUPERSEDED/i.test(read(f))) continue;
    combined += stripComments(read(f)) + '\n';
  }
  for (const table of SENSITIVE_TABLES) {
    assert.match(
      combined,
      new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'),
      `RLS is never enabled on "${table}"`,
    );
  }
});

test('application code never reads sensitive tables with an anon-key client', () => {
  // The anon-key clients are createClient() in browser components and
  // createSessionClient(). Neither may call .from() on a sensitive table.
  const files = [
    'app/login/page.tsx',
    'app/reset-password/page.tsx',
    'app/dashboard/LogoutButton.tsx',
    'lib/auth/require-api-admin.ts',
    'lib/auth/require-admin.ts',
    'lib/supabase/server.ts',
  ];
  for (const rel of files) {
    let src: string;
    try { src = readFileSync(join(APP_DIR, rel), 'utf8'); } catch { continue; }
    for (const table of SENSITIVE_TABLES) {
      assert.ok(
        !new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)`).test(src),
        `${rel} reads "${table}" with an anon-key client; that access must go through service_role server code`,
      );
    }
  }
});

test('the service-role client is never imported by a client component', () => {
  const clientComponents = ['app/login/page.tsx', 'app/reset-password/page.tsx', 'app/dashboard/LogoutButton.tsx'];
  for (const rel of clientComponents) {
    let src: string;
    try { src = readFileSync(join(APP_DIR, rel), 'utf8'); } catch { continue; }
    assert.ok(!/createAdminClient/.test(src), `${rel} must never import createAdminClient (service_role)`);
    assert.ok(!/SERVICE_ROLE/.test(src), `${rel} must never reference the service-role key`);
  }
});
