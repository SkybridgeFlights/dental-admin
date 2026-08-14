import { createPrivateKey, randomBytes, randomUUID, sign } from 'crypto';

export const LICENSE_SCHEMA = 'dentalpro-license/v4' as const;
export const LICENSE_ALGORITHM = 'Ed25519' as const;

export type OwnerBootstrapSource = {
  ownerEmail: string;
  ownerName: string;
  ownerSupabaseUserId: string;
  preferredLanguage?: string | null;
};

export type LicenseClaims = {
  schema: typeof LICENSE_SCHEMA;
  licenseId: string;
  clinicId: string;
  clinicName: string;
  deviceId: string;
  deviceCredential: string;
  edition: 'standard' | 'pro' | 'enterprise';
  issuedAt: string;
  expiresAt: string;
  bootstrap: null | {
    ownerEmail: string;
    ownerName: string;
    ownerSupabaseUserId: string;
    role: 'owner';
    preferredLanguage: string;
    grantNonce: string;
  };
};

export type LicenseEnvelope = {
  version: 'DP4-LICENSE-1';
  algorithm: typeof LICENSE_ALGORITHM;
  keyId: string;
  claims: LicenseClaims;
  signature: string;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function requirePrivateKey() {
  const raw = String(process.env.LICENSE_ED25519_PRIVATE_KEY || '').trim();
  if (!raw) throw new Error('LICENSE_ED25519_PRIVATE_KEY is not configured');
  const material = raw.includes('BEGIN PRIVATE KEY')
    ? raw.replace(/\\n/g, '\n')
    : Buffer.from(raw, 'base64').toString('utf8');
  const key = createPrivateKey(material);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('License signing key must be Ed25519');
  return key;
}

function normalizeExpiry(expiryDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) throw new Error('Invalid expiry date');
  return new Date(`${expiryDate}T23:59:59.999Z`).toISOString();
}

function createEnvelope(claims: LicenseClaims): LicenseEnvelope {
  const keyId = String(process.env.LICENSE_SIGNING_KEY_ID || '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error('LICENSE_SIGNING_KEY_ID is invalid');
  const signature = sign(null, Buffer.from(canonicalize(claims), 'utf8'), requirePrivateKey()).toString('base64url');
  return { version: 'DP4-LICENSE-1', algorithm: LICENSE_ALGORITHM, keyId, claims, signature };
}

export function createLicenseFilePayload(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
  clinicId = '',
  owner?: OwnerBootstrapSource | null,
): LicenseEnvelope {
  const edition = String(type).toLowerCase();
  if (!['standard', 'pro', 'enterprise'].includes(edition)) throw new Error('Invalid license edition');
  const claims: LicenseClaims = {
    schema: LICENSE_SCHEMA,
    licenseId: randomUUID(),
    clinicId: String(clinicId).trim(),
    clinicName: String(clinicName).trim(),
    deviceId: String(deviceId).trim().toUpperCase(),
    deviceCredential: randomBytes(32).toString('base64url'),
    edition: edition as LicenseClaims['edition'],
    issuedAt: new Date().toISOString(),
    expiresAt: normalizeExpiry(expiryDate),
    bootstrap: owner ? {
      ownerEmail: String(owner.ownerEmail).trim().toLowerCase(),
      ownerName: String(owner.ownerName).trim(),
      ownerSupabaseUserId: String(owner.ownerSupabaseUserId).trim(),
      role: 'owner',
      preferredLanguage: ['ar', 'de', 'en'].includes(String(owner.preferredLanguage)) ? String(owner.preferredLanguage) : 'en',
      grantNonce: randomUUID(),
    } : null,
  };
  if (!claims.clinicId || !claims.clinicName || !claims.deviceId) throw new Error('Incomplete license claims');
  return createEnvelope(claims);
}

export function signDP3License(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
  clinicId?: string,
): string {
  const envelope = createLicenseFilePayload(clinicName, expiryDate, type, deviceId, clinicId);
  return `DP4-${base64Url(JSON.stringify(envelope))}`;
}

export function encodeLicenseEnvelope(envelope: LicenseEnvelope) {
  return `DP4-${base64Url(JSON.stringify(envelope))}`;
}

export function createSignedLicenseArtifacts(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
  clinicId: string,
  owner?: OwnerBootstrapSource | null,
) {
  const licenseFile = createLicenseFilePayload(clinicName, expiryDate, type, deviceId, clinicId, owner);
  return { licenseFile, licenseKey: encodeLicenseEnvelope(licenseFile) };
}

export function parseDP3LicenseKey(value: string): LicenseClaims | null {
  const match = String(value || '').trim().match(/^DP4-([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  try {
    const envelope = JSON.parse(decodeBase64Url(match[1])) as LicenseEnvelope;
    return envelope.version === 'DP4-LICENSE-1' && envelope.claims?.schema === LICENSE_SCHEMA
      ? envelope.claims
      : null;
  } catch {
    return null;
  }
}

export { canonicalize };
