# @agentokratia/guardian-schemes

**CGGMP24 threshold ECDSA signing scheme for Guardian Wallet.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](../../LICENSE-APACHE)
[![npm](https://img.shields.io/npm/v/@agentokratia/guardian-schemes)](https://www.npmjs.com/package/@agentokratia/guardian-schemes)

Implements the `IThresholdScheme` interface from `@agentokratia/guardian-core` using CGGMP24 (Canetti-Gennaro-Goldfeder-Makriyannis-Peled 2024) threshold ECDSA over secp256k1. Wraps a Rust WASM module for the cryptographic operations.

## Install

```bash
npm install @agentokratia/guardian-schemes
```

## Usage

```typescript
import { CGGMP24Scheme, SchemeRegistry } from '@agentokratia/guardian-schemes';

// Direct usage
const scheme = new CGGMP24Scheme();

// Or via registry
const scheme = SchemeRegistry.get('cggmp24');
```

This package is used internally by `@agentokratia/guardian-signer` and `@agentokratia/guardian-server`. Most users should use the higher-level `Guardian` facade from the signer package instead.

## What It Does

- **DKG (Distributed Key Generation)** -- 3-party key generation ceremony producing 3 shares
- **Threshold Signing** -- 2-of-3 interactive signing protocol (3 rounds)
- **Aux Info Generation** -- Pre-computation for efficient signing
- **Address Derivation** -- secp256k1 public key to Ethereum address

## Dependencies

- `@agentokratia/guardian-core` -- interfaces and types
- `@agentokratia/guardian-mpc-wasm` -- Rust WASM binary (CGGMP24 implementation)

## License

Apache-2.0 -- see [LICENSE-APACHE](../../LICENSE-APACHE).
