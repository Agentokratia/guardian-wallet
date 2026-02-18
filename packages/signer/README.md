# @agentokratia/guardian-signer

**Guardian Wallet SDK -- threshold signing where the key never exists.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](../../LICENSE-APACHE)
[![npm](https://img.shields.io/npm/v/@agentokratia/guardian-signer)](https://www.npmjs.com/package/@agentokratia/guardian-signer)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg)](https://nodejs.org)

The TypeScript SDK for [Guardian Wallet](https://github.com/agentokratia/guardian-wallet). Sign Ethereum transactions and messages using 2-of-3 threshold ECDSA -- the full private key is never constructed.

## Install

```bash
npm install @agentokratia/guardian-signer
# or
pnpm add @agentokratia/guardian-signer
```

## Quick Start

### Using the `Guardian` facade (recommended)

```typescript
import { Guardian } from '@agentokratia/guardian-signer';

const gw = await Guardian.connect({
  apiSecret: process.env.GUARDIAN_API_SECRET,  // base64 key share
  serverUrl: process.env.GUARDIAN_SERVER,       // e.g. "http://localhost:8080"
  apiKey: process.env.GUARDIAN_API_KEY,         // API key for auth
});

// Sign and broadcast a transaction
const { txHash } = await gw.signTransaction({
  to: '0x...',
  value: '0.01',
  network: 'base-sepolia',
});

console.log(`Transaction: ${txHash}`);

// Query server data
const signers = await gw.listSigners();
const balance = await gw.getBalance(signers[0].id, 'base-sepolia');

// Always clean up
gw.destroy();
```

### Using `ThresholdSigner` directly

```typescript
import { ThresholdSigner } from '@agentokratia/guardian-signer';

// Load from a .secret file (CLI path)
const signer = await ThresholdSigner.fromFile({
  configPath: '~/.gw/config.json',
  secretPath: '~/.gw/my-agent.secret',
});

// Or from environment variables
const signer = await ThresholdSigner.fromSecret({
  apiSecret: process.env.GUARDIAN_API_SECRET,
  serverUrl: 'http://localhost:8080',
  apiKey: process.env.GUARDIAN_API_KEY,
});

// Sign a transaction
const { txHash, signature } = await signer.signTransaction({
  to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  value: '0.001',
  network: 'base-sepolia',
});

// Sign a message (EIP-191)
const { signature } = await signer.signMessage('Hello Guardian');

console.log(`Address: ${signer.address}`);
signer.destroy(); // wipe key material from memory
```

### viem Integration

```typescript
import { Guardian } from '@agentokratia/guardian-signer';
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const gw = await Guardian.connect({ ... });

const client = createWalletClient({
  account: gw.toViemAccount(),
  chain: baseSepolia,
  transport: http(),
});

const hash = await client.sendTransaction({
  to: '0x...',
  value: 1000000000000000n, // 0.001 ETH
});

gw.destroy();
```

## API

### `Guardian` (facade)

| Method | Description |
|--------|-------------|
| `Guardian.connect(opts)` | Connect to server, load key share, return initialized instance |
| `gw.address` | Ethereum address derived from the threshold key |
| `gw.signTransaction(tx)` | Sign and broadcast a transaction |
| `gw.signMessage(msg)` | Sign a message (EIP-191) |
| `gw.toViemAccount()` | Get a viem-compatible account |
| `gw.listSigners()` | List all signers on the server |
| `gw.getBalance(id, network)` | Get ETH balance for a signer |
| `gw.getTokenBalances(id, chainId)` | Get tracked token balances |
| `gw.listNetworks()` | List supported networks |
| `gw.getPolicies(id)` | Get signer's policy rules |
| `gw.getAuditLog(opts?)` | Query the audit log |
| `gw.simulate(id, tx)` | Simulate a transaction (gas estimate) |
| `gw.resolveAddress(addressOrEns)` | Resolve ENS name or validate address |
| `gw.destroy()` | Wipe key material from memory |

### `ThresholdSigner`

| Method | Description |
|--------|-------------|
| `ThresholdSigner.fromFile(opts)` | Load signer from config + secret file |
| `ThresholdSigner.fromSecret(opts)` | Load signer from environment/inline secret |
| `signer.signTransaction(tx)` | Sign and broadcast |
| `signer.signMessage(msg)` | Sign EIP-191 message |
| `signer.toViemAccount()` | viem account adapter |
| `signer.address` | Ethereum address |
| `signer.destroy()` | Wipe share from memory |

### `GuardianApi`

Low-level API client for server read operations. Used internally by `Guardian`, but available for advanced use:

```typescript
import { GuardianApi, HttpClient } from '@agentokratia/guardian-signer';

const client = new HttpClient({ baseUrl: 'http://localhost:8080', apiKey: '...' });
const api = new GuardianApi(client);

const health = await api.getHealth();
const networks = await api.listNetworks();
```

## Security

- **The full private key never exists** -- not in memory, not in transit, not ever
- Key material is wiped from memory on `destroy()` using `buffer.fill(0)`
- Signing is an interactive multi-round CGGMP24 protocol between your share and the server's share
- The server enforces policies before co-signing (spending limits, allowlists, rate limits)
- API key authentication on every request (SHA-256 hash stored server-side)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GUARDIAN_API_SECRET` | Base64-encoded key share | Yes |
| `GUARDIAN_SERVER` | Server URL (e.g. `http://localhost:8080`) | Yes |
| `GUARDIAN_API_KEY` | API key for authentication | Yes |

## License

Apache-2.0 -- see [LICENSE-APACHE](../../LICENSE-APACHE).
