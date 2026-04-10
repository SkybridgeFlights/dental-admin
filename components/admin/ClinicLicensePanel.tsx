'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type ClinicLicensePanelProps = {
  clinicId: string;
  clinicName: string;
  planType: 'standard' | 'pro' | 'enterprise';
  expiresAt: string;
};

type LatestLicenseResponse = {
  license_key: string;
  license_file: Record<string, unknown>;
  expires_at: string;
  device_id: string;
  generated_at: string;
  license_type: string;
  license_status: string;
  owner: {
    email?: string;
    full_name?: string;
  } | null;
};

function downloadLicenseFile(clinicName: string, deviceId: string, licenseFile: Record<string, unknown>) {
  const fileName = `${clinicName || 'clinic'}-${deviceId || 'device'}.dpl`
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const blob = new Blob([JSON.stringify(licenseFile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'dentalpro-license.dpl';
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function ClinicLicensePanel({ clinicId, clinicName, planType, expiresAt }: ClinicLicensePanelProps) {
  const [data, setData] = useState<LatestLicenseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadLatest() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/license/latest?clinicId=${encodeURIComponent(clinicId)}`);
      const json = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = {
          NO_LICENSE_FOUND: 'No license has been generated for this clinic yet.',
          DATABASE_ERROR: 'Database error. Please try again.',
          CLINIC_NOT_FOUND: 'Clinic not found.',
        };
        setError(messages[json.error] ?? `Error: ${json.error ?? 'Unknown'}`);
        setData(null);
        return;
      }
      setData(json as LatestLicenseResponse);
    } catch {
      setError('Network error. Please try again.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLatest().catch(() => {});
  }, [clinicId]);

  async function handleCopy() {
    if (!data?.license_key) {
      return;
    }
    await navigator.clipboard.writeText(data.license_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleRegenerate() {
    if (!data?.device_id) {
      return;
    }
    setRegenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/license/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId,
          clinicName,
          expiryDate: expiresAt.slice(0, 10),
          licenseType: planType,
          deviceId: data.device_id,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error ? `Error: ${json.error}` : 'Failed to regenerate license.');
        return;
      }
      await loadLatest();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">License Access</p>
          <h2 className="mt-1 text-sm font-semibold text-slate-100">Current device license</h2>
        </div>
        <Button variant="secondary" size="sm" onClick={() => loadLatest()} disabled={loading || regenerating}>
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Device ID</p>
              <p className="font-mono text-xs text-slate-200">{data.device_id}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Status</p>
              <p className="text-sm capitalize text-slate-200">{data.license_status}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Expires</p>
              <p className="text-sm text-slate-200">{formatDate(data.expires_at)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Owner Login</p>
              <p className="text-sm text-slate-200">{data.owner?.email || 'No linked owner profile'}</p>
            </div>
          </div>

          <code className="break-all rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-xs text-emerald-300">
            {data.license_key}
          </code>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy License Key'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadLicenseFile(clinicName, data.device_id, data.license_file)}
            >
              Download License File
            </Button>
            <Button size="sm" onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? 'Regenerating...' : 'Regenerate File'}
            </Button>
          </div>
        </>
      ) : (
        !loading ? <p className="text-sm text-slate-400">No current license artifact is available for this clinic.</p> : null
      )}
    </Card>
  );
}
