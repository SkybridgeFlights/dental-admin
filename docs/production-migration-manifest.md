# DentalPro — Authoritative Production Migration Manifest

Applies to a **brand-new empty** Supabase project. Repository files are
sufficient as committed: **no manual merging, editing, or reordering of SQL is
permitted during a production run.** If a file needs a change, change it in the
repository, re-run the fresh-database rehearsal from empty, and commit.

Rehearsed empirically — see §Rehearsal evidence.

---

## Apply order (exact)

| # | File | Purpose |
|---|---|---|
| 1 | `supabase/schema.sql` | enums, `set_updated_at()`, `clinics`, `devices`, `licenses`, indexes, triggers, RLS enable, `clinic_summary` |
| 2 | `supabase/schema_profiles.sql` | `profiles`, its trigger/indexes, deny-all policies, `clinic_summary` rebuild |
| 3 | `supabase/003_audit_log.sql` | `admin_audit_logs` + indexes + RLS |
| 4 | `supabase/004_device_auth_and_atomic_license.sql` | `devices.credential_hash`/`credential_issued_at`, `device_request_nonces`, `replace_device_license()` |
| 5 | `supabase/005_rls_deny_by_default.sql` | one `deny_all` RESTRICTIVE policy per sensitive table |
| 6 | `supabase/006_rpc_execute_hardening.sql` | EXECUTE least-privilege on SECURITY DEFINER functions |

**`supabase/phase1_desktop_auth.sql` is SUPERSEDED — never apply it.** It
duplicates `profiles` and would collide. `test/schema-sql-ordering.test.ts`
enforces both the order and the superseded marking.

### Preconditions

* Empty Supabase project; `public` schema contains none of the six tables.
* `auth.users` exists (Supabase default) — `profiles.id` FKs to it.
* Roles `anon`, `authenticated`, `service_role` exist (Supabase default).
* `gen_random_uuid()` available (pgcrypto, Supabase default).
* Run every file as the SQL-editor `postgres` role.
* Run each file **in its own transaction**; abort the whole run on any error.

---

## Expected objects after each step

| After | Must exist |
|---|---|
| 1 | enums `clinic_status`, `plan_type`, `device_status`; tables `clinics`, `devices`, `licenses` (RLS enabled); `set_updated_at()`; view `clinic_summary` |
| 2 | table `profiles` (RLS enabled); `deny_all` on `clinics`/`devices`/`profiles`; `clinic_summary` rebuilt with `user_count` |
| 3 | `admin_audit_logs` + 3 indexes + RLS |
| 4 | `devices.credential_hash`, `devices.credential_issued_at`; `device_request_nonces`; `replace_device_license()` SECURITY DEFINER with `search_path = public` |
| 5 | `deny_all` RESTRICTIVE `USING (false)` on **all six** tables |
| 6 | `replace_device_license`: anon **false**, authenticated **false**, service_role **true** |

## Verification queries (run after step 6)

```sql
-- 1. tables + RLS
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY 1;
--    expect 6 rows, rowsecurity = true for every one

-- 2. deny_all coverage
SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND policyname='deny_all';
--    expect 6

-- 3. function privileges  (THE migration-006 gate)
SELECT p.proname,
       has_function_privilege('anon',          p.oid,'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid,'EXECUTE') AS authed,
       has_function_privilege('service_role',  p.oid,'EXECUTE') AS svc,
       p.prosecdef AS security_definer,
       array_to_string(p.proconfig,',')       AS search_path
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public';
--    replace_device_license -> anon=f, authed=f, svc=t, secdef=t, search_path=search_path=public

-- 4. device-auth columns / enums / view
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema='public' AND table_name='devices'
   AND column_name IN ('credential_hash','credential_issued_at');           -- expect 2
SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname='public' AND t.typtype='e';                                 -- expect 3
SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public';   -- expect 1
```

### Out-of-band RLS/RPC verification (with the production **anon** key)

```
GET  /rest/v1/clinics?select=*&limit=1          -> 200 with [] (zero rows)
POST /rest/v1/clinics                            -> 401 / 42501
POST /rest/v1/rpc/replace_device_license (args)  -> denied (42501, or PGRST202
                                                    because the function is not
                                                    exposed to the role at all)
```

Repeat every probe above with a **real authenticated end-user token**, not only
the anon key. The two roles are distinct, and an earlier revision of these files
denied anon while leaving authenticated readable. In particular:

```
GET /rest/v1/profiles?select=*,clinics!clinic_id(clinic_name)&id=eq.<uid>
    with Authorization: Bearer <user token>   -> 200 with [] (zero rows)
```

That query is the one the Desktop used to issue. It must return nothing. The
Desktop now obtains the same information from `GET /api/desktop/profile`, so a
non-empty result here means a permissive policy has been reintroduced.

**No table grant of any kind is required for the Desktop to work.** If a
migration ever adds a permissive `SELECT` policy for `authenticated` on
`profiles` or `clinics` to "fix" a login problem, that is a regression — the
bootstrap endpoint is the supported path.

Then the Admin service startup log must read:

```
✅ All required env vars are present
✅ Supabase project ID confirmed: <prod ref>
✅ Supabase connection OK
✅ Database schema verified (clinics, devices, licenses)
✅ Admin whitelist configured (N entries)
   Fault injection DISARMED (not a staging environment)
```

## Rollback / abort criteria

Abort the entire run and **do not proceed to the next file** if any of:

* any file raises an error (each file is transactional — it rolls itself back);
* verification query 1 returns fewer than 6 tables, or any `rowsecurity=false`;
* query 2 returns < 6;
* query 3 shows `anon` or `authenticated` holding EXECUTE — **security stop**;
* the anon-key probe returns rows, or the RPC probe returns 200;
* startup logs show `SECURITY_SCHEMA_NOT_VERIFIED` or a missing-env error.

Rollback for a brand-new project is simply: **delete the project and start
over.** Do not hand-patch a partially migrated production database — fix the
repository files and re-rehearse from empty.

---

## Rehearsal evidence (2026-08-17, staging project, isolated empty schema)

Files applied verbatim in the documented order, no reordering, wrapped in one
transaction so any collision with `public` would roll back (success therefore
proves isolation):

```
tables            : admin_audit_logs, clinics, device_request_nonces,
                    devices, licenses, profiles
rls_on            : 6        rls_off : 0
deny_all          : 6        views   : 1      enums : 3
device_auth_cols  : 2
function_grants   : replace_device_license:anon=false,auth=false,svc=true
                    | set_updated_at:...
```

Probe schema dropped afterwards (`fresh_probe_left = 0`).

**Caveat:** the rehearsal used an isolated *schema*, not a separate Postgres
instance — roles and extensions were shared with the staging project. A true
new-project rehearsal should be repeated once a disposable production-like
project is available (see the go-live runbook, Gate 2).

### Defects this manifest already caught

1. `42P16 cannot change name of view column "last_device_seen" to "user_count"`
   — `CREATE OR REPLACE VIEW` cannot reorder columns; fixed by dropping
   `clinic_summary` first (commit `d368dc1`).
2. `42P01 relation "profiles" does not exist` — policies referencing `profiles`
   were created before the table; fixed by reordering (commit `61f21a2`).
3. **anon could execute `replace_device_license`** — fixed by migration 006.
