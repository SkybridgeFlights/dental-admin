import 'server-only';

import { createHmac, randomUUID } from 'crypto';

export type OwnerBootstrapSource = {
  ownerEmail: string;
  ownerName: string;
  ownerSupabaseUserId: string;
  preferredLanguage?: string | null;
};

export type LicenseBootstrapGrant = {
  version: 'DP3-BOOTSTRAP-1';
  ownerEmail: string;
  ownerName: string;
  ownerSupabaseUserId: string;
  role: 'owner';
  preferredLanguage: string;
  issuedAt: string;
  grantNonce: string;
  signature: string;
};

export type LicenseFilePayload = {
  version: 'DP3-LICENSE-FILE-1';
  clinicId: string;
  clinicName: string;
  deviceId: string;
  expiresAt: string;
  expiryDate: string;
  plan: string;
  type: string;
  signature: string;
  bootstrapGrant: LicenseBootstrapGrant | null;
};

type LicensePayload = {
  clinicId?: string;
  clinicName: string;
  expiresAt: string;
  expiryDate: string;
  plan: string;
  type: string;
  deviceId: string;
  signature: string;
};

function requireLicenseSecret() {
  const secret = String(process.env.LICENSE_HMAC_SECRET || '').trim();
  if (!secret) {
    throw new Error('LICENSE_HMAC_SECRET is not configured');
  }
  return secret;
}

function signWithSecret(data: string) {
  return createHmac('sha256', requireLicenseSecret())
    .update(data)
    .digest('hex')
    .slice(0, 20)
    .toUpperCase();
}

function buildLicenseSigningData(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
): string {
  return [
    clinicName.trim(),
    expiryDate.trim(),
    type.trim().toLowerCase(),
    deviceId.trim().toUpperCase(),
  ].join('|');
}

function buildBootstrapSigningData(input: {
  clinicId: string;
  clinicName: string;
  deviceId: string;
  ownerEmail: string;
  ownerSupabaseUserId: string;
  role: string;
  issuedAt: string;
  grantNonce: string;
}) {
  return [
    'bootstrap',
    String(input.clinicId || '').trim(),
    String(input.clinicName || '').trim(),
    String(input.deviceId || '').trim().toUpperCase(),
    String(input.ownerEmail || '').trim().toLowerCase(),
    String(input.ownerSupabaseUserId || '').trim(),
    String(input.role || '').trim().toLowerCase(),
    String(input.issuedAt || '').trim(),
    String(input.grantNonce || '').trim(),
  ].join('|');
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function buildLicensePayload(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
  clinicId?: string,
): LicensePayload {
  const normalizedClinicName = clinicName.trim();
  const normalizedExpiryDate = expiryDate.trim();
  const normalizedType = type.trim().toLowerCase();
  const normalizedDeviceId = deviceId.trim().toUpperCase();

  const payload: LicensePayload = {
    clinicName: normalizedClinicName,
    expiresAt: normalizedExpiryDate,
    expiryDate: normalizedExpiryDate,
    plan: normalizedType,
    type: normalizedType,
    deviceId: normalizedDeviceId,
    signature: signWithSecret(
      buildLicenseSigningData(
        normalizedClinicName,
        normalizedExpiryDate,
        normalizedType,
        normalizedDeviceId,
      ),
    ),
  };

  if (clinicId) {
    payload.clinicId = String(clinicId).trim();
  }

  return payload;
}

export function createBootstrapGrant(params: {
  clinicId: string;
  clinicName: string;
  deviceId: string;
  ownerEmail: string;
  ownerName: string;
  ownerSupabaseUserId: string;
  preferredLanguage?: string | null;
  issuedAt?: string;
  grantNonce?: string;
}): LicenseBootstrapGrant {
  const issuedAt = String(params.issuedAt || '').trim() || new Date().toISOString();
  const grantNonce = String(params.grantNonce || '').trim() || randomUUID();

  const grant = {
    version: 'DP3-BOOTSTRAP-1' as const,
    ownerEmail: String(params.ownerEmail || '').trim().toLowerCase(),
    ownerName: String(params.ownerName || '').trim(),
    ownerSupabaseUserId: String(params.ownerSupabaseUserId || '').trim(),
    role: 'owner' as const,
    preferredLanguage: ['ar', 'de', 'en'].includes(String(params.preferredLanguage || '').trim())
      ? String(params.preferredLanguage || '').trim()
      : 'en',
    issuedAt,
    grantNonce,
    signature: '',
  };

  grant.signature = signWithSecret(
    buildBootstrapSigningData({
      clinicId: String(params.clinicId || '').trim(),
      clinicName: String(params.clinicName || '').trim(),
      deviceId: String(params.deviceId || '').trim(),
      ownerEmail: grant.ownerEmail,
      ownerSupabaseUserId: grant.ownerSupabaseUserId,
      role: grant.role,
      issuedAt: grant.issuedAt,
      grantNonce: grant.grantNonce,
    }),
  );

  return grant;
}

export function createLicenseFilePayload(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
  clinicId?: string,
  ownerBootstrap?: OwnerBootstrapSource | null,
): LicenseFilePayload {
  const payload = buildLicensePayload(clinicName, expiryDate, type, deviceId, clinicId);
  const bootstrapGrant = clinicId && ownerBootstrap?.ownerEmail && ownerBootstrap?.ownerSupabaseUserId
    ? createBootstrapGrant({
        clinicId,
        clinicName: payload.clinicName,
        deviceId: payload.deviceId,
        ownerEmail: ownerBootstrap.ownerEmail,
        ownerName: ownerBootstrap.ownerName,
        ownerSupabaseUserId: ownerBootstrap.ownerSupabaseUserId,
        preferredLanguage: ownerBootstrap.preferredLanguage,
      })
    : null;

  return {
    version: 'DP3-LICENSE-FILE-1',
    clinicId: payload.clinicId || '',
    clinicName: payload.clinicName,
    deviceId: payload.deviceId,
    expiresAt: payload.expiresAt,
    expiryDate: payload.expiryDate,
    plan: payload.plan,
    type: payload.type,
    signature: payload.signature,
    bootstrapGrant,
  };
}

export function signDP3License(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
  clinicId?: string,
): string {
  const payload = buildLicensePayload(clinicName, expiryDate, type, deviceId, clinicId);
  return `DP3-${base64UrlEncode(JSON.stringify(payload))}`;
}

export function parseDP3LicenseKey(licenseKey: string): LicensePayload | null {
  const match = String(licenseKey || '').trim().match(/^DP3-([A-Za-z0-9\-_]+)$/);
  if (!match) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(match[1]));
    if (
      !payload
      || !payload.clinicName
      || !(payload.expiryDate || payload.expiresAt)
      || !(payload.type || payload.plan)
      || !payload.deviceId
      || !payload.signature
    ) {
      return null;
    }

    return {
      clinicId: String(payload.clinicId || '').trim() || undefined,
      clinicName: String(payload.clinicName || '').trim(),
      expiresAt: String(payload.expiresAt || payload.expiryDate || '').trim(),
      expiryDate: String(payload.expiryDate || payload.expiresAt || '').trim(),
      plan: String(payload.plan || payload.type || '').trim().toLowerCase(),
      type: String(payload.type || payload.plan || '').trim().toLowerCase(),
      deviceId: String(payload.deviceId || '').trim().toUpperCase(),
      signature: String(payload.signature || '').trim().toUpperCase(),
    };
  } catch {
    return null;
  }
}
