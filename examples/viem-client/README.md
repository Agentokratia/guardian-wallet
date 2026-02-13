# Guardian + viem

Direct WalletClient integration using `ThresholdSigner.toViemAccount()`. The full private key never exists.

## Setup

```bash
npm install

export GUARDIAN_SERVER=http://localhost:8080
export GUARDIAN_API_KEY=gw_live_...
export SHARE_PASSPHRASE=your-passphrase
export SHARE_PATH=./my-agent.share.enc
```

## Run

```bash
# Send 0.001 ETH to default address
npx tsx send.ts

# Send to a specific address
npx tsx send.ts 0xRecipient... 0.01
```

## How It Works

`ThresholdSigner.toViemAccount()` returns a viem `Account` that can be used with any viem `WalletClient`. Under the hood, every `signTransaction` call runs the interactive CGGMP24 protocol with the Guardian server.

```typescript
const account = signer.toViemAccount();
const client = createWalletClient({ account, chain: baseSepolia, transport: http() });
const hash = await client.sendTransaction({ to, value });
```

This is the simplest integration path — just 10 lines to go from a standard viem workflow to threshold-signed transactions.
