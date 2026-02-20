# PRD Review Brief — Product & Architecture

**Date:** 2026-02-20 (updated)
**Reviewer context:** 20 PRDs covering the path from MVP to go-live, organized in 4 phases.
**Branch:** `main`

---

## Current State of the Codebase

Before reviewing the PRDs, understand what exists **today**:

### What Works
- **Interactive CGGMP24 signing** — real MPC protocol (WASM + native) across two paths: Signer+Server (CLI) and User+Server (browser)
- **DKG ceremony** — 3-party key generation, shares distributed to signer file / Vault / PRF-encrypted blob
- **Policy engine** — 8 policy types (spending_limit, daily_limit, monthly_limit, allowed_contracts, allowed_functions, blocked_addresses, rate_limit, time_window)
- **Dashboard** — 8 pages: login, create-signer, signers list, signer detail, sign, audit, settings, account
- **CLI** — 7 commands: init, status, balance, send, sign-message, deploy, proxy
- **Auth** — WebAuthn passkey (registration + login + PRF), session cookies, API key auth
- **Audit log** — all signing requests logged with signing path, status, decoded action
- **Core invariant verified** — zero code paths reconstruct the full private key

### What Does NOT Exist
| Gap | Current State |
|-----|---------------|
| Third signing path (Signer+User) | `SigningPath` enum has only 2 values |
| Path-specific policies | `PolicyContext` has no `signingPath` field |
| Share role metadata | `Share` type has `participantIndex` but no `role` label |
| TLS/HTTPS | No reverse proxy, no certs — all HTTP on localhost |
| CSP headers | None set |
| Redis | Not in stack — rate limiting is in-memory Map (100 req/60s, single tier) |
| Prometheus/metrics | None |
| Structured logging | No Pino, no JSON logs, no request correlation |
| Webhooks | Not implemented (only in UI mockups as placeholder) |
| Key refresh/rotation | Shares are static after DKG — no rotation protocol |
| RBAC | Owner-based access only — no roles (operator/viewer) |
| Vault AppRole auth | Static `VAULT_TOKEN` from .env |
| Backup/DR | No scripts, no snapshots, no recovery procedures |
| Docker hardening | Dev-mode Vault, no resource limits, no network isolation |
| API key rotation | Endpoint exists but allows API key auth (should be session-only) |

### Infrastructure
- **Docker Compose:** 3 services — Vault (:8200), Server (:8080), App (:3000). Dev mode.
- **Database:** Supabase (PostgreSQL) — 4 tables (signers, policies, signing_requests, networks)
- **Secrets:** All in `.env` — JWT_SECRET, VAULT_TOKEN, SUPABASE_SERVICE_KEY, RESEND_API_KEY

---

## PRD Overview — What to Review

### Phase 0: Novel Differentiators
*These are unique features that no competitor has. Review for product differentiation value.*

| PRD | What It Does | Key Review Points |
|-----|-------------|-------------------|
| **[00] Signing Path Policy Context** | Adds `signingPath` to PolicyContext so rules can differ per path (e.g., lower limits for agent-only signing) | Review: Are path-specific policy rules a real user need or premature? The `SigningPathCriterion` adds a new criterion type — is this the right abstraction vs. a simpler boolean field? |
| **[01] Bypass Signing + Multi-User Delegation** | Dual encryption: (1) ECIES envelopes (PRF-derived secp256k1 keys, per-user, for browser signing + delegation), (2) passphrase-encrypted `.secret` file (for CLI bypass). Delegation is async — Bob's public key is on the server, Alice wraps the DEK for him with one fingerprint tap. `gw bypass` is pure CLI with two passphrase prompts. **No competitor does bypass without reconstructing the key.** | Review: (1) Is ECIES with `@noble/curves` secp256k1 + HKDF + AES-256-GCM the right choice vs. using `eciesjs` package? (2) DEK separation means one ciphertext + N envelopes vs. N ciphertext copies — verify storage model is correct. (3) Re-key flow: new DEK + new envelopes for all remaining users — is the DB transaction safe? (4) Org roles (owner/admin/operator/viewer) map to envelope access — review if RBAC controls who can delegate. |
| **[02] Role Metadata on Shares** | Adds `role: 'signer' | 'server' | 'user'` to share files and key material blobs. Server validates it loaded a server share, CLI validates it loaded a signer share. Backward-compatible with v1 shares. | Review: Is the participantIndex-to-role mapping (0=signer, 1=server, 2=user) correct and final? Any concern about v1 share migration? |
| **[03] Audit Log Signing Path** | Adds signing path filter dropdown to audit page, path badge to activity feed, human-readable labels in CSV export. Server already populates the field in all 8 audit insertion points. | Review: Low risk, mostly UI polish. Are the abbreviated labels (A+S, U+S, A+U) clear enough? |

### Phase 1: Production Blockers
*These must be done before any production deployment. Review for completeness and priority ordering.*

| PRD | What It Does | Key Review Points |
|-----|-------------|-------------------|
| **[10] TLS/HTTPS** | Caddy reverse proxy as single ingress. Vault gets its own TLS cert chain. Cookies become `secure: true` + `sameSite: strict`. | Review: Is Caddy the right choice vs. nginx/Traefik? The PRD generates a self-signed CA for Vault — is this sufficient or do we need real PKI? |
| **[11] CSP Headers** | Full Content-Security-Policy via nginx config in the app container. Requires `wasm-unsafe-eval` for CGGMP24 WASM. | Review: `wasm-unsafe-eval` is required but doesn't enable `eval()` — is the security team comfortable with this? Is `unsafe-inline` acceptable for `style-src` (Tailwind dynamic styles)? |
| **[12] API Key Rotation** | `POST /signers/:id/rotate-key` restricted to session auth only (API key cannot rotate itself). New key returned once, old key invalidated immediately. | Review: No grace period for old key — is immediate invalidation OK? CLI users must manually update `~/.gw/config.json`. Should we add a deprecation window? |
| **[13] Secrets Management** | Move JWT_SECRET, SUPABASE_SERVICE_KEY, RESEND_API_KEY from .env into Vault. Switch from static VAULT_TOKEN to AppRole auth. 3-phase migration. | Review: The 3-phase migration (dual mode → Vault only → AppRole) is conservative. Is this the right sequence? The init.sh script seeds secrets — who runs it and when? |
| **[14] Disaster Recovery** | Hourly encrypted backups (Vault snapshot + pg_dump) to S3. Restore scripts. 5 documented recovery scenarios with step-by-step procedures. RTO: 30 min, RPO: 1 hour. | Review: Are the RTO/RPO targets appropriate for a self-hosted product? The backup encryption uses AES-256-CBC with a static key — should this be in Vault too? |
| **[15] Rate Limiting (Redis)** | Redis-backed sliding window rate limiting. 4 tiers: signing (20/min), auth (10/min), DKG (5/min), general (100/min). Per-IP + per-signer limits. Graceful degradation to in-memory if Redis is down. | Review: Current system has a single in-memory 100/60s limit. Are the new tier limits correct? The temporary ban after 10 consecutive violations — is this too aggressive? |
| **[16] Docker Hardening** | Production overlay compose file. `cap_drop: ALL`, `no-new-privileges`, read-only filesystems, network isolation (backend/frontend split), resource limits, log rotation. | Review: `read_only: true` on all containers requires targeted tmpfs mounts — is the list complete? Vault `disable_mlock = false` requires `IPC_LOCK` capability — verify this works in the target deployment environment. |

### Phase 0.5: CLI Autonomy (NEW)
*These enable headless CLI operation without the dashboard. Review for security model correctness.*

| PRD | What It Does | Key Review Points |
|-----|-------------|-------------------|
| **[51] Public Signer Creation** | `POST /signers/public` — no-auth endpoint for CLI signer creation. Bitwarden-model admin auth: CLI sends `hash(userShare)`, server stores `hash(hash(userShare))`. `AnonAuthGuard` for admin operations. Reuses `owner_address` column with `sha256:` prefix. | Review: (1) Is the Bitwarden double-hash model sufficient, or do we need a proper auth token exchange? (2) Rate limit of N/hour/IP — is this too permissive or too restrictive? (3) DKG is CPU-intensive — deploy behind reverse proxy with additional rate limiting for production. (4) Two-step flow (create+DKG, then register-admin) vs atomic single-step — which is cleaner? |
| **[52] CLI Init Rework** | `gw init` interactive menu: create new signer (hits /signers/public + DKG), import existing (current flow), switch default. Flat config: `~/.guardian-wallet/signers/<name>.json` + `admin/<name>.token` + `.default`. User share in OS keychain via `keytar`. Signer resolution: `--signer` flag > `.default` file > auto-single. No global config.json. | Review: (1) `keytar` has native deps — acceptable for a CLI tool? Alternative: `@aspect-build/keytar` fork or platform-specific keychain via `child_process`? (2) Fallback when keychain unavailable (CI/CD, Docker) — file-based with warning. (3) Old config migration — prompt-based. (4) Admin token written during init — is this the right default? |
| **[53] CLI Admin Commands** | All admin under `gw admin` namespace: `unlock/lock` (ssh-agent model — human unlocks keychain → writes hash to `admin/<name>.token`), `policies` (list/add/remove/toggle — interactive + non-interactive), `pause/resume`, `audit` (table + CSV). 6 new MCP admin tools. `SignerManager` updated to read file-based config alongside env vars. | Review: (1) ssh-agent token model — is `admin.token` on disk acceptable vs. in-memory daemon? (2) Token TTL defaults to no-expiry — should there be a max? (3) MCP admin tools read `admin.token` — should MCP tools auto-prompt for unlock? (4) Audit uses API key only (no admin token) — correct for read-only? |
| **[54] Share Format Cleanup** | Standardize new shares as plain base64 JSON. Remove `encryptShareForCLI` from browser (if dead code). Keep encrypted `.enc` backward compat in `loadShareFromFile`. Coordinate with PRD-02 (role metadata). | Review: Low risk. Verify `encryptShareForCLI` call sites before removing. Plain base64 on disk relies on `chmod 600` — document clearly. |

### Phase 2: Go-Live Minimum
*These establish enterprise credibility. Review for scope appropriateness — are we building too much or too little for launch?*

| PRD | What It Does | Key Review Points |
|-----|-------------|-------------------|
| **[20] Key Refresh** | CGGMP24 key refresh protocol — rotates all 3 shares without changing the ETH address. New WASM exports, 3-party coordination, share versioning, Vault update with write-then-verify. | Review: **This is the most complex PRD (12-13 days).** Is key refresh required for launch or can it be post-launch? The protocol requires all 3 parties online simultaneously — is the coordination UX acceptable? What happens if one party goes offline mid-refresh? |
| **[21] Webhooks** | 9 event types, HMAC-SHA256 signed payloads, retry with exponential backoff, auto-disable after 10 failures. | Review: Is fire-and-forget delivery (no guaranteed ordering) acceptable? Should we offer a delivery log in the dashboard? Are 9 event types too many for v1 — which are essential? |
| **[22] RBAC** | 3 roles (owner/operator/viewer) with `signer_members` table. RolesGuard with `@Roles()` decorator. API key auth bypasses roles entirely. | Review: API key auth bypassing roles means any agent with the key has full access regardless of RBAC — is this intentional? The migration seeds existing owners — does this handle the case where `owner_address` is null (signers created before auth was implemented)? |
| **[23] Monitoring** | Prometheus metrics (signing duration, error rates, vault health), Pino structured logging, pre-built Grafana dashboard, 6 alert rules, Docker Compose services for Prometheus + Grafana. | Review: Is the full Prometheus+Grafana stack appropriate for a self-hosted product aimed at individual devs/small teams? Should we offer a simpler alternative (e.g., structured logs only + optional Prometheus endpoint)? |
| **[24] KMS Envelope Encryption** | Replace Vault as share storage backend. Shares encrypted with AES-256-GCM using DEKs from a pluggable KMS (AWS KMS, GCP KMS, Azure Key Vault, Vault Transit, local file). Encrypted envelopes stored in PostgreSQL. Vault becomes optional. | Review: **This is architecturally significant — it changes the deployment model.** (1) Should this be Phase 1 instead of Phase 2? It simplifies deployment more than any other PRD. (2) Does the `local-file` provider meet the security bar for production single-node deployments? (3) The `IVaultStore` interface is preserved — existing code doesn't change. Is this the right abstraction or should we rename to `IShareStore`? (4) PRD-13 (secrets in Vault) and PRD-14 (DR) scope changes if Vault is removed — review together. |

---

## Cross-PRD Dependencies

```
PRD-00 (PolicyContext signingPath)
  └── no dependencies

PRD-01 (Bypass Signing) ──depends on──> PRD-02 (Role Metadata)
  └── role validation prevents misuse of wrong share type

PRD-02 (Role Metadata)
  └── no dependencies
  └── coordinate with PRD-54 (share format) — both touch share serialization

PRD-03 (Audit Signing Path) ──depends on──> PRD-00 (PolicyContext)
  └── signing path filter makes more sense after path-specific policies exist
  └── PRD-53 (CLI Audit) can consume the signingPath filter when available

PRD-10 (TLS) ──depends on──> nothing
  └── but should be done BEFORE PRD-13 (Vault AppRole needs TLS)

PRD-13 (Secrets Management) ──depends on──> PRD-10 (TLS)
  └── AppRole auth over HTTP is insecure

PRD-15 (Rate Limiting) ──depends on──> nothing
  └── but needs Redis added to docker-compose
  └── PRD-51 (Public Creation) uses its own rate limit — should move to Redis when PRD-15 ships

PRD-16 (Docker Hardening) ──should come AFTER──> PRD-10, PRD-15
  └── production overlay needs TLS and Redis services defined

PRD-20 (Key Refresh) ──depends on──> PRD-02 (Role Metadata)
  └── share versioning builds on role metadata in key material

PRD-22 (RBAC) ──depends on──> nothing
  └── but PRD-21 (Webhooks) should check roles for webhook management
  └── PRD-51 AnonAuthGuard is a separate auth model — RBAC should account for it

PRD-24 (KMS Envelope Encryption) ──partially supersedes──> PRD-13 (Secrets Mgmt)
  └── If KMS replaces Vault, PRD-13 scope changes (secrets go in KMS, not Vault)
  └── Also simplifies PRD-14 (DR) — single DB backup captures encrypted shares
  └── Also simplifies PRD-16 (Docker) — Vault becomes optional

PRD-51 (Public Signer Creation) ──depends on──> nothing
  └── new server endpoint + AnonAuthGuard + EitherAdminGuard
  └── blocks PRD-52 and PRD-53

PRD-52 (CLI Init Rework) ──depends on──> PRD-51 (Public Creation)
  └── "Create new signer" flow calls POST /signers/public

PRD-53 (CLI Admin Commands) ──depends on──> PRD-51 (AnonAuthGuard), PRD-52 (keychain + config)
  └── admin commands use X-User-Share-Hash via admin.token or keychain fallback
  └── MCP admin tools read admin.token; SignerManager updated for file-based config

PRD-54 (Share Format Cleanup) ──depends on──> nothing
  └── coordinate with PRD-02 (Role Metadata) — both touch share JSON format
```

### Recommended Implementation Order

```
NEXT:    PRD-51 → PRD-52 → PRD-53   ← CLI autonomy (one PR, multiple commits)
         PRD-54 (Share Format)       ← can be done alongside or after

Week 1:  PRD-24 (KMS Envelope)      ← unlocks simpler deployment for everything after
Week 2:  PRD-02 (Role Metadata)     → PRD-00 (PolicyContext)    → PRD-03 (Audit)
Week 3:  PRD-10 (TLS)               → PRD-11 (CSP)
Week 4:  PRD-12 (API Key Rotation)  → PRD-15 (Rate Limiting)
Week 5:  PRD-16 (Docker Hardening)  → PRD-13 (Secrets — scope reduced if KMS adopted)
Week 6:  PRD-01 (Bypass Signing)    ← novel differentiator, complex
Week 7:  PRD-14 (Disaster Recovery) → PRD-22 (RBAC)
Week 8:  PRD-21 (Webhooks)          → PRD-23 (Monitoring)
Week 9:  PRD-20 (Key Refresh)       ← most complex, can be post-launch
```

---

## Open Questions for Reviewers

### Product Questions
1. **Is key refresh (PRD-20) required for launch?** It's 12-13 days of work and the most complex feature. Many MPC wallets launch without it.
2. **Is the full monitoring stack (Prometheus+Grafana) appropriate for the target user (individual dev/small team)?** Or should we ship structured logs + optional metrics endpoint?
3. **Should bypass signing (PRD-01) be in v1?** It's our strongest differentiator but adds ~5 days. Alternative: ship the `localTwoPartySign` engine and defer the proxy-UI.
4. **Webhook event types:** Are all 9 needed for launch? Which are essential for agent automation use cases?
5. **Should KMS envelope encryption (PRD-24) be Phase 1 instead of Phase 2?** It simplifies deployment more than any other single PRD. A `docker compose up` with just PostgreSQL + a local master key is a dramatically better onboarding experience than requiring Vault.

### Architecture Questions
1. **Caddy vs nginx vs Traefik** for reverse proxy — any strong preference? Caddy has auto-HTTPS but is less common in enterprise.
2. **Redis as a hard dependency** — the PRD proposes graceful degradation to in-memory. Should Redis be optional or required?
3. **KMS provider selection** — PRD-24 proposes 5 providers (AWS, GCP, Azure, Vault Transit, local file). Should we ship all 5 at launch or start with local-file + AWS + Vault Transit and add others on demand?
4. **`IVaultStore` naming** — should we rename to `IShareStore` now that it's not necessarily backed by Vault? Or keep the name for backward compatibility?
5. **WASM `wasm-unsafe-eval`** — required for `WebAssembly.instantiate()`. Is there a path to remove this via pre-compiled WASM modules?
6. **Bypass rpId constraint** — passkeys are origin-bound. For cloud-hosted dashboards, the bypass UI on localhost can't use the same passkey. Is a "backup passkey on localhost" during DKG an acceptable v2 solution?
7. **PRD-13 scope if KMS adopted** — if Vault is optional, where do app secrets (JWT_SECRET, SUPABASE_SERVICE_KEY) go? Options: (a) same KMS envelope in DB, (b) env vars with restricted access, (c) cloud secret managers (AWS Secrets Manager, etc.)

### Security Questions
1. **Two shares in browser memory during bypass** — both the signer share (from CLI via WS) and user share (from PRF) exist simultaneously. The window is short (seconds) and localhost-only. Is this acceptable?
2. **API key rotation with no grace period** — old key dies immediately. Agent downtime during rotation. Should we add a 5-minute overlap window?
3. **Backup encryption key** — DR backups are AES-256-CBC encrypted. Where is the encryption key stored? Should it live in KMS?
4. **Rate limiting temporary ban** — 10 consecutive violations triggers a ban. Could this be weaponized for DoS against legitimate signers?
5. **Local file KMS provider in production** — is a `chmod 600` master key file on disk acceptable for single-node production deployments? Or should we require a cloud KMS for production?

---

## How to Review

Each PRD file (`prd/00-*.md` through `prd/54-*.md`) follows a consistent structure:

1. **Problem Statement** — what's missing and why it matters
2. **Current State Analysis** — exact file paths and line numbers showing what exists today
3. **Technical Specification** — before/after code, new files, database changes
4. **Security Considerations** — threat analysis and mitigations
5. **Test Plan** — numbered test cases with specific assertions
6. **Implementation Tasks** — ordered table with effort estimates and dependencies
7. **Acceptance Criteria** — checkboxes for "done" definition

**Immediate next:** PRD-51/52/53 (CLI Autonomy) — these are the next implementation target, going into one PR.

**Longer term:** PRD-01 (Bypass) and PRD-20 (Key Refresh) — these are the highest-impact and most architecturally significant. The production blockers (10-16) are more straightforward but review them for completeness.

**Flag anything where:**
- The current code state described doesn't match your understanding
- The proposed approach conflicts with existing architectural decisions
- The effort estimate seems off
- A feature should be descoped or deferred to post-launch
- A security consideration is missing
