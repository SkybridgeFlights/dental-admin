import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_TABLES,
  isMissingRelationError,
  evaluateSchemaResults,
} from '../lib/startup/validate';

// ── The exact regression ─────────────────────────────────────────────────────
// PostgREST answers a missing table from its schema cache with wording that
// contains neither "relation" nor "does not exist". The old checker only
// matched the Postgres wording, so this message scored as VERIFIED while the
// connectivity ping simultaneously reported the table was absent.
test('REGRESSION: PostgREST schema-cache miss must not report verified', () => {
  const message = "Could not find the table 'public.clinics' in the schema cache";
  assert.equal(isMissingRelationError(message), true, 'must be recognised as missing');

  const result = evaluateSchemaResults([
    { table: 'clinics', error: { message, code: 'PGRST205' } },
    { table: 'devices', error: null },
    { table: 'licenses', error: null },
  ]);

  assert.equal(result.ok, false, 'schema must NOT be reported ok');
  assert.deepEqual(result.missing, ['clinics']);
  assert.ok(!result.verified.includes('clinics'));
});

test('recognises every documented missing-relation variant', () => {
  const variants = [
    'relation "public.clinics" does not exist',
    'table "devices" does not exist',
    "Could not find the table 'public.licenses' in the schema cache",
    'Could not find table public.clinics',
    'The schema cache is missing the table',
    'undefined table',
    'unknown table: clinics',
    'no such table: devices',
  ];
  for (const v of variants) {
    assert.equal(isMissingRelationError(v), true, `should flag: ${v}`);
  }
});

test('recognises missing-relation by SQLSTATE / PostgREST code alone', () => {
  assert.equal(isMissingRelationError('something opaque', '42P01'), true);
  assert.equal(isMissingRelationError('something opaque', 'PGRST205'), true);
  assert.equal(isMissingRelationError('something opaque', 'PGRST200'), true);
});

// ── Fail-closed guarantees ───────────────────────────────────────────────────

test('unrecognised errors fail closed rather than counting as verified', () => {
  const result = evaluateSchemaResults([
    { table: 'clinics', error: { message: 'permission denied for table clinics', code: '42501' } },
    { table: 'devices', error: null },
    { table: 'licenses', error: null },
  ]);
  assert.equal(result.ok, false, 'an unrecognised error must not pass');
  assert.equal(result.verified.includes('clinics'), false);
  assert.equal(result.unverifiable.length, 1);
});

test('a missing probe result fails closed', () => {
  const result = evaluateSchemaResults([{ table: 'clinics', error: null }]);
  assert.equal(result.ok, false, 'absent probes must not be assumed present');
  assert.equal(result.unverifiable.map((u) => u.table).sort().join(','), 'devices,licenses');
});

test('network/transport failure fails closed for every table', () => {
  const result = evaluateSchemaResults(
    REQUIRED_TABLES.map((table) => ({ table, error: { message: 'fetch failed', code: null } })),
  );
  assert.equal(result.ok, false);
  assert.equal(result.verified.length, 0);
});

test('only a clean probe on every required table reports ok', () => {
  const result = evaluateSchemaResults(REQUIRED_TABLES.map((table) => ({ table, error: null })));
  assert.equal(result.ok, true);
  assert.deepEqual(result.verified.slice().sort(), [...REQUIRED_TABLES].slice().sort());
  assert.equal(result.missing.length, 0);
  assert.equal(result.unverifiable.length, 0);
});

test('healthy strings are not misclassified as missing', () => {
  for (const v of ['', 'duplicate key value violates unique constraint', 'JWT expired']) {
    assert.equal(isMissingRelationError(v), false, `should not flag: ${v}`);
  }
});

test('required tables include clinics, devices and licenses', () => {
  for (const t of ['clinics', 'devices', 'licenses']) {
    assert.ok((REQUIRED_TABLES as readonly string[]).includes(t), `${t} must be required`);
  }
});
