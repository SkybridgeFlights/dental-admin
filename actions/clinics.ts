'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { writeAuditLog } from '@/lib/audit/log';

export type ClinicFormData = {
  clinic_name: string;
  owner_name:  string;
  phone:       string;
  plan_type:   'standard' | 'pro' | 'enterprise';
  expires_at:  string; // YYYY-MM-DD
  max_devices: number;
  status:      'active' | 'inactive' | 'suspended';
  notes:       string;
};

function parseClinicForm(formData: FormData): ClinicFormData {
  return {
    clinic_name: String(formData.get('clinic_name') ?? '').trim(),
    owner_name:  String(formData.get('owner_name')  ?? '').trim(),
    phone:       String(formData.get('phone')        ?? '').trim(),
    plan_type:   (formData.get('plan_type') as ClinicFormData['plan_type']) ?? 'standard',
    expires_at:  String(formData.get('expires_at')  ?? '').trim(),
    max_devices: Math.max(1, parseInt(String(formData.get('max_devices') ?? '1'), 10)),
    status:      (formData.get('status') as ClinicFormData['status']) ?? 'active',
    notes:       String(formData.get('notes') ?? '').trim(),
  };
}

function validateClinicForm(data: ClinicFormData): string | null {
  if (!data.clinic_name) return 'Clinic name is required';
  if (!data.owner_name)  return 'Owner name is required';
  if (!data.expires_at)  return 'Expiry date is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.expires_at)) return 'Expiry date must be YYYY-MM-DD';
  return null;
}

export async function createClinic(_prevState: string | null, formData: FormData) {
  const actor = await requireAdmin();

  const data = parseClinicForm(formData);
  const validationError = validateClinicForm(data);
  if (validationError) return validationError;

  const admin = createAdminClient();
  const { data: inserted, error } = await admin.from('clinics').insert({
    ...data,
    expires_at: new Date(data.expires_at).toISOString(),
  }).select('id').single();

  if (error) {
    console.error('[createClinic]', error);
    return 'Failed to create clinic. Please try again.';
  }

  await writeAuditLog({
    actorEmail: actor.email!,
    action:     'clinic.create',
    targetType: 'clinic',
    targetId:   inserted?.id,
    metadata:   { clinic_name: data.clinic_name, plan_type: data.plan_type },
  });

  revalidatePath('/dashboard/clinics');
  redirect('/dashboard/clinics');
}

export async function updateClinic(
  clinicId: string,
  _prevState: string | null,
  formData: FormData,
) {
  const actor = await requireAdmin();

  const data = parseClinicForm(formData);
  const validationError = validateClinicForm(data);
  if (validationError) return validationError;

  const admin = createAdminClient();
  const { error } = await admin
    .from('clinics')
    .update({
      ...data,
      expires_at: new Date(data.expires_at).toISOString(),
    })
    .eq('id', clinicId);

  if (error) {
    console.error('[updateClinic]', error);
    return 'Failed to update clinic. Please try again.';
  }

  await writeAuditLog({
    actorEmail: actor.email!,
    action:     'clinic.update',
    targetType: 'clinic',
    targetId:   clinicId,
    metadata:   { clinic_name: data.clinic_name, plan_type: data.plan_type },
  });

  revalidatePath('/dashboard/clinics');
  revalidatePath(`/dashboard/clinics/${clinicId}`);
  redirect(`/dashboard/clinics/${clinicId}`);
}

export async function setClinicStatus(
  clinicId: string,
  status: 'active' | 'inactive' | 'suspended',
) {
  const actor = await requireAdmin();

  const admin = createAdminClient();
  const { error } = await admin
    .from('clinics')
    .update({ status })
    .eq('id', clinicId);

  if (error) {
    console.error('[setClinicStatus]', error);
    throw new Error('Failed to update clinic status');
  }

  await writeAuditLog({
    actorEmail: actor.email!,
    action:     'clinic.status_change',
    targetType: 'clinic',
    targetId:   clinicId,
    metadata:   { status },
  });

  revalidatePath('/dashboard/clinics');
  revalidatePath(`/dashboard/clinics/${clinicId}`);
}

export async function deleteClinic(
  clinicId: string,
): Promise<{ error?: string; warning?: string }> {
  const actor = await requireAdmin();
  const admin = createAdminClient();

  const { data: clinic, error: clinicLookupError } = await admin
    .from('clinics')
    .select('id, clinic_name, owner_name')
    .eq('id', clinicId)
    .maybeSingle();

  if (clinicLookupError) {
    console.error('[deleteClinic] clinic lookup failed', clinicLookupError);
    return { error: 'Failed to load clinic details. Please try again.' };
  }

  if (!clinic) {
    return { error: 'Clinic not found.' };
  }

  const { data: profiles, error: profilesLookupError } = await admin
    .from('profiles')
    .select('id, email, role')
    .eq('clinic_id', clinicId);

  if (profilesLookupError) {
    console.error('[deleteClinic] profile lookup failed', profilesLookupError);
    return { error: 'Failed to load linked profiles. Please try again.' };
  }

  const { count: deletedLicenses, error: licenseDeleteError } = await admin
    .from('licenses')
    .delete({ count: 'exact' })
    .eq('clinic_id', clinicId);

  if (licenseDeleteError) {
    console.error('[deleteClinic] license delete failed', licenseDeleteError);
    return { error: 'Failed to delete linked licenses. Clinic was not removed.' };
  }

  const { count: deletedDevices, error: deviceDeleteError } = await admin
    .from('devices')
    .delete({ count: 'exact' })
    .eq('clinic_id', clinicId);

  if (deviceDeleteError) {
    console.error('[deleteClinic] device delete failed', deviceDeleteError);
    return { error: 'Failed to delete linked devices. Clinic was not removed.' };
  }

  const { count: deletedProfiles, error: profileDeleteError } = await admin
    .from('profiles')
    .delete({ count: 'exact' })
    .eq('clinic_id', clinicId);

  if (profileDeleteError) {
    console.error('[deleteClinic] profile delete failed', profileDeleteError);
    return { error: 'Failed to delete linked profiles. Clinic was not removed.' };
  }

  const { error: clinicDeleteError } = await admin
    .from('clinics')
    .delete()
    .eq('id', clinicId);

  if (clinicDeleteError) {
    console.error('[deleteClinic] clinic delete failed', clinicDeleteError);
    return { error: 'Failed to delete clinic. Please review linked data and try again.' };
  }

  const authDeletionFailures: string[] = [];
  for (const profile of profiles ?? []) {
    const { error } = await admin.auth.admin.deleteUser(profile.id);
    if (error) {
      console.error('[deleteClinic] auth user delete failed', {
        clinicId,
        userId: profile.id,
        email: profile.email,
        error,
      });
      authDeletionFailures.push(profile.email || profile.id);
    }
  }

  await writeAuditLog({
    actorEmail: actor.email!,
    action: 'clinic.delete',
    targetType: 'clinic',
    targetId: clinicId,
    metadata: {
      clinic_name: clinic.clinic_name,
      owner_name: clinic.owner_name,
      deleted_license_count: deletedLicenses ?? 0,
      deleted_device_count: deletedDevices ?? 0,
      deleted_profile_count: deletedProfiles ?? 0,
      auth_delete_failures: authDeletionFailures,
    },
  });

  revalidatePath('/dashboard/clinics');

  if (authDeletionFailures.length > 0) {
    return {
      warning: `Clinic deleted, but ${authDeletionFailures.length} auth account(s) could not be removed automatically.`,
    };
  }

  return {};
}
