import { createAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

type ProfileStatus = 'active' | 'inactive';

export type UpsertClinicAuthUserInput = {
  email: string;
  password?: string | null;
  fullName: string;
  clinicId: string;
  role: string;
  status: ProfileStatus;
  existingSupabaseUserId?: string | null;
};

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

export async function findAuthUserByEmail(admin: AdminClient, email: string) {
  const normalizedEmail = normalizeEmail(email);
  let page = 1;

  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw error;
    }

    const users = data?.users ?? [];
    const match = users.find((user) => normalizeEmail(user.email || '') === normalizedEmail);
    if (match) {
      return match;
    }

    if (users.length < 200) {
      return null;
    }

    page += 1;
  }

  return null;
}

async function getProfile(admin: AdminClient, userId: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('id, clinic_id, role, status')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertClinicAuthUser(input: UpsertClinicAuthUserInput) {
  const admin = createAdminClient();
  const email = normalizeEmail(input.email);
  const fullName = String(input.fullName || '').trim();
  const clinicId = String(input.clinicId || '').trim();
  const role = String(input.role || '').trim().toLowerCase();
  const status = input.status === 'inactive' ? 'inactive' : 'active';
  const password = String(input.password || '').trim();
  const existingSupabaseUserId = String(input.existingSupabaseUserId || '').trim();

  if (!email) {
    throw new Error('STAFF_EMAIL_REQUIRED');
  }
  if (!fullName) {
    throw new Error('STAFF_NAME_REQUIRED');
  }
  if (!clinicId) {
    throw new Error('CLINIC_ID_REQUIRED');
  }

  let authUser = existingSupabaseUserId
    ? (await admin.auth.admin.getUserById(existingSupabaseUserId)).data.user ?? null
    : null;

  if (!authUser) {
    authUser = await findAuthUserByEmail(admin, email);
  }

  if (!authUser) {
    if (!password) {
      throw new Error('PASSWORD_REQUIRED_FOR_NEW_AUTH_USER');
    }

    const createResult = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createResult.error || !createResult.data.user) {
      throw createResult.error || new Error('Failed to create Supabase auth user');
    }

    authUser = createResult.data.user;
  } else {
    const updatePayload: Record<string, unknown> = {
      email,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    };

    if (password) {
      updatePayload.password = password;
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(authUser.id, updatePayload);
    if (updateError) {
      throw updateError;
    }
  }

  const existingProfile = await getProfile(admin, authUser.id);
  if (existingProfile && existingProfile.clinic_id !== clinicId) {
    const conflict = new Error('SUPABASE_ACCOUNT_BELONGS_TO_OTHER_CLINIC');
    conflict.name = 'SUPABASE_ACCOUNT_BELONGS_TO_OTHER_CLINIC';
    throw conflict;
  }

  const profilePayload = {
    id: authUser.id,
    email,
    full_name: fullName,
    clinic_id: clinicId,
    role,
    status,
  };

  const { error: upsertError } = await admin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' });

  if (upsertError) {
    throw upsertError;
  }

  return {
    userId: authUser.id,
    profileStatus: status,
    mode: existingProfile ? 'updated' : 'created',
  };
}

