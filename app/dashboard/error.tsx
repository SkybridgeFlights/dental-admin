'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard/error]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <h2 className="text-xl font-semibold text-slate-100">Something went wrong</h2>
      <p className="text-sm text-slate-400 max-w-sm">
        An error occurred while loading this page.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 transition-colors"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
