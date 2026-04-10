import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/server';
import { ClinicStatusBadge, PlanBadge } from '@/components/admin/StatusBadge';
import { ClinicStatusToggle } from '@/components/admin/ClinicStatusToggle';
import { DeviceManager } from '@/components/admin/DeviceManager';
import { ClinicLicensePanel } from '@/components/admin/ClinicLicensePanel';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

async function fetchClinic(id: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('clinics')
    .select('*')
    .eq('id', id)
    .single();
  return data;
}

async function fetchDevices(clinicId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('devices')
    .select('device_id, activated_at, last_seen_at, status')
    .eq('clinic_id', clinicId)
    .order('activated_at', { ascending: false });
  return data ?? [];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

export default async function ClinicDetailPage({ params }: { params: Promise<{ clinicId: string }> }) {
  await requireAdmin();
  const { clinicId } = await params;

  const [clinic, devices] = await Promise.all([
    fetchClinic(clinicId),
    fetchDevices(clinicId),
  ]);

  if (!clinic) notFound();

  const isExpired = new Date(clinic.expires_at) < new Date();

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/clinics" className="text-xs text-slate-500 hover:text-slate-300">
            ← Back to Clinics
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">{clinic.clinic_name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <ClinicStatusBadge status={clinic.status} />
            <PlanBadge plan={clinic.plan_type} />
            {isExpired && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-red-900/60 text-red-300 ring-1 ring-inset ring-red-700/40">
                Expired
              </span>
            )}
          </div>
        </div>
        <Link href={`/dashboard/clinics/${clinic.id}/edit`}>
          <Button variant="secondary" size="sm">Edit</Button>
        </Link>
      </div>

      {/* Details grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <p className="text-xs text-slate-500">Owner</p>
          <p className="mt-1 font-medium text-slate-100">{clinic.owner_name}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Phone</p>
          <p className="mt-1 font-medium text-slate-100">{clinic.phone || '—'}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Expires</p>
          <p className={`mt-1 font-medium ${isExpired ? 'text-red-400' : 'text-slate-100'}`}>
            {formatDate(clinic.expires_at)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Max Devices</p>
          <p className="mt-1 font-medium text-slate-100">{clinic.max_devices}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Registered Devices</p>
          <p className="mt-1 font-medium text-slate-100">{devices.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Created</p>
          <p className="mt-1 font-medium text-slate-100">{formatDate(clinic.created_at)}</p>
        </Card>
      </div>

      {/* Notes */}
      {clinic.notes && (
        <Card>
          <p className="text-xs text-slate-500 mb-1">Notes</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{clinic.notes}</p>
        </Card>
      )}

      {/* Status controls */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-slate-400">Status Controls</h2>
        <ClinicStatusToggle clinicId={clinic.id} currentStatus={clinic.status} />
      </div>

      {/* Devices */}
      <ClinicLicensePanel
        clinicId={clinic.id}
        clinicName={clinic.clinic_name}
        planType={clinic.plan_type}
        expiresAt={clinic.expires_at}
      />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-100">Registered Devices</h2>
          <Link href={`/dashboard/licenses/generate?clinicId=${clinic.id}`}>
            <Button size="sm">+ Generate License</Button>
          </Link>
        </div>
        <DeviceManager devices={devices} clinicId={clinic.id} />
      </div>
    </div>
  );
}
