#!/usr/bin/env bash
set -euo pipefail

# Guardian Wallet + Forge Proxy
#
# Deploys a contract using Foundry's `forge create` through the Guardian
# signing proxy. The proxy intercepts eth_sendTransaction and signs via
# 2-of-3 threshold MPC — the full private key never exists.
#
# Prerequisites:
#   - Guardian server running on :8080
#   - examples/.env configured with API key + secret
#   - Foundry installed (forge, cast)
#
# Usage:
#   ./deploy.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
GW="node ${ROOT_DIR}/packages/cli/dist/cli.js"
PROXY_PORT="${PROXY_PORT:-8545}"

# Load env
if [ -f "${ENV_FILE}" ]; then
    set -a
    source "${ENV_FILE}"
    set +a
fi

echo "==> Starting Guardian signing proxy on port ${PROXY_PORT}..."
${GW} proxy --port "${PROXY_PORT}" &
PROXY_PID=$!

# Wait for proxy to be ready
sleep 3

cleanup() {
    echo ""
    echo "==> Stopping proxy..."
    kill "${PROXY_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Verifying proxy connection..."
CHAIN_ID=$(cast chain-id --rpc-url "http://localhost:${PROXY_PORT}" 2>/dev/null || echo "failed")
if [ "${CHAIN_ID}" = "failed" ]; then
    echo "    ERROR: Proxy not responding on port ${PROXY_PORT}"
    exit 1
fi
echo "    Chain ID: ${CHAIN_ID}"

SENDER=$(cast rpc eth_accounts --rpc-url "http://localhost:${PROXY_PORT}" 2>/dev/null | jq -r '.[0]' || echo "")
echo "    Sender:   ${SENDER}"

echo ""
echo "==> Deploying GuardianTest contract via forge create..."
cd "${SCRIPT_DIR}"
forge create GuardianTest.sol:GuardianTest \
    --rpc-url "http://localhost:${PROXY_PORT}" \
    --from "${SENDER}" \
    --unlocked \
    --broadcast \
    --constructor-args "Hello from Guardian!"

echo ""
echo "==> Done! Contract deployed via threshold signing."
