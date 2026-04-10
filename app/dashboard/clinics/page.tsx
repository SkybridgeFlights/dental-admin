import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/server';
import { ClinicTable } from '@/components/admin/ClinicTable';
import { Button } from '@/components/ui/Button';

async function fetchClinics() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('clinics')
    .select('id, clinic_name, owner_name, plan_type, expires_at, max_devices, status')
    .order('created_at', { ascending: false });

  if (error) throw new Error('Failed to load clinics');
  return data ?? [];
}

export default async function ClinicsPage() {
  await requireAdmin();
  const clinics = await fetchClinics();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Clinics</h1>
          <p className="mt-1 text-sm text-slate-500">{clinics.length} clinic{clinics.length !== 1 ? 's' : ''} registered.</p>
        </div>
        <Link href="/dashboard/onboard">
          <Button>+ Onboard Clinic</Button>
        </Link>
      </div>

      <ClinicTable clinics={clinics} />
    </div>
  );
}
