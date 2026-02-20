# PRD-54: Share File Format Cleanup

**Status:** Draft
**Priority:** P2 — quality of life, low urgency
**Effort:** 0.5-1 day (reduced scope — mostly dead code removal + documentation)
**Depends on:** None (independent)
**Related issues:** PRD-02 (#4, role metadata on shares) — both touch share format. Coordinate: new plain base64 format should include the `role` field from PRD-02 when both ship.

---

## Problem Statement

There are currently two share file formats and two factory methods for loading shares:
1. **Encrypted binary** — AES-256-GCM with scrypt KDF, produced by `saveShareToFile()` in `share-loader.ts`. Requires a passphrase.
2. **Raw base64 JSON** — `{ coreShare: base64, auxInfo: base64 }`, produced by DKG and downloaded from dashboard. No passphrase.

The encrypted format was designed for CLI users who needed to protect share files on disk with a passphrase. Now that PRD-52 introduces OS keychain storage for the user share, the passphrase-encrypted format adds unnecessary complexity for new CLI signers.

Additionally, the `share-encrypt.ts` in the browser app contains `encryptShareForCLI()` — a dead code function that is never called anywhere in the codebase.

**Scope note:** This PRD is intentionally small. It could be folded into PRD-52 as a subtask. It exists as a separate PRD for tracking and because it can be implemented independently. If the team prefers, merge its tasks into PRD-52.

---

## Current State Analysis

### Share file loading — two paths

**`packages/signer/src/share-loader.ts`** (248 lines):

**`loadShareFromFile(path, passphrase)`:**
1. First tries `tryLoadRawBase64Share()` — reads file, base64-decodes, JSON-parses for `{ coreShare, auxInfo }`. If valid, returns immediately (no passphrase needed).
2. Falls back to encrypted binary: reads `[salt 16B][iv 12B][ciphertext][authTag 16B]`, derives key via scrypt, decrypts AES-256-GCM.

**`saveShareToFile(share, path, passphrase)`:**
- Serializes to `SerializedShare { participantIndex, scheme, curve, publicKeyBase64, dataBase64 }`
- Encrypts with scrypt + AES-256-GCM
- Writes binary `[salt][iv][ciphertext][authTag]`

### Dashboard download — already plain base64

**`packages/app/src/pages/create-signer.tsx`** — `handleDownloadSecret`:
```typescript
// Downloads raw shareData (already plain text)
const blob = new Blob([result.shareData], { type: 'text/plain' });
downloadFile(blob, `${name}.secret`);
```

The dashboard **already downloads plain base64**. The `encryptShareForCLI` function was built but never wired into the download flow.

### `encryptShareForCLI` — confirmed dead code

**`packages/app/src/lib/share-encrypt.ts`**:

**`encryptShareForCLI(shareBase64, passphrase)`:**
- Takes the raw base64 share from DKG
- Wraps in `SerializedShare` JSON
- Encrypts with PBKDF2 (600k iterations, SHA-256) + AES-256-GCM via Web Crypto
- Returns binary `[salt][iv][ciphertext][authTag]`

**Usage audit:** `grep -r "encryptShareForCLI"` returns exactly one result — the function definition itself. Zero call sites. This is dead code.

**KDF incompatibility (documented, not fixed):** The browser function uses PBKDF2 (Web Crypto), while the Node.js `share-loader.ts` uses scrypt. These are different KDFs producing the same binary layout. If `encryptShareForCLI` were ever called, the resulting file would NOT be loadable by `loadShareFromFile()` — the scrypt key derivation would produce a different key from the same passphrase, and AES-GCM decryption would fail silently (wrong auth tag). This is a latent bug that never manifested because the function was never used.

### ThresholdSigner factories — two paths

**`packages/signer/src/threshold-signer.ts`**:
- `fromFile(opts)` — calls `loadShareFromFile(path, passphrase)`. Works with both formats.
- `fromSecret(opts)` — takes raw base64 string directly. No file, no passphrase.

### Browser user share path — separate, working

**`packages/app/src/lib/user-share-store.ts`:**
- Encrypts user share with PRF-derived key (HKDF + AES-256-GCM)
- Stored on server at `user-encrypted/{signerId}`
- Completely separate from file-based share format
- **This path is NOT modified by this PRD**

---

## Technical Specification

### Decision: New shares are plain base64

For new signer creation (both CLI and dashboard):
- **Signer share** (party 0): downloaded/saved as plain base64 JSON `{ coreShare, auxInfo }`
- **User share** (party 2): stored in OS keychain (CLI) or PRF-encrypted on server (dashboard)
- **No passphrase encryption for new files**

### Plain Base64 Format

Current format (unchanged):
```json
{
  "coreShare": "base64...",
  "auxInfo": "base64..."
}
```

When PRD-02 (#4) ships role metadata, the format extends to:
```json
{
  "version": 1,
  "coreShare": "base64...",
  "auxInfo": "base64...",
  "role": "signer"
}
```

The `version` field is optional for backward compat. `loadShareFromFile()` reads it if present. The `role` field is PRD-02 scope, not this PRD.

### Backward Compatibility

Encrypted `.enc` files (from old CLI signer creation or old dashboard downloads) continue to work:
- `loadShareFromFile()` still tries raw base64 first, falls back to encrypted binary (scrypt)
- `fromFile()` still accepts `passphrase` option
- No existing share files are broken

**Note on PBKDF2 files:** If any file was somehow encrypted with the `encryptShareForCLI` function (using PBKDF2), it would NOT be loadable by the current `share-loader.ts` (which uses scrypt). Since `encryptShareForCLI` was never called, no such files exist. This is documented for completeness.

### Changes to `share-encrypt.ts`

Remove `encryptShareForCLI` entirely. It is dead code with a latent KDF incompatibility bug. No callers exist.

If `share-encrypt.ts` has no other exports after removal, delete the file.

### Changes to `share-loader.ts`

No functional changes needed. Add clarifying comments:

```typescript
/**
 * Loads a share from file. Supports two formats:
 *
 * 1. Plain base64 JSON: { coreShare, auxInfo } — preferred for all new files
 * 2. Encrypted binary: [salt 16B][iv 12B][ciphertext][authTag 16B] — legacy format,
 *    encrypted with scrypt + AES-256-GCM. Requires passphrase.
 *
 * New share files should ALWAYS use plain base64 format.
 * Encrypted files are supported for backward compatibility only.
 */
```

### File Permissions

Plain base64 files on disk are protected by OS file permissions:
- `0600` (owner read/write only) — set by `saveConfig()` in config.ts
- Document this clearly: "Share files contain sensitive key material. Ensure restrictive file permissions (chmod 600)."

For CLI anonymous signers (PRD-52), the signer share is stored inline in `config.json` (which is already 0600). For dashboard signers, the downloaded `.secret` file should be `0600` — but we can't enforce this from the browser download.

---

## Security Considerations

### Plain base64 on disk

Without passphrase encryption, the share file relies entirely on OS file permissions. This is acceptable because:
1. The signer share alone cannot sign — needs the server share (or user share) as the second party
2. OS keychain handles the user share with proper encryption
3. Encrypted share files with weak passphrases provided a false sense of security
4. The `0600` permission model is standard for SSH keys, which protect more sensitive material

### Dashboard download security

The browser downloads a `.secret` file. The user's browser download directory may not have restrictive permissions. Document the recommendation to move the file to a secure location with `chmod 600`.

### Browser user share path is unchanged

The PRF-encrypted user share on server (`user-share-store.ts`) is completely unaffected by this PRD. That path uses HKDF + AES-256-GCM with a PRF-derived key and is the correct solution for browser-based shares.

---

## Files to Modify

| File | Changes |
|---|---|
| `packages/app/src/lib/share-encrypt.ts` | Remove `encryptShareForCLI` (confirmed dead code). Delete file if no other exports remain. |
| `packages/signer/src/share-loader.ts` | Add clarifying comments about two-format support; no functional changes |

## Files NOT Modified

| File | Reason |
|---|---|
| `packages/app/src/lib/user-share-store.ts` | PRF-encrypted user share path is unchanged |
| `packages/app/src/pages/create-signer.tsx` | Already downloads plain base64 |
| `packages/signer/src/threshold-signer.ts` | `fromSecret()` and `fromFile()` unchanged |
| `packages/server/` | Server doesn't handle share file format |
| `supabase/migrations/` | No DB changes |

---

## Test Plan

### Unit Tests

1. **loadShareFromFile — raw base64**: Write plain base64 JSON to file. Assert: loads without passphrase.
2. **loadShareFromFile — encrypted binary**: Write scrypt-encrypted file. Assert: loads with correct passphrase.
3. **loadShareFromFile — raw base64 with version field**: Write `{ version: 1, coreShare, auxInfo }`. Assert: loads, version accessible (prep for PRD-02).
4. **loadShareFromFile — raw base64 with role field**: Write `{ coreShare, auxInfo, role: 'signer' }`. Assert: loads, role accessible (prep for PRD-02).
5. **loadShareFromFile — raw base64 without extras**: Write `{ coreShare, auxInfo }`. Assert: loads, version/role are undefined (backward compat).

### Verification

6. **encryptShareForCLI is removed**: Assert: `share-encrypt.ts` does not export `encryptShareForCLI`. Build succeeds.
7. **Dashboard download format**: Create signer in dashboard, download `.secret` file. Assert: file is plain base64 JSON, not binary.
8. **CLI with new format**: Create signer via CLI (PRD-52), verify the stored `apiSecret` in config is plain base64 that `createSignerFromConfig()` handles correctly.

---

## Acceptance Criteria

- [ ] `encryptShareForCLI` removed from `share-encrypt.ts` (dead code cleanup)
- [ ] No build errors after removal — no callers exist
- [ ] New share files are always plain base64 JSON `{ coreShare, auxInfo }`
- [ ] Old encrypted `.enc` files still loadable via `loadShareFromFile(path, passphrase)`
- [ ] PBKDF2/scrypt KDF incompatibility documented (latent bug in dead code, no fix needed)
- [ ] PRF-encrypted user share path (browser) is completely unchanged
- [ ] `user-share-store.ts` is not modified
- [ ] `share-loader.ts` has clarifying comments about format support
- [ ] Share file security documented (OS permissions, chmod 600 recommendation)
- [ ] All existing tests pass
- [ ] `pnpm build` succeeds across all packages
