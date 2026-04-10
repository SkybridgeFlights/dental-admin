import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/server';
import { StatsCard } from '@/components/admin/StatsCard';

async function fetchStats() {
  const admin = createAdminClient();

  const [clinicRes, deviceRes] = await Promise.all([
    admin.from('clinics').select('status, expires_at'),
    admin.from('devices').select('device_id', { count: 'exact', head: true }),
  ]);

  const clinics = clinicRes.data ?? [];
  const now     = new Date();

  const total   = clinics.length;
  const active  = clinics.filter((c) => c.status === 'active' && new Date(c.expires_at) >= now).length;
  const expired = clinics.filter((c) => new Date(c.expires_at) < now).length;
  const devices = deviceRes.count ?? 0;

  return { total, active, expired, devices };
}

export default async function DashboardPage() {
  await requireAdmin();
  const stats = await fetchStats();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Overview</h1>
        <p className="mt-1 text-sm text-slate-500">License system status at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Total Clinics"  value={stats.total}   accent="slate" />
        <StatsCard label="Active Clinics" value={stats.active}  accent="green" />
        <StatsCard label="Expired"        value={stats.expired} accent="red"   />
        <StatsCard label="Total Devices"  value={stats.devices} accent="blue"  />
      </div>
    </div>
  );
}
