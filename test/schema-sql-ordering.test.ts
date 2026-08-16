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
  '005_rls_deny_by_default.sql',
];

/** Tables that must never be readable by the anon or authenticated roles. */
const SENSITIVE_TABLES = [
  'clinics', 'devices', 'licenses', 'profiles',
  'admin_audit_logs', 'device_request_nonces',
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

test('schema_profiles.sql creates the profiles table before any policy referencing it', () => {
  const sql = stripComments(read('schema_profiles.sql'));
  const table = createTableIndex(sql, 'profiles');
  assert.ok(table !== -1, 'schema_profiles.sql must create the profiles table');

  // Currently the policies are deny-all and reference nothing, so this may be
  // empty — the guarantee is that IF such a policy is added it must come after.
  for (const p of policyStatements(sql).filter((x) => /FROM\s+profiles\b/i.test(x.body))) {
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

  // It duplicates the profiles table (and historically the policy names) with
  // schema_profiles.sql, which is why only one of the two may be applied.
  const tables = (f: string) =>
    [...stripComments(read(f)).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1].toLowerCase());
  const overlap = tables('phase1_desktop_auth.sql').filter((t) => tables('schema_profiles.sql').includes(t));
  assert.ok(
    overlap.includes('profiles'),
    'expected the duplicated profiles table that justifies superseding phase1_desktop_auth.sql',
  );
});

test('REGRESSION: a view redefined by a later file must be dropped first', () => {
  // CREATE OR REPLACE VIEW can only APPEND columns. If a later file redefines a
  // view with a different column ORDER or with a new column inserted before an
  // existing one, Postgres fails with 42P16. schema.sql defines clinic_summary
  // ending in last_device_seen; schema_profiles.sql inserts user_count before
  // it, so it must DROP VIEW first. Caught empirically on a fresh schema.
  const defs = new Map<string, { file: string; cols: string[] }>();
  for (const file of APPLY_ORDER) {
    const sql = stripComments(read(file));
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([a-z_][a-z0-9_]*)\s+AS\s+SELECT([\s\S]*?);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const name = m[1].toLowerCase();
      // column aliases: "... AS alias" plus bare "c.col" projections
      const cols = [...m[2].matchAll(/\bAS\s+([a-z_][a-z0-9_]*)/gi)].map((x) => x[1].toLowerCase());
      const prev = defs.get(name);
      if (prev) {
        const sameOrder = prev.cols.every((c, i) => cols[i] === c);
        if (!sameOrder) {
          const dropped = new RegExp(`DROP\\s+VIEW\\s+(IF\\s+EXISTS\\s+)?${name}\\b`, 'i').test(sql);
          assert.ok(
            dropped,
            `${file} redefines view "${name}" with a changed column order but never drops it. ` +
              `CREATE OR REPLACE VIEW cannot reorder or rename columns — this fails with 42P16 ` +
              `on a fresh database. Add DROP VIEW IF EXISTS ${name}; before the definition.`,
          );
        }
      }
      defs.set(name, { file, cols });
    }
  }
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
