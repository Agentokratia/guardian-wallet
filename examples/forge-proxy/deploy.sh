#!/usr/bin/env bash
set -euo pipefail

# Guardian Wallet + Forge Proxy
#
# Deploys a contract using Foundry's `forge create` through the Guardian
# signing proxy. The proxy intercepts eth_sendTransaction and signs via
# 2-of-3 threshold MPC — the full private key never exists.
#
# Prerequisites:
#   - Guardian server running (docker compose up -d)
#   - Signer created with share file + API key
#   - Foundry installed (forge, cast)
#   - gw CLI installed: npm install -g @agentokratia/guardian-cli
#
# Usage:
#   ./deploy.sh

PROXY_PORT="${PROXY_PORT:-8545}"

echo "==> Starting Guardian signing proxy on port ${PROXY_PORT}..."
gw proxy --port "${PROXY_PORT}" &
PROXY_PID=$!

# Wait for proxy to be ready
sleep 2

cleanup() {
    echo "==> Stopping proxy..."
    kill "${PROXY_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Verifying proxy connection..."
CHAIN_ID=$(cast chain-id --rpc-url "http://localhost:${PROXY_PORT}")
echo "    Chain ID: ${CHAIN_ID}"

echo "==> Deploying GuardianTest contract..."
forge create \
    --rpc-url "http://localhost:${PROXY_PORT}" \
    --constructor-args "Hello from Guardian!" \
    --unlocked \
    GuardianTest.sol:GuardianTest

echo "==> Done! Contract deployed via threshold signing."
