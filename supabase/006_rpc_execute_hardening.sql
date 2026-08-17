-- ================================================================
-- Migration 006: restrict EXECUTE on SECURITY DEFINER / helper functions
--
-- FINDING (empirically confirmed against staging before this migration)
-- --------------------------------------------------------------------
-- The PUBLIC anon key could execute replace_device_license through PostgREST:
--
--   POST /rest/v1/rpc/replace_device_license   (apikey: <anon>)
--   -> HTTP 200, returned a newly minted licence id
--
-- Migration 004 ended with:
--   REVOKE ALL ON FUNCTION replace_device_license(...) FROM PUBLIC;
-- which is NOT sufficient on Supabase. Supabase grants EXECUTE on public
-- functions to the anon and authenticated roles EXPLICITLY (via default
-- privileges). Revoking from PUBLIC does not remove an explicit role grant, so
-- both roles retained EXECUTE.
--
-- Because the function is SECURITY DEFINER it runs as its owner and BYPASSES
-- RLS, so the deny_all policies added in 005 did not mitigate this at all.
--
-- IMPACT with only the public anon key (shipped in the browser bundle and the
-- Desktop app, so effectively world-readable):
--   * UPDATE licenses SET revoked_at = NOW() for an arbitrary clinic+device
--     -> revoke any clinic's licence (denial of service)
--   * INSERT INTO devices ... ON CONFLICT DO UPDATE SET credential_hash = ...
--     -> overwrite ANY device's credential hash and thereby pass
--        /api/license/check device authentication as that device
--   * INSERT INTO licenses -> mint licence rows and bypass the max_devices
--     limit, which is enforced only in the API layer
--   * NOT exploitable to forge a Desktop-valid licence: the Ed25519 private
--     key never leaves the server, and Desktop verifies the signature.
--
-- NOT vulnerabilities (checked): the function uses only bound parameters with
-- no dynamic SQL (no EXECUTE/format/quote_ident), so there is no SQL injection
-- and no caller-controlled identifier; and `SET search_path = public` already
-- prevents search_path hijacking of the definer context.
--
-- FIX
-- ---
-- Least privilege: only service_role (used exclusively by server-side code via
-- createAdminClient) may execute the licensing RPC. anon and authenticated are
-- explicitly revoked. Licensing stays server-controlled, which is the intended
-- architecture: no browser or Desktop caller gains privileged mutation merely
-- by discovering the RPC.
--
-- Idempotent: safe to re-run.
-- ================================================================

-- WHY `REVOKE ... FROM PUBLIC` ALONE IS NOT ENOUGH (keep this note):
--   PUBLIC is the implicit catch-all grantee. Supabase additionally issues
--   EXPLICIT grants to the anon and authenticated roles. Revoking PUBLIC leaves
--   those explicit grants in place, so each role must be revoked by name.

BEGIN;

-- ── replace_device_license: SECURITY DEFINER, must be service_role only ──────
REVOKE ALL ON FUNCTION public.replace_device_license(UUID, TEXT, TEXT, plan_type, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_device_license(UUID, TEXT, TEXT, plan_type, TIMESTAMPTZ, TEXT, TEXT)
  FROM anon;
REVOKE ALL ON FUNCTION public.replace_device_license(UUID, TEXT, TEXT, plan_type, TIMESTAMPTZ, TEXT, TEXT)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_device_license(UUID, TEXT, TEXT, plan_type, TIMESTAMPTZ, TEXT, TEXT)
  TO service_role;

-- ── set_updated_at: trigger helper, never called directly by a client ────────
-- SECURITY INVOKER and returns TRIGGER (so PostgREST cannot invoke it), but
-- there is no reason for anon/authenticated to hold EXECUTE.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM authenticated;

COMMIT;

-- ================================================================
-- VERIFICATION (expected results after applying)
--
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public';
--
--   replace_device_license -> anon=false, authed=false, svc=true
--   set_updated_at         -> anon=false, authed=false
--
-- And through PostgREST with the anon key:
--   POST /rest/v1/rpc/replace_device_license -> HTTP 404 (PGRST202)
--   (PostgREST hides functions the caller cannot execute)
-- ================================================================
