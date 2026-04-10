'use client';

import { type ReactNode, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';

type PlanType = 'standard' | 'pro' | 'enterprise';

type FormData = {
  clinic_name: string;
  owner_name: string;
  phone: string;
  plan_type: PlanType;
  expires_at: string;
  max_devices: string;
  notes: string;
  owner_email: string;
  temp_password: string;
  device_id: string;
};

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

type OnboardingResult = {
  clinic_id: string;
  clinic_name: string;
  owner_email: string;
  device_id: string;
  license_key: string;
  license_file: LicenseFilePayload;
  expires_at: string;
};

type StepError = {
  failedStep: string;
  error: string;
};

const STEPS = [
  { id: 1, label: 'Clinic Info' },
  { id: 2, label: 'Owner Account' },
  { id: 3, label: 'Device' },
  { id: 4, label: 'Review' },
] as const;

const STEP_LABELS: Record<string, string> = {
  input: 'Input Validation',
  clinic: 'Step 1 - Create Clinic',
  auth_user: 'Step 2 - Create Owner Account',
  profile: 'Step 3 - Create Profile',
  device: 'Step 4 - Register Device',
  license: 'Step 5 - Generate License',
};

function emptyForm(): FormData {
  return {
    clinic_name: '',
    owner_name: '',
    phone: '',
    plan_type: 'standard',
    expires_at: '',
    max_devices: '1',
    notes: '',
    owner_email: '',
    temp_password: '',
    device_id: '',
  };
}

function validateStep(step: number, data: FormData): string | null {
  if (step === 1) {
    if (!data.clinic_name.trim()) {
      return 'Clinic name is required';
    }
    if (!data.owner_name.trim()) {
      return 'Owner name is required';
    }
    if (!data.expires_at) {
      return 'Expiry date is required';
    }
  }

  if (step === 2) {
    if (!data.owner_email.trim()) {
      return 'Owner email is required';
    }
    if (!data.owner_email.includes('@')) {
      return 'Enter a valid email address';
    }
    if (data.temp_password.length < 8) {
      return 'Temporary password must be at least 8 characters';
    }
  }

  if (step === 3) {
    if (!data.device_id.trim()) {
      return 'Device ID is required';
    }
    if (!/^DPDEV-[0-9a-fA-F]{8}$/i.test(data.device_id.trim())) {
      return 'Device ID must match format: DPDEV-XXXXXXXX (8 hex characters)';
    }
  }

  return null;
}

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

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding progress" className="flex flex-wrap items-center gap-0 gap-y-2">
      {STEPS.map((step, index) => {
        const done = step.id < current;
        const active = step.id === current;
        return (
          <div key={step.id} className="flex items-center">
            <div
              className={[
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                done ? 'bg-emerald-500 text-white' : '',
                active ? 'bg-blue-500 text-white' : '',
                !done && !active ? 'bg-slate-700 text-slate-400' : '',
              ].join(' ')}
            >
              {done ? '✓' : step.id}
            </div>
            <span
              className={[
                'ml-2 text-sm font-medium',
                active ? 'text-slate-100' : 'text-slate-500',
              ].join(' ')}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <div
                className={[
                  'mx-4 h-px w-8 flex-shrink-0',
                  done ? 'bg-emerald-500' : 'bg-slate-700',
                ].join(' ')}
              />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function ValidationError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
      {message}
    </div>
  );
}

function Step1Clinic({
  data,
  onChange,
  validationError,
}: {
  data: FormData;
  onChange: (field: keyof FormData, value: string) => void;
  validationError: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Clinic Information</h2>
        <p className="mt-0.5 text-sm text-slate-400">Basic details for the new clinic.</p>
      </div>

      {validationError ? <ValidationError message={validationError} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="clinic_name"
          label="Clinic Name *"
          value={data.clinic_name}
          onChange={(event) => onChange('clinic_name', event.target.value)}
          placeholder="Al-Noor Dental Clinic"
          required
        />
        <Input
          id="owner_name"
          label="Owner Name *"
          value={data.owner_name}
          onChange={(event) => onChange('owner_name', event.target.value)}
          placeholder="Dr. Ahmed Al-Rashid"
          required
        />
        <Input
          id="phone"
          label="Phone"
          value={data.phone}
          onChange={(event) => onChange('phone', event.target.value)}
          placeholder="+966 5X XXX XXXX"
        />
        <Select
          id="plan_type"
          label="Plan Type"
          value={data.plan_type}
          onChange={(event) => onChange('plan_type', event.target.value)}
        >
          <option value="standard">Standard</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </Select>
        <Input
          id="expires_at"
          label="License Expires *"
          type="date"
          value={data.expires_at}
          onChange={(event) => onChange('expires_at', event.target.value)}
          required
        />
        <Input
          id="max_devices"
          label="Max Devices"
          type="number"
          min={1}
          max={50}
          value={data.max_devices}
          onChange={(event) => onChange('max_devices', event.target.value)}
        />
      </div>

      <Textarea
        id="notes"
        label="Notes"
        value={data.notes}
        onChange={(event) => onChange('notes', event.target.value)}
        placeholder="Internal notes about this clinic..."
      />
    </div>
  );
}

function Step2Owner({
  data,
  onChange,
  validationError,
}: {
  data: FormData;
  onChange: (field: keyof FormData, value: string) => void;
  validationError: string | null;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Owner Account</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          Creates a Supabase Auth user. The owner will use these credentials to log in.
        </p>
      </div>

      {validationError ? <ValidationError message={validationError} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="owner_email"
          label="Owner Email *"
          type="email"
          value={data.owner_email}
          onChange={(event) => onChange('owner_email', event.target.value)}
          placeholder="owner@clinic.com"
          required
          className="sm:col-span-2"
        />
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="temp_password" className="text-sm font-medium text-slate-300">
            Temporary Password * <span className="font-normal text-slate-500">(min 8 characters)</span>
          </label>
          <div className="relative">
            <input
              id="temp_password"
              type={showPassword ? 'text' : 'password'}
              value={data.temp_password}
              onChange={(event) => onChange('temp_password', event.target.value)}
              placeholder="Temporary password"
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 pr-20 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-amber-700/40 bg-amber-900/20 px-4 py-3 text-xs text-amber-300">
        The account will be created as confirmed so the owner can log in immediately. Share the temporary password securely. The owner should change it on first login.
      </div>
    </div>
  );
}

function Step3Device({
  data,
  onChange,
  validationError,
}: {
  data: FormData;
  onChange: (field: keyof FormData, value: string) => void;
  validationError: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Device Registration</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          The device this license will be locked to. If it does not exist yet it will be created. If it already belongs to another clinic the workflow will fail clearly.
        </p>
      </div>

      {validationError ? <ValidationError message={validationError} /> : null}

      <Input
        id="device_id"
        label="Device ID *"
        value={data.device_id}
        onChange={(event) => onChange('device_id', event.target.value.toUpperCase())}
        placeholder="DPDEV-A1B2C3D4"
        className="font-mono uppercase placeholder:normal-case"
        required
      />

      <div className="rounded-md border border-slate-700 bg-slate-800 px-4 py-3 text-xs text-slate-400">
        Format: <code className="font-mono text-slate-300">DPDEV-</code> followed by exactly 8 hexadecimal characters (0-9, A-F). The device ID is generated by the DP3 desktop application on first launch.
      </div>
    </div>
  );
}

function Step4Review({
  data,
  stepError,
}: {
  data: FormData;
  stepError: StepError | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Review &amp; Confirm</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          All steps will run server-side in order. Verify the details below before submitting.
        </p>
      </div>

      {stepError ? (
        <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          <span className="mb-0.5 block font-semibold">
            {STEP_LABELS[stepError.failedStep] ?? stepError.failedStep} failed
          </span>
          {stepError.error}
        </div>
      ) : null}

      <div className="divide-y divide-slate-700/60 rounded-xl border border-slate-700 bg-slate-900">
        <Section title="Clinic">
          <Row label="Name" value={data.clinic_name} />
          <Row label="Owner" value={data.owner_name} />
          <Row label="Phone" value={data.phone || '-'} />
          <Row label="Plan" value={data.plan_type} capitalize />
          <Row label="Expires" value={data.expires_at} />
          <Row label="Max devices" value={data.max_devices} />
          {data.notes ? <Row label="Notes" value={data.notes} /> : null}
        </Section>
        <Section title="Owner Account">
          <Row label="Email" value={data.owner_email} />
          <Row label="Password" value={'*'.repeat(Math.min(data.temp_password.length, 12))} mono />
        </Section>
        <Section title="Device">
          <Row label="Device ID" value={data.device_id.toUpperCase()} mono />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span
        className={[
          'text-right text-sm text-slate-200',
          mono ? 'font-mono text-xs' : '',
          capitalize ? 'capitalize' : '',
        ].join(' ')}
      >
        {String(value)}
      </span>
    </div>
  );
}

function ResultScreen({
  result,
  onReset,
}: {
  result: OnboardingResult;
  onReset: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function copy(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2500);
    } catch {
      // The user can still select the content manually.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/20 px-6 py-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 font-bold text-emerald-400">
            ✓
          </div>
          <h2 className="text-lg font-semibold text-emerald-300">Clinic Onboarded Successfully</h2>
        </div>

        <div className="flex flex-col gap-4">
          <CopyRow label="Clinic Name" value={result.clinic_name} />
          <CopyRow
            label="Owner Email"
            value={result.owner_email}
            onCopy={() => copy(result.owner_email, 'email')}
            copied={copiedField === 'email'}
          />
          <CopyRow
            label="Device ID"
            value={result.device_id}
            mono
            onCopy={() => copy(result.device_id, 'device')}
            copied={copiedField === 'device'}
          />
          <CopyRow label="Expires" value={result.expires_at} />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              License Key
            </span>
            <div className="flex items-start gap-3">
              <code className="flex-1 break-all rounded-md bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed text-emerald-300 select-all">
                {result.license_key}
              </code>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  onClick={() => copy(result.license_key, 'license')}
                  className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
                >
                  {copiedField === 'license' ? 'Copied ✓' : 'Copy'}
                </button>
                <button
                  onClick={() => downloadLicenseFile(result.license_file)}
                  className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
                >
                  Download License File
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              This key is stored in the license audit log. You can also download a signed `.dpl` file for offline activation on the clinic desktop app.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onReset}>
          Onboard Another Clinic
        </Button>
        <a href="/dashboard/clinics">
          <Button variant="secondary">View All Clinics</Button>
        </a>
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  mono,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        <span className={['truncate text-sm text-slate-100', mono ? 'font-mono text-xs' : ''].join(' ')}>
          {value}
        </span>
      </div>
      {onCopy ? (
        <button
          onClick={onCopy}
          className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      ) : null}
    </div>
  );
}

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [stepError, setStepError] = useState<StepError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function update(field: keyof FormData, value: string) {
    setFormData((previous) => ({ ...previous, [field]: value }));
    setValidationError(null);
  }

  function handleNext() {
    const error = validateStep(step, formData);
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    setStep((current) => current + 1);
  }

  function handleBack() {
    setStep((current) => current - 1);
    setValidationError(null);
    setStepError(null);
  }

  async function handleSubmit() {
    setLoading(true);
    setStepError(null);

    try {
      const response = await fetch('/api/onboarding/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_name: formData.clinic_name.trim(),
          owner_name: formData.owner_name.trim(),
          phone: formData.phone.trim(),
          plan_type: formData.plan_type,
          expires_at: formData.expires_at,
          max_devices: parseInt(formData.max_devices, 10) || 1,
          notes: formData.notes.trim(),
          owner_email: formData.owner_email.trim(),
          temp_password: formData.temp_password,
          device_id: formData.device_id.trim().toUpperCase(),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        setStepError({
          failedStep: data.failedStep ?? 'unknown',
          error: data.error ?? 'An unknown error occurred',
        });
        return;
      }

      setResult(data.data as OnboardingResult);
    } catch {
      setStepError({
        failedStep: 'network',
        error: 'Network error - please try again.',
      });
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setStep(1);
    setFormData(emptyForm());
    setStepError(null);
    setValidationError(null);
  }

  if (result) {
    return <ResultScreen result={result} onReset={reset} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator current={step} />

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
        {step === 1 ? (
          <Step1Clinic data={formData} onChange={update} validationError={validationError} />
        ) : null}
        {step === 2 ? (
          <Step2Owner data={formData} onChange={update} validationError={validationError} />
        ) : null}
        {step === 3 ? (
          <Step3Device data={formData} onChange={update} validationError={validationError} />
        ) : null}
        {step === 4 ? <Step4Review data={formData} stepError={stepError} /> : null}
      </div>

      <div className="flex items-center justify-between">
        <div>
          {step > 1 ? (
            <Button variant="secondary" onClick={handleBack} disabled={loading}>
              &larr; Back
            </Button>
          ) : null}
        </div>
        <div>
          {step < 4 ? (
            <Button onClick={handleNext}>Continue &rarr;</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Running onboarding...' : 'Run Onboarding'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
