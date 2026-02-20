# PRD-52: CLI Init Rework — Flat Config, Keychain, Anonymous Creation

**Status:** Draft
**Priority:** P0 — primary CLI UX improvement
**Effort:** 4-5 days
**Depends on:** PRD-51 (public signer creation endpoint)
**Related issues:** None (new feature). Cross-refs: PRD-12 (#8, API key rotation), PRD-54 (share format)

---

## Problem Statement

The current `gw init` command only stores pre-existing credentials. It cannot create signers. The config is a single flat file (`~/.guardian-wallet/config.json`) that supports one signer at a time. There is no secure storage for the user share — it exists only as a file or is lost.

Specific problems:
1. **No signer creation from CLI** — must use dashboard first
2. **Single signer only** — one config file = one signer. No multi-signer support.
3. **No user share storage** — user share returned during DKG but not persisted anywhere secure
4. **Manual credential entry** — user must copy-paste API key and secret file path from dashboard

---

## Current State Analysis

### Current `gw init` flow

**`packages/wallet/src/cli/commands/init.command.ts`** (104 lines):
1. Prints welcome banner
2. Checks if `~/.guardian-wallet/config.json` exists (warns about overwrite)
3. Prompts for: Server URL (default `http://localhost:8080`), API key (hidden), API secret file path or raw secret (hidden), Network (default `base-sepolia`)
4. Writes `TwConfig` to `~/.guardian-wallet/config.json`
5. Done — no signer creation, no DKG, no keychain

### Current config shape

**`packages/wallet/src/lib/config.ts`** (103 lines):
```typescript
interface TwConfig {
  serverUrl: string;       // e.g. "http://localhost:8080"
  apiKey: string;          // raw API key (gw_live_*)
  apiSecret?: string;      // base64 key material (inline)
  apiSecretFile?: string;  // path to .secret file (alternative)
  network: string;         // e.g. "base-sepolia"
}
```

**Config location:** `~/.guardian-wallet/config.json` (single file, 0600 permissions)

### Current config utilities

- `getConfigDir()` → `~/.guardian-wallet`
- `getConfigPath()` → `~/.guardian-wallet/config.json`
- `configExists()` → boolean
- `loadConfig()` → reads and parses config
- `saveConfig(config)` → atomic write (tmp + rename), 0600 permissions, 0700 dir
- `resolveApiSecret(config)` → returns `apiSecret` or reads `apiSecretFile`
- `createClientFromConfig(config)` → `{ client: HttpClient, api: GuardianApi }`
- `createSignerFromConfig(config)` → `ThresholdSigner`

### All commands except `init` call `loadConfig()`

Commands: `status`, `balance`, `send`, `sign-message`, `deploy`, `proxy` — all load the single config file and create a signer/client from it.

---

## Technical Specification

### New Directory Structure

```
~/.guardian-wallet/
  .default                           # plain text: "my-agent" (optional)
  signers/
    my-agent.json                    # signing credentials
    trading-bot.json
  admin/
    my-agent.token                   # admin hash (written by `gw admin unlock`)

OS Keychain (service: guardian-wallet):
  guardian-wallet/my-agent           # full user share (human only)
```

No global config file. The `signers/` directory IS the config. The `.default` file is optional — just a signer name, one line, plain text.

| Location | What's in it | Who reads it |
|---|---|---|
| `signers/` | Signing credentials (apiKey, signerShare, serverUrl) | Trading agent |
| `admin/` | `SHA256(userShare)` — admin-only credential | Admin agent (MCP, AI) |
| `.default` | Default signer name (plain text) | CLI (signer resolution) |
| Keychain | Full user share (can sign + can derive admin hash) | Human only |

### Signer Config

```typescript
interface SignerConfig {
  version: 1;
  serverUrl: string;
  apiKey: string;
  apiSecret?: string;                // base64 signer share (party 0) — inline
  apiSecretFile?: string;            // path to .secret file — alternative
  network: string;
  signerName: string;
  ethAddress: string;
  signerId?: string;                 // server-side UUID
  createdAt?: string;                // ISO timestamp
}
```

**Location:** `~/.guardian-wallet/signers/<name>.json` (0600 permissions)

This is today's `TwConfig` + `version`, `signerName`, `ethAddress`, `signerId`. All existing fields unchanged. `resolveApiSecret()` and `createSignerFromConfig()` work as-is.

### Admin Token

```typescript
interface AdminToken {
  hash: string;                      // SHA256(userShareBase64) — hex
  createdAt: string;                 // ISO timestamp
  expiresAt?: string | null;         // ISO timestamp or null (no expiry)
}
```

**Location:** `~/.guardian-wallet/admin/<name>.token` (0600 permissions)

The hash **cannot sign transactions** — it only provides admin access (policies, pause/resume). Even if compromised, the attacker cannot move funds.

### Signer Resolution

```
1. --signer flag           → use that
2. .default file exists    → use that name
3. 1 signer in signers/   → use it
4. 0 or 2+ signers        → error with helpful message
```

### New `gw init` Flow — Interactive Menu

```
$ gw init

  Guardian Wallet — CLI Setup

  ? What would you like to do?
  > 1. Create new signer (no dashboard needed)
    2. Import existing signer (from dashboard)
    3. Switch default signer

  [If no signers exist, option 3 is hidden]
```

#### Option 1: Create New Signer

```
$ gw init
  ? What would you like to do? Create new signer

  ? Signer name: my-agent
  ? Server URL: http://localhost:8080
  ? Network: base-sepolia

  Creating signer "my-agent"...
  Running key generation ceremony (DKG)... done (2.1s)

  Signer created:
    Name:     my-agent
    Address:  0x742d...4Fe2
    Network:  base-sepolia
    API Key:  gw_live_aBcD...xYz (saved to config)

  ? Store user share in OS keychain? (recommended) Yes
  User share stored in keychain.

  ? Enable admin access for agents? (recommended) Yes
  Admin token written to ~/.guardian-wallet/admin/my-agent.token

  Config saved to ~/.guardian-wallet/signers/my-agent.json
  Set as default signer.
  Run `gw status` to verify.
```

**Steps:**
1. Prompt for name, server URL, network
2. `POST /api/v1/signers/public` with `{ name, network }` — atomic DKG (see PRD-51)
3. Receive `{ signerId, ethAddress, apiKey, signerShare, userShare }`
4. Save: `signers/<name>.json`
5. Prompt: "Store user share in OS keychain?"
6. If yes → keychain. If no → warn about lost admin access.
7. Prompt: "Enable admin access for agents?"
8. If yes → compute `SHA256(userShareBase64)` → write `admin/<name>.token`
9. Write `.default` with signer name

#### Option 2: Import Existing Signer

```
$ gw init
  ? What would you like to do? Import existing signer

  First, create a signer at your Guardian dashboard
  (e.g. http://localhost:3000). Then paste the credentials here.

  ? Signer name: deploy-bot
  ? Server URL: http://localhost:8080
  ? API key: gw_live_aBcD...xYz
  ? Secret file path (or paste base64): ~/deploy-bot.secret
  ? Network: base-sepolia

  Verifying... ✓ (signer: 0xaB3c...9D1e)

  Config saved to ~/.guardian-wallet/signers/deploy-bot.json
  Set as default signer.
  Run `gw status` to verify.
```

- Saves to `signers/<name>.json`
- **Verification step**: calls `GET /api/v1/signers` with the API key to fetch `signerId` and `ethAddress` automatically. If server unreachable, saves without them + warning.
- Writes `.default`
- No admin token (imported signers don't have user share — admin via dashboard)

#### Option 3: Switch Default Signer

```
$ gw init
  ? What would you like to do? Switch default signer

  Available signers:
    1. my-agent     (0x742d...4Fe2) [default]
    2. deploy-bot   (0xaB3c...9D1e)
    3. trading-bot  (0x5F8a...2C7b)

  ? Select default signer: deploy-bot

  Default signer set to "deploy-bot".
```

Writes `deploy-bot` to `~/.guardian-wallet/.default`.

### Signer Selection at Runtime

```bash
# Uses .default (or auto-selects if only 1 signer)
gw send 0x... 0.01

# Override with --signer flag
gw --signer trading-bot send 0x... 0.01
```

### CLI Command Organization

Three domains, clean separation:

```
SETUP (human, interactive)
  gw init                          # create / import / switch default

SIGNING (trading agent, autonomous)
  gw status
  gw balance
  gw send <to> <amount>
  gw sign-message <message>
  gw deploy <bytecode>
  gw proxy                         # MCP/RPC proxy

ADMIN (human unlocks, agent uses)                    ← PRD-53
  gw admin unlock [--ttl 8h]       # keychain → admin.token
  gw admin lock                    # delete admin.token
  gw admin policies [add|remove|toggle]
  gw admin pause | resume
  gw admin audit [--limit N] [--export]
```

### Config Loading — Updated Logic

```typescript
const CONFIG_DIR = path.join(os.homedir(), '.guardian-wallet');

function getSignerConfigPath(name: string): string {
  return path.join(CONFIG_DIR, 'signers', `${name}.json`);
}

function getAdminTokenPath(name: string): string {
  return path.join(CONFIG_DIR, 'admin', `${name}.token`);
}

function getDefaultSignerName(): string | null {
  const defaultPath = path.join(CONFIG_DIR, '.default');
  if (!existsSync(defaultPath)) return null;
  return readFileSync(defaultPath, 'utf-8').trim() || null;
}

function listSigners(): string[] {
  const signersDir = path.join(CONFIG_DIR, 'signers');
  if (!existsSync(signersDir)) return [];
  return readdirSync(signersDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .filter(name => {
      try {
        const config = JSON.parse(readFileSync(getSignerConfigPath(name), 'utf-8'));
        return typeof config.serverUrl === 'string' && typeof config.apiKey === 'string';
      } catch {
        return false;
      }
    });
}

function resolveSignerName(explicit?: string): string {
  // 1. Explicit --signer flag
  if (explicit) return explicit;

  // 2. .default file
  const defaultName = getDefaultSignerName();
  if (defaultName) return defaultName;

  // 3. Auto-select if exactly 1 signer
  const signers = listSigners();
  if (signers.length === 1) return signers[0];
  if (signers.length === 0) throw new Error('No signers configured. Run `gw init` first.');
  throw new Error(
    `Multiple signers found: ${signers.join(', ')}.\n` +
    `Use --signer <name> or run \`gw init\` to set a default.`
  );
}

function loadSignerConfig(name?: string): SignerConfig {
  const signerName = resolveSignerName(name);
  const configPath = getSignerConfigPath(signerName);
  if (!existsSync(configPath))
    throw new Error(`Signer "${signerName}" not found. Run \`gw init\` first.`);
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}
```

**Backward compatibility:** If `~/.guardian-wallet/config.json` exists (old flat format) and no `signers/` directory exists, `loadSignerConfig()` falls back to the old path. `gw init` offers to migrate.

### Migration from Old Config

```
$ gw init

  Found legacy config at ~/.guardian-wallet/config.json
  ? Migrate to new format? Yes
  ? Signer name for this config: my-agent

  Migrated to ~/.guardian-wallet/signers/my-agent.json
  Set "my-agent" as default signer.
```

### OS Keychain Integration

**Library:** `keytar` (primary) with fallback alternatives.

**Platform support:**
| Platform | Backend | Notes |
|---|---|---|
| macOS | Keychain Access (Security.framework) | First access per session may prompt for Touch ID or login password |
| Windows | Credential Manager (wincred) | No prompt after login |
| Linux | libsecret (GNOME Keyring / KDE Wallet) | Requires `libsecret-1-dev`; headless servers may not have a secret service |

**`keytar` considerations:**
- Native Node.js module — requires `node-gyp` for builds
- **Alternative:** `@aspect-build/keytar` (maintained fork) if `keytar` becomes unmaintained
- **Headless/CI fallback**: If `keytar` import fails, fall back to file at `signers/<name>.user-share` (0600) with warning

**`packages/wallet/src/lib/keychain.ts`:**
```typescript
const SERVICE_NAME = 'guardian-wallet';

export async function storeUserShare(signerName: string, shareBase64: string): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE_NAME, signerName, shareBase64);
  } else {
    await storeUserShareToFile(signerName, shareBase64);
  }
}

export async function getUserShare(signerName: string): Promise<string | null> {
  const keytar = await loadKeytar();
  if (keytar) {
    return keytar.getPassword(SERVICE_NAME, signerName);
  }
  return loadUserShareFromFile(signerName);
}

export async function deleteUserShare(signerName: string): Promise<boolean> {
  const keytar = await loadKeytar();
  if (keytar) {
    return keytar.deletePassword(SERVICE_NAME, signerName);
  }
  return deleteUserShareFile(signerName);
}

// --- Internal ---

let keytarModule: typeof import('keytar') | null | undefined;

async function loadKeytar(): Promise<typeof import('keytar') | null> {
  if (keytarModule !== undefined) return keytarModule;
  try {
    keytarModule = await import('keytar');
    return keytarModule;
  } catch {
    keytarModule = null;
    return null;
  }
}
```

### Recovery: What Happens When the Keychain is Lost

1. **Signing still works.** Signer share in `signers/<name>.json` + server share → transactions work.
2. **Admin still works if `admin.token` exists.** The hash file is independent of keychain.
3. **If both lost:** Admin access lost for v1 anonymous signers. Signing still works.
4. **Mitigation:** `gw init` warns if user declines both keychain and admin token.

### Changes to Existing Commands

All commands need one change: `loadConfig()` → `loadSignerConfig(opts.signer)`.

The `program` object gets a global `--signer` option:
```typescript
program.option('-s, --signer <name>', 'Signer to use');
```

Everything downstream (`resolveApiSecret()`, `createSignerFromConfig()`, `createClientFromConfig()`) is unchanged.

### `gw status` — List Signers

When multiple signers exist, `gw status` shows all of them:

```
$ gw status

  Signer:   my-agent (0x742d...4Fe2)
  Server:   http://localhost:8080 (connected)
  Network:  base-sepolia
  Balance:  1.23 ETH
  Admin:    unlocked (token expires 2026-02-21 06:00)

  All signers:
    my-agent      0x742d...4Fe2  [default]
    trading-bot   0x5F8a...2C7b
    deploy-bot    0xaB3c...9D1e
```

- "All signers" section only shown when 2+ signers exist
- Shows which is default (from `.default` file)
- "Admin" line shows whether `admin/<name>.token` exists and its expiry

---

## Security Considerations

### Credential hierarchy

| Credential | On disk? | Can sign? | Can admin? | Risk if leaked |
|---|---|---|---|---|
| User share (keychain) | No (OS encrypted) | Yes (party 2) | Yes (derive hash) | Both |
| Signer share + API key (`signers/`) | Yes (0600) | Yes (party 0) | No | Can move funds |
| Admin hash (`admin/`) | Yes (0600) | No | Yes | Can change rules |

### File permissions

All files: `0600`. All directories: `0700`.

### Signer name validation

Used as file names. Validate: alphanumeric + hyphens + underscores, 1-64 chars, no path traversal (`..`, `/`, `\`).

### Note on admin agent reading signers/

The admin agent needs `signers/<name>.json` for `serverUrl`, `apiKey`, and `signerId`. It can see the signer share but doesn't use it. True isolation requires scoped API keys (v2).

---

## Files to Create

| File | Purpose |
|---|---|
| `packages/wallet/src/lib/keychain.ts` | Keychain wrapper for user share storage (with file fallback) |

## Files to Modify

| File | Changes |
|---|---|
| `packages/wallet/src/cli/commands/init.command.ts` | Full rewrite — interactive menu, create/import/switch |
| `packages/wallet/src/lib/config.ts` | `signers/` + `admin/` + `.default` layout, `resolveSignerName()`, `loadSignerConfig()`, `listSigners()`, migration, name validation |
| `packages/wallet/src/cli/index.ts` | Add `--signer` global option, `admin` subcommand group (PRD-53) |
| `packages/wallet/src/cli/commands/status.command.ts` | `loadConfig()` → `loadSignerConfig(opts.signer)` |
| `packages/wallet/src/cli/commands/balance.command.ts` | Same |
| `packages/wallet/src/cli/commands/send.command.ts` | Same |
| `packages/wallet/src/cli/commands/sign.command.ts` | Same |
| `packages/wallet/src/cli/commands/deploy.command.ts` | Same |
| `packages/wallet/src/cli/commands/proxy.command.ts` | Same |
| `packages/wallet/package.json` | Add `keytar` dependency |

## Files NOT Modified

| File | Reason |
|---|---|
| `packages/signer/src/threshold-signer.ts` | `fromSecret()` factory unchanged |
| `packages/signer/src/http-client.ts` | `x-api-key` header unchanged |
| `packages/server/` | No server changes |
| `packages/app/` | Dashboard unchanged |

---

## Test Plan

### Unit Tests

1. **loadSignerConfig — from signers/**: Write `signers/test.json`. Assert: loads correctly.
2. **resolveSignerName — explicit**: Pass `name='other'`. Assert: returns 'other'.
3. **resolveSignerName — .default file**: Write `.default` with 'my-agent'. Assert: returns 'my-agent'.
4. **resolveSignerName — auto single**: 1 signer in `signers/`. Assert: returns it.
5. **resolveSignerName — auto multiple**: 2 signers, no `.default`. Assert: throws with names listed.
6. **resolveSignerName — priority**: `--signer` beats `.default` beats auto.
8. **listSigners — valid**: 3 signer files. Assert: returns 3 names.
9. **listSigners — invalid config**: Broken JSON in `signers/`. Assert: excluded.
10. **Migration — old format**: Flat `config.json` exists. Assert: migration creates `signers/`, writes `.default`.
11. **Signer name validation**: Accepts `my-agent`, `bot_1`. Rejects `../evil`, `foo/bar`, empty.
12. **File permissions**: Assert: signers 0600, dirs 0700.

### Keychain Tests (mocked keytar)

13. **storeUserShare**: Assert: `keytar.setPassword` called correctly.
14. **getUserShare — exists**: Assert: returns base64 string.
15. **getUserShare — missing**: Assert: returns null.
16. **Keychain fallback**: Mock import failure. Assert: file fallback with 0600.

### Integration Tests

17. **Full create flow**: Mock server. Assert: `signers/<name>.json` + `admin/<name>.token` + `.default` + keychain.
18. **Full import flow**: Mock server. Assert: `signers/<name>.json` + `.default`, no admin token.
19. **Import — server unreachable**: Assert: config saved without signerId, warning printed.
20. **Switch default**: 2 signers, run init option 3. Assert: `.default` updated.
21. **Multi-signer**: `--signer` flag selects correct config.
22. **Backward compat**: Old flat config. Assert: `loadSignerConfig()` falls back.

---

## Acceptance Criteria

- [ ] `gw init` presents interactive menu (create / import / switch default)
- [ ] "Create new signer" → `POST /signers/public` + DKG → `signers/<name>.json`
- [ ] "Create new signer" offers admin token → `admin/<name>.token`
- [ ] "Import existing signer" → `signers/<name>.json`, auto-fetches metadata
- [ ] "Switch default signer" → writes `.default`
- [ ] `.default` written automatically on create/import
- [ ] Signer resolution: `--signer` > `.default` > auto-single
- [ ] User share stored in OS keychain
- [ ] Keychain failure falls back to file with warning
- [ ] `--signer <name>` works on all commands
- [ ] Old flat config migrates to new layout
- [ ] Signer names validated
- [ ] `pnpm build` succeeds
