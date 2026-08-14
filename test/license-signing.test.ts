import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { canonicalize, createSignedLicenseArtifacts, parseDP3LicenseKey } from '../lib/license/sign';

test('server creates a verifiable DP4 envelope with deterministic claims', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  process.env.LICENSE_ED25519_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.LICENSE_SIGNING_KEY_ID = 'test-key';
  const result = createSignedLicenseArtifacts('Synthetic Clinic', '2027-12-31', 'pro',
    'DPDEV-0123456789ABCDEF0123456789ABCDEF', '11111111-1111-4111-8111-111111111111');
  assert.match(result.licenseKey, /^DP4-/);
  assert.equal(parseDP3LicenseKey(result.licenseKey)?.edition, 'pro');
  assert.equal(verify(null, Buffer.from(canonicalize(result.licenseFile.claims)), publicKey,
    Buffer.from(result.licenseFile.signature, 'base64url')), true);
});
