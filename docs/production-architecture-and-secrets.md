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
           │ /auth/v1/*   │ POST /api/license/check
           │ anon key     │ Bearer <deviceCredential>
           ▼              ▼
   ┌───────────────┐   ┌──────────────────────────────┐
   │ Supabase Auth │   │  Render Web Service (Admin)  │
   │  (GoTrue)     │   │  Next.js, Node 22.14.0       │
   └───────────────┘   │  • service_role key          │
           │           │  • Ed25519 PRIVATE key       │
           │ (3)       │  • admin whitelist           │
           │ PostgREST │  • signs DP4 envelopes       │
           │ profiles  └──────────┬───────────────────┘
           ▼                      │ service_role (bypasses RLS)
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

**Confirmed:** the Desktop repository contains **no** write path to Supabase for
clinical data. Its only Supabase calls are `/auth/v1/*` (GoTrue) and one
`GET /rest/v1/profiles?select=*,clinics!clinic_id(clinic_name)` identity lookup.
No `POST/PATCH/DELETE` to PostgREST exists anywhere in the Desktop codebase.

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
| Desktop → PostgREST | `GET /rest/v1/profiles` | **authenticated** (user JWT) | **see OPEN ISSUE** |
| Desktop → Admin API | `POST /api/license/check` | none (device credential) | no |
| Admin browser | Supabase JS | anon | auth calls only, never `.from()` |
| Admin server | server components / routes | **service_role** | yes (bypasses RLS) |

### OPEN ISSUE — desktop profile read vs `deny_all`

`electron/services/supabase-auth-service.js::fetchProfile` performs an
authenticated PostgREST read of `profiles` joined to `clinics`. Migration 005
installs `deny_all` (RESTRICTIVE `USING (false)`) on both tables, so that read
returns **zero rows** and login fails with `SUPABASE_PROFILE_LINK_FAILED`,
which `auth-handlers.js` treats as fatal. The offline cache only helps *after*
a first successful online login, so first-run activation cannot complete.

This is **pre-existing**, not caused by 005: the previous
`AS RESTRICTIVE USING (auth.role() = 'anon')` policy also denied authenticated
users (RESTRICTIVE policies are ANDed, so that predicate passed for anon and
failed for authenticated). Any database built from these files has this defect.

Two mutually exclusive resolutions — **owner decision required**:

* **Option A — keep the boundary (recommended).** Desktop stops reading
  PostgREST; the identity lookup moves behind an authenticated Admin API
  endpoint (e.g. `GET /api/desktop/profile`) that uses `service_role`
  server-side. Keeps `deny_all` intact and matches the stated architecture
  ("no browser/Desktop caller gains privileged access"). Requires a Desktop
  change, so it cannot happen while the RC is frozen.
* **Option B — narrowly open the read.** Add PERMISSIVE `SELECT`-only policies
  for `authenticated`: `profiles` where `auth.uid() = id`, and `clinics` where
  `id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid())` — i.e. what
  `profiles_self_read` / `clinics_own_read` were meant to be. No Desktop change.
  Weaker: any authenticated user can read their own profile+clinic row directly.

Until this is resolved, production Desktop online login will not work.

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
