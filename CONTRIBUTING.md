# Contributing to Guardian Wallet

## Prerequisites
- Node.js 20+
- pnpm 9+
- Docker & Docker Compose (for Vault + PostgreSQL)

## Setup
```bash
git clone https://github.com/agentokratia/guardian-wallet.git
cd guardian-wallet
pnpm install
pnpm build
```

## Development
```bash
# Start infrastructure
docker compose up -d

# Start the server in dev mode
pnpm --filter @agentokratia/guardian-server dev

# Start the dashboard in dev mode
pnpm --filter @agentokratia/guardian-app dev

# Run tests
pnpm test

# Lint and format
pnpm lint
```

## Package Structure

The monorepo follows a strict layered architecture:

- **core** -- Interfaces and shared types only (zero dependencies)
- **schemes** -- Threshold signing implementations (CGGMP24 via WASM)
- **chains** -- Chain-specific transaction logic (Ethereum via viem)
- **server** -- NestJS API server (policy engine, signing orchestration, auth)
- **signer** -- Signer-side SDK (share loading, partial signing, HTTP client)
- **cli** -- `gw` command-line tool
- **app** -- React + Vite dashboard (communicates via HTTP only)

Build order: `core` --> `schemes` + `chains` (parallel) --> `server`, `signer` --> `cli`. The `app` package is independent and talks to the server over HTTP.

## Dependency Rules
- core imports NOTHING
- schemes/chains import only core
- server imports core, schemes, chains
- signer imports core, schemes
- cli imports signer
- app imports NOTHING from backend

## Coding Conventions
- TypeScript strict mode, ESM modules
- Biome for linting + formatting (tabs, single quotes, semicolons always)
- File naming: kebab-case (e.g., policy-engine.provider.ts)
- No `any` -- use `unknown` and narrow
- Binary data: always `Uint8Array`
- Security: wipe server shares with `buffer.fill(0)` in finally blocks

## Pull Requests
- Fork the repo, create a feature branch
- Ensure `pnpm build && pnpm test && pnpm lint` all pass
- Write clear commit messages
- One feature/fix per PR
- Add tests for new functionality

## Security
If you discover a security vulnerability, please report it via security@agentokratia.com rather than opening a public issue. See SECURITY.md for details.

## License
By contributing, you agree that your contributions will be licensed under AGPL-3.0.
