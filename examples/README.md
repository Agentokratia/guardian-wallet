# Examples

Working integration examples for Guardian Wallet. Each one sends a real transaction on Base Sepolia.

## Prerequisites

- Node.js 20+, pnpm 9+, Docker
- Rust + wasm-pack (for building MPC WASM)
- Foundry (for the forge-proxy example)

## Full setup (from zero to running an example)

```bash
# 1. Clone and install
git clone https://github.com/agentokratia/guardian-wallet.git
cd guardian-wallet
cp .env.example .env
pnpm install
pnpm build

# 2. Start the database and server
npx supabase start
pnpm --filter @agentokratia/guardian-server dev    # terminal 1
pnpm --filter @agentokratia/guardian-app dev       # terminal 2

# 3. Create a signer
#    Open http://localhost:3000, sign in, create a signer.
#    The wizard gives you an API key and a .secret file.

# 4. Configure examples
cp examples/.env.example examples/.env
#    Fill in GUARDIAN_API_KEY and GUARDIAN_API_SECRET from step 3.

# 5. Run
pnpm example:viem 0xRecipient 0.001
```

## Environment variables

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `GUARDIAN_SERVER` | Yes | Default: `http://localhost:8080` |
| `GUARDIAN_API_KEY` | Yes | Shown when you create a signer in the dashboard |
| `GUARDIAN_API_SECRET` | Yes | Contents of the `.secret` file downloaded during signer creation |
| `GOOGLE_API_KEY` | LangChain / Vercel AI only | [aistudio.google.com](https://aistudio.google.com/apikey) |

## Run examples

```bash
# viem — send ETH (requires to address and amount)
pnpm example:viem <to> <amount>

# LangChain agent — balance check, sign, send
pnpm example:langchain

# Vercel AI SDK agent — balance check, sign, send
pnpm example:vercel-ai

# Full lifecycle — health, init, balance, sign, send, audit
./examples/full-lifecycle/demo.sh

# Forge proxy — deploy a Solidity contract via threshold signing
./examples/forge-proxy/deploy.sh
```

## What each example does

| Example | Integration | What it demonstrates |
|---------|-------------|---------------------|
| [viem-client](viem-client/) | `ThresholdSigner.toViemAccount()` | Drop-in viem WalletClient — 10 lines to threshold-signed transactions |
| [langchain](langchain/) | `DynamicStructuredTool` | AI agent with balance, send, and sign tools (Gemini via OpenAI endpoint) |
| [vercel-ai-sdk](vercel-ai-sdk/) | Vercel AI `tool()` | AI agent with the same tools using Vercel's SDK (Gemini via OpenAI endpoint) |
| [full-lifecycle](full-lifecycle/) | CLI | 7-step demo: health, init, balance, sign, send, audit log, CSV export |
| [forge-proxy](forge-proxy/) | Foundry | Deploy a Solidity contract through the Guardian signing proxy |
