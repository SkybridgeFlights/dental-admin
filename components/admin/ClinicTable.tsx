'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { deleteClinic } from '@/actions/clinics';
import { DangerConfirmModal } from './DangerConfirmModal';
import { ClinicStatusBadge, PlanBadge } from './StatusBadge';

export type ClinicRow = {
  id: string;
  clinic_name: string;
  owner_name: string;
  plan_type: 'standard' | 'pro' | 'enterprise';
  expires_at: string;
  max_devices: number;
  status: 'active' | 'inactive' | 'suspended';
};

type LicenseData = {
  license_key: string;
  expires_at: string;
  device_id: string;
  generated_at: string;
};

type Toast = { message: string; type: 'success' | 'error' };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function isExpired(iso: string) {
  return new Date(iso) < new Date();
}

function ToastBar({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      className={[
        'fixed bottom-5 right-5 z-[60] flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-xl',
        toast.type === 'success'
          ? 'border-emerald-700/60 bg-emerald-950 text-emerald-300'
          : 'border-red-700/60 bg-red-950 text-red-300',
      ].join(' ')}
    >
      <span>{toast.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-xs opacity-50 transition-opacity hover:opacity-100"
      >
        x
      </button>
    </div>
  );
}

function LicenseModal({
  clinicName,
  license,
  regenerating,
  onClose,
  onRegenerate,
}: {
  clinicName: string;
  license: LicenseData;
  regenerating: boolean;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(license.license_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700/60 px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Latest License</p>
            <h2 className="mt-0.5 text-sm font-semibold text-slate-100">{clinicName}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            x
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Device ID</span>
              <span className="font-mono text-xs text-slate-200">{license.device_id}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Expires</span>
              <span className={isExpired(license.expires_at) ? 'text-sm text-red-400' : 'text-sm text-slate-200'}>
                {formatDate(license.expires_at)}
                {isExpired(license.expires_at) && <span className="ml-1.5 text-xs">(expired)</span>}
              </span>
            </div>
            <div className="col-span-2 flex flex-col gap-0.5">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Generated</span>
              <span className="text-xs text-slate-400">{formatDate(license.generated_at)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">License Key</span>
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-xs leading-relaxed text-emerald-300 select-all">
                {license.license_key}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-700/60 px-5 py-3">
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-slate-700 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {regenerating ? 'Regenerating…' : 'Regenerate License'}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClinicTable({ clinics }: { clinics: ClinicRow[] }) {
  const router = useRouter();
  const [activeClinic, setActiveClinic] = useState<ClinicRow | null>(null);
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [deleteClinicId, setDeleteClinicId] = useState<string | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  function showToast(message: string, type: Toast['type']) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleViewLicense(clinic: ClinicRow) {
    setActiveClinic(clinic);
    setLicenseData(null);
    setLicenseError(null);
    setLoadingId(clinic.id);

    try {
      const response = await fetch(`/api/license/latest?clinicId=${encodeURIComponent(clinic.id)}`);
      const json = await response.json();

      if (!response.ok) {
        const messages: Record<string, string> = {
          NO_LICENSE_FOUND: 'No license has been generated for this clinic yet.',
          DATABASE_ERROR: 'Database error. Please try again.',
          UNAUTHORIZED: 'Session expired. Please refresh.',
          FORBIDDEN: 'Access denied. Please refresh and try again.',
        };
        setLicenseError(messages[json.error] ?? `Error: ${json.error ?? 'Unknown'}`);
      } else {
        setLicenseData(json as LicenseData);
      }
    } catch {
      setLicenseError('Network error. Please try again.');
    } finally {
      setLoadingId(null);
    }
  }

  async function handleRegenerate(clinic: ClinicRow) {
    setRegeneratingId(clinic.id);

    try {
      const latestResponse = await fetch(`/api/license/latest?clinicId=${encodeURIComponent(clinic.id)}`);
      const latestJson = await latestResponse.json();

      if (!latestResponse.ok) {
        showToast(
          latestJson.error === 'NO_LICENSE_FOUND'
            ? 'No device registered for this clinic. Generate an initial license first.'
            : 'Failed to fetch device info. Please try again.',
          'error',
        );
        return;
      }

      const deviceId = latestJson.device_id as string;
      const generateResponse = await fetch('/api/license/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: clinic.id,
          clinicName: clinic.clinic_name,
          expiryDate: clinic.expires_at.slice(0, 10),
          licenseType: clinic.plan_type,
          deviceId,
        }),
      });
      const generateJson = await generateResponse.json();

      if (!generateResponse.ok) {
        const messages: Record<string, string> = {
          CLINIC_NOT_FOUND: 'Clinic no longer exists.',
          CLINIC_NOT_ACTIVE: 'Clinic is not active.',
          DEVICE_BELONGS_TO_ANOTHER_CLINIC: 'Device is registered to a different clinic.',
          MAX_DEVICES_REACHED: `Max devices reached (${generateJson.max ?? '?'}).`,
          SIGNING_FAILED: 'License signing failed. Check server configuration.',
          DATABASE_ERROR: 'Database error. Please try again.',
          UNAUTHORIZED: 'Session expired. Please refresh.',
          FORBIDDEN: 'Access denied. Please refresh and try again.',
        };
        showToast(messages[generateJson.error] ?? `Error: ${generateJson.error ?? 'Unknown'}`, 'error');
        return;
      }

      setActiveClinic(clinic);
      setLicenseError(null);
      setLicenseData({
        license_key: generateJson.licenseKey,
        expires_at: clinic.expires_at,
        device_id: deviceId,
        generated_at: new Date().toISOString(),
      });
      showToast(`New license generated for ${clinic.clinic_name}`, 'success');
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setRegeneratingId(null);
    }
  }

  async function handleDeleteClinic(clinic: ClinicRow) {
    setLoadingId(clinic.id);
    const result = await deleteClinic(clinic.id);

    if (result?.error) {
      showToast(result.error, 'error');
    } else {
      setDeleteClinicId(null);
      showToast(result?.warning ?? `Clinic deleted: ${clinic.clinic_name}`, result?.warning ? 'error' : 'success');
      router.refresh();
    }

    setLoadingId(null);
  }

  function handleClose() {
    setActiveClinic(null);
    setLicenseData(null);
    setLicenseError(null);
  }

  if (clinics.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-slate-500">
        No clinics yet. <Link href="/dashboard/clinics/new" className="text-blue-400 hover:underline">Add one.</Link>
      </p>
    );
  }

  const clinicPendingDelete = clinics.find((clinic) => clinic.id === deleteClinicId) ?? null;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-700/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/60 bg-slate-800/80">
              <th className="px-4 py-3 text-left font-medium text-slate-400">Clinic</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Owner</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Plan</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Expires</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Devices</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {clinics.map((clinic) => {
              const isBusy = loadingId === clinic.id || regeneratingId === clinic.id;
              return (
                <tr key={clinic.id} className="bg-slate-800/40 transition-colors hover:bg-slate-800/80">
                  <td className="px-4 py-3 font-medium text-slate-100">{clinic.clinic_name}</td>
                  <td className="px-4 py-3 text-slate-300">{clinic.owner_name}</td>
                  <td className="px-4 py-3"><PlanBadge plan={clinic.plan_type} /></td>
                  <td className="px-4 py-3">
                    <span className={isExpired(clinic.expires_at) ? 'text-red-400' : 'text-slate-300'}>
                      {formatDate(clinic.expires_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{clinic.max_devices}</td>
                  <td className="px-4 py-3"><ClinicStatusBadge status={clinic.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => handleViewLicense(clinic)}
                        disabled={isBusy}
                        className="text-xs text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-40"
                      >
                        {loadingId === clinic.id ? 'Loading…' : 'View License'}
                      </button>
                      <button
                        onClick={() => handleRegenerate(clinic)}
                        disabled={isBusy}
                        className="text-xs text-amber-500 transition-colors hover:text-amber-300 disabled:opacity-40"
                      >
                        {regeneratingId === clinic.id ? 'Regenerating…' : 'Regenerate'}
                      </button>
                      <button
                        onClick={() => setDeleteClinicId(clinic.id)}
                        disabled={isBusy}
                        className="text-xs text-red-400 transition-colors hover:text-red-300 disabled:opacity-40"
                      >
                        {loadingId === clinic.id ? 'Deleting…' : 'Delete'}
                      </button>
                      <Link
                        href={`/dashboard/clinics/${clinic.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                      >
                        View {'->'}
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activeClinic && licenseError && !licenseData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={handleClose}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="mb-1 text-sm font-semibold text-slate-100">{activeClinic.clinic_name}</p>
            <p className="mb-4 text-sm text-red-400">{licenseError}</p>
            <button
              onClick={handleClose}
              className="rounded-md border border-slate-600 bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {activeClinic && licenseData && (
        <LicenseModal
          clinicName={activeClinic.clinic_name}
          license={licenseData}
          regenerating={regeneratingId === activeClinic.id}
          onClose={handleClose}
          onRegenerate={() => handleRegenerate(activeClinic)}
        />
      )}

      <DangerConfirmModal
        open={Boolean(clinicPendingDelete)}
        title="Delete Clinic"
        message="This permanently deletes the clinic, all linked device records, all linked license records, and all linked profile rows. Device IDs from this clinic become reusable for onboarding. Auth accounts are also removed when possible."
        confirmLabel="Delete Clinic"
        busy={Boolean(clinicPendingDelete && loadingId === clinicPendingDelete.id)}
        onCancel={() => {
          if (!loadingId) {
            setDeleteClinicId(null);
          }
        }}
        onConfirm={() => {
          if (clinicPendingDelete) {
            handleDeleteClinic(clinicPendingDelete);
          }
        }}
      />

      {toast && <ToastBar toast={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
