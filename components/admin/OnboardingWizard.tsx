'use client';

import { useState } from 'react';
import { Input }     from '@/components/ui/Input';
import { Select }    from '@/components/ui/Select';
import { Textarea }  from '@/components/ui/Textarea';
import { Button }    from '@/components/ui/Button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlanType = 'standard' | 'pro' | 'enterprise';

type FormData = {
  // Step 1 – Clinic Info
  clinic_name:  string;
  owner_name:   string;
  phone:        string;
  plan_type:    PlanType;
  expires_at:   string; // YYYY-MM-DD
  max_devices:  string;
  notes:        string;
  // Step 2 – Owner Account
  owner_email:  string;
  temp_password: string;
  // Step 3 – Device
  device_id:    string;
};

type OnboardingResult = {
  clinic_id:   string;
  clinic_name: string;
  owner_email: string;
  device_id:   string;
  license_key: string;
  expires_at:  string;
};

type StepError = {
  failedStep: string;
  error:      string;
};

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, label: 'Clinic Info'    },
  { id: 2, label: 'Owner Account'  },
  { id: 3, label: 'Device'         },
  { id: 4, label: 'Review'         },
] as const;

const STEP_LABELS: Record<string, string> = {
  input:     'Input Validation',
  clinic:    'Step 1 – Create Clinic',
  auth_user: 'Step 2 – Create Owner Account',
  profile:   'Step 3 – Create Profile',
  device:    'Step 4 – Register Device',
  license:   'Step 5 – Generate License',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyForm(): FormData {
  return {
    clinic_name: '', owner_name: '', phone: '',
    plan_type: 'standard', expires_at: '', max_devices: '1', notes: '',
    owner_email: '', temp_password: '', device_id: '',
  };
}

function validateStep(step: number, data: FormData): string | null {
  if (step === 1) {
    if (!data.clinic_name.trim()) return 'Clinic name is required';
    if (!data.owner_name.trim())  return 'Owner name is required';
    if (!data.expires_at)         return 'Expiry date is required';
  }
  if (step === 2) {
    if (!data.owner_email.trim())            return 'Owner email is required';
    if (!data.owner_email.includes('@'))     return 'Enter a valid email address';
    if (data.temp_password.length < 8)       return 'Temporary password must be at least 8 characters';
  }
  if (step === 3) {
    if (!data.device_id.trim()) return 'Device ID is required';
    if (!/^DPDEV-[0-9a-fA-F]{8}$/i.test(data.device_id.trim())) {
      return 'Device ID must match format: DPDEV-XXXXXXXX (8 hex characters)';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding progress" className="flex items-center gap-0 flex-wrap gap-y-2">
      {STEPS.map((s, i) => {
        const done    = s.id < current;
        const active  = s.id === current;
        return (
          <div key={s.id} className="flex items-center">
            <div className={[
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors',
              done   ? 'bg-emerald-500 text-white' :
              active ? 'bg-blue-500 text-white'    :
                       'bg-slate-700 text-slate-400',
            ].join(' ')}>
              {done ? '✓' : s.id}
            </div>
            <span className={[
              'ml-2 text-sm font-medium',
              active ? 'text-slate-100' : 'text-slate-500',
            ].join(' ')}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={[
                'mx-4 h-px w-8 flex-shrink-0',
                done ? 'bg-emerald-500' : 'bg-slate-700',
              ].join(' ')} />
            )}
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

// Step 1 — Clinic Info
function Step1Clinic({
  data, onChange, validationError,
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

      {validationError && <ValidationError message={validationError} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="clinic_name" label="Clinic Name *"
          value={data.clinic_name}
          onChange={(e) => onChange('clinic_name', e.target.value)}
          placeholder="Al-Noor Dental Clinic"
          required
        />
        <Input
          id="owner_name" label="Owner Name *"
          value={data.owner_name}
          onChange={(e) => onChange('owner_name', e.target.value)}
          placeholder="Dr. Ahmed Al-Rashid"
          required
        />
        <Input
          id="phone" label="Phone"
          value={data.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          placeholder="+966 5X XXX XXXX"
        />
        <Select
          id="plan_type" label="Plan Type"
          value={data.plan_type}
          onChange={(e) => onChange('plan_type', e.target.value)}
        >
          <option value="standard">Standard</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </Select>
        <Input
          id="expires_at" label="License Expires *"
          type="date" value={data.expires_at}
          onChange={(e) => onChange('expires_at', e.target.value)}
          required
        />
        <Input
          id="max_devices" label="Max Devices"
          type="number" min={1} max={50}
          value={data.max_devices}
          onChange={(e) => onChange('max_devices', e.target.value)}
        />
      </div>

      <Textarea
        id="notes" label="Notes"
        value={data.notes}
        onChange={(e) => onChange('notes', e.target.value)}
        placeholder="Internal notes about this clinic…"
      />
    </div>
  );
}

// Step 2 — Owner Account
function Step2Owner({
  data, onChange, validationError,
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

      {validationError && <ValidationError message={validationError} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="owner_email" label="Owner Email *"
          type="email"
          value={data.owner_email}
          onChange={(e) => onChange('owner_email', e.target.value)}
          placeholder="owner@clinic.com"
          required
          className="sm:col-span-2"
        />
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="temp_password" className="text-sm font-medium text-slate-300">
            Temporary Password * <span className="text-slate-500 font-normal">(min 8 characters)</span>
          </label>
          <div className="relative">
            <input
              id="temp_password"
              type={showPassword ? 'text' : 'password'}
              value={data.temp_password}
              onChange={(e) => onChange('temp_password', e.target.value)}
              placeholder="Temporary password"
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 pr-20 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-amber-700/40 bg-amber-900/20 px-4 py-3 text-xs text-amber-300">
        The account will be created as confirmed so the owner can log in immediately.
        Share the temporary password securely — the owner should change it on first login.
      </div>
    </div>
  );
}

// Step 3 — Device
function Step3Device({
  data, onChange, validationError,
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
          The device this license will be locked to. If it doesn't exist yet it will be created.
          If it already belongs to another clinic the workflow will fail clearly.
        </p>
      </div>

      {validationError && <ValidationError message={validationError} />}

      <Input
        id="device_id" label="Device ID *"
        value={data.device_id}
        onChange={(e) => onChange('device_id', e.target.value.toUpperCase())}
        placeholder="DPDEV-A1B2C3D4"
        className="font-mono uppercase placeholder:normal-case"
        required
      />

      <div className="rounded-md border border-slate-700 bg-slate-800 px-4 py-3 text-xs text-slate-400">
        Format: <code className="font-mono text-slate-300">DPDEV-</code> followed by exactly 8 hexadecimal characters (0–9, A–F).
        The device ID is generated by the DP3 desktop application on first launch.
      </div>
    </div>
  );
}

// Step 4 — Review
function Step4Review({
  data, stepError,
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

      {stepError && (
        <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          <span className="font-semibold block mb-0.5">
            {STEP_LABELS[stepError.failedStep] ?? stepError.failedStep} failed
          </span>
          {stepError.error}
        </div>
      )}

      <div className="divide-y divide-slate-700/60 rounded-xl border border-slate-700 bg-slate-900">
        <Section title="Clinic">
          <Row label="Name"        value={data.clinic_name} />
          <Row label="Owner"       value={data.owner_name} />
          <Row label="Phone"       value={data.phone || '—'} />
          <Row label="Plan"        value={data.plan_type} capitalize />
          <Row label="Expires"     value={data.expires_at} />
          <Row label="Max devices" value={data.max_devices} />
          {data.notes && <Row label="Notes" value={data.notes} />}
        </Section>
        <Section title="Owner Account">
          <Row label="Email"    value={data.owner_email} />
          <Row label="Password" value={'•'.repeat(Math.min(data.temp_password.length, 12))} mono />
        </Section>
        <Section title="Device">
          <Row label="Device ID" value={data.device_id.toUpperCase()} mono />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({
  label, value, mono, capitalize,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={[
        'text-sm text-slate-200 text-right',
        mono ? 'font-mono text-xs' : '',
        capitalize ? 'capitalize' : '',
      ].join(' ')}>
        {String(value)}
      </span>
    </div>
  );
}

// Result screen
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
      // clipboard not available — user can select manually
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/20 px-6 py-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
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

          {/* License key — full-width with code block */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              License Key
            </span>
            <div className="flex items-start gap-3">
              <code className="flex-1 break-all rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300 select-all leading-relaxed">
                {result.license_key}
              </code>
              <button
                onClick={() => copy(result.license_key, 'license')}
                className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                {copiedField === 'license' ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              This key is stored in the license audit log. Hand it to the clinic owner to activate their device.
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
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
  label, value, mono, onCopy, copied,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        <span className={[
          'text-sm text-slate-100 truncate',
          mono ? 'font-mono text-xs' : '',
        ].join(' ')}>
          {value}
        </span>
      </div>
      {onCopy && (
        <button
          onClick={onCopy}
          className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export function OnboardingWizard() {
  const [step,            setStep]            = useState(1);
  const [formData,        setFormData]        = useState<FormData>(emptyForm);
  const [loading,         setLoading]         = useState(false);
  const [result,          setResult]          = useState<OnboardingResult | null>(null);
  const [stepError,       setStepError]       = useState<StepError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function update(field: keyof FormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setValidationError(null);
  }

  function handleNext() {
    const err = validateStep(step, formData);
    if (err) { setValidationError(err); return; }
    setValidationError(null);
    setStep((s) => s + 1);
  }

  function handleBack() {
    setStep((s) => s - 1);
    setValidationError(null);
    setStepError(null);
  }

  async function handleSubmit() {
    setLoading(true);
    setStepError(null);

    try {
      const res = await fetch('/api/onboarding/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_name:  formData.clinic_name.trim(),
          owner_name:   formData.owner_name.trim(),
          phone:        formData.phone.trim(),
          plan_type:    formData.plan_type,
          expires_at:   formData.expires_at,
          max_devices:  parseInt(formData.max_devices, 10) || 1,
          notes:        formData.notes.trim(),
          owner_email:  formData.owner_email.trim(),
          temp_password: formData.temp_password,
          device_id:    formData.device_id.trim().toUpperCase(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setStepError({
          failedStep: data.failedStep ?? 'unknown',
          error:      data.error     ?? 'An unknown error occurred',
        });
        return;
      }

      setResult(data.data as OnboardingResult);
    } catch {
      setStepError({ failedStep: 'network', error: 'Network error — please try again.' });
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
      {/* Progress */}
      <StepIndicator current={step} />

      {/* Step content */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
        {step === 1 && (
          <Step1Clinic data={formData} onChange={update} validationError={validationError} />
        )}
        {step === 2 && (
          <Step2Owner data={formData} onChange={update} validationError={validationError} />
        )}
        {step === 3 && (
          <Step3Device data={formData} onChange={update} validationError={validationError} />
        )}
        {step === 4 && (
          <Step4Review data={formData} stepError={stepError} />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {step > 1 && (
            <Button variant="secondary" onClick={handleBack} disabled={loading}>
              ← Back
            </Button>
          )}
        </div>
        <div>
          {step < 4 ? (
            <Button onClick={handleNext}>Continue →</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Running onboarding…' : 'Run Onboarding'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
