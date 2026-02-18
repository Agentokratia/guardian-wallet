# Guardian — Full Lifecycle Demo

End-to-end demonstration of Guardian Wallet: DKG, policies, signing, and audit.

## Prerequisites

- Docker & Docker Compose
- Node.js 20+
- Guardian CLI: `npm install -g @agentokratia/guardian-wallet`

## Run

```bash
# 1. Start infrastructure
cd /path/to/guardian-wallet
docker compose up -d

# 2. Open dashboard and create a signer
open http://localhost:3000

# 3. Run the demo script
cd examples/full-lifecycle
chmod +x demo.sh
./demo.sh
```

## What the Demo Does

1. **Initialize** — configures the CLI to point at your Guardian server
2. **Health check** — verifies the server is running
3. **Status** — shows signer info (address, chain, scheme)
4. **Balance** — checks the signer's ETH balance
5. **Audit log** — fetches recent signing requests
6. **CSV export** — exports the full audit trail

## Manual Flow

```bash
# Create a signer via the dashboard (http://localhost:3000)
# This runs the DKG ceremony and gives you:
#   - A share file (my-agent.share.enc)
#   - An API key (gw_live_...)

# Configure the CLI
guardian-wallet init

# Send a transaction
guardian-wallet send 0.001 ETH to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

# Sign a message
guardian-wallet sign-message "Hello from Guardian"

# Check status
guardian-wallet status

# Check balance
guardian-wallet balance
```

## Policy Enforcement

Add policies via the dashboard or API:

```bash
# Add a spending limit (max 0.1 ETH per tx)
curl -X POST "${SERVER}/api/v1/signers/${SIGNER_ID}/policies" \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"type": "spending_limit", "config": {"maxAmount": "100000000000000000"}}'

# Now try to send more than 0.1 ETH — it will be blocked with 403
guardian-wallet send 0.5 ETH to 0x...
# Error: Policy violation: spending_limit — amount exceeds limit
```
