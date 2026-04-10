import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/server';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

type AuditLog = {
  id:          string;
  actor_email: string;
  action:      string;
  target_type: string | null;
  target_id:   string | null;
  metadata:    Record<string, unknown>;
  created_at:  string;
};

async function fetchAuditLogs(): Promise<AuditLog[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('admin_audit_logs')
    .select('id, actor_email, action, target_type, target_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  return (data ?? []) as AuditLog[];
}

export default async function AuditLogPage() {
  await requireAdmin();
  const logs = await fetchAuditLogs();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Audit Log</h1>
        <p className="mt-1 text-sm text-slate-500">Last 100 admin actions, most recent first.</p>
      </div>

      {logs.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No audit events recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/60 bg-slate-800/80">
                <th className="px-4 py-3 text-left font-medium text-slate-400">Time</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Actor</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Action</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Target</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {logs.map((log) => (
                <tr key={log.id} className="bg-slate-800/40 hover:bg-slate-800/70 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{log.actor_email}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-mono font-medium bg-slate-700/60 text-slate-200 ring-1 ring-inset ring-slate-600/50">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {log.target_type && (
                      <span className="text-slate-300">{log.target_type}</span>
                    )}
                    {log.target_id && (
                      <span className="ml-1 font-mono text-slate-500">{log.target_id.slice(0, 8)}…</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 font-mono max-w-xs truncate">
                    {Object.keys(log.metadata).length > 0
                      ? JSON.stringify(log.metadata)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
