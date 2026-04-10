'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

type Clinic = { id: string; clinic_name: string; plan_type: string; expires_at: string };
type LicenseFilePayload = {
  version: string;
  clinicId: string;
  clinicName: string;
  deviceId: string;
  expiresAt: string;
  expiryDate: string;
  plan: string;
  type: string;
  signature: string;
};

function downloadLicenseFile(licenseFile: LicenseFilePayload) {
  const fileName = `${licenseFile.clinicName || 'clinic'}-${licenseFile.deviceId || 'device'}.dpl`
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const blob = new Blob([JSON.stringify(licenseFile, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'dentalpro-license.dpl';
  link.click();
  URL.revokeObjectURL(url);
}

export function LicenseGenerator({ clinics }: { clinics: Clinic[] }) {
  const [clinicId, setClinicId] = useState(clinics[0]?.id ?? '');
  const [deviceId, setDeviceId] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [licenseType, setLicenseType] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [licenseFile, setLicenseFile] = useState<LicenseFilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedClinic = clinics.find((c) => c.id === clinicId);

  function handleClinicChange(id: string) {
    setClinicId(id);
    const clinic = clinics.find((c) => c.id === id);
    if (clinic) {
      setExpiryDate(clinic.expires_at.slice(0, 10));
      setLicenseType(clinic.plan_type);
    }
    setResult(null);
    setLicenseFile(null);
    setError(null);
  }

  async function handleGenerate() {
    setError(null);
    setResult(null);
    setLicenseFile(null);
    setCopied(false);

    if (!clinicId || !deviceId.trim() || !expiryDate || !licenseType) {
      setError('All fields are required.');
      return;
    }

    if (!/^DPDEV-[0-9a-fA-F]{8}$/i.test(deviceId.trim())) {
      setError('Device ID must match DPDEV-XXXXXXXX format (8 hex characters).');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/license/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId,
          clinicName: selectedClinic?.clinic_name ?? '',
          expiryDate,
          licenseType,
          deviceId: deviceId.trim().toUpperCase(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const messages: Record<string, string> = {
          CLINIC_NOT_FOUND: 'Clinic not found.',
          CLINIC_NOT_ACTIVE: 'Clinic is not active.',
          DEVICE_BELONGS_TO_ANOTHER_CLINIC: 'This Device ID is already registered to a different clinic.',
          MAX_DEVICES_REACHED: `Maximum devices reached (${data.max ?? '?'}). Update the clinic's max_devices limit to add more.`,
          SIGNING_FAILED: 'License signing failed. Check server configuration.',
          DATABASE_ERROR: 'Database error. Please try again.',
        };
        setError(messages[data.error] ?? `Error: ${data.error ?? 'Unknown error'}`);
        return;
      }

      setResult(data.licenseKey);
      setLicenseFile(data.licenseFile ?? null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!result) {
      return;
    }

    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Clipboard write failed. Copy the key manually.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="clinic_select" className="text-sm font-medium text-slate-300">
            Clinic *
          </label>
          <select
            id="clinic_select"
            value={clinicId}
            onChange={(event) => handleClinicChange(event.target.value)}
            className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.clinic_name}
              </option>
            ))}
          </select>
        </div>

        <Input
          id="device_id"
          label="Device ID *"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          placeholder="DPDEV-A1B2C3D4"
          className="uppercase font-mono placeholder:normal-case"
        />

        <Input
          id="expiry_date"
          type="date"
          label="Expiry Date *"
          value={expiryDate}
          onChange={(event) => setExpiryDate(event.target.value)}
        />

        <Select
          id="license_type"
          label="License Type *"
          value={licenseType}
          onChange={(event) => setLicenseType(event.target.value)}
        >
          <option value="">Select type...</option>
          <option value="standard">Standard</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </Select>
      </div>

      {error ? (
        <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div>
        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? 'Generating...' : 'Generate License Key'}
        </Button>
      </div>

      {result ? (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-700/40 bg-emerald-900/20 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">
            License key generated
          </p>
          <div className="flex items-start gap-3">
            <code className="flex-1 break-all rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300 select-all">
              {result}
            </code>
            <div className="flex shrink-0 flex-col gap-2">
              <Button variant="secondary" size="sm" onClick={handleCopy} className="shrink-0">
                {copied ? 'Copied ✓' : 'Copy'}
              </Button>
              {licenseFile ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadLicenseFile(licenseFile)}
                  className="shrink-0"
                >
                  Download License File
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            This key is stored in the audit log. You can also download a signed `.dpl` file for offline import on the clinic desktop app.
          </p>
        </div>
      ) : null}
    </div>
  );
}
