# Guardian Wallet

> Agents deserve wallets without private keys.

2-of-3 threshold ECDSA signing for AI agents. The full private key is never constructed — not during creation, not during signing, not ever.

## Why Guardian

- **No single point of compromise** — every key is split into 3 shares via distributed key generation
- **Policy-enforced signing** — spending limits, contract allowlists, rate limits, time windows, and a declarative rules engine
- **AI agent native** — TypeScript SDK, CLI, Forge proxy, LangChain + Vercel AI SDK integrations
- **Self-hosted** — full control over the server, shares, and policies
- **Auditable** — every signing request is logged with decoded transaction details and CSV export

## Architecture

```
                    ┌─────────────┐
                    │  3 Shares   │
                    │  (DKLs23)   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Signer  │ │  Server  │ │   User   │
        │  Share   │ │  Share   │ │  Share   │
        │ (agent)  │ │ (vault)  │ │(browser) │
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
              └─────┬──────┘            │
                    ▼                   │
              2-of-3 Sign              │
              (any pair)───────────────┘
```

**Three signing paths — any 2 shares can sign:**

| Path | Shares | Use Case |
|------|--------|----------|
| Signer + Server | Agent share + Server share | Normal autonomous operation |
| User + Server | Wallet-encrypted share + Server share (browser WASM) | Dashboard manual signing |
| Signer + User | Agent share + User share | Server down / bypass |

## Quick Start

```bash
# Clone and start
git clone https://github.com/agentokratia/guardian-wallet.git
cd guardian-wallet
cp .env.example .env
pnpm install
docker compose up -d

# Dashboard at http://localhost:3000
# API at http://localhost:8080
```

### CLI

```bash
# Initialize configuration
gw init

# Send a transaction
gw send 0.01 ETH to 0xRecipient...

# Check balance
gw balance

# View status
gw status

# Deploy a contract
gw deploy ./MyContract.json

# Start Forge RPC proxy
gw proxy
```

## Environment Variables

Copy `.env.example` to `.env`. Only 5 vars are required:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | PostgreSQL database URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role JWT |
| `VAULT_ADDR` | Yes | HashiCorp Vault address |
| `VAULT_TOKEN` | Yes | Vault authentication token |
| `JWT_SECRET` | Yes | JWT signing secret (min 16 chars) |
| `VITE_WALLETCONNECT_PROJECT_ID` | No | WalletConnect project ID |
| `ALLOWED_ORIGINS` | No | CORS origins (default: `http://localhost:3000`) |

See [`.env.example`](.env.example) for the full list with defaults.

## Packages

| Package | Description |
|---------|-------------|
| [`@agentokratia/guardian-core`](packages/core) | Shared types and interfaces |
| [`@agentokratia/guardian-schemes`](packages/schemes) | DKLs23 threshold ECDSA (Rust WASM) |
| [`@agentokratia/guardian-chains`](packages/chains) | Ethereum chain adapter (viem) |
| [`@agentokratia/guardian-server`](packages/server) | NestJS policy server |
| [`@agentokratia/guardian-signer`](packages/signer) | TypeScript SDK with viem integration |
| [`@agentokratia/guardian-cli`](packages/cli) | CLI tool (`gw` command) |
| [`@agentokratia/guardian-app`](packages/app) | React dashboard (Vite SPA) |

## SDK Usage

```typescript
import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { createWalletClient, http, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';

const signer = await ThresholdSigner.fromFile({
  sharePath: './my-agent.share.enc',
  passphrase: process.env.SHARE_PASSPHRASE!,
  serverUrl: process.env.GUARDIAN_SERVER!,
  apiKey: process.env.GUARDIAN_API_KEY!,
});

const client = createWalletClient({
  account: signer.toViemAccount(),
  chain: baseSepolia,
  transport: http(),
});

const hash = await client.sendTransaction({
  to: '0xRecipient...',
  value: parseEther('0.01'),
});
```

## AI Agent Integration

See [`examples/`](examples/) for complete integrations:

- **[Vercel AI SDK](examples/vercel-ai-sdk/)** — Agent with threshold signing tools
- **[LangChain](examples/langchain/)** — Agent with GuardianSignTool
- **[viem Client](examples/viem-client/)** — Direct WalletClient integration
- **[Forge Proxy](examples/forge-proxy/)** — Deploy contracts via `gw proxy`
- **[Full Lifecycle](examples/full-lifecycle/)** — DKG, policies, signing, audit

## Policy Engine

Two policy systems work together:

### Legacy Policies (per-signer CRUD)

| Policy | Description |
|--------|-------------|
| `spending_limit` | Max ETH per transaction |
| `daily_limit` | Max ETH per 24 hours |
| `monthly_limit` | Max ETH per 30 days |
| `allowed_contracts` | Allowlist of contract addresses |
| `allowed_functions` | Allowlist of function selectors |
| `blocked_addresses` | Blocklist of recipient addresses |
| `rate_limit` | Max transactions per time window |
| `time_window` | Allowed signing hours |

### Rules Engine (declarative policy documents)

A declarative rules engine with 10 criterion types for complex policy logic:

```json
{
  "version": "1.0",
  "name": "Production agent policy",
  "defaultAction": "deny",
  "rules": [
    {
      "name": "Allow small transfers",
      "action": "allow",
      "criteria": [
        { "type": "ethValue", "operator": "lte", "value": "0.1" },
        { "type": "toAddress", "operator": "in", "value": ["0x..."] }
      ]
    }
  ]
}
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict mode, ESM) |
| MPC | DKLs23 via `@silencelaboratories/dkls-wasm-ll-node` |
| API | NestJS |
| Dashboard | React + Vite + Tailwind + shadcn/ui |
| Database | Supabase (PostgreSQL) |
| Secret Storage | HashiCorp Vault (KV v2) |
| Auth | SIWE (Sign In With Ethereum) + JWT |
| Monorepo | Turborepo + pnpm workspaces |
| Linting | Biome |
| Testing | Vitest |

## Security

The core invariant: **THE FULL PRIVATE KEY MUST NEVER EXIST.**

- Server shares are wiped from memory (`buffer.fill(0)`) after every operation
- User shares are encrypted with wallet signatures (HKDF + AES-256-GCM) — server cannot decrypt
- Browser signing runs DKLs23 client-side via WASM — server only sees protocol messages
- API keys are stored as SHA-256 hashes
- All signing is interactive multi-round (4-round DKLs23 protocol)
- Same MPC protocol used by MetaMask

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[AGPL-3.0](LICENSE) — Agentokratia
