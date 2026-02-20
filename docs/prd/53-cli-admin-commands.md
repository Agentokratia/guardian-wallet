# PRD-53: CLI Admin Commands — Unlock, Policies, Pause/Resume, Audit

**Status:** Draft
**Priority:** P1 — enables headless signer management
**Effort:** 3-4 days
**Depends on:** PRD-51 (AnonAuthGuard), PRD-52 (directory layout + keychain)
**Related issues:** Cross-refs: PRD-03 (#5, audit signing path filter), PRD-00 (#2, signing path policy context)

---

## Problem Statement

Anonymous CLI signers (created via `POST /signers/public`) have no admin interface. The dashboard requires WebAuthn login (SessionGuard). The CLI has no admin commands.

After PRD-51 and PRD-52, users can create signers from the CLI and store credentials securely. But a **separate admin agent** (MCP tool, AI agent, script) cannot manage policies because:
1. Admin auth requires `SHA256(userShare)` — derived from the OS keychain
2. The keychain requires human interaction (Touch ID, password prompt)
3. An autonomous agent can't prompt for that

The solution: human unlocks admin once (`gw admin unlock`), which writes the hash to `~/.guardian-wallet/admin/<name>.token`. The admin agent reads the token file — no keychain access needed.

---

## Current State Analysis

### Existing admin endpoints (all SessionGuard)

| Method | Path | Purpose |
|---|---|---|
| `GET /signers/:id/policies` | List policies | `packages/server/src/policies/policy.controller.ts` |
| `POST /signers/:id/policies` | Create policy | Same |
| `PATCH /policies/:id` | Update policy | Same |
| `DELETE /policies/:id` | Delete policy | Same |
| `POST /signers/:id/pause` | Pause signer | `packages/server/src/signers/signer.controller.ts` |
| `POST /signers/:id/resume` | Resume signer | Same |
| `GET /audit-log` | List audit entries | `packages/server/src/audit/audit.controller.ts` |
| `GET /audit-log/export` | CSV export | Same |

**Guard status (actual code, not CLAUDE.md):**
- Policy CRUD + pause/resume: `SessionGuard`
- `GET /audit-log`: `EitherAuthGuard` (API key works)
- `GET /audit-log/export`: `SessionGuard` — **this is different from the listing endpoint**. PRD-51 changes it to `EitherAuthGuard` so CLI users can export.

### No CLI admin commands exist

The CLI (`packages/wallet/src/cli/index.ts`) registers 7 commands: `init`, `status`, `balance`, `send`, `sign-message`, `deploy`, `proxy`. None of these perform admin operations (policies, pause/resume, audit).

### HttpClient has no admin methods

**`packages/signer/src/http-client.ts`** only has signing-related methods:
- `createSignSession`, `createMessageSignSession`, `processSignRound`, `completeSign`, `completeMessageSign`

No methods for policies, pause/resume, or audit.

---

## Technical Specification

### All Admin Commands Under `gw admin`

Every admin operation lives under the `admin` subcommand. Clean separation from signing commands.

```
gw admin unlock [--ttl <duration>]     # Human: keychain → admin.token
gw admin lock                          # Human: delete admin.token
gw admin policies                      # List policies
gw admin policies add [--type ...]     # Add policy (interactive or non-interactive)
gw admin policies remove <id>          # Remove policy
gw admin policies toggle <id>          # Enable/disable policy
gw admin pause                         # Pause signer
gw admin resume                        # Resume signer
gw admin audit [--limit N] [--export]  # View audit log
```

### `gw admin unlock` — Enable Admin Access

**This is how a human grants admin access to autonomous agents.**

```
$ gw admin unlock

  Reading user share from keychain...
  Admin access enabled for "my-agent".
  Token: ~/.guardian-wallet/admin/my-agent.token

$ gw admin unlock --ttl 8h

  Admin access enabled for "my-agent" (expires in 8 hours).
  Token: ~/.guardian-wallet/admin/my-agent.token
```

**Steps:**
1. Load signer config from `signers/<name>.json`
2. Read user share from keychain: `getUserShare(signerName)` — may prompt for Touch ID / password
3. Compute `SHA256(userShareBase64)` → hex string
4. Write `admin/<name>.token`:
   ```json
   {
     "hash": "a1b2c3d4e5f6...",
     "createdAt": "2026-02-20T22:00:00Z",
     "expiresAt": "2026-02-21T06:00:00Z"
   }
   ```
5. If `--ttl` not specified, `expiresAt` is `null` (no expiry)
6. Create `admin/` directory with `0700` if it doesn't exist
7. Write token file with `0600` permissions

**If keychain is unavailable:** Error: `"No user share in keychain for this signer. Was it created via CLI (gw init)?"`

**If admin.token already exists:** Overwrite (refresh). Useful to extend TTL.

### `gw admin lock` — Revoke Admin Access

```
$ gw admin lock

  Admin access revoked for "my-agent".
  Deleted: ~/.guardian-wallet/admin/my-agent.token
```

Deletes `admin/<name>.token`. Any agent that was using it loses admin access immediately on next request.

### `gw admin policies` — List Policies

```
$ gw admin policies

  Policies for "my-agent" (0x742d...4Fe2):

  ID                                    Type              Config                          Enabled
  ────────────────────────────────────  ────────────────  ──────────────────────────────  ───────
  a1b2c3d4-...                          spending_limit    max: 1.0 ETH                    Yes
  e5f6g7h8-...                          rate_limit        10 req / 3600s                  Yes
  i9j0k1l2-...                          allowed_contracts 0xA0b8...3C4d, 0x5E6f...7G8h   No

  3 policies (2 enabled)
```

### `gw admin policies add` — Create Policy

**Interactive mode (default):**

```
$ gw admin policies add

  ? Policy type:
  > spending_limit
    daily_limit
    monthly_limit
    allowed_contracts
    allowed_functions
    blocked_addresses
    rate_limit
    time_window

  ? Max amount (ETH): 1.0

  Create spending_limit policy?
    Max: 1.0 ETH
    Enabled: Yes

  ? Confirm: Yes
  Policy created: a1b2c3d4-...
```

**Non-interactive mode (for agents/scripting):**

```bash
gw admin policies add --type spending_limit --max 1.0
gw admin policies add --type daily_limit --max 5.0
gw admin policies add --type monthly_limit --max 100.0
gw admin policies add --type rate_limit --max-requests 10 --window 3600
gw admin policies add --type allowed_contracts --addresses 0xA0b8...3C4d,0x5E6f...7G8h
gw admin policies add --type allowed_functions --selectors 0xa9059cbb,0x095ea7b3
gw admin policies add --type blocked_addresses --addresses 0xDEAD...BEEF
gw admin policies add --type time_window --start 9 --end 17 --timezone UTC
```

When `--type` is provided, the command runs non-interactively. Missing required flags produce an error with usage hint.

| Type | Interactive Prompts | Non-Interactive Flags |
|---|---|---|
| `spending_limit` | Max amount (ETH) | `--max <eth>` |
| `daily_limit` | Max daily amount (ETH) | `--max <eth>` |
| `monthly_limit` | Max monthly amount (ETH) | `--max <eth>` |
| `allowed_contracts` | Contract addresses (comma-separated) | `--addresses <addrs>` |
| `allowed_functions` | Function selectors or signatures (comma-separated) | `--selectors <sigs>` |
| `blocked_addresses` | Blocked addresses (comma-separated) | `--addresses <addrs>` |
| `rate_limit` | Max requests, Window (seconds) | `--max-requests <n> --window <secs>` |
| `time_window` | Start hour (0-23), End hour (0-23), Timezone | `--start <h> --end <h> --timezone <tz>` |

### `gw admin policies remove <id>` — Delete Policy

```
$ gw admin policies remove a1b2c3d4-...

  Remove spending_limit policy (max: 1.0 ETH)?
  ? Confirm: Yes
  Policy removed.
```

### `gw admin policies toggle <id>` — Enable/Disable

```
$ gw admin policies toggle a1b2c3d4-...

  spending_limit policy (max: 1.0 ETH): Enabled → Disabled
```

### `gw admin pause` — Pause Signer

```
$ gw admin pause

  Pause signer "my-agent" (0x742d...4Fe2)?
  This will block ALL signing requests until resumed.
  ? Confirm: Yes
  Signer paused.
```

### `gw admin resume` — Resume Signer

```
$ gw admin resume

  Resume signer "my-agent" (0x742d...4Fe2)?
  ? Confirm: Yes
  Signer resumed.
```

### `gw admin audit` — View Audit Log

**Limitation:** The current `GET /audit-log` endpoint does not filter by signer. PRD-51 adds `signerId` query parameter support. `gw admin audit` always sends `signerId` to scope results to the current signer.

```
$ gw admin audit

  Recent signing requests for "my-agent":

  Time                  Type          Path          Status     To                   Value
  ────────────────────  ────────────  ────────────  ─────────  ───────────────────  ──────
  2026-02-20 14:30:12   send          signer+server completed  0xA0b8...3C4d       0.5 ETH
  2026-02-20 14:25:01   send          signer+server blocked    0x5E6f...7G8h       2.0 ETH
  2026-02-20 13:10:45   sign_message  signer+server completed  —                   —

  Showing 3 of 47 entries. Use --limit to see more.
```

**Options:**
- `--limit <n>` — number of entries (default: 20)
- `--status <status>` — filter: `completed`, `blocked`, `failed`, `pending`
- `--export` — CSV output to stdout (pipe to file: `gw admin audit --export > audit.csv`)

When PRD-03 (#5) ships the `signingPath` query parameter, add:
- `--path <path>` — filter: `signer+server`, `user+server`, `signer+user`

### Auth Resolution for Admin Commands

All admin commands (except `unlock`/`lock`) follow this resolution order:

```typescript
async function getAdminHeaders(signerName: string): Promise<Record<string, string>> {
  const config = loadSignerConfig(signerName);
  const headers: Record<string, string> = {
    'x-api-key': config.apiKey,
  };

  // 1. Try admin.token file first (for autonomous agents)
  const token = loadAdminToken(signerName);
  if (token) {
    headers['x-user-share-hash'] = token.hash;
    return headers;
  }

  // 2. Fall back to keychain (for interactive human use)
  const userShare = await getUserShare(signerName);
  if (userShare) {
    const hash = createHash('sha256').update(userShare).digest('hex');
    headers['x-user-share-hash'] = hash;
    return headers;
  }

  // 3. No admin credential available
  throw new Error(
    'No admin access. Run `gw admin unlock` first, or use the dashboard.'
  );
}
```

**Resolution order:** `admin/<name>.token` → keychain → error

This means:
- **Autonomous agent**: reads `admin.token` — no keychain needed
- **Interactive human**: keychain fallback works even without `admin.token`
- **Imported signer (no user share)**: error with helpful message

**Exception: `gw admin audit`** uses API key auth only (via `EitherAuthGuard`). It works for all signers regardless of admin access. The audit log is read-only.

### GuardianApi Extension

**`packages/wallet/src/lib/guardian-api.ts`** — add admin methods:

```typescript
class GuardianApi {
  // Existing methods...

  // New admin methods
  async listPolicies(signerId: string, headers?: Record<string, string>): Promise<Policy[]>;
  async createPolicy(signerId: string, body: CreatePolicyInput, headers?: Record<string, string>): Promise<Policy>;
  async deletePolicy(policyId: string, headers?: Record<string, string>): Promise<void>;
  async updatePolicy(policyId: string, body: UpdatePolicyInput, headers?: Record<string, string>): Promise<Policy>;
  async pauseSigner(signerId: string, headers?: Record<string, string>): Promise<void>;
  async resumeSigner(signerId: string, headers?: Record<string, string>): Promise<void>;
  async getAuditLog(params: AuditLogParams, headers?: Record<string, string>): Promise<AuditLogEntry[]>;
  async exportAuditLog(params: AuditLogParams, headers?: Record<string, string>): Promise<string>; // CSV
}
```

### Server-Side Guard Updates (from PRD-51)

After PRD-51 ships `EitherAdminGuard`, the policy and audit endpoints accept it:

| Endpoint | Current Guard | New Guard | Notes |
|---|---|---|---|
| `GET /signers/:id/policies` | `SessionGuard` | `EitherAdminGuard` | |
| `POST /signers/:id/policies` | `SessionGuard` | `EitherAdminGuard` | |
| `PATCH /policies/:id` | `SessionGuard` | `EitherAdminGuard` | |
| `DELETE /policies/:id` | `SessionGuard` | `EitherAdminGuard` | |
| `POST /signers/:id/pause` | `SessionGuard` | `EitherAdminGuard` | |
| `POST /signers/:id/resume` | `SessionGuard` | `EitherAdminGuard` | |
| `GET /audit-log` | `EitherAuthGuard` | `EitherAuthGuard` | Unchanged — API key works |
| `GET /audit-log/export` | `SessionGuard` | `EitherAuthGuard` | **Changed in PRD-51** — enables CLI CSV export |

### Policy Config Builders

Each policy type has specific config. Interactive prompts build the config object:

```typescript
const POLICY_BUILDERS: Record<string, (readline) => Promise<PolicyConfig>> = {
  spending_limit: async (rl) => {
    const max = await prompt(rl, 'Max amount (ETH):');
    return { maxAmount: parseEther(max).toString() };
  },
  daily_limit: async (rl) => {
    const max = await prompt(rl, 'Max daily amount (ETH):');
    return { maxDailyAmount: parseEther(max).toString() };
  },
  monthly_limit: async (rl) => {
    const max = await prompt(rl, 'Max monthly amount (ETH):');
    return { maxMonthlyAmount: parseEther(max).toString() };
  },
  allowed_contracts: async (rl) => {
    const addrs = await prompt(rl, 'Contract addresses (comma-separated):');
    return { addresses: addrs.split(',').map(a => a.trim()) };
  },
  allowed_functions: async (rl) => {
    const sigs = await prompt(rl, 'Function selectors or signatures (comma-separated):');
    return { selectors: sigs.split(',').map(s => s.trim()) };
  },
  blocked_addresses: async (rl) => {
    const addrs = await prompt(rl, 'Blocked addresses (comma-separated):');
    return { addresses: addrs.split(',').map(a => a.trim()) };
  },
  rate_limit: async (rl) => {
    const max = await prompt(rl, 'Max requests:');
    const window = await prompt(rl, 'Window (seconds):');
    return { maxRequests: parseInt(max), windowSeconds: parseInt(window) };
  },
  time_window: async (rl) => {
    const start = await prompt(rl, 'Start hour (0-23):');
    const end = await prompt(rl, 'End hour (0-23):');
    const tz = await prompt(rl, 'Timezone (e.g. UTC, America/New_York):');
    return { startHour: parseInt(start), endHour: parseInt(end), timezone: tz };
  },
};
```

### Table Formatting

Use `chalk` for color and manual column alignment (no external table library). Keep it simple:

```typescript
function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || '').length))
  );
  const header = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  const separator = widths.map(w => '─'.repeat(w)).join('  ');
  const body = rows.map(r => r.map((c, i) => (c || '').padEnd(widths[i])).join('  ')).join('\n');
  return `${header}\n${separator}\n${body}`;
}
```

### MCP Server — Admin Tools + File-Based Config

The MCP server (`packages/wallet/src/mcp/`) currently reads config exclusively from env vars:

```
GUARDIAN_API_KEY       → API key
GUARDIAN_API_SECRET    → signer share (base64)
GUARDIAN_SERVER        → server URL
GUARDIAN_NETWORK       → default network
```

After PRD-52, credentials live in `~/.guardian-wallet/signers/<name>.json`. We update `SignerManager.getConfig()` to support both:

```typescript
private getConfig() {
  // 1. Env vars (backward compat — existing MCP configs keep working)
  let apiSecret = process.env.GUARDIAN_API_SECRET;
  const secretFile = process.env.GUARDIAN_API_SECRET_FILE;
  const serverUrl = process.env.GUARDIAN_SERVER;
  const apiKey = process.env.GUARDIAN_API_KEY;

  if (apiSecret || secretFile) {
    // Old-style env var config
    if (!apiSecret && secretFile) apiSecret = readFileSync(secretFile, 'utf-8').trim();
    if (!apiSecret) throw new Error('GUARDIAN_API_SECRET is required');
    if (!apiKey) throw new Error('GUARDIAN_API_KEY is required');
    return { apiSecret, serverUrl: serverUrl || 'http://localhost:8080', apiKey };
  }

  // 2. File-based config — resolve signer from GUARDIAN_SIGNER env or .default/auto
  const signerName = process.env.GUARDIAN_SIGNER || undefined;
  const config = loadSignerConfig(signerName); // from config.ts
  const secret = resolveApiSecret(config);
  return {
    apiSecret: secret,
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
    signerName: config.signerName,
    signerId: config.signerId,
  };
}
```

**New MCP config (simple — reads from files):**
```json
{
  "mcpServers": {
    "guardian": {
      "command": "gw",
      "env": { "GUARDIAN_SIGNER": "my-agent" }
    }
  }
}
```

**Even simpler (auto-resolves from .default or single signer):**
```json
{
  "mcpServers": {
    "guardian": { "command": "gw" }
  }
}
```

**Old MCP config (still works — env vars take priority):**
```json
{
  "mcpServers": {
    "guardian": {
      "command": "gw",
      "env": {
        "GUARDIAN_API_KEY": "gw_live_...",
        "GUARDIAN_API_SECRET": "base64...",
        "GUARDIAN_SERVER": "http://localhost:8080"
      }
    }
  }
}
```

#### New MCP Admin Tools

Register alongside existing tools in `mcp/index.ts`:

| Tool name | What it does | Auth |
|---|---|---|
| `guardian_admin_policies_list` | List policies for current signer | `admin.token` or error |
| `guardian_admin_policies_add` | Add policy (type + config as params) | `admin.token` or error |
| `guardian_admin_policies_remove` | Remove policy by ID | `admin.token` or error |
| `guardian_admin_policies_toggle` | Enable/disable policy by ID | `admin.token` or error |
| `guardian_admin_pause` | Pause signer | `admin.token` or error |
| `guardian_admin_resume` | Resume signer | `admin.token` or error |

Admin tools read `admin/<name>.token` for the hash. If no token exists, they return: `"Admin not unlocked. Run 'gw admin unlock' first."`

The existing `guardian_get_audit_log` tool already works with API key auth — no admin token needed.

#### `SignerManager` Gets Admin Support

```typescript
// New method on SignerManager
getAdminHash(): string | null {
  const name = this.getSignerName(); // from config or env
  if (!name) return null;
  const token = loadAdminToken(name);
  return token?.hash ?? null;
}

getAdminHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key': this.getConfig().apiKey,
  };
  const hash = this.getAdminHash();
  if (hash) headers['x-user-share-hash'] = hash;
  return headers;
}
```

---

## Security Considerations

### Admin hash cannot sign transactions

The `admin/<name>.token` contains `SHA256(userShare)` — a one-way hash. It authenticates admin operations (policies, pause/resume) but CANNOT be used to sign transactions. Even if the token file is stolen, the attacker cannot move funds.

### Admin token file permissions

`admin/<name>.token` is written with `0600` permissions. Only the file owner can read it. The `admin/` directory is `0700`.

### Confirmation prompts for destructive operations

`gw admin pause`, `gw admin policies remove`, and future destructive commands require explicit `y/n` confirmation in interactive mode. Non-interactive invocations (with `--type` flag) skip confirmation — the caller is a script/agent that made a deliberate API call.

### Audit log access

`gw admin audit` uses API key auth (via `EitherAuthGuard`), not admin auth. This means any process with the API key can view the audit log. This is intentional — the audit log is read-only and useful for monitoring.

### Token expiry

When `--ttl` is used, the token has an `expiresAt` timestamp. `loadAdminToken()` checks this and auto-deletes expired tokens. No background process needed.

---

## Files to Create

| File | Purpose |
|---|---|
| `packages/wallet/src/cli/commands/admin.command.ts` | `gw admin` subcommand group: `unlock`, `lock`, `policies`, `pause`, `resume`, `audit` |
| `packages/wallet/src/mcp/tools/admin-policies-list.ts` | MCP tool: list policies |
| `packages/wallet/src/mcp/tools/admin-policies-add.ts` | MCP tool: add policy |
| `packages/wallet/src/mcp/tools/admin-policies-remove.ts` | MCP tool: remove policy |
| `packages/wallet/src/mcp/tools/admin-policies-toggle.ts` | MCP tool: toggle policy |
| `packages/wallet/src/mcp/tools/admin-pause.ts` | MCP tool: pause signer |
| `packages/wallet/src/mcp/tools/admin-resume.ts` | MCP tool: resume signer |

## Files to Modify

| File | Changes |
|---|---|
| `packages/wallet/src/cli/index.ts` | Register `admin` subcommand group |
| `packages/wallet/src/lib/guardian-api.ts` | Add admin API methods (listPolicies, createPolicy, etc.) |
| `packages/wallet/src/lib/config.ts` | Add `loadAdminToken()`, `writeAdminToken()`, `deleteAdminToken()`, `getAdminHeaders()` |
| `packages/wallet/src/lib/signer-manager.ts` | Add file-based config fallback, `getAdminHash()`, `getAdminHeaders()` |
| `packages/wallet/src/mcp/index.ts` | Register 6 new admin tools |

## Files NOT Modified

| File | Reason |
|---|---|
| `packages/server/src/policies/` | Guard changes are in PRD-51 scope |
| `packages/server/src/signers/signer.controller.ts` | Guard changes are in PRD-51 scope |
| `packages/server/src/audit/audit.controller.ts` | Guard + `signerId` query param changes are in PRD-51 scope |
| `packages/signer/src/http-client.ts` | Admin calls go through GuardianApi, not HttpClient |

---

## Test Plan

### Unit Tests

1. **admin unlock — writes token**: Mock keychain `getUserShare`. Assert: `admin/<name>.token` written with correct hash.
2. **admin unlock — with TTL**: `--ttl 8h`. Assert: `expiresAt` is ~8 hours from now.
3. **admin unlock — no TTL**: Assert: `expiresAt` is null.
4. **admin unlock — no keychain**: Mock keychain returning null. Assert: error message about missing user share.
5. **admin lock — deletes token**: Write token, run lock. Assert: file deleted.
6. **admin lock — no token**: Assert: no error (idempotent).
7. **getAdminHeaders — from token**: Write `admin.token`. Assert: hash from token used, keychain NOT called.
8. **getAdminHeaders — keychain fallback**: No token, mock keychain. Assert: hash computed from keychain.
9. **getAdminHeaders — both missing**: No token, no keychain. Assert: error.
10. **policies list — table format**: Mock API response with 3 policies. Assert: table output correct.
11. **policies add — interactive spending_limit**: Mock readline inputs. Assert: correct `CreatePolicyInput` built.
12. **policies add — interactive rate_limit**: Mock readline. Assert: `maxRequests` and `windowSeconds` parsed correctly.
13. **policies add — non-interactive spending_limit**: `--type spending_limit --max 1.0`. Assert: correct config, no readline.
14. **policies add — non-interactive rate_limit**: `--type rate_limit --max-requests 10 --window 3600`. Assert: correct config.
15. **policies add — non-interactive missing flag**: `--type spending_limit` without `--max`. Assert: error with usage hint.
16. **policies remove — confirmation denied**: Mock readline 'n'. Assert: no API call.
17. **policies toggle — enable**: Mock disabled policy. Assert: API called with `{ enabled: true }`.
18. **policies toggle — disable**: Mock enabled policy. Assert: API called with `{ enabled: false }`.
19. **pause — confirmation**: Mock readline 'y'. Assert: `POST /signers/:id/pause` called.
20. **resume**: Assert: `POST /signers/:id/resume` called.
21. **audit — default**: Assert: `GET /audit-log?signerId=<id>&limit=20` called.
22. **audit — filtered**: `--status blocked --limit 50`. Assert: correct query params including `signerId`.
23. **audit — export**: `--export`. Assert: raw CSV written to stdout.
24. **audit — no admin needed**: No token, no keychain. Assert: still works (API key auth).

### Integration Tests

25. **Unlock → policy CRUD → lock**: Unlock → add policy → list → toggle → remove → lock. Assert: each step works, lock revokes access.
26. **Non-interactive policy CRUD**: `gw admin policies add --type spending_limit --max 1.0` → list → remove. Assert: no interactive prompts.
27. **Pause/resume cycle**: Pause → verify signing fails → resume → verify signing works.
28. **Audit after signing**: Send a transaction → `gw admin audit`. Assert: entry appears, scoped to current signer.
29. **Token expiry**: Unlock with `--ttl 1s`, wait 2s, run admin command. Assert: token expired, falls back to keychain.

---

## Acceptance Criteria

- [ ] `gw admin unlock` reads keychain → writes `admin/<name>.token`
- [ ] `gw admin unlock --ttl 8h` sets expiry on token
- [ ] `gw admin lock` deletes token, revokes agent admin access
- [ ] Admin commands check token first, then keychain fallback
- [ ] `gw admin policies` lists all policies in table format
- [ ] `gw admin policies add` creates a policy via interactive prompts
- [ ] `gw admin policies add --type <type> [flags]` creates non-interactively (for agents)
- [ ] `gw admin policies remove <id>` deletes with confirmation
- [ ] `gw admin policies toggle <id>` enables/disables
- [ ] `gw admin pause` pauses signer with confirmation
- [ ] `gw admin resume` resumes signer
- [ ] `gw admin audit` shows signing requests scoped to current signer
- [ ] `gw admin audit --export` outputs CSV to stdout
- [ ] `gw admin audit` works without admin token (API key auth)
- [ ] Expired tokens auto-cleaned on next access
- [ ] All commands respect `--signer` flag for multi-signer support
- [ ] `pnpm build` succeeds across all packages
