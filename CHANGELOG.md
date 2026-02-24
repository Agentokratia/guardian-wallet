# Changelog

All notable changes to Guardian Wallet will be documented in this file.

## [0.1.0] — 2026-02-24

### Added

- **Threshold signing**: 2-of-3 CGGMP24 threshold ECDSA via Rust WASM. The full private key never exists.
- **Three signing paths**: Signer+Server (autonomous), User+Server (dashboard override), Signer+User (offline recovery).
- **Guardrails engine**: Rules-based policy system with criterion catalog — spending limits, rate limits, address allowlists/blocklists, function selectors, time windows.
- **Dashboard**: React SPA — create signers, manage guardrails, manual signing via browser WASM, audit log, settings.
- **CLI** (`gw`): init, status, info, balance, send, sign-message, deploy, proxy, admin.
- **SDK**: `ThresholdSigner` with viem `toAccount()` integration for TypeScript agents.
- **MCP server**: Give Claude, Cursor, or any AI assistant access to Guardian signing — send ETH, send tokens, check balances, x402 payments.
- **JSON-RPC proxy**: `gw proxy` for Foundry/Hardhat — threshold signing with zero config changes.
- **Passkey authentication**: WebAuthn login with PRF-derived encryption for user share (no passwords, no seed phrases).
- **Self-hosting**: Docker Compose deployment with HashiCorp Vault, PostgreSQL, nginx.
- **Audit logging**: Every signing request logged with decoded action, policy evaluation results, and timing.
