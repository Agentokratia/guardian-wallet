# Guardian + LangChain

A LangChain agent with threshold signing tools. The full private key never exists.

## Run

```bash
# Setup: see examples/README.md (also needs ANTHROPIC_API_KEY in .env)

pnpm example:langchain

# Or with a custom prompt
pnpm example:langchain "Send 0.001 ETH to 0x..."
```

## How It Works

1. `ThresholdSigner.fromSecret()` loads the agent's key material from an env var
2. Three tools are registered: `get_balance`, `send_transaction`, `sign_message`
3. LangChain's `createToolCallingAgent` routes the user's request to the right tool
4. Each signing operation uses interactive CGGMP24 protocol with the Guardian server
5. The server enforces all configured policies before co-signing
