import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/server';
import { updateClinic } from '@/actions/clinics';
import { ClinicForm } from '@/components/admin/ClinicForm';

async function fetchClinic(id: string) {
  const admin = createAdminClient();
  const { data } = await admin.from('clinics').select('*').eq('id', id).single();
  return data;
}

export default async function EditClinicPage({ params }: { params: Promise<{ clinicId: string }> }) {
  await requireAdmin();
  const { clinicId } = await params;

  const clinic = await fetchClinic(clinicId);
  if (!clinic) notFound();

  // Bind the clinicId into the action — useActionState expects (prevState, formData)
  const boundAction = updateClinic.bind(null, clinicId);

  return (
    <div className="mx-auto max-w-2xl flex flex-col gap-6">
      <div>
        <Link href={`/dashboard/clinics/${clinicId}`} className="text-xs text-slate-500 hover:text-slate-300">
          ← Back to {clinic.clinic_name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">Edit Clinic</h1>
      </div>

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-6">
        <ClinicForm
          action={boundAction}
          defaultValues={clinic}
          submitLabel="Save Changes"
        />
      </div>
    </div>
  );
}
