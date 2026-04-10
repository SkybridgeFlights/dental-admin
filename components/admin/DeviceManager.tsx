'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DeviceStatusBadge } from './StatusBadge';
import { DangerConfirmModal } from './DangerConfirmModal';
import { setDeviceStatus, unassignDevice } from '@/actions/devices';

export type DeviceRow = {
  device_id: string;
  activated_at: string;
  last_seen_at: string | null;
  status: 'active' | 'revoked' | 'blocked';
};

function formatDate(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysSince(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function DeviceManager({
  devices,
  clinicId,
}: {
  devices: DeviceRow[];
  clinicId: string;
}) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeviceId, setConfirmDeviceId] = useState<string | null>(null);

  async function handleStatusChange(deviceId: string, newStatus: 'active' | 'revoked') {
    setLoadingId(deviceId);
    setActionError(null);

    const result = await setDeviceStatus(deviceId, clinicId, newStatus);
    if (result?.error) {
      setActionError(result.error);
    } else {
      router.refresh();
    }

    setLoadingId(null);
  }

  async function handleUnassign(deviceId: string) {
    setLoadingId(deviceId);
    setActionError(null);

    const result = await unassignDevice(deviceId, clinicId);
    if (result?.error) {
      setActionError(result.error);
    } else {
      setConfirmDeviceId(null);
      router.refresh();
    }

    setLoadingId(null);
  }

  if (devices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No devices registered yet. Generate a license to register the first device.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {actionError && (
        <div className="rounded-md border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-700/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/60 bg-slate-800/80">
              <th className="px-4 py-3 text-left font-medium text-slate-400">Device ID</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Activated</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Last Seen</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {devices.map((device) => {
              const busy = loadingId === device.device_id;
              return (
                <tr
                  key={device.device_id}
                  className="bg-slate-800/40 transition-colors hover:bg-slate-800/80"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-100">{device.device_id}</td>
                  <td className="px-4 py-3 text-slate-300">{formatDate(device.activated_at)}</td>
                  <td className="px-4 py-3">
                    <span className="text-slate-300">{formatDate(device.last_seen_at)}</span>
                    <span className="ml-2 text-xs text-slate-500">{daysSince(device.last_seen_at)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <DeviceStatusBadge status={device.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {device.status === 'active' && (
                        <button
                          onClick={() => handleStatusChange(device.device_id, 'revoked')}
                          disabled={busy}
                          className="text-xs text-red-400 transition-colors hover:text-red-300 disabled:opacity-40"
                        >
                          {busy ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                      {device.status === 'revoked' && (
                        <button
                          onClick={() => handleStatusChange(device.device_id, 'active')}
                          disabled={busy}
                          className="text-xs text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-40"
                        >
                          {busy ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      )}
                      {device.status === 'blocked' && (
                        <span className="text-xs italic text-slate-500">Blocked</span>
                      )}
                      {device.status !== 'blocked' && (
                        <button
                          onClick={() => setConfirmDeviceId(device.device_id)}
                          disabled={busy}
                          className="text-xs text-amber-400 transition-colors hover:text-amber-300 disabled:opacity-40"
                        >
                          {busy ? 'Removing…' : 'Unassign'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DangerConfirmModal
        open={Boolean(confirmDeviceId)}
        title="Unassign Device"
        message="This removes the device from the clinic and deletes its linked license records so the same Device ID can be used again during onboarding. Other clinic records stay intact."
        confirmLabel="Unassign Device"
        confirmTone="warning"
        busy={Boolean(confirmDeviceId && loadingId === confirmDeviceId)}
        onCancel={() => {
          if (!loadingId) {
            setConfirmDeviceId(null);
          }
        }}
        onConfirm={() => {
          if (confirmDeviceId) {
            handleUnassign(confirmDeviceId);
          }
        }}
      />
    </div>
  );
}
