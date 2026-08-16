/**
 * Startup validation — runs once when the Next.js server boots via instrumentation.ts
 * Performs:
 *   1. Required env var presence check (fail-fast with explicit messages)
 *   2. Supabase project-ID cross-check (URL vs JWT ref)
 *   3. Lightweight Supabase connectivity ping
 *   4. Schema table existence check (clinics, devices, licenses)
 *
 * All output goes to the server terminal — never exposed to the browser.
 */

const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LICENSE_ED25519_PRIVATE_KEY',
  'LICENSE_SIGNING_KEY_ID',
  'ADMIN_EMAIL_WHITELIST',
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];

// ── helpers ──────────────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', msg: string) {
  const prefix = {
    info:  '[startup] ✅',
    warn:  '[startup] ⚠️ ',
    error: '[startup] ❌',
  }[level];
  console[level === 'info' ? 'info' : level](`${prefix} ${msg}`);
}

function jwtRef(jwt: string): string {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).ref ?? '';
  } catch {
    return '';
  }
}

// ── 1. Env var check ─────────────────────────────────────────────────────────

function checkEnvVars(): { ok: boolean; missing: RequiredVar[]; placeholder: string[] } {
  const missing: RequiredVar[]   = [];
  const placeholder: string[] = [];

  for (const key of REQUIRED_VARS) {
    const val = process.env[key];
    if (!val) {
      missing.push(key);
    } else if (val.startsWith('your-') || val.startsWith('replace-')) {
      placeholder.push(key);
    }
  }

  return { ok: missing.length === 0, missing, placeholder };
}

// ── 2. Project-ID cross-check ─────────────────────────────────────────────────

function checkProjectIds(): { ok: boolean; urlId: string; jwtId: string } {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const sr   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  const urlId  = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
  const anonId = jwtRef(anon);
  const srId   = jwtRef(sr);

  const ok = Boolean(urlId && urlId === anonId && anonId === srId);
  return { ok, urlId, jwtId: anonId };
}

// ── 3. Supabase connectivity ping ─────────────────────────────────────────────

async function pingSupabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Lightweight ping — query a system table that always exists
    const { error } = await client.from('clinics').select('id').limit(1);

    // "relation does not exist" means connected but schema not applied — still OK for ping
    if (error && !error.message.includes('relation') && !error.message.includes('does not exist')) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: String(err) };
  }
}

// ── 4. Schema table check ────────────────────────────────────────────────────

export const REQUIRED_TABLES = ['clinics', 'devices', 'licenses'] as const;
export type RequiredTable = (typeof REQUIRED_TABLES)[number];

/**
 * Recognises the many ways PostgREST/Supabase report a missing relation.
 * Postgres itself says `relation "public.x" does not exist` (SQLSTATE 42P01),
 * but PostgREST answers from its schema cache with wording like
 * `Could not find the table 'public.clinics' in the schema cache` (PGRST205),
 * which contains neither "relation" nor "does not exist". Matching only the
 * Postgres wording is what produced the false green.
 */
export function isMissingRelationError(message?: string | null, code?: string | null): boolean {
  const normalized = String(message ?? '').toLowerCase();
  const sqlState = String(code ?? '').toUpperCase();

  // SQLSTATE 42P01 = undefined_table; PGRST20x = PostgREST schema-cache lookup miss
  if (sqlState === '42P01' || /^PGRST20\d$/.test(sqlState)) return true;

  return (
    /relation .* does not exist/.test(normalized) ||
    normalized.includes('does not exist') ||
    normalized.includes('could not find the table') ||
    normalized.includes('could not find table') ||
    normalized.includes('in the schema cache') ||
    normalized.includes('schema cache') ||
    normalized.includes('undefined table') ||
    normalized.includes('unknown table') ||
    normalized.includes('no such table')
  );
}

export type TableProbe = { table: string; error?: { message?: string | null; code?: string | null } | null };

/**
 * Fail-closed evaluation. A table counts as verified ONLY when its probe came
 * back with no error at all. Anything else — a recognised missing-relation
 * error, a permission error, a network blip, an unparsable response — leaves
 * the table unverified. We never infer presence from an error we do not
 * recognise.
 */
export function evaluateSchemaResults(probes: TableProbe[], required: readonly string[] = REQUIRED_TABLES) {
  const verified: string[] = [];
  const missing: string[] = [];
  const unverifiable: { table: string; reason: string }[] = [];

  for (const table of required) {
    const probe = probes.find((p) => p.table === table);
    if (!probe) {
      unverifiable.push({ table, reason: 'no probe result' });
      continue;
    }
    if (!probe.error) {
      verified.push(table);
    } else if (isMissingRelationError(probe.error.message, probe.error.code)) {
      missing.push(table);
    } else {
      unverifiable.push({ table, reason: String(probe.error.message ?? 'unknown error') });
    }
  }

  return { ok: missing.length === 0 && unverifiable.length === 0, verified, missing, unverifiable };
}

async function checkSchema(): Promise<ReturnType<typeof evaluateSchemaResults>> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const probes: TableProbe[] = await Promise.all(
      REQUIRED_TABLES.map(async (table) => {
        const { error } = await client.from(table).select('*').limit(0);
        return { table, error: error ? { message: error.message, code: error.code } : null };
      }),
    );

    return evaluateSchemaResults(probes);
  } catch (err: unknown) {
    // Total failure to probe is itself fail-closed: nothing is verified.
    return evaluateSchemaResults(
      REQUIRED_TABLES.map((table) => ({ table, error: { message: String(err), code: null } })),
    );
  }
}

// ── 5. Whitelist display ──────────────────────────────────────────────────────

function logWhitelist() {
  const raw = process.env.ADMIN_EMAIL_WHITELIST ?? '';
  const emails = raw.split(',').map((e) => e.trim()).filter(Boolean);
  if (emails.length === 0) {
    log('warn', 'ADMIN_EMAIL_WHITELIST is empty — no one can log in');
  } else {
    log('info', `Admin whitelist configured (${emails.length} entries)`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function validateStartup(): Promise<void> {
  console.info('\n[startup] ─── DentalPro Admin startup checks ───────────────────');

  // 1. Env vars
  const env = checkEnvVars();
  if (env.missing.length > 0) {
    log('error', `Missing required env vars — add these to .env.local:\n         ${env.missing.join('\n         ')}`);
    log('error', 'Server will not function correctly until all env vars are set');
    if (process.env.NODE_ENV === 'production') throw new Error('SECURITY_CONFIGURATION_MISSING');
  } else {
    log('info', 'All required env vars are present');
  }

  if (env.placeholder.length > 0) {
    log('error', 'Security configuration contains placeholder values');
    if (process.env.NODE_ENV === 'production') throw new Error('SECURITY_CONFIGURATION_PLACEHOLDER');
  }

  // 2. Project ID cross-check
  if (env.missing.length === 0) {
    const ids = checkProjectIds();
    if (ids.ok) {
      log('info', `Supabase project ID confirmed: ${ids.urlId}`);
    } else {
      log('error', `Project ID mismatch — URL has "${ids.urlId}" but JWT has "${ids.jwtId}".\n         Fix NEXT_PUBLIC_SUPABASE_URL in .env.local and restart the server.`);
    }
  }

  // 3. Connectivity ping
  if (env.missing.length === 0) {
    const ping = await pingSupabase();
    if (ping.ok) {
      log('info', 'Supabase connection OK');
    } else {
      log('error', `Supabase connection failed: ${ping.error}`);
    }

    // 4. Schema check — fail-closed: only a clean probe counts as verified
    const schema = await checkSchema();
    if (schema.ok) {
      log('info', `Database schema verified (${schema.verified.join(', ')})`);
    } else {
      if (schema.missing.length > 0) {
        log('error', `Database schema not applied — missing tables: ${schema.missing.join(', ')}.\n         Run supabase/schema.sql in your Supabase SQL editor.`);
      }
      for (const { table, reason } of schema.unverifiable) {
        log('error', `Table "${table}" could not be verified: ${reason}`);
      }
      log('error', 'Schema verification failed — treating as NOT verified');
      if (process.env.NODE_ENV === 'production') throw new Error('SECURITY_SCHEMA_NOT_VERIFIED');
    }
  }

  // 5. Whitelist
  logWhitelist();

  console.info('[startup] ─────────────────────────────────────────────────────────\n');
}
