import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';

export type AuditAction =
  | 'clinic.create'
  | 'clinic.update'
  | 'clinic.status_change'
  | 'clinic.delete'
  | 'device.status_change'
  | 'device.unassign'
  | 'license.generate'
  | 'license.regenerate'
  | 'onboarding.complete';

export type AuditTargetType = 'clinic' | 'device' | 'license';

export interface AuditEntry {
  actorEmail: string;
  action: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes a single audit log entry to admin_audit_logs.
 * Never throws — failures are logged to stderr only.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('admin_audit_logs').insert({
      actor_email: entry.actorEmail,
      action:      entry.action,
      target_type: entry.targetType ?? null,
      target_id:   entry.targetId   ?? null,
      metadata:    entry.metadata   ?? {},
    });

    if (error) {
      console.error('[audit] Failed to write audit log:', error.message, { entry });
    }
  } catch (err) {
    console.error('[audit] Unexpected error writing audit log:', err, { entry });
  }
}
