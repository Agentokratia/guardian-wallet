# Guardian + Vercel AI SDK

An AI agent that signs Ethereum transactions using Guardian's threshold wallet. The full private key never exists.

## Run

```bash
# Setup: see examples/README.md (also needs ANTHROPIC_API_KEY in .env)

pnpm example:vercel-ai

# Or with a custom prompt
pnpm example:vercel-ai "Check my wallet balance"
```

## How It Works

1. The agent loads a threshold signer from the `GUARDIAN_API_SECRET` env var
2. Vercel AI SDK exposes `get_balance`, `send_transaction`, and `sign_message` as tools
3. Claude decides which tools to call based on the user's prompt
4. Each transaction is co-signed by the agent's share + the Guardian server's share (2-of-3 MPC)
5. The server enforces policies (spending limits, allowed contracts, etc.) before co-signing
