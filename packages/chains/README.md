# @agentokratia/guardian-chains

**Ethereum chain adapter for Guardian Wallet.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](../../LICENSE-APACHE)
[![npm](https://img.shields.io/npm/v/@agentokratia/guardian-chains)](https://www.npmjs.com/package/@agentokratia/guardian-chains)

Implements the `IChain` interface from `@agentokratia/guardian-core` for Ethereum-compatible chains. Handles transaction building, decoding, serialization, and signature assembly using [viem](https://viem.sh/).

## Install

```bash
npm install @agentokratia/guardian-chains
```

## Usage

```typescript
import { EthereumChain } from '@agentokratia/guardian-chains';
```

This package is used internally by `@agentokratia/guardian-server` for transaction processing. Most users should use the higher-level `Guardian` facade from the signer package instead.

## What It Does

- **Transaction Building** -- construct EIP-1559 transactions with gas estimation
- **Transaction Decoding** -- decode calldata using known ABI selectors
- **Signature Serialization** -- assemble `(r, s, v)` into RLP-encoded signed transactions
- **Balance Queries** -- fetch ETH balance via RPC

## Dependencies

- `@agentokratia/guardian-core` -- interfaces and types
- `viem` -- Ethereum client library

## License

Apache-2.0 -- see [LICENSE-APACHE](../../LICENSE-APACHE).
