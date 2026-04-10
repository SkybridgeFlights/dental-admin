-- ============================================================
-- Migration 003: Admin Audit Log
-- Run in: Supabase SQL Editor (service role)
-- ============================================================

create table if not exists admin_audit_logs (
  id           uuid        primary key default gen_random_uuid(),
  actor_email  text        not null,
  action       text        not null,         -- e.g. 'clinic.create', 'license.generate'
  target_type  text,                         -- e.g. 'clinic', 'device', 'license'
  target_id    text,                         -- UUID or device ID of the affected row
  metadata     jsonb       default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- Index for recent-entries queries (most common read pattern)
create index if not exists admin_audit_logs_created_at_idx
  on admin_audit_logs (created_at desc);

-- Index for filtering by actor
create index if not exists admin_audit_logs_actor_email_idx
  on admin_audit_logs (actor_email);

-- Index for filtering by action type
create index if not exists admin_audit_logs_action_idx
  on admin_audit_logs (action);

-- RLS: deny all direct access — only service role (admin client) may insert/read
alter table admin_audit_logs enable row level security;

create policy "deny_all_anon_audit_logs"
  on admin_audit_logs
  for all
  to anon
  using (false);
