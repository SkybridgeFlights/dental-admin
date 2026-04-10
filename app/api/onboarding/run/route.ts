import { NextResponse } from 'next/server';
import { createSessionClient, createAdminClient } from '@/lib/supabase/server';
import { signDP3License } from '@/lib/license/sign';
import { writeAuditLog } from '@/lib/audit/log';

type PlanType = 'standard' | 'pro' | 'enterprise';

type OnboardingRequest = {
  clinic_name:   string;
  owner_name:    string;
  phone:         string;
  plan_type:     PlanType;
  expires_at:    string; // YYYY-MM-DD
  max_devices:   number;
  notes:         string;
  owner_email:   string;
  temp_password: string;
  device_id:     string; // DPDEV-XXXXXXXX
};

type FailedStep = 'input' | 'clinic' | 'auth_user' | 'profile' | 'device' | 'license';

function fail(failedStep: FailedStep, error: string, status = 400) {
  return NextResponse.json({ success: false, failedStep, error }, { status });
}

// ---------------------------------------------------------------------------
// Isolated rollback helpers — each catches its own error so a failure in one
// never prevents the remaining cleanup steps from running.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

async function rollbackClinic(admin: AdminClient, clinicId: string) {
  try {
    await admin.from('clinics').delete().eq('id', clinicId);
  } catch (err) {
    console.error('[onboarding/rollback] clinic delete failed', { clinicId, err });
  }
}

async function rollbackAuthUser(admin: AdminClient, userId: string) {
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch (err) {
    console.error('[onboarding/rollback] auth user delete failed', { userId, err });
  }
}

async function rollbackProfile(admin: AdminClient, userId: string) {
  try {
    await admin.from('profiles').delete().eq('id', userId);
  } catch (err) {
    console.error('[onboarding/rollback] profile delete failed', { userId, err });
  }
}

async function rollbackDevice(admin: AdminClient, deviceId: string) {
  try {
    await admin.from('devices').delete().eq('device_id', deviceId);
  } catch (err) {
    console.error('[onboarding/rollback] device delete failed', { deviceId, err });
  }
}

async function rollbackLicenseAudit(admin: AdminClient, clinicId: string, deviceId: string) {
  try {
    await admin.from('licenses').delete().eq('clinic_id', clinicId).eq('device_id', deviceId);
  } catch (err) {
    console.error('[onboarding/rollback] license audit delete failed', { clinicId, deviceId, err });
  }
}

// ---------------------------------------------------------------------------
// POST /api/onboarding/run
// Runs the full clinic onboarding pipeline server-side in a single request.
// Each step is labelled; on failure the response includes failedStep + error.
// Completed steps are rolled back in reverse order. Each rollback step is
// individually guarded so a failure in one does not skip subsequent cleanup.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  // --- Auth guard (mirrors /api/license/generate) ---
  const sessionClient = await createSessionClient();
  const { data: { user }, error: authError } = await sessionClient.auth.getUser();
  if (authError || !user) return fail('input', 'UNAUTHORIZED', 403);

  const whitelist = (process.env.ADMIN_EMAIL_WHITELIST ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (whitelist.length > 0 && !whitelist.includes(user.email?.toLowerCase() ?? '')) {
    return fail('input', 'FORBIDDEN', 403);
  }

  // --- Parse body ---
  let body: OnboardingRequest;
  try {
    body = await request.json();
  } catch {
    return fail('input', 'Invalid request body', 400);
  }

  const {
    clinic_name, owner_name, phone, plan_type, expires_at,
    max_devices, notes, owner_email, temp_password, device_id,
  } = body;

  // --- Input validation ---
  if (!clinic_name?.trim())  return fail('input', 'Clinic name is required');
  if (!owner_name?.trim())   return fail('input', 'Owner name is required');
  if (!owner_email?.trim())  return fail('input', 'Owner email is required');
  if (!temp_password || temp_password.length < 8) {
    return fail('input', 'Temporary password must be at least 8 characters');
  }
  if (!expires_at || !/^\d{4}-\d{2}-\d{2}$/.test(expires_at)) {
    return fail('input', 'Expiry date must be in YYYY-MM-DD format');
  }
  if (!device_id || !/^DPDEV-[0-9a-fA-F]{8}$/i.test(device_id.trim())) {
    return fail('input', 'Device ID must match format: DPDEV-XXXXXXXX (8 hex characters)');
  }

  const admin        = createAdminClient();
  const deviceIdNorm = device_id.trim().toUpperCase();
  const maxDevices   = Math.max(1, Number(max_devices) || 1);

  // ================================================================
  // STEP 1 — Create clinic
  // ================================================================
  const { data: clinic, error: clinicError } = await admin
    .from('clinics')
    .insert({
      clinic_name: clinic_name.trim(),
      owner_name:  owner_name.trim(),
      phone:       phone?.trim() ?? '',
      plan_type:   plan_type ?? 'standard',
      expires_at:  new Date(expires_at).toISOString(),
      max_devices: maxDevices,
      status:      'active',
      notes:       notes?.trim() ?? '',
    })
    .select('id')
    .single();

  if (clinicError || !clinic) {
    console.error('[onboarding/run] step=clinic', clinicError);
    return fail('clinic', clinicError?.message ?? 'Failed to create clinic');
  }
  const clinicId = clinic.id;

  // ================================================================
  // STEP 2 — Create owner auth user
  // ================================================================
  const { data: authData, error: authCreateError } =
    await admin.auth.admin.createUser({
      email:         owner_email.trim(),
      password:      temp_password,
      email_confirm: true, // allows immediate login without email verification
    });

  if (authCreateError || !authData.user) {
    console.error('[onboarding/run] step=auth_user', authCreateError);
    await rollbackClinic(admin, clinicId);
    return fail('auth_user', authCreateError?.message ?? 'Failed to create owner account');
  }
  const ownerId = authData.user.id;

  // ================================================================
  // STEP 3 — Create profile row linked to clinic
  // ================================================================
  const { error: profileError } = await admin.from('profiles').insert({
    id:        ownerId,
    email:     owner_email.trim(),
    full_name: owner_name.trim(),
    clinic_id: clinicId,
    role:      'owner',
    status:    'active',
  });

  if (profileError) {
    console.error('[onboarding/run] step=profile', profileError);
    await rollbackAuthUser(admin, ownerId);
    await rollbackClinic(admin, clinicId);
    return fail('profile', profileError.message ?? 'Failed to create owner profile');
  }

  // ================================================================
  // STEP 4 — Register or attach device
  // ================================================================

  // 4a. Conflict check — fail clearly if device belongs to a different clinic
  const { data: existingDevice, error: deviceLookupError } = await admin
    .from('devices')
    .select('device_id, clinic_id, status')
    .eq('device_id', deviceIdNorm)
    .maybeSingle();

  if (deviceLookupError) {
    console.error('[onboarding/run] step=device lookup', deviceLookupError);
    await rollbackProfile(admin, ownerId);
    await rollbackAuthUser(admin, ownerId);
    await rollbackClinic(admin, clinicId);
    return fail('device', 'Failed to look up device — database error');
  }

  if (existingDevice && existingDevice.clinic_id !== clinicId) {
    await rollbackProfile(admin, ownerId);
    await rollbackAuthUser(admin, ownerId);
    await rollbackClinic(admin, clinicId);
    return fail('device', 'This device is already registered to a different clinic');
  }

  const isNewDevice = !existingDevice;

  // 4b. max_devices enforcement — consistent with /api/license/generate
  // Only enforced for a device that is new to this clinic. If the device is
  // already linked to this clinic it doesn't consume an additional slot.
  if (isNewDevice) {
    const { count, error: countError } = await admin
      .from('devices')
      .select('device_id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'active');

    if (countError) {
      console.error('[onboarding/run] step=device count', countError);
      await rollbackProfile(admin, ownerId);
      await rollbackAuthUser(admin, ownerId);
      await rollbackClinic(admin, clinicId);
      return fail('device', 'Failed to check device count — database error');
    }

    if (count !== null && count >= maxDevices) {
      await rollbackProfile(admin, ownerId);
      await rollbackAuthUser(admin, ownerId);
      await rollbackClinic(admin, clinicId);
      return fail(
        'device',
        `Max devices reached: this clinic allows ${maxDevices} device${maxDevices !== 1 ? 's' : ''} and already has ${count}.`,
      );
    }
  }

  // 4c. Insert new device or re-activate existing one for this clinic
  if (isNewDevice) {
    const { error: deviceInsertError } = await admin.from('devices').insert({
      device_id:    deviceIdNorm,
      clinic_id:    clinicId,
      activated_at: new Date().toISOString(),
      status:       'active',
    });
    if (deviceInsertError) {
      console.error('[onboarding/run] step=device insert', deviceInsertError);
      await rollbackProfile(admin, ownerId);
      await rollbackAuthUser(admin, ownerId);
      await rollbackClinic(admin, clinicId);
      return fail('device', deviceInsertError.message ?? 'Failed to register device');
    }
  } else {
    // Same device, same clinic — re-activate and re-link cleanly
    const { error: deviceUpdateError } = await admin
      .from('devices')
      .update({ clinic_id: clinicId, status: 'active' })
      .eq('device_id', deviceIdNorm);
    if (deviceUpdateError) {
      console.error('[onboarding/run] step=device update', deviceUpdateError);
      await rollbackProfile(admin, ownerId);
      await rollbackAuthUser(admin, ownerId);
      await rollbackClinic(admin, clinicId);
      return fail('device', deviceUpdateError.message ?? 'Failed to attach device to clinic');
    }
  }

  // ================================================================
  // STEP 5 — Generate DP3 license
  // ================================================================
  let licenseKey: string;
  try {
    licenseKey = signDP3License(clinic_name.trim(), expires_at, plan_type ?? 'standard', deviceIdNorm, clinicId);
  } catch (err) {
    console.error('[onboarding/run] step=license sign', err);
    if (isNewDevice) await rollbackDevice(admin, deviceIdNorm);
    await rollbackProfile(admin, ownerId);
    await rollbackAuthUser(admin, ownerId);
    await rollbackClinic(admin, clinicId);
    return fail('license', 'License signing failed — check LICENSE_HMAC_SECRET configuration', 500);
  }

  const { error: licenseInsertError } = await admin.from('licenses').insert({
    clinic_id:    clinicId,
    device_id:    deviceIdNorm,
    license_key:  licenseKey,
    license_type: (plan_type ?? 'standard') as PlanType,
    expires_at:   new Date(expires_at).toISOString(),
    generated_by: user.email,
  });

  if (licenseInsertError) {
    console.error('[onboarding/run] step=license insert', licenseInsertError);
    // License key was signed but the audit record failed — rollback everything.
    // rollbackLicenseAudit is a best-effort guard in case a partial insert occurred.
    await rollbackLicenseAudit(admin, clinicId, deviceIdNorm);
    if (isNewDevice) await rollbackDevice(admin, deviceIdNorm);
    await rollbackProfile(admin, ownerId);
    await rollbackAuthUser(admin, ownerId);
    await rollbackClinic(admin, clinicId);
    return fail('license', licenseInsertError.message ?? 'Failed to save license record');
  }

  // ================================================================
  // All steps succeeded — write audit log
  // ================================================================
  await writeAuditLog({
    actorEmail: user.email!,
    action:     'onboarding.complete',
    targetType: 'clinic',
    targetId:   clinicId,
    metadata:   {
      clinic_name:  clinic_name.trim(),
      owner_email:  owner_email.trim(),
      device_id:    deviceIdNorm,
      plan_type:    plan_type ?? 'standard',
      expires_at,
    },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        clinic_id:   clinicId,
        clinic_name: clinic_name.trim(),
        owner_email: owner_email.trim(),
        device_id:   deviceIdNorm,
        license_key: licenseKey,
        expires_at,
      },
    },
    { status: 201 },
  );
}
