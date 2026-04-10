'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { VerifyAdminResult } from '@/app/api/auth/verify-admin/route';

// Force dynamic — never pre-render; Supabase client requires env vars at runtime
export const dynamic = 'force-dynamic';

// Human-readable messages for each exact failure reason
const ERROR_MESSAGES: Record<string, string> = {
  // Supabase auth failures
  AUTH_FAILED:
    'Invalid email or password. Check your credentials and try again.',
  AUTH_EMAIL_NOT_CONFIRMED:
    'Email not confirmed. Check your inbox for a confirmation link.',

  // Whitelist failures (returned by /api/auth/verify-admin)
  NOT_AUTHENTICATED:
    'Session could not be established. Please try again.',
  NOT_AUTHORIZED_ADMIN:
    'Your account is not authorised to access this dashboard. ' +
    'Contact the administrator to be added to the access list.',
  WHITELIST_EMPTY:
    'Admin whitelist is not configured on the server. ' +
    'Set ADMIN_EMAIL_WHITELIST in .env.local and restart the dev server.',

  // Catch-all
  UNKNOWN: 'An unexpected error occurred. Check the server logs.',
};

function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN;
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const param = new URLSearchParams(window.location.search).get('error');
    // Map legacy redirect codes to our canonical codes
    if (param === 'unauthorized') return 'NOT_AUTHORIZED_ADMIN';
    return null;
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorCode(null);
    setLoading(true);

    // ── Step 1: Supabase credential check ─────────────────────────────────────
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      console.warn('[login] AUTH_FAILED —', authError.message, '| code:', authError.code);
      const code =
        authError.message?.toLowerCase().includes('confirm')
          ? 'AUTH_EMAIL_NOT_CONFIRMED'
          : 'AUTH_FAILED';
      setErrorCode(code);
      setLoading(false);
      return;
    }

    // ── Step 2: Server-side whitelist check ───────────────────────────────────
    // Cookie is set by Supabase after signInWithPassword — the verify endpoint
    // reads it to get the authenticated user without any credentials in the body.
    let verifyResult: VerifyAdminResult;
    try {
      const res = await fetch('/api/auth/verify-admin', { method: 'POST' });
      verifyResult = await res.json();
    } catch {
      setErrorCode('UNKNOWN');
      setLoading(false);
      return;
    }

    if (!verifyResult.ok) {
      const code = verifyResult.reason ?? 'UNKNOWN';
      console.warn('[login] whitelist rejection —', code);
      setErrorCode(code);
      setLoading(false);
      return;
    }

    // ── Step 3: Both checks passed — go to dashboard ──────────────────────────
    console.info('[login] ✅ admin login successful:', verifyResult.email);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">DentalPro</h1>
          <p className="mt-1 text-sm text-slate-500">Admin Dashboard — internal access only</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-xl border border-slate-700/60 bg-slate-800/60 p-6"
        >
          {errorCode && (
            <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
              <p className="font-mono text-xs text-red-500 mb-1">{errorCode}</p>
              {errorMessage(errorCode)}
            </div>
          )}

          <Input
            id="email"
            type="email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            required
            autoFocus
          />

          <Input
            id="password"
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <Button type="submit" disabled={loading} className="w-full justify-center">
            {loading ? 'Verifying…' : 'Sign in'}
          </Button>

          <div className="pt-1 text-center">
            <Link
              href="/reset-password"
              className="text-sm text-slate-400 hover:text-slate-200 underline underline-offset-2"
            >
              Forgot password?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
