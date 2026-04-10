import { requireAdmin }      from '@/lib/auth/require-admin';
import { OnboardingWizard } from '@/components/admin/OnboardingWizard';

export default async function OnboardPage() {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Onboard New Clinic</h1>
        <p className="mt-1 text-sm text-slate-500">
          Guided setup — creates the clinic, owner account, device, and license in one workflow.
        </p>
      </div>

      <OnboardingWizard />
    </div>
  );
}
