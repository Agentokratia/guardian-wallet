# Guardian + Vercel AI SDK

An AI agent that signs Ethereum transactions using Guardian's threshold wallet. The full private key never exists.

## Setup

```bash
# Install dependencies
npm install

# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export GUARDIAN_SERVER=http://localhost:8080
export GUARDIAN_API_KEY=gw_live_...
export SHARE_PASSPHRASE=your-passphrase
export SHARE_PATH=./my-agent.share.enc
```

## Run

```bash
npx tsx agent.ts

# Or with a custom prompt
npx tsx agent.ts "Check my wallet balance"
```

## How It Works

1. The agent loads a threshold signer from an encrypted share file
2. Vercel AI SDK exposes `get_balance`, `send_transaction`, and `sign_message` as tools
3. Claude decides which tools to call based on the user's prompt
4. Each transaction is co-signed by the agent's share + the Guardian server's share (2-of-3 MPC)
5. The server enforces policies (spending limits, allowed contracts, etc.) before co-signing
