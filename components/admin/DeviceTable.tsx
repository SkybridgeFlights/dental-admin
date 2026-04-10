import { DeviceStatusBadge } from './StatusBadge';

export type DeviceRow = {
  device_id:    string;
  activated_at: string;
  last_seen_at: string | null;
  status:       'active' | 'revoked' | 'blocked';
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function daysSince(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function DeviceTable({ devices }: { devices: DeviceRow[] }) {
  if (devices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No devices registered yet. Generate a license to register the first device.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/60 bg-slate-800/80">
            <th className="px-4 py-3 text-left font-medium text-slate-400">Device ID</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Activated</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Last Seen</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/40">
          {devices.map((d) => (
            <tr key={d.device_id} className="bg-slate-800/40 hover:bg-slate-800/80 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-slate-100">{d.device_id}</td>
              <td className="px-4 py-3 text-slate-300">{formatDate(d.activated_at)}</td>
              <td className="px-4 py-3">
                <span className="text-slate-300">{formatDate(d.last_seen_at)}</span>
                <span className="ml-2 text-xs text-slate-500">{daysSince(d.last_seen_at)}</span>
              </td>
              <td className="px-4 py-3">
                <DeviceStatusBadge status={d.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
