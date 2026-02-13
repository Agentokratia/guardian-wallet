# Guardian + LangChain

A LangChain agent with threshold signing tools. The full private key never exists.

## Setup

```bash
npm install

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
npx tsx agent.ts "Send 0.001 ETH to 0x..."
```

## How It Works

1. `ThresholdSigner.fromFile()` loads the agent's encrypted share
2. Three tools are registered: `get_balance`, `send_transaction`, `sign_message`
3. LangChain's `createToolCallingAgent` routes the user's request to the right tool
4. Each signing operation uses interactive CGGMP24 protocol with the Guardian server
5. The server enforces all configured policies before co-signing
