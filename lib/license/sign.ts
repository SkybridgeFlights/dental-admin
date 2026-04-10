import 'server-only'; // Hard guard — this module CANNOT be imported by any client component

import { createHmac } from 'crypto';

// Mirrors the signing logic in the desktop app's license-crypto-service.js exactly.
// Any change here MUST be mirrored there (and vice versa) or generated keys will fail validation.
//
// Desktop reference: electron/services/license-crypto-service.js → buildLicenseSigningData / signLicensePayload
//
// Signing data format:  clinicName|expiryDate|type(lower)|deviceId(UPPER)
// Key format (encoded): DP3-<base64url JSON>  ← used for all new licenses; supports clinicId
// Key format (inline):  DP3|clinicName|expiryDate|type|deviceId|SIGNATURE  ← legacy only
// Signature:            first 20 hex chars of HMAC-SHA256, UPPERCASED
//
// clinicId is embedded in the JSON payload but NOT in the HMAC signing data so that the
// signature scheme remains backward-compatible with old desktop builds. The desktop uses
// clinicId only for stable clinic-switch detection; it is not a security-sensitive field.

function buildSigningData(
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

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function signDP3License(
  clinicName: string,
  expiryDate: string,
  type: string,
  deviceId: string,
  clinicId?: string,
): string {
  const secret = process.env.LICENSE_HMAC_SECRET;
  if (!secret) {
    throw new Error('LICENSE_HMAC_SECRET is not configured');
  }

  const data = buildSigningData(clinicName, expiryDate, type, deviceId);
  const signature = createHmac('sha256', secret)
    .update(data)
    .digest('hex')
    .slice(0, 20)
    .toUpperCase();

  // Use encoded DP3 format so clinicId can travel with the license payload.
  // Old desktop builds (before clinicId support) will still parse and verify
  // correctly via their existing parseEncodedDp3LicenseKey path.
  const payload: Record<string, string> = {
    clinicName: clinicName.trim(),
    expiresAt: expiryDate.trim(),
    expiryDate: expiryDate.trim(),
    plan: type.trim().toLowerCase(),
    type: type.trim().toLowerCase(),
    deviceId: deviceId.trim().toUpperCase(),
    signature,
  };

  if (clinicId) {
    payload.clinicId = String(clinicId).trim();
  }

  return `DP3-${base64UrlEncode(JSON.stringify(payload))}`;
}
