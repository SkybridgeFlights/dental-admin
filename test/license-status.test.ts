import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLicenseStatus,
  toOutcome,
  forceFailure,
  stagingFaultTarget,
  isFaultInjectionArmed,
  type ClinicRow,
  type LicenseRow,
} from '../lib/license/status';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const activeDevice = { status: 'active' };
const okClinic = (over: Partial<ClinicRow> = {}) =>
  ({ ok: true as const, data: { status: 'active', expires_at: '2027-01-01T00:00:00.000Z', ...over } });
const okLicense = (over: Partial<LicenseRow> = {}) =>
  ({ ok: true as const, data: { revoked_at: null, expires_at: '2027-06-30T00:00:00.000Z', ...over } });
const FAILED = { ok: false as const };

// ── A. confirmed revoked → revoked ───────────────────────────────────────────
test('A. confirmed revoked device → revoked', () => {
  const r = classifyLicenseStatus({
    device: { status: 'revoked' }, clinic: okClinic(), license: okLicense(), now: NOW,
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.status, 'revoked');
});

test('A2. suspended clinic → revoked', () => {
  const r = classifyLicenseStatus({
    device: activeDevice, clinic: okClinic({ status: 'suspended' }), license: okLicense(), now: NOW,
  });
  assert.equal(r.ok && r.status, 'revoked');
});

// ── B. confirmed active → active ─────────────────────────────────────────────
test('B. confirmed active lookup → active', () => {
  const r = classifyLicenseStatus({
    device: activeDevice, clinic: okClinic(), license: okLicense(), now: NOW,
  });
  assert.equal(r.ok && r.status, 'active');
  assert.equal(r.ok && r.expiryDate, '2027-06-30T00:00:00.000Z');
});

// ── C. confirmed expired → expired ───────────────────────────────────────────
test('C. expired licence date → expired', () => {
  const r = classifyLicenseStatus({
    device: activeDevice, clinic: okClinic(),
    license: okLicense({ expires_at: '2026-08-14T00:00:00.000Z' }), now: NOW,
  });
  assert.equal(r.ok && r.status, 'expired');
});

test('C2. inactive clinic → expired', () => {
  const r = classifyLicenseStatus({
    device: activeDevice, clinic: okClinic({ status: 'inactive' }), license: okLicense(), now: NOW,
  });
  assert.equal(r.ok && r.status, 'expired');
});

// ── D. licences query failure → unavailable (THE REGRESSION) ─────────────────
test('D. REGRESSION: licences query failure → STATUS_UNAVAILABLE, never revoked', () => {
  const r = classifyLicenseStatus({
    device: activeDevice, clinic: okClinic(), license: FAILED, now: NOW,
  });
  assert.equal(r.ok, false, 'a failed licences query must not be classified');
  assert.equal(!r.ok && r.reason, 'STATUS_UNAVAILABLE');
});

test('D2. licences failure stays unavailable even when device+clinic look healthy', () => {
  for (const deviceStatus of ['active', 'revoked', 'blocked']) {
    const r = classifyLicenseStatus({
      device: { status: deviceStatus }, clinic: okClinic(), license: FAILED, now: NOW,
    });
    // a revoked DEVICE is a confirmed fact, but we must not answer at all while
    // a status-critical read is failing
    assert.equal(r.ok, false, `device=${deviceStatus} must still be unavailable`);
  }
});

// ── E. clinics query failure → unavailable ───────────────────────────────────
test('E. clinics query failure → STATUS_UNAVAILABLE', () => {
  const r = classifyLicenseStatus({
    device: activeDevice, clinic: FAILED, license: okLicense(), now: NOW,
  });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'STATUS_UNAVAILABLE');
});

test('E2. clinic row missing (FK inconsistency) → unavailable, not revoked', () => {
  const r = classifyLicenseStatus({
    device: activeDevice, clinic: { ok: true, data: null }, license: okLicense(), now: NOW,
  });
  assert.equal(r.ok, false);
});

// ── F. null result distinguished from query failure ──────────────────────────
test('F. confirmed absent licence (ok,null) → revoked; failed query → unavailable', () => {
  const absent = classifyLicenseStatus({
    device: activeDevice, clinic: okClinic(), license: { ok: true, data: null }, now: NOW,
  });
  assert.equal(absent.ok && absent.status, 'revoked', 'a real "no row" answer is a confirmed revocation');

  const failed = classifyLicenseStatus({
    device: activeDevice, clinic: okClinic(), license: FAILED, now: NOW,
  });
  assert.equal(failed.ok, false, 'a failed query is NOT a confirmed revocation');
});

// ── G. no failure may become "revoked" because data is undefined ─────────────
test('G. no combination of failed reads ever yields revoked/expired/active', () => {
  const combos: Array<[unknown, unknown]> = [
    [FAILED, FAILED],
    [FAILED, okLicense()],
    [okClinic(), FAILED],
  ];
  for (const [clinic, license] of combos) {
    for (const deviceStatus of ['active', 'revoked', 'blocked']) {
      const r = classifyLicenseStatus({
        device: { status: deviceStatus },
        clinic: clinic as never,
        license: license as never,
        now: NOW,
      });
      assert.equal(r.ok, false, 'failed reads must never be classified');
    }
  }
});

test('G2. toOutcome maps any supabase error to failure, and null data to confirmed absence', () => {
  assert.deepEqual(toOutcome({ data: null, error: { message: 'boom' } }), { ok: false });
  assert.deepEqual(toOutcome({ data: null, error: { code: 'PGRST301' } }), { ok: false });
  assert.deepEqual(toOutcome({ data: null, error: null }), { ok: true, data: null });
  assert.deepEqual(toOutcome({ data: { a: 1 }, error: null }), { ok: true, data: { a: 1 } });
});

test('G3. forceFailure only ever narrows availability', () => {
  assert.deepEqual(forceFailure({ ok: true, data: { x: 1 } }), { ok: false });
  assert.deepEqual(forceFailure({ ok: false }), { ok: false });
});

// ── fault-injection safety ───────────────────────────────────────────────────
function req(headers: Record<string, string>) {
  return { headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
}

test('fault injection is inert unless DENTALPRO_ENVIRONMENT is staging', () => {
  const prev = process.env.DENTALPRO_ENVIRONMENT;
  try {
    for (const env of ['production', 'development', '', undefined]) {
      if (env === undefined) delete process.env.DENTALPRO_ENVIRONMENT;
      else process.env.DENTALPRO_ENVIRONMENT = env;
      assert.equal(
        stagingFaultTarget(req({ 'x-staging-fault-injection': 'licenses' })), null,
        `must be inert when DENTALPRO_ENVIRONMENT=${String(env)}`,
      );
    }
  } finally {
    if (prev === undefined) delete process.env.DENTALPRO_ENVIRONMENT;
    else process.env.DENTALPRO_ENVIRONMENT = prev;
  }
});

test('fault injection activates only for known targets in staging', () => {
  const prev = process.env.DENTALPRO_ENVIRONMENT;
  process.env.DENTALPRO_ENVIRONMENT = 'staging';
  try {
    assert.equal(stagingFaultTarget(req({ 'x-staging-fault-injection': 'licenses' })), 'licenses');
    assert.equal(stagingFaultTarget(req({ 'x-staging-fault-injection': 'clinics' })), 'clinics');
    assert.equal(stagingFaultTarget(req({ 'x-staging-fault-injection': 'devices' })), null);
    assert.equal(stagingFaultTarget(req({})), null, 'absent header must be inert');
  } finally {
    if (prev === undefined) delete process.env.DENTALPRO_ENVIRONMENT;
    else process.env.DENTALPRO_ENVIRONMENT = prev;
  }
});

// ── production fault-injection posture ───────────────────────────────────────
test('isFaultInjectionArmed is false for every non-staging environment', () => {
  const prev = process.env.DENTALPRO_ENVIRONMENT;
  try {
    for (const env of ['production', 'development', 'test', 'Staging', 'STAGING', '', undefined]) {
      if (env === undefined) delete process.env.DENTALPRO_ENVIRONMENT;
      else process.env.DENTALPRO_ENVIRONMENT = env;
      assert.equal(isFaultInjectionArmed(), false, `must be disarmed when env=${String(env)}`);
    }
    process.env.DENTALPRO_ENVIRONMENT = 'staging';
    assert.equal(isFaultInjectionArmed(), true, 'armed only for exact lowercase "staging"');
  } finally {
    if (prev === undefined) delete process.env.DENTALPRO_ENVIRONMENT;
    else process.env.DENTALPRO_ENVIRONMENT = prev;
  }
});

test('stagingFaultTarget agrees with isFaultInjectionArmed', () => {
  const prev = process.env.DENTALPRO_ENVIRONMENT;
  const req = { headers: { get: () => 'licenses' } };
  try {
    process.env.DENTALPRO_ENVIRONMENT = 'production';
    assert.equal(isFaultInjectionArmed(), false);
    assert.equal(stagingFaultTarget(req), null, 'no fault target while disarmed');
    process.env.DENTALPRO_ENVIRONMENT = 'staging';
    assert.equal(isFaultInjectionArmed(), true);
    assert.equal(stagingFaultTarget(req), 'licenses');
  } finally {
    if (prev === undefined) delete process.env.DENTALPRO_ENVIRONMENT;
    else process.env.DENTALPRO_ENVIRONMENT = prev;
  }
});
