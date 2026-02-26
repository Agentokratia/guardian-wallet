# @agentokratia/guardian-signer

## 0.2.0

### Minor Changes

- [`f5f01ca`](https://github.com/Agentokratia/guardian-wallet/commit/f5f01caf21e89929e578d788ff2b6ae5e54d9100) Thanks [@PancheI](https://github.com/PancheI)! - Initial public release — threshold ECDSA signing for autonomous agents

  - 2-of-3 CGGMP24 threshold signing via Rust WASM (full key never exists)
  - Three signing paths: Signer+Server, User+Server, Signer+User
  - Rules-based guardrails engine with criterion catalog
  - CLI (`gw`): init, send, sign-message, deploy, proxy, admin
  - SDK: `ThresholdSigner` with viem `toAccount()` integration
  - MCP server for AI assistant signing (Claude, Cursor)
  - JSON-RPC proxy for Foundry/Hardhat

### Patch Changes

- Updated dependencies [[`f5f01ca`](https://github.com/Agentokratia/guardian-wallet/commit/f5f01caf21e89929e578d788ff2b6ae5e54d9100)]:
  - @agentokratia/guardian-core@0.2.0
  - @agentokratia/guardian-schemes@0.2.0
