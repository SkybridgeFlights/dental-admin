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
  'LICENSE_HMAC_SECRET',
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
    } else if (key === 'LICENSE_HMAC_SECRET' && val === 'your-hmac-secret') {
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

async function checkSchema(): Promise<{ ok: boolean; missing: string[] }> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const tables = ['clinics', 'devices', 'licenses'] as const;
    const missing: string[] = [];

    await Promise.all(
      tables.map(async (table) => {
        const { error } = await client.from(table).select('*').limit(0);
        if (error?.message.includes('does not exist') || error?.message.includes('relation')) {
          missing.push(table);
        }
      }),
    );

    return { ok: missing.length === 0, missing };
  } catch (err: unknown) {
    return { ok: false, missing: ['clinics', 'devices', 'licenses'] };
  }
}

// ── 5. Whitelist display ──────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length <= 2 ? '***' : `${local[0]}***${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}

function logWhitelist() {
  const raw = process.env.ADMIN_EMAIL_WHITELIST ?? '';
  const emails = raw.split(',').map((e) => e.trim()).filter(Boolean);
  if (emails.length === 0) {
    log('warn', 'ADMIN_EMAIL_WHITELIST is empty — no one can log in');
  } else {
    log('info', `Admin whitelist (${emails.length} email${emails.length === 1 ? '' : 's'}): ${emails.map(maskEmail).join(', ')}`);
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
    // Do NOT throw — let the server start so error messages are visible in logs
  } else {
    log('info', 'All required env vars are present');
  }

  if (env.placeholder.length > 0) {
    log('warn', `LICENSE_HMAC_SECRET is still the placeholder value "your-hmac-secret".\n         License generation will fail. Set the real secret from the desktop app.`);
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

    // 4. Schema check
    const schema = await checkSchema();
    if (schema.ok) {
      log('info', 'Database schema verified (clinics, devices, licenses)');
    } else {
      log('error', `Database schema not applied — missing tables: ${schema.missing.join(', ')}.\n         Run supabase/schema.sql in your Supabase SQL editor.`);
    }
  }

  // 5. Whitelist
  logWhitelist();

  console.info('[startup] ─────────────────────────────────────────────────────────\n');
}
