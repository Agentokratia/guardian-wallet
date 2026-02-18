# Licensing

Copyright 2025-2026 Aristokrates OÜ

Guardian Wallet uses a dual-license model. Different packages in this monorepo
are released under different licenses depending on their purpose.

## SDK and Developer Tools — Apache 2.0

The following packages are licensed under the **Apache License 2.0**
(`LICENSE-APACHE`). You may freely use, modify, and distribute them in your own
projects — commercial or otherwise — with no copyleft obligations.

| Package                           | npm    | Description                                           |
| --------------------------------- | ------ | ----------------------------------------------------- |
| `@agentokratia/guardian-core`     | public | Type definitions and interfaces                       |
| `@agentokratia/guardian-mpc-wasm` | public | CGGMP24 threshold ECDSA WASM module                   |
| `@agentokratia/guardian-schemes`  | public | Signing scheme orchestration                          |
| `@agentokratia/guardian-chains`   | public | Ethereum chain adapter (viem)                         |
| `@agentokratia/guardian-signer`   | public | Signer SDK — share loading, signing, viem integration |
| `@agentokratia/guardian-wallet`  | public | CLI + MCP server (`gw` command)                       |

These packages are safe to use alongside any license — MIT, Apache 2.0,
proprietary, etc. Integrate them with LangChain, Vercel AI SDK, ethers.js, or
any other library without restriction.

## Server, Dashboard, and Auth — AGPL 3.0

The following packages are licensed under the **GNU Affero General Public
License v3.0** (`LICENSE`). You may self-host them freely. If you modify the
source and offer the modified version as a network service to third parties, you
must make your modifications available under the same license.

| Package                         | npm     | Description                |
| ------------------------------- | ------- | -------------------------- |
| `@agentokratia/guardian-server` | private | Policy server (NestJS API) |
| `@agentokratia/guardian-app`    | private | Dashboard (React SPA)      |
| `@agentokratia/guardian-auth`   | private | WebAuthn + PRF wallet auth |

## Self-Hosting

Self-hosting Guardian Wallet for your own agents is **free** and encouraged. The
AGPL only requires source disclosure when you modify the server or dashboard and
offer the modified version as a service to others.

## Commercial Licensing

If you want to offer Guardian Wallet as part of a managed or hosted service to
third parties, or if you need a license without copyleft obligations for the
AGPL components, contact us for a commercial license:

- Email: contact@agentokratia.com
- Web: https://agentokratia.com

## Summary

```
You want to...                          License that applies
─────────────────────────────────────── ──────────────────────
npm install the SDK / CLI               Apache 2.0 — go ahead
Self-host the server for your agents    AGPL 3.0 — free, no restrictions
Modify the server for your own use      AGPL 3.0 — free, no restrictions
Offer a modified server as a service    AGPL 3.0 — must share your changes
Resell as a hosted/managed product      Contact us for a commercial license
```
