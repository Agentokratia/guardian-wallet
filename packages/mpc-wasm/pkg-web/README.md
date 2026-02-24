# @agentokratia/guardian-mpc-wasm

**CGGMP24 threshold ECDSA WASM module for Guardian Wallet.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](../../LICENSE-APACHE)
[![npm](https://img.shields.io/npm/v/@agentokratia/guardian-mpc-wasm)](https://www.npmjs.com/package/@agentokratia/guardian-mpc-wasm)

Rust-compiled WebAssembly module implementing CGGMP24 threshold ECDSA (2-of-3) over secp256k1. Built from the [LFDT-Lockness/cggmp21](https://github.com/LFDT-Lockness/cggmp21) Rust crate.

## Install

```bash
npm install @agentokratia/guardian-mpc-wasm
```

## What It Does

- **DKG** -- Distributed Key Generation (3-party, produces 3 shares + public key)
- **Signing** -- Interactive threshold signing (2-of-3, 3-round protocol)
- **Aux Info** -- Pre-computation of auxiliary information for signing efficiency
- **Key Refresh** -- Proactive share refresh without changing the public key

## Build from Source

Requires Rust toolchain with `wasm32-unknown-unknown` target:

```bash
cd packages/mpc-wasm
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/guardian_mpc.wasm --out-dir pkg/
```

## Usage

This module is consumed by `@agentokratia/guardian-schemes`. Direct usage is not recommended -- use the higher-level `Guardian` facade from `@agentokratia/guardian-signer` instead.

## License

Apache-2.0 -- see [LICENSE-APACHE](../../LICENSE-APACHE).
