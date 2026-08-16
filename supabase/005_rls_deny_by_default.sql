-- ================================================================
-- Migration 005: RLS hardening — deny-by-default on every sensitive table
--
-- TRUST MODEL (traced from production code, not assumed)
-- ------------------------------------------------------
-- Every read/write of clinics, devices, licenses, profiles,
-- admin_audit_logs and device_request_nonces in the application goes through
-- createAdminClient() (SUPABASE_SERVICE_ROLE_KEY), i.e. server-side only:
--   * Admin dashboard  -> Next.js server components / server actions (service_role)
--   * Admin API routes -> service_role
--   * Device auth      -> lib/device/authenticate.ts (service_role)
--   * Startup validator-> service_role
-- The browser Supabase client (anon key) is used ONLY for auth calls
-- (signInWithPassword / signOut / resetPasswordForEmail / getUser).
-- createSessionClient (anon key + user cookie) is used ONLY for auth.getUser();
-- it never calls .from().
-- The Desktop app uses the anon key ONLY against /auth/v1/* (GoTrue token and
-- settings) and obtains licence state from the Render API at
-- /api/license/check. It never calls PostgREST /rest/v1/*.
--
-- CONCLUSION: no component requires anon or authenticated access to any of
-- these tables. The correct policy set is therefore "no access for anon or
-- authenticated"; service_role bypasses RLS and is how the app operates.
--
-- WHAT WAS WRONG
-- --------------
-- schema_profiles.sql shipped, on clinics/devices/profiles:
--     AS RESTRICTIVE USING (auth.role() = 'anon')
-- PostgreSQL composes policies as:
--     visible  <=>  (any PERMISSIVE passes) AND (all RESTRICTIVE pass)
-- so that predicate passes the restrictive gate for anon and FAILS it for
-- authenticated — the inverse of its name. Net effect:
--   * anon          : denied (only because no permissive policy matches it)
--   * authenticated : denied by the restrictive gate, which also made the
--                     permissive policies clinics_own_read / devices_clinic_read
--                     / profiles_self_read permanently dead code
-- It was fail-closed, so no data was exposed, but it was structurally wrong
-- and it hid three policies that could never fire.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Removes the inverted restrictive policies and the dead permissive policies,
-- and installs one unambiguous deny-all restrictive policy per table. This is
-- strictly stronger than the previous state and matches the real trust model.
-- It does NOT open any table to any role. If direct desktop reads are ever
-- wanted, add a narrowly scoped permissive policy in a later, reviewed
-- migration — do not relax the deny-all here.
--
-- Idempotent: safe to re-run.
-- ================================================================

BEGIN;

-- clinics ---------------------------------------------------------------
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny anon"         ON clinics;
DROP POLICY IF EXISTS "clinics_own_read"  ON clinics;   -- dead permissive policy
DROP POLICY IF EXISTS "deny_all"          ON clinics;
CREATE POLICY "deny_all" ON clinics AS RESTRICTIVE USING (false) WITH CHECK (false);

-- devices ---------------------------------------------------------------
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny anon"           ON devices;
DROP POLICY IF EXISTS "devices_clinic_read" ON devices; -- dead permissive policy
DROP POLICY IF EXISTS "deny_all"            ON devices;
CREATE POLICY "deny_all" ON devices AS RESTRICTIVE USING (false) WITH CHECK (false);

-- licenses --------------------------------------------------------------
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny anon" ON licenses;
DROP POLICY IF EXISTS "deny_all"  ON licenses;
CREATE POLICY "deny_all" ON licenses AS RESTRICTIVE USING (false) WITH CHECK (false);

-- profiles --------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny anon"          ON profiles;
DROP POLICY IF EXISTS "profiles_self_read" ON profiles; -- dead permissive policy
DROP POLICY IF EXISTS "deny_all"           ON profiles;
CREATE POLICY "deny_all" ON profiles AS RESTRICTIVE USING (false) WITH CHECK (false);

-- admin_audit_logs ------------------------------------------------------
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_all_anon_audit_logs" ON admin_audit_logs;
DROP POLICY IF EXISTS "deny_all"                 ON admin_audit_logs;
CREATE POLICY "deny_all" ON admin_audit_logs AS RESTRICTIVE USING (false) WITH CHECK (false);

-- device_request_nonces -------------------------------------------------
ALTER TABLE device_request_nonces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny anon" ON device_request_nonces;
DROP POLICY IF EXISTS "deny_all"  ON device_request_nonces;
CREATE POLICY "deny_all" ON device_request_nonces AS RESTRICTIVE USING (false) WITH CHECK (false);

COMMIT;
