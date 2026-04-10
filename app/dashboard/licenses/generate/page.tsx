import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/server';
import { LicenseGenerator } from '@/components/admin/LicenseGenerator';
import { Card } from '@/components/ui/Card';

async function fetchActiveClinics() {
  const admin = createAdminClient();
  const { data } = await admin
    .from('clinics')
    .select('id, clinic_name, plan_type, expires_at')
    .eq('status', 'active')
    .order('clinic_name');
  return data ?? [];
}

export default async function GenerateLicensePage() {
  await requireAdmin();
  const clinics = await fetchActiveClinics();

  return (
    <div className="mx-auto max-w-2xl flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Generate License Key</h1>
        <p className="mt-1 text-sm text-slate-500">
          Creates a signed DP3 license key for a registered device. The signing secret never
          leaves the server.
        </p>
      </div>

      {clinics.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">
            No active clinics found. Create and activate a clinic first.
          </p>
        </Card>
      ) : (
        <Card>
          <LicenseGenerator clinics={clinics} />
        </Card>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-slate-700/30 bg-slate-800/30 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-400">How it works</h2>
        <ol className="flex flex-col gap-2 text-sm text-slate-500 list-decimal list-inside">
          <li>Select the clinic and enter the Device ID shown in the desktop app.</li>
          <li>Confirm the expiry date and license type.</li>
          <li>Click Generate — the key is signed server-side and logged.</li>
          <li>Copy the key and send it to the clinic to activate their device.</li>
        </ol>
      </div>
    </div>
  );
}
