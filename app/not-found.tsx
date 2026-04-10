import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="text-center">
        <p className="text-sm font-medium text-slate-500 mb-2">404</p>
        <h1 className="text-2xl font-bold text-slate-100 mb-4">Page not found</h1>
        <p className="text-sm text-slate-400 mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
