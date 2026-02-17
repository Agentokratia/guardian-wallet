# Guardian + viem

Direct WalletClient integration using `ThresholdSigner.toViemAccount()`. The full private key never exists.

## Run

```bash
# Setup: see examples/README.md

pnpm example:viem <to> <amount>
pnpm example:viem 0xRecipient 0.001
```

## How It Works

`ThresholdSigner.toViemAccount()` returns a viem `Account` that can be used with any viem `WalletClient`. Under the hood, every `signTransaction` call runs the interactive CGGMP24 protocol with the Guardian server.

```typescript
const account = signer.toViemAccount();
const client = createWalletClient({ account, chain: baseSepolia, transport: http() });
const hash = await client.sendTransaction({ to, value });
```

This is the simplest integration path — just 10 lines to go from a standard viem workflow to threshold-signed transactions.
