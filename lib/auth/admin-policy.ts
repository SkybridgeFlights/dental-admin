const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AdminPolicyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'ADMIN_CONFIG_MISSING' | 'ADMIN_CONFIG_MALFORMED' | 'ADMIN_FORBIDDEN' };

export function parseAdminEmails(raw: string | undefined) {
  if (raw == null || raw.trim() === '') return { ok: false as const, reason: 'ADMIN_CONFIG_MISSING' as const };
  const values = raw.split(',').map((value) => value.trim().toLowerCase());
  if (values.some((value) => !value || !EMAIL.test(value))) {
    return { ok: false as const, reason: 'ADMIN_CONFIG_MALFORMED' as const };
  }
  return { ok: true as const, emails: new Set(values) };
}

export function authorizeAdminEmail(email: string | null | undefined, raw: string | undefined): AdminPolicyResult {
  const parsed = parseAdminEmails(raw);
  if (!parsed.ok) return parsed;
  const normalized = String(email || '').trim().toLowerCase();
  return parsed.emails.has(normalized)
    ? { ok: true, email: normalized }
    : { ok: false, reason: 'ADMIN_FORBIDDEN' };
}
