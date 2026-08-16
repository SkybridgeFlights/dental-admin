import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Static, deterministic validation of the SQL files. Postgres validates a
// policy expression at CREATE POLICY time, so any object referenced inside a
// policy must already exist. A previous revision of schema_profiles.sql
// created policies selecting FROM profiles before CREATE TABLE profiles and
// failed on every fresh database with 42P01.

const SUPABASE_DIR = join(import.meta.dirname, '..', 'supabase');
const read = (f: string) => readFileSync(join(SUPABASE_DIR, f), 'utf8');

/** Strip line comments so commented-out SQL never counts as a statement. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

/** Index of `CREATE TABLE [IF NOT EXISTS] <name>`, or -1. */
function createTableIndex(sql: string, table: string): number {
  return sql.search(new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${table}\\b`, 'i'));
}

/** Every `CREATE POLICY` statement, with its offset and body up to the next statement. */
function policyStatements(sql: string): { index: number; body: string }[] {
  const out: { index: number; body: string }[] = [];
  const re = /CREATE\s+POLICY\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const end = sql.indexOf(';', m.index);
    out.push({ index: m.index, body: sql.slice(m.index, end === -1 ? sql.length : end) });
  }
  return out;
}

const APPLY_ORDER = [
  'schema.sql',
  'schema_profiles.sql',
  '003_audit_log.sql',
  '004_device_auth_and_atomic_license.sql',
];

test('REGRESSION: no policy references a table created later in the same file', () => {
  for (const file of APPLY_ORDER) {
    const sql = stripComments(read(file));
    for (const { index, body } of policyStatements(sql)) {
      // tables referenced inside the policy expression
      for (const ref of body.matchAll(/\bFROM\s+([a-z_][a-z0-9_]*)/gi)) {
        const table = ref[1].toLowerCase();
        const created = createTableIndex(sql, table);
        if (created === -1) continue; // created in an earlier file — checked below
        assert.ok(
          created < index,
          `${file}: policy references "${table}" at offset ${index} but ` +
            `CREATE TABLE ${table} appears later at ${created}. ` +
            `Postgres validates policy expressions at CREATE time — this fails with 42P01.`,
        );
      }
    }
  }
});

test('schema_profiles.sql creates the profiles table before its dependent policies', () => {
  const sql = stripComments(read('schema_profiles.sql'));
  const table = createTableIndex(sql, 'profiles');
  assert.ok(table !== -1, 'schema_profiles.sql must create the profiles table');

  const dependent = policyStatements(sql).filter((p) => /FROM\s+profiles\b/i.test(p.body));
  assert.ok(dependent.length >= 2, 'expected clinics_own_read and devices_clinic_read');
  for (const p of dependent) {
    assert.ok(table < p.index, 'profiles table must be created before policies that select from it');
  }
});

test('policies referencing a table from an earlier file are satisfied by apply order', () => {
  // Build the set of tables that exist by the time each file runs.
  const existing = new Set<string>();
  for (const file of APPLY_ORDER) {
    const sql = stripComments(read(file));
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      existing.add(m[1].toLowerCase());
    }
    for (const { body } of policyStatements(sql)) {
      for (const ref of body.matchAll(/\bFROM\s+([a-z_][a-z0-9_]*)/gi)) {
        const table = ref[1].toLowerCase();
        assert.ok(
          existing.has(table),
          `${file}: policy references "${table}", which no file up to and including ` +
            `${file} creates. Apply order is ${APPLY_ORDER.join(' -> ')}.`,
        );
      }
    }
  }
});

test('RLS is enabled on every table the apply order creates', () => {
  const created = new Set<string>();
  const rlsEnabled = new Set<string>();
  for (const file of APPLY_ORDER) {
    const sql = stripComments(read(file));
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      created.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
      rlsEnabled.add(m[1].toLowerCase());
    }
  }
  for (const t of created) {
    assert.ok(rlsEnabled.has(t), `table "${t}" is created but never has RLS enabled`);
  }
});

test('policies are not silently weakened to USING (true)', () => {
  for (const file of APPLY_ORDER) {
    const sql = stripComments(read(file));
    for (const { body } of policyStatements(sql)) {
      assert.ok(
        !/USING\s*\(\s*true\s*\)/i.test(body),
        `${file}: a policy uses USING (true), which grants unrestricted access`,
      );
    }
  }
});

test('phase1_desktop_auth.sql is marked superseded and excluded from apply order', () => {
  const raw = read('phase1_desktop_auth.sql');
  assert.match(raw, /SUPERSEDED/i, 'must be clearly marked superseded');
  assert.ok(!APPLY_ORDER.includes('phase1_desktop_auth.sql'), 'must not be in the apply order');

  // It duplicates policy names with schema_profiles.sql; applying both fails.
  const names = (f: string) =>
    [...stripComments(read(f)).matchAll(/CREATE\s+POLICY\s+"([^"]+)"/gi)].map((m) => m[1]);
  const overlap = names('phase1_desktop_auth.sql').filter((n) => names('schema_profiles.sql').includes(n));
  assert.ok(overlap.length > 0, 'expected the duplicate policy names that justify superseding');
});

test('every .sql file in supabase/ is either in the apply order or marked superseded', () => {
  for (const f of readdirSync(SUPABASE_DIR).filter((f) => f.endsWith('.sql'))) {
    if (APPLY_ORDER.includes(f)) continue;
    assert.match(
      read(f),
      /SUPERSEDED/i,
      `${f} is neither in the documented apply order nor marked superseded`,
    );
  }
});
