# PRD-51: Public Signer Creation + Anonymous Admin Auth

**Status:** Draft
**Priority:** P0 — blocks PRD-52 (CLI Init Rework) and PRD-53 (CLI Admin Commands)
**Effort:** 3-4 days
**Related issues:** None (new feature). Cross-refs: PRD-15 (#11, rate limiting), PRD-22 (#15, RBAC)

---

## Problem Statement

Today, creating a signer requires dashboard authentication (WebAuthn passkey + email OTP). The CLI `gw init` only stores credentials for a signer that was **already created in the dashboard**. This forces every CLI user through the browser for initial setup — even developers who will never use the dashboard again.

There is no way to:
1. Create a signer from the CLI
2. Manage a signer without a dashboard account
3. Run a fully headless setup (CI/CD, remote server, Docker container)

---

## Current State Analysis

### Signer creation — dashboard only

**`packages/server/src/signers/signer.controller.ts`** — `POST /signers`:
- Protected by `@UseGuards(SessionGuard)` — requires JWT from passkey login
- Reads `req.sessionUser` (Ethereum address) to set `ownerAddress`
- Calls `SignerService.create()` which generates API key + stores signer row

**`packages/server/src/dkg/dkg.controller.ts`** — `POST /dkg/init` + `POST /dkg/finalize`:
- Both protected by `@UseGuards(SessionGuard)`
- DKG returns `{ signerShare, userShare }` — server share goes to Vault

**`packages/server/src/common/session.guard.ts`** — `SessionGuard`:
- Reads JWT from `req.cookies.session` or `Authorization: Bearer <token>` header
- JWT issued after passkey authentication (WebAuthn)

### No anonymous creation path exists

There is no unauthenticated endpoint for signer creation. The `signer.controller.ts` has no `/public` route. The `EitherAuthGuard` accepts session OR API key — but you need a signer to have an API key, creating a chicken-and-egg problem.

### The `owner_address` column

**`supabase/migrations/00002_add_owner_address_multitenancy.sql`**:
- Adds `owner_address TEXT` to `signers` table
- Used for session auth ownership checks: `signer.ownerAddress.toLowerCase() === req.sessionUser.toLowerCase()`
- Always an Ethereum address (`0x...`) for dashboard signers
- This column can be repurposed for anonymous auth credentials

### Ownership check in `getOwnedSigner()`

**`packages/server/src/signers/signer.controller.ts`** — private `getOwnedSigner(id, req)`:
- API key auth: checks `req.signerId === id` (set by `ApiKeyGuard`)
- Session auth: checks `signer.ownerAddress.toLowerCase() === req.sessionUser.toLowerCase()`
- This method must be updated to handle `AnonAuthGuard` where `req.signerId` is set (same as API key path)

### RLS policies assume ETH address

**`supabase/migrations/00010_add_rls_policies.sql`**: RLS policies compare `owner_address` against JWT `sub`. Anonymous signers with `sha256:...` will never match JWT claims. This is fine because the server uses the **Supabase service role key** (bypasses RLS). RLS is defense-in-depth for direct database access only, not a runtime concern.

---

## Technical Specification

### Security Model: The Bitwarden Pattern

For anonymous CLI signers, we use the Bitwarden model. The server acts as a dumb proxy — it stores encrypted data (server share) and verifies auth, but never has the user's secret.

| Bitwarden | Guardian (Anonymous) |
|---|---|
| Master password | User share (party 2 keyshare) |
| Client sends `hash(masterPassword)` | CLI sends `SHA256(userShareBase64)` |
| Server stores `hash(hash(masterPassword))` | Server stores `SHA256(SHA256(userShareBase64))` |
| Server holds encrypted vault | Server holds server share (for co-signing) |
| Server never has the master password | Server never has the user share post-creation |

The user share IS the credential. If you lose it, you lose admin access to the signer (but can still sign with the signer+server path via API key). Admin credential rotation requires key refresh (PRD-20). In v1, if admin access is compromised, the user can revoke the signer and create a new one.

### Two Auth Models (Side by Side)

| | Dashboard Signer | Anonymous Signer (CLI) |
|---|---|---|
| **Creation** | `POST /signers` (SessionGuard) | `POST /signers/public` (no auth) |
| **ownerAddress** | ETH address from JWT (`0x...`) | `sha256:<SHA256(SHA256(userShareBase64))>` |
| **Admin auth** | SessionGuard (passkey+email) | `X-User-Share-Hash` header |
| **Signing auth** | API key (same) | API key (same) |
| **User share storage** | PRF-encrypted on server | OS keychain (local only) |
| **User+Server signing** | Browser WASM (unchanged) | N/A (no share on server) |
| **`GET /signers` list** | Returns all owned signers | Returns single signer (scoped by API key) |
| **Linking** | N/A (native) | v2 — deferred |

**Known limitation:** Anonymous signers with multiple API keys cannot list all their signers in a single call. Each API key returns only its own signer. This is acceptable for v1 — the CLI config knows which signers exist locally.

### New Endpoint: `POST /api/v1/signers/public`

**No authentication required.** Rate-limited per IP. Single atomic call — creates signer, runs DKG, registers admin credential.

**Request body:**
```typescript
interface CreatePublicSignerDto {
  name: string;                    // required, 1-64 chars
  type?: SignerType;               // default: 'ai_agent'
  scheme?: SchemeName;             // default: 'cggmp24'
  network?: string;                // default: 'base-sepolia'
}
```

**Response (201 Created):**
```typescript
interface CreatePublicSignerResponse {
  signerId: string;                // UUID
  ethAddress: string;              // derived during DKG
  apiKey: string;                  // raw key (returned once, never again)
  signerShare: string;             // base64 key material (party 0)
  userShare: string;               // base64 key material (party 2)
}
```

**Flow:**
1. Validate input (name length)
2. Check rate limit (3 creations per IP per hour, keyed by `req.ip` — respects Express `trust proxy` setting)
3. Run `DKGService.createWithDKG()` atomically:
   - Create signer record with `ownerAddress = 'pending'`
   - Run `DKGService.init()` + `DKGService.finalize()` in sequence
   - Store server share in Vault
   - **Server computes `SHA256(SHA256(userShareBase64))` internally** and sets `ownerAddress = 'sha256:' + doubleHash`
   - Update signer with `ethAddress`, `dkgCompleted: true`, `ownerAddress`
5. Return all outputs: `signerId`, `ethAddress`, `apiKey`, `signerShare`, `userShare`
6. Log creation to audit

**Why single-step works:** The server already generates all 3 shares during DKG (simulated 3-party ceremony). It has the `userShare` transiently before returning it. Computing `SHA256(SHA256(userShareBase64))` before wiping is trivial — same as the dashboard flow where `ownerAddress` comes from the JWT. The raw user share base64 string persists in GC-managed memory until collected (JavaScript strings are immutable and cannot be wiped), but the `Uint8Array` buffers backing the key material are zeroed in `finally` blocks. This transient exposure is inherent to DKG — the server generates the shares by definition.

**Timeout:** DKG takes ~1s with AuxInfo pool hit, ~30-120s on cold start. The CLI must use an extended HTTP timeout (180s) for this endpoint. See PRD-52 for CLI implementation.

**Error cases:**
- `400` — invalid name
- `429` — rate limit exceeded (3/hour/IP)
- `500` — DKG failure (signer row cleaned up on failure)

**Response logging warning:** This response contains API key, signer share, and user share. Any middleware, proxy, or monitoring tool that logs response bodies will capture all three secrets. Ensure response body logging is disabled for this endpoint in production.

### New Guard: `AnonAuthGuard`

**`packages/server/src/common/anon-auth.guard.ts`**

```typescript
@Injectable()
export class AnonAuthGuard implements CanActivate {
  constructor(private readonly signerRepo: SignerRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const signerId = req.params.id;
    const userShareHash = req.headers['x-user-share-hash'] as string;

    if (!userShareHash) throw new UnauthorizedException('Missing X-User-Share-Hash header');

    // Double-hash: server stores SHA256(SHA256(userShare)), client sends SHA256(userShare)
    const doubleHash = hashApiKey(userShareHash); // SHA-256
    const signer = await this.signerRepo.findById(signerId);

    if (!signer) throw new NotFoundException();
    if (signer.ownerAddress !== `sha256:${doubleHash}`) {
      throw new UnauthorizedException('Invalid credential');
    }

    // Set req.signerId — same as ApiKeyGuard. getOwnedSigner() checks req.signerId === id.
    req.signerId = signerId;
    return true;
  }
}
```

### Ownership Check Matrix

`getOwnedSigner(id, req)` in `signer.controller.ts` uses this logic:

| Guard | `req.signerId` | `req.sessionUser` | Ownership check |
|---|---|---|---|
| `ApiKeyGuard` | set (from API key lookup) | unset | `req.signerId === id` |
| `SessionGuard` | unset | set (from JWT) | `signer.ownerAddress === req.sessionUser` |
| `AnonAuthGuard` | set (from hash validation) | unset | `req.signerId === id` (same as API key) |

The existing `getOwnedSigner` already handles the `req.signerId` path. No changes needed to that method — `AnonAuthGuard` sets `req.signerId` like `ApiKeyGuard` does.

### Combined Guard for Admin Routes: `EitherAdminGuard`

For routes that need to work for both dashboard and CLI signers:

```typescript
// Tries SessionGuard first (dashboard signers), then AnonAuthGuard (CLI signers)
@Injectable()
export class EitherAdminGuard implements CanActivate { ... }
```

Applied to: `PATCH /signers/:id`, `DELETE /signers/:id`, `POST /signers/:id/pause`, `POST /signers/:id/resume`, `POST /signers/:id/regenerate-key`, policy CRUD routes.

### New DKG Method: `createWithDKG()`

**`packages/server/src/dkg/dkg.service.ts`** — atomic create + DKG:

```typescript
async createWithDKG(input: {
  name: string;
  type: SignerType;
  scheme: SchemeName;
  network: string;
}): Promise<{
  signerId: string;
  ethAddress: string;
  apiKey: string;
  signerShare: string;
  userShare: string;
}> {
  // 1. Create signer record (ownerAddress set after DKG)
  const { signer, apiKey } = await this.signerService.create({
    name: input.name,
    type: input.type,
    chain: 'ethereum',
    scheme: input.scheme,
    network: input.network,
    ownerAddress: 'pending',  // placeholder — updated after DKG
  });

  try {
    // 2. Init DKG session
    const { sessionId } = await this.init({ signerId: signer.id });

    // 3. Finalize DKG (runs full ceremony)
    const result = await this.finalize({ sessionId, signerId: signer.id });

    // 4. Compute admin credential from user share (Bitwarden model)
    //    Server has userShare transiently during DKG — compute double-hash before returning
    const singleHash = hashApiKey(result.userShare);   // SHA256(base64 string)
    const doubleHash = hashApiKey(singleHash);          // SHA256(SHA256(...))
    await this.signerRepo.update(signer.id, {
      ownerAddress: `sha256:${doubleHash}`,
    });

    return {
      signerId: signer.id,
      ethAddress: result.ethAddress,
      apiKey,
      signerShare: result.signerShare,
      userShare: result.userShare,
    };
  } catch (error) {
    // Cleanup: delete signer record on DKG failure
    await this.signerRepo.delete(signer.id);
    throw error;
  }
}
```

### Database Changes

**None.** The `owner_address` column already exists as `TEXT`. The `sha256:` prefix is unambiguous vs Ethereum addresses (`0x...`). No migration needed.

**Implementation note:** `CreateSignerInput.ownerAddress` must accept `string` including the `'pending'` placeholder. The existing `signer.repository.ts` calls `.toLowerCase()` on `ownerAddress` — this is safe because both `'pending'` and `'sha256:<hex>'` are already lowercase. Verify that `signer.repository.ts` handles the `'pending'` value without error.

### Distinguishing owner types:

```typescript
function isAnonymousSigner(signer: Signer): boolean {
  return signer.ownerAddress?.startsWith('sha256:') ?? false;
}

function isDashboardSigner(signer: Signer): boolean {
  return signer.ownerAddress?.startsWith('0x') ?? false;
}
```

### Configuration

### Rate Limiting

The public endpoint uses a dedicated rate limit: 3 signers per IP per hour. This is separate from the general rate limit (100 req/min/IP from `RateLimitGuard`).

Uses `req.ip` which respects Express `trust proxy` setting. In production behind a reverse proxy (nginx, Caddy), configure `app.set('trust proxy', 1)` so `req.ip` reflects the real client IP from `X-Forwarded-For`.

In-memory counter resets on server restart. This is acceptable for v1 (self-hosted, single-process). When PRD-15 (#11) ships with Redis-backed rate limiting, this endpoint should use the Redis sliding window.

---

## Security Considerations

### Threat: Signer spam
**Risk:** Attacker floods `POST /signers/public` to exhaust server resources (DKG is CPU-intensive).
**Mitigation:** 3/hour/IP rate limit. For production, deploy behind a reverse proxy with additional rate limiting or IP allowlists.

### Threat: User share hash brute force
**Risk:** Attacker tries to guess `SHA256(userShareBase64)` to manage someone's signer.
**Mitigation:** User share is 32+ bytes of random key material encoded as base64. SHA-256 of that is computationally infeasible to brute-force. The double-hash prevents rainbow table attacks even if the DB is compromised.

### Threat: Replay attack on `X-User-Share-Hash`
**Risk:** MITM intercepts the hash and replays it.
**Mitigation:** (1) TLS in production (PRD-10, #6). (2) The hash alone doesn't grant signing access — you still need the API key. (3) The hash grants admin access (pause/resume/policies) but not fund access. This is the same security model as the API key itself — both are static bearer tokens protected by TLS.

### Threat: Admin credential rotation
**Risk:** If `X-User-Share-Hash` is compromised, there's no way to rotate it without key refresh.
**Mitigation:** Admin credential rotation requires key refresh (PRD-20) which rotates all shares. In v1, if the hash is compromised, the user can revoke the signer and create a new one. The blast radius is limited — an attacker with the hash can change policies but cannot sign transactions or access funds.

### Transient user share exposure during DKG
- The server generates all 3 shares during DKG — it has the user share by definition during the ceremony
- `Uint8Array` buffers are wiped with `.fill(0)` in `finally` blocks
- The base64 string representation persists in GC-managed memory (JavaScript strings are immutable)
- Post-creation, the server never receives or stores the raw user share — only the double-hash
- The CLI sends `SHA256(userShareBase64)` for admin auth — a one-way hash

### Separation of concerns
| Credential | What it grants |
|---|---|
| API key | Signing (signer+server path) |
| `SHA256(userShareBase64)` | Admin (pause, policies, audit) |
| User share (raw) | Backup signing (signer+user bypass path, future) |

Compromise of one credential type doesn't grant the others.

---

## Files to Create

| File | Purpose |
|---|---|
| `packages/server/src/common/anon-auth.guard.ts` | AnonAuthGuard — validates `X-User-Share-Hash` header |
| `packages/server/src/common/either-admin.guard.ts` | EitherAdminGuard — tries SessionGuard then AnonAuthGuard |
| `packages/server/src/signers/dto/create-public-signer.dto.ts` | DTO for public creation endpoint |

## Files to Modify

| File | Changes |
|---|---|
| `packages/server/src/signers/signer.controller.ts` | Add `POST /signers/public` route; apply `EitherAdminGuard` to admin routes |
| `packages/server/src/signers/signer.service.ts` | Make `ownerAddress` in `CreateSignerInput` accept `'pending'` placeholder |
| `packages/server/src/dkg/dkg.service.ts` | Add `createWithDKG()` atomic method |
| `packages/server/src/common/config.ts` | Add `PUBLIC_CREATE_LIMIT` config |
| `packages/server/src/signers/signer.module.ts` | Register new guards |
| `packages/server/src/policies/policy.controller.ts` | Change guards from `SessionGuard` to `EitherAdminGuard` on CRUD routes |
| `packages/server/src/audit/audit.controller.ts` | Change `GET /audit-log/export` guard from `SessionGuard` to `EitherAuthGuard` |

## Files NOT Modified

| File | Reason |
|---|---|
| `packages/server/src/auth/` | Dashboard auth is completely separate — no changes |
| `packages/app/` | Dashboard UI unchanged — no public creation from browser |
| `packages/server/src/signing/` | Signing endpoints use API key auth — unchanged |
| `supabase/migrations/` | No schema changes needed — RLS uses service role key (bypasses RLS) |

---

## Test Plan

### Unit Tests

1. **AnonAuthGuard — valid hash**: Send `X-User-Share-Hash` matching a signer's `owner_address`. Assert: passes, sets `req.signerId`.
2. **AnonAuthGuard — invalid hash**: Send wrong hash. Assert: throws `UnauthorizedException`.
3. **AnonAuthGuard — missing header**: No header. Assert: throws `UnauthorizedException`.
4. **AnonAuthGuard — dashboard signer**: Signer has `0x...` ownerAddress, send hash. Assert: throws `UnauthorizedException` (wrong prefix).
5. **AnonAuthGuard — pending signer**: Signer has `ownerAddress = 'pending'`. Assert: throws `UnauthorizedException`.
6. **EitherAdminGuard — session auth**: Valid JWT, no hash header. Assert: passes via SessionGuard path.
7. **EitherAdminGuard — anon auth**: No JWT, valid hash. Assert: passes via AnonAuthGuard path.
8. **EitherAdminGuard — neither**: No JWT, no hash. Assert: throws `UnauthorizedException`.
9. **isAnonymousSigner/isDashboardSigner**: Test prefix detection for `sha256:`, `0x`, `pending`, `null`.

### Integration Tests

10. **Public creation — happy path**: `POST /signers/public` with valid name. Assert: 201, response has all fields, DKG completed, `owner_address` starts with `sha256:`.
11. **Public creation — rate limit**: 4 rapid requests from same IP. Assert: first 3 succeed, 4th gets 429.
12. **Admin via hash — pause**: Create public signer, then `POST /signers/:id/pause` with `X-User-Share-Hash`. Assert: 200, signer paused.
14. **Admin via hash — wrong signer**: Send hash for signer A to signer B's pause endpoint. Assert: 401.
15. **DKG failure cleanup**: Mock DKG to throw. Assert: signer row is deleted, no orphan records.
16. **createWithDKG atomicity**: Verify signer + DKG + Vault store all succeed, or all fail.
17. **Audit export with API key**: `GET /audit-log/export` with `x-api-key` header. Assert: 200 with CSV body.
18. **Policy CRUD with anon auth**: Create/list/update/delete policy using `X-User-Share-Hash`. Assert: all operations succeed.

---

## Acceptance Criteria

- [ ] `POST /api/v1/signers/public` creates a signer without any auth
- [ ] Response includes `signerId`, `ethAddress`, `apiKey`, `signerShare`, `userShare`
- [ ] `owner_address` stored as `sha256:<SHA256(SHA256(userShareBase64))>` (double-hash)
- [ ] `X-User-Share-Hash` header authenticates admin operations for anonymous signers
- [ ] Admin routes work for both dashboard signers (SessionGuard) and anonymous signers (AnonAuthGuard)
- [ ] Policy controller routes accept `EitherAdminGuard`
- [ ] Audit export endpoint accepts `EitherAuthGuard` (API key works)
- [ ] Rate limit: max 3 public creations per IP per hour (in-memory, resets on restart)
- [ ] DKG failure cleans up the signer record
- [ ] Dashboard signer creation path is completely unchanged
- [ ] All existing tests pass
- [ ] `pnpm build` succeeds across all packages
