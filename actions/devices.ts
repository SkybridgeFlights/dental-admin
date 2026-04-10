'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { writeAuditLog } from '@/lib/audit/log';

/**
 * Revoke or reactivate a device that belongs to a specific clinic.
 *
 * Ownership is verified server-side: the device must have clinic_id = clinicId
 * before any status change is applied. Blocked devices are not changeable here —
 * that is a platform-level action outside the admin dashboard.
 *
 * Revoking a device causes /api/license/check to return status: 'revoked'
 * to the desktop app on the next heartbeat — no IPC changes needed.
 */
export async function setDeviceStatus(
  deviceId: string,
  clinicId: string,
  status:   'active' | 'revoked',
): Promise<{ error?: string }> {
  const actor = await requireAdmin();

  const admin = createAdminClient();

  // Ownership + current-state check
  const { data: device, error: lookupError } = await admin
    .from('devices')
    .select('device_id, clinic_id, status')
    .eq('device_id', deviceId)
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (lookupError) {
    console.error('[setDeviceStatus] lookup failed', lookupError);
    return { error: 'Database error — could not look up device.' };
  }

  if (!device) {
    return { error: 'Device not found or does not belong to this clinic.' };
  }

  if (device.status === 'blocked') {
    return { error: 'Blocked devices cannot be changed here. Contact platform support.' };
  }

  if (device.status === status) {
    // Already in the desired state — treat as success, not an error
    return {};
  }

  const { error: updateError } = await admin
    .from('devices')
    .update({ status })
    .eq('device_id', deviceId)
    .eq('clinic_id', clinicId);

  if (updateError) {
    console.error('[setDeviceStatus] update failed', updateError);
    return { error: 'Failed to update device status. Please try again.' };
  }

  await writeAuditLog({
    actorEmail: actor.email!,
    action:     'device.status_change',
    targetType: 'device',
    targetId:   deviceId,
    metadata:   { clinic_id: clinicId, status },
  });

  revalidatePath(`/dashboard/clinics/${clinicId}`);
  return {};
}

export async function unassignDevice(
  deviceId: string,
  clinicId: string,
): Promise<{ error?: string }> {
  const actor = await requireAdmin();
  const admin = createAdminClient();

  const { data: device, error: lookupError } = await admin
    .from('devices')
    .select('device_id, clinic_id, status')
    .eq('device_id', deviceId)
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (lookupError) {
    console.error('[unassignDevice] lookup failed', lookupError);
    return { error: 'Database error — could not look up device.' };
  }

  if (!device) {
    return { error: 'Device not found or does not belong to this clinic.' };
  }

  if (device.status === 'blocked') {
    return { error: 'Blocked devices cannot be unassigned here. Contact platform support.' };
  }

  const { count: deletedLicenses, error: licenseDeleteError } = await admin
    .from('licenses')
    .delete({ count: 'exact' })
    .eq('clinic_id', clinicId)
    .eq('device_id', deviceId);

  if (licenseDeleteError) {
    console.error('[unassignDevice] license delete failed', licenseDeleteError);
    return { error: 'Failed to remove device licenses. Please try again.' };
  }

  const { error: deviceDeleteError } = await admin
    .from('devices')
    .delete()
    .eq('device_id', deviceId)
    .eq('clinic_id', clinicId);

  if (deviceDeleteError) {
    console.error('[unassignDevice] device delete failed', deviceDeleteError);
    return { error: 'Failed to unassign device. Please try again.' };
  }

  await writeAuditLog({
    actorEmail: actor.email!,
    action: 'device.unassign',
    targetType: 'device',
    targetId: deviceId,
    metadata: {
      clinic_id: clinicId,
      previous_status: device.status,
      deleted_license_count: deletedLicenses ?? 0,
    },
  });

  revalidatePath('/dashboard/clinics');
  revalidatePath(`/dashboard/clinics/${clinicId}`);
  return {};
}
