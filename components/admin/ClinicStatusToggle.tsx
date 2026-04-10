'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { setClinicStatus } from '@/actions/clinics';

type Props = {
  clinicId: string;
  currentStatus: 'active' | 'inactive' | 'suspended';
};

export function ClinicStatusToggle({ clinicId, currentStatus }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handle(status: 'active' | 'inactive' | 'suspended') {
    setPending(true);
    setError(null);
    try {
      await setClinicStatus(clinicId, status);
    } catch {
      setError('Failed to update status. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {currentStatus !== 'active' && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => handle('active')}>
            Set Active
          </Button>
        )}
        {currentStatus !== 'inactive' && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => handle('inactive')}>
            Deactivate
          </Button>
        )}
        {currentStatus !== 'suspended' && (
          <Button variant="danger" size="sm" disabled={pending} onClick={() => handle('suspended')}>
            Suspend
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
