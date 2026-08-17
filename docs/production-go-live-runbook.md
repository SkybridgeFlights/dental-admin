# DentalPro — Production Go-Live Runbook

Phase 1 planning document. **Nothing in here has been executed.** No production
key exists. Every step marked **OWNER APPROVAL REQUIRED** is destructive,
irreversible, costly, or security-critical and must not be automated.

---

## Part 1 — Ed25519 production key ceremony (Gate 5)

**Do not perform during Phase 1.**

| Item | Decision |
|---|---|
| **keyId convention** | `dentalpro-prod-<YYYY>-<NN>`, e.g. `dentalpro-prod-2026-01`. Must never collide with `dentalpro-staging-*`. Immutable once issued. |
| **Generation environment** | Offline or trusted workstation, Node ≥22 `crypto.generateKeyPairSync('ed25519')` (same primitive already validated in staging). No cloud shell, no CI, no shared machine. Generate directly to a file with mode `600`. |
| **Private-key format** | PKCS#8 PEM (what `lib/license/sign.ts` accepts; it also un-escapes `\n`). |
| **Private-key storage** | Exactly **one** live copy: Render env `LICENSE_ED25519_PRIVATE_KEY` (`sync: false`). Plus **one** offline escrow copy (see backup). Never in Git, Desktop, browser bundles, logs, or a password manager shared with non-owners. |
| **Render provisioning** | Paste via the Render dashboard env editor over TLS; prefer OS clipboard so the value never lands in shell history. Verify by reading it back and deriving the public key — the fingerprint must match. Then clear the clipboard. |
| **Public-key extraction** | `createPublicKey(privateKey).export({type:'spki',format:'pem'})`. Public key is non-secret. |
| **Fingerprint recording** | `sha256` over the DER SPKI, colon-separated uppercase hex. Record in `production-keys/<keyId>.json` (repo-external, like `staging-keys/`). |
| **Desktop registry update** | Add `{"<keyId>": "<SPKI PEM>"}` to `DENTALPRO_LICENSE_PUBLIC_KEYS` for the production build only. |
| **Backup / recovery** | Two sealed offline copies (e.g. encrypted USB / paper PKCS#8 in a safe), geographically separated, owner-only. **Losing the private key means no new licences can be issued** — existing signed licences keep verifying until expiry, so it is a business-continuity issue, not an immediate outage. |
| **Rotation** | Additive: generate `…-02`, add the new public key to the Desktop map *alongside* the old one, ship that Desktop build, switch `LICENSE_SIGNING_KEY_ID` on Render, re-issue licences on renewal, and only then retire the old key from the map. Never rotate by replacing the map in one step — that instantly invalidates every deployed licence. |
| **Emergency revocation** | Compromise ⇒ (1) remove the compromised keyId from `DENTALPRO_LICENSE_PUBLIC_KEYS` and ship an emergency Desktop build — this is the only true kill switch, because Desktop verifies offline; (2) rotate `LICENSE_SIGNING_KEY_ID` + private key on Render; (3) mass-revoke affected `licenses` rows so `/api/license/check` reports `revoked` for online devices; (4) audit `admin_audit_logs`. Note (3) alone is **not** sufficient for offline devices. |

---

## Part 2 — Desktop production integration plan (Gate 9/10)

**The validated Desktop RC has not been modified.** Current mechanism, read
from the RC:

* `electron/services/license-crypto-service.js::readPublicKeys()` parses
  `DENTALPRO_LICENSE_PUBLIC_KEYS` — a JSON object `keyId → PEM|base64 PEM`.
* `verifyLicenseEnvelope()` requires `version === 'DP4-LICENSE-1'`,
  `algorithm === 'Ed25519'`, full claim set, signature matching
  `^[A-Za-z0-9_-]{80,100}$`, then looks up `envelope.keyId` in that map.
* Unknown key id ⇒ `UNKNOWN_SIGNING_KEY`. Bad signature ⇒ `INVALID_SIGNATURE`.
* Legacy HMAC paths are already hard-disabled (`verifyLicenseSignature()`
  returns `false`).
* `evaluateLicenseEnvelope()` additionally enforces device match and expiry, and
  treats `serverStatus === null` (offline) as "local signed entitlement stands".

**So no Desktop code change is required to trust the production key** — only a
build-time configuration change. That is the whole integration.

| Requirement | Plan |
|---|---|
| Add production keyId/public key | Set `DENTALPRO_LICENSE_PUBLIC_KEYS = {"dentalpro-prod-2026-01":"<SPKI PEM>"}` for the production build. |
| Staging/legacy compatibility | **Deliberately excluded.** The production map contains the production key **only**. |
| Prevent staging licences activating production Desktop | Falls out of the above: a staging-signed envelope hits `UNKNOWN_SIGNING_KEY`. This is the intended boundary and needs no new code. |
| Test: valid production signature | Issue a synthetic production licence, verify Desktop activates. |
| Test: staging signature rejected | Feed a staging-signed envelope to the production build ⇒ expect `UNKNOWN_SIGNING_KEY`. |
| Test: tampering | Flip a claim ⇒ `INVALID_SIGNATURE` (already proven for the staging key). |
| Test: unknown keyId | Envelope with `keyId: "nope"` ⇒ `UNKNOWN_SIGNING_KEY`. |
| Test: offline verification | Air-gap the machine; activation + launch must succeed on the cached signed envelope (`serverStatus = null` path). |
| Rebuild final RC | Only after the above pass in a scratch build. |
| Packaged golden path | Re-run `test/packaged-golden-path.js` and `test/packaged-ui-probe.js` against the signed production artifact. |

**Blocking dependency:** the OPEN ISSUE in
`production-architecture-and-secrets.md` §2 (desktop `fetchProfile` vs
`deny_all`). If Option A is chosen, the Desktop RC *must* change, which makes
this a larger piece of work than a config swap.

---

## Part 3 — Windows distribution assessment

No purchase has been made and none is recommended in Phase 1.

### REQUIRED FOR SECURITY

* **Nothing here is load-bearing for licence integrity.** Licence trust comes
  from Ed25519 verification inside the app, not from the installer signature.
* Ship SHA-256 checksums for every artifact and publish them over a channel
  separate from the download.
* Keep the release inspection that fails the build if the public-key map is
  missing, holds a test key id, or contains private-key material.

### REQUIRED FOR PROFESSIONAL DISTRIBUTION

* **Authenticode signing.** Unsigned installers show
  "Windows protected your PC — Unknown publisher"; many clinic IT policies and
  AV products block them outright.
* Certificate options:
  * **OV (Organisation Validation)** — cheaper; SmartScreen reputation must be
    *earned* over time/downloads, so early users still see warnings.
  * **EV (Extended Validation)** — hardware-token/HSM bound; grants immediate
    SmartScreen reputation. Materially better first-run experience; more
    expensive and requires the token for every signing operation.
  * Since June 2023 all publicly trusted code-signing keys must live on
    FIPS-140-2 hardware or a qualified cloud KMS — budget for the token or an
    HSM-backed cloud signing service.
* **Timestamping** at signing time (RFC 3161) so binaries stay valid after the
  certificate expires. Non-negotiable if you sign at all.
* **Installer vs portable:** ship the NSIS/MSI **installer** as primary —
  per-machine install, Start-menu entry, clean uninstall, and a single
  signable artifact. A portable `.exe` is useful for support/diagnostics but
  should be signed too and is not the recommended default for clinics.

### OPTIONAL

* Auto-update channel (adds a signed-update trust path — do not add it
  unsigned).
* MSIX packaging / Microsoft Store distribution.
* Reproducible-build attestation.

---

## Part 4 — Gated go-live sequence

Execute strictly in order. Do not proceed past a failed gate.

| # | Step | Gate |
|---|---|---|
| 1 | Create production Supabase project (region, plan, DB password) | **OWNER APPROVAL REQUIRED** — creates a billable/permanent resource |
| 2 | Apply migrations 1–6 per the manifest, each transactional, verifying after each | **OWNER APPROVAL REQUIRED** (irreversible schema); STOP on any manifest abort criterion |
| 2b | Repeat the fresh-DB rehearsal against this new project *before* any data exists | STOP/GO |
| 3 | Create production Render web service from `render.yaml` (branch, health path, autoDeploy off) | **OWNER APPROVAL REQUIRED** — may be a paid instance |
| 4 | Provision production secrets (§3 of the architecture doc), all `sync: false` | **OWNER APPROVAL REQUIRED** — handles service-role key |
| 5 | **Ed25519 production key ceremony** (Part 1) | **OWNER APPROVAL REQUIRED** — irreversible; key material |
| 6 | Set `ADMIN_EMAIL_WHITELIST` to the real owner address; deploy; confirm startup log shows the expected entry count and `Fault injection DISARMED` | **OWNER APPROVAL REQUIRED** |
| 7 | Synthetic production issuance (a throwaway clinic/device), verify signature against the production public key, verify `keyId`, verify DB persistence and credential hashing | STOP/GO |
| 8 | Device-auth validation: rerun the 12-test matrix against production **except** the fault-injection test, which must be **unavailable** (production is disarmed — assert 401/normal status, never 503 from a header) | STOP/GO |
| 9 | Desktop production public-key integration (Part 2) in a scratch build | STOP/GO |
| 10 | Rebuild final Desktop RC | **OWNER APPROVAL REQUIRED** — changes the validated RC |
| 11 | Packaged golden-path + UI probe against the production build | STOP/GO |
| 12 | Authenticode signing + timestamping | **OWNER APPROVAL REQUIRED** — certificate/HSM |
| 13 | Final secret inspection: Git history, Render logs, HTTP responses, client bundles, Supabase rows, packaged artifact | STOP/GO — any hit is a hard stop |
| 14 | Record checksums, version, keyId, fingerprint, migration set, commit SHA | STOP/GO |
| 15 | First controlled clinic deployment (one friendly site, rollback plan ready) | **OWNER APPROVAL REQUIRED** |
| 16 | Delete the throwaway production test records from step 7; keep audit rows | STOP/GO |

### Standing constraints during go-live

* Staging stays untouched as the reference environment.
* No production secret is ever printed, committed, or echoed.
* Any step that would weaken RLS, EXECUTE grants, or authentication to make a
  test pass is forbidden — fix the test or the design instead.
