# DentalPro — Production Architecture & Secret Inventory

Phase 1 planning document. Nothing here has been applied to production.
Staging (`fwcsavxfpiskzcbjhdmc`, Render `srv-da0m8qtg1s2s73bv9mag`) remains the
reference environment.

---

## 1. Intended production topology

```
   ┌──────────────────────────────┐
   │  CLINIC WORKSTATION          │
   │  DentalPro Desktop (Electron)│
   │  • better-sqlite3, WAL       │   ALL patient / clinical / financial
   │  • local encrypted backups   │   data lives HERE and is never uploaded
   │    (AES-256-GCM, key in      │
   │     Electron safeStorage)    │
   └───────┬──────────────┬───────┘
           │              │
           │ (1) GoTrue   │ (2) licence status
           │ /auth/v1/*   │     POST /api/license/check
           │ anon key     │     Bearer <deviceCredential>
           │              │ (3) identity bootstrap
           │              │     GET /api/desktop/profile
           │              │     Bearer <user access token>
           ▼              ▼
   ┌───────────────┐   ┌──────────────────────────────┐
   │ Supabase Auth │   │  Render Web Service (Admin)  │
   │  (GoTrue)     │   │  Next.js, Node 22.14.0       │
   └───────────────┘   │  • service_role key          │
                       │  • Ed25519 PRIVATE key       │
                       │  • admin whitelist           │
                       │  • signs DP4 envelopes       │
                       └──────────┬───────────────────┘
      NO Desktop path             │ service_role (bypasses RLS)
      to PostgREST                │
   ┌──────────────────────────────▼───────────────────┐
   │ Supabase Postgres                                │
   │  clinics · devices · licenses · profiles         │
   │  admin_audit_logs · device_request_nonces        │
   │  RLS deny_all on all six; RPC = service_role only│
   └──────────────────────────────────────────────────┘
```

### A. Data stored locally in the clinic (never uploaded)

| Data | Store |
|---|---|
| Patients, appointments, treatments, clinical notes | `better-sqlite3` local DB (WAL, FK on) |
| Invoices / payments / financial records | same local DB |
| Local backups | AES-256-GCM, key ring in Electron `safeStorage` |
| Cached offline auth entitlement | local app store |
| Activated licence envelope | local app store |

**Confirmed:** the Desktop repository contains **no** path to Supabase PostgREST
at all — neither read nor write. Its only Supabase calls are `/auth/v1/settings`
and `/auth/v1/token` (GoTrue). The identity lookup goes to the Admin service
(`GET /api/desktop/profile`). Enforced by `test/identity-boundary.test.js`,
which fails the build if any main-process file references `/rest/v1` or names a
protected table.

### B. Data stored in Supabase (licensing / identity only)

`clinics` (name, owner name, phone, plan, expiry, max_devices, status) ·
`devices` (device id, clinic, status, `credential_hash`, `last_seen_at`) ·
`licenses` (issued licence keys, type, expiry, revoked_at, generated_by) ·
`profiles` (auth user ↔ clinic ↔ role) · `admin_audit_logs` ·
`device_request_nonces` (replay protection).

No patient, clinical, or financial data. Device credentials are stored **only**
as SHA-256 hashes (verified empirically: stored hash matched locally computed
`sha256(credential)`).

### C. Secrets stored in Render (server only)

`SUPABASE_SERVICE_ROLE_KEY`, `LICENSE_ED25519_PRIVATE_KEY`,
`ADMIN_EMAIL_WHITELIST`. See §3.

### D. Public configuration embedded in Desktop

Supabase URL, Supabase **anon** key, `DENTALPRO_LICENSE_PUBLIC_KEYS`
(JSON map `keyId → SPKI PEM`), Admin API base URL. All are safe to distribute.

### E. Admin-only components

Next.js dashboard + server actions, `/api/license/generate`,
`/api/onboarding/run`, `/api/license/latest`, audit log viewer. All run
server-side with `service_role`; all gated by `requireApiAdmin()` against
`ADMIN_EMAIL_WHITELIST`.

---

## 2. Trust boundaries (traced from code, not assumed)

| Component | Transport | Supabase role | May read tables? |
|---|---|---|---|
| Desktop → GoTrue | `/auth/v1/*` | anon | n/a (auth only) |
| Desktop → PostgREST | **none** | — | **no path exists** |
| Desktop → Admin API | `POST /api/license/check` | none (device credential) | no |
| Desktop → Admin API | `GET /api/desktop/profile` | none directly; server uses service_role after verifying the user's token | only that user's own row |
| Admin browser | Supabase JS | anon | auth calls only, never `.from()` |
| Admin server | server components / routes | **service_role** | yes (bypasses RLS) |

### RESOLVED — desktop identity bootstrap (Option A)

**Background.** `fetchProfile` used to perform an authenticated PostgREST read
of `profiles` joined to `clinics`. Migration 005 installs `deny_all`
(RESTRICTIVE `USING (false)`) on both tables, so that read returned **zero
rows** and login failed with `SUPABASE_PROFILE_LINK_FAILED`, which
`auth-handlers.js` treats as fatal. Because the offline cache is only populated
*after* a first successful online login, first-run activation could never
complete.

This was **pre-existing**, not caused by 005: the earlier
`AS RESTRICTIVE USING (auth.role() = 'anon')` policy also denied authenticated
users (RESTRICTIVE policies are ANDed, so that predicate passed for anon and
failed for authenticated). Any database built from these files had the defect.

**Resolution (owner decision: Option A).** The Desktop no longer reads
PostgREST. The lookup moved to `GET /api/desktop/profile`:

| Property | Guarantee |
|---|---|
| Authentication | `Authorization: Bearer <Supabase user access token>`, validated by GoTrue via `auth.getUser(token)` — signature, expiry and revocation are the identity provider's decision, and no JWT secret is provisioned to the Admin service |
| Subject | Derived **only** from the verified token. The route reads no query string, no body and no id header; `test/desktop-bootstrap.test.ts` asserts this structurally |
| Privilege | `service_role` is used only *after* the subject is established, and only to read an explicit column list |
| Projection | `profiles(id, status, clinic_id)` + `clinics(id, clinic_name)`, rebuilt through an allowlist so a future column cannot leak |
| Failure modes | 401 `UNAUTHENTICATED`, 404 `PROFILE_NOT_LINKED`, 503 `BOOTSTRAP_UNAVAILABLE`. A failed read is never rendered as "no profile" |
| Enumeration | Impossible: a caller can only ever address itself |
| Admin whitelist | Deliberately **not** consulted — this is an end-user identity endpoint, not an admin endpoint |

`deny_all` on `profiles`/`clinics` is unchanged and must stay unchanged; a
regression test fails if migration 005 is relaxed to accommodate the Desktop.

Verified live against staging: 14/14 authorization and data-boundary checks,
including that the Desktop's former query still returns `[]` for both the anon
and the authenticated role.

---

## 3. Production secret inventory

### PUBLIC — safe to embed in Desktop / browser bundles

| Value | Belongs in | MUST NOT appear in |
|---|---|---|
| Supabase URL (prod) | Desktop config, Render `NEXT_PUBLIC_SUPABASE_URL` | — |
| Supabase **anon** key (prod) | Desktop config, Render `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — (public by design) |
| Ed25519 **public** key (prod) | Desktop `DENTALPRO_LICENSE_PUBLIC_KEYS` | — |
| `LICENSE_SIGNING_KEY_ID` (e.g. `dentalpro-prod-2026-01`) | Render env, Desktop key map | — |

> The anon key is public but still an *authorisation* input: it must never be
> the only thing standing between a caller and a privileged RPC. See
> migration 006 — that exact mistake was found and fixed.

### SERVER SECRET — Render environment only

| Value | Belongs in | MUST NOT appear in |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Render env (`sync: false`) | Git, Desktop, browser bundles, logs, client responses |
| `LICENSE_ED25519_PRIVATE_KEY` | Render env (`sync: false`) | Git, Desktop, browser bundles, logs, backups outside the sealed store |
| `ADMIN_EMAIL_WHITELIST` | Render env (`sync: false`) | Git, Desktop |
| Supabase DB password / connection string | Supabase console only | Git, Render app env |

### DESKTOP — distributed publicly

Only the PUBLIC block above. The Desktop build must **fail release inspection**
if `DENTALPRO_LICENSE_PUBLIC_KEYS` is absent, contains a test key id, or
contains private-key material (already documented in the Desktop repo's
`docs/production-operations-1.0.0.md`).

### Never generated or stored by this plan

Production Ed25519 private key (see the ceremony document), production Supabase
keys, Authenticode certificate private key.
