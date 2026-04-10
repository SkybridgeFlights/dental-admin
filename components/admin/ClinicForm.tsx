'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';

type Clinic = {
  id?:         string;
  clinic_name: string;
  owner_name:  string;
  phone:       string;
  plan_type:   string;
  expires_at:  string;
  max_devices: number;
  status:      string;
  notes:       string;
};

type Props = {
  action: (prevState: string | null, formData: FormData) => Promise<string | null | void>;
  defaultValues?: Partial<Clinic>;
  submitLabel?: string;
};

// Format ISO date → YYYY-MM-DD for <input type="date">
function toDateInput(iso?: string) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function ClinicForm({ action, defaultValues = {}, submitLabel = 'Save' }: Props) {
  const [error, formAction, pending] = useActionState(action as any, null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="clinic_name"
          name="clinic_name"
          label="Clinic Name *"
          defaultValue={defaultValues.clinic_name ?? ''}
          placeholder="Al-Noor Dental Clinic"
          required
        />
        <Input
          id="owner_name"
          name="owner_name"
          label="Owner Name *"
          defaultValue={defaultValues.owner_name ?? ''}
          placeholder="Dr. Ahmed Al-Rashid"
          required
        />
        <Input
          id="phone"
          name="phone"
          label="Phone"
          defaultValue={defaultValues.phone ?? ''}
          placeholder="+966 5X XXX XXXX"
        />
        <Select
          id="plan_type"
          name="plan_type"
          label="Plan Type"
          defaultValue={defaultValues.plan_type ?? 'standard'}
        >
          <option value="standard">Standard</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </Select>
        <Input
          id="expires_at"
          name="expires_at"
          type="date"
          label="License Expires *"
          defaultValue={toDateInput(defaultValues.expires_at)}
          required
        />
        <Input
          id="max_devices"
          name="max_devices"
          type="number"
          min={1}
          max={50}
          label="Max Devices"
          defaultValue={String(defaultValues.max_devices ?? 1)}
        />
        <Select
          id="status"
          name="status"
          label="Status"
          defaultValue={defaultValues.status ?? 'active'}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      <Textarea
        id="notes"
        name="notes"
        label="Notes"
        defaultValue={defaultValues.notes ?? ''}
        placeholder="Internal notes..."
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
