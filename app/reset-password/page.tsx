'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Input }   from '@/components/ui/Input';
import { Button }  from '@/components/ui/Button';

// The callback route exchanges the email link's code for a session,
// then redirects here. By the time this page mounts, auth.getUser()
// returns the user (in a short-lived recovery session) if the flow
// is at the "set new password" stage.
function resolveCallbackUrl() {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/api/auth/callback?next=/reset-password`;
}

type Mode = 'request' | 'update' | 'done';

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);

  const [mode,            setMode]            = useState<Mode>('request');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [requestSent,     setRequestSent]     = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  // Detect whether we're in the recovery session (came via email link)
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted && data.user) setMode('update');
    });
    return () => { mounted = false; };
  }, [supabase]);

  // ── Request reset email ──────────────────────────────────────────────────

  async function sendResetEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required.'); return; }

    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: resolveCallbackUrl() },
    );

    setLoading(false);

    if (resetError) {
      // Supabase returns a generic error even for unknown emails (by design —
      // prevents email enumeration). Show it as-is.
      setError(resetError.message || 'Failed to send reset email. Please try again.');
      return;
    }

    setRequestSent(true);
  }

  // ── Update password ──────────────────────────────────────────────────────

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(
        updateError.message ||
        'Failed to update password. The reset link may have expired — request a new one.',
      );
      setLoading(false);
      return;
    }

    // Clear the recovery session so the user starts fresh on next login.
    await supabase.auth.signOut();
    setMode('done');
    setLoading(false);
  }

  // ── Done ─────────────────────────────────────────────────────────────────

  if (mode === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-slate-100">DentalPro</h1>
          </div>
          <div className="flex flex-col gap-5 rounded-xl border border-emerald-700/40 bg-slate-800/60 p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 font-bold text-emerald-400">
                ✓
              </div>
              <div>
                <p className="font-semibold text-slate-100">Password updated</p>
                <p className="mt-0.5 text-sm text-slate-400">
                  Your new password is set. If you're an admin, sign in below.
                  If you're a clinic user, log in through the DentalPro desktop app.
                </p>
              </div>
            </div>
            <Link href="/login">
              <Button className="w-full justify-center">Sign in to admin dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Request / Update forms ────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">DentalPro</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'update' ? 'Set your new password' : 'Reset your password'}
          </p>
        </div>

        <form
          onSubmit={mode === 'update' ? updatePassword : sendResetEmail}
          className="flex flex-col gap-4 rounded-xl border border-slate-700/60 bg-slate-800/60 p-6"
        >
          {/* Error */}
          {error && (
            <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Request sent confirmation */}
          {requestSent && (
            <div className="rounded-md border border-emerald-700/50 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
              A reset link has been sent to <strong className="font-semibold">{email}</strong>.
              Check your inbox and spam folder — the link expires in 1 hour.
            </div>
          )}

          {/* Request mode */}
          {mode === 'request' && !requestSent && (
            <>
              <p className="text-sm text-slate-400">
                Enter your account email and we'll send you a reset link.
              </p>
              <Input
                id="email"
                type="email"
                label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoFocus
              />
              <Button type="submit" disabled={loading} className="w-full justify-center">
                {loading ? 'Sending…' : 'Send reset email'}
              </Button>
            </>
          )}

          {/* Update mode */}
          {mode === 'update' && (
            <>
              {/* Password with show/hide toggle */}
              <div className="flex flex-col gap-1">
                <label htmlFor="password" className="text-sm font-medium text-slate-300">
                  New password{' '}
                  <span className="font-normal text-slate-500">(min 8 characters)</span>
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 pr-16 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <Input
                id="confirm_password"
                type="password"
                label="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />

              <Button type="submit" disabled={loading} className="w-full justify-center">
                {loading ? 'Saving…' : 'Update password'}
              </Button>
            </>
          )}

          {/* Back to sign in — hidden after request is sent in request mode */}
          {!(mode === 'request' && requestSent) && (
            <div className="pt-1 text-center">
              <Link
                href="/login"
                className="text-sm text-slate-400 underline underline-offset-2 hover:text-slate-200"
              >
                Back to sign in
              </Link>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
