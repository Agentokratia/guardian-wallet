# @agentokratia/guardian-core

**Type definitions and interfaces for Guardian Wallet.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](../../LICENSE-APACHE)
[![npm](https://img.shields.io/npm/v/@agentokratia/guardian-core)](https://www.npmjs.com/package/@agentokratia/guardian-core)

Zero-dependency package that defines the contracts all Guardian packages implement. Contains TypeScript interfaces, type definitions, and enums -- no runtime code.

## Install

```bash
npm install @agentokratia/guardian-core
```

## What's Inside

### Interfaces

| Interface | Purpose |
|-----------|---------|
| `IThresholdScheme` | MPC signing scheme (DKG, signing rounds, aux info) |
| `IChain` | Chain adapter (build tx, decode, broadcast, balance) |
| `IVaultStore` | Secret storage (store/retrieve/delete shares) |
| `IShareStore` | Generic share persistence |
| `IPolicyEngine` | Policy evaluation engine |
| `IRulesEngine` | Rules-based policy evaluation |
| `IKmsProvider` | Key management service abstraction |

### Types

| Type | Purpose |
|------|---------|
| `Share`, `ShareFile`, `KeyMaterial` | Key share structures |
| `Signer` | Signer entity (address, status, metadata) |
| `SigningRequest` | Transaction/message signing request |
| `Policy`, `PolicyRule`, `PolicyDocument` | Policy definitions with 9 criterion types |
| `TransactionRequest`, `DecodedAction` | Transaction building and decoding |
| `DKGState`, `EncryptedEnvelope` | DKG ceremony and encryption types |

### Enums

`SchemeName`, `CurveName`, `ChainName`, `NetworkName`, `SignerType`, `SignerStatus`, `SigningPath`, `PolicyType`, `RequestStatus`, `RequestType`

## Usage

```typescript
import { SignerStatus, PolicyType } from '@agentokratia/guardian-core';
import type { IThresholdScheme, Share, Policy } from '@agentokratia/guardian-core';
```

## Dependency Rules

`@agentokratia/guardian-core` imports nothing. All other Guardian packages depend on it.

```
core     -> imports NOTHING
schemes  -> imports core
chains   -> imports core
signer   -> imports core, schemes
server   -> imports core, schemes, chains
```

## License

Apache-2.0 -- see [LICENSE-APACHE](../../LICENSE-APACHE).
