import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAdminEmail } from '../lib/auth/admin-policy';

test('admin policy fails closed for missing, empty, and malformed configuration', () => {
  assert.equal(authorizeAdminEmail('admin@example.test', undefined).ok, false);
  assert.equal(authorizeAdminEmail('admin@example.test', '').ok, false);
  assert.equal(authorizeAdminEmail('admin@example.test', 'not-an-email').ok, false);
});
test('ordinary users are rejected and configured admins are accepted', () => {
  assert.deepEqual(authorizeAdminEmail('user@example.test', 'admin@example.test'), { ok: false, reason: 'ADMIN_FORBIDDEN' });
  assert.deepEqual(authorizeAdminEmail('ADMIN@example.test', 'admin@example.test'), { ok: true, email: 'admin@example.test' });
});
