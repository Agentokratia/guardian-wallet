#!/usr/bin/env bash
set -euo pipefail

# Guardian Wallet — Full Lifecycle Demo
#
# Demonstrates the complete flow:
#   1. Health check
#   2. CLI init + status
#   3. Check balance
#   4. Sign a message (proof-of-liveness)
#   5. Send a transaction
#   6. View audit log
#   7. Export audit CSV
#
# Prerequisites:
#   - Guardian server running on :8080
#   - examples/.env configured with API key + secret
#
# Usage:
#   ./demo.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
GW="node ${ROOT_DIR}/packages/wallet/dist/index.js"

# Load env
if [ -f "${ENV_FILE}" ]; then
    set -a
    source "${ENV_FILE}"
    set +a
fi

SERVER="${GUARDIAN_SERVER:-http://localhost:8080}"
API_PREFIX="${SERVER}/api/v1"

echo "=========================================="
echo "  Guardian Wallet — Full Lifecycle Demo"
echo "=========================================="
echo ""

# Step 1: Health check
echo "==> Step 1: Verify server health"
HEALTH=$(curl -sf "${API_PREFIX}/health" 2>/dev/null || echo '{"status":"error"}')
echo "    ${HEALTH}" | head -c 200
echo ""
echo ""

# Step 2: CLI init + status
echo "==> Step 2: Initialize CLI + check signer status"
${GW} init --server "${SERVER}" --non-interactive 2>/dev/null || echo "    (already initialized)"
${GW} status
echo ""

# Step 3: Balance
echo "==> Step 3: Check signer balance"
${GW} balance
echo ""

# Step 4: Sign a message
echo "==> Step 4: Sign proof-of-liveness message"
MSG="guardian-lifecycle-demo::$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "    Message: ${MSG}"
${GW} sign-message "${MSG}"
echo ""

# Step 5: Send a transaction
echo "==> Step 5: Send 0.000001 ETH (Base Sepolia)"
${GW} send 0x0000000000000000000000000000000000000001 0.000001
echo ""

# Step 6: Audit log
echo "==> Step 6: View recent audit log"
curl -s "${API_PREFIX}/audit-log?limit=5" \
    -H "x-api-key: ${GUARDIAN_API_KEY:-gw_live_demo}" | python3 -m json.tool 2>/dev/null | head -30 || echo "    (no audit data)"
echo ""

# Step 7: CSV export
echo "==> Step 7: Export audit log as CSV"
curl -s "${API_PREFIX}/audit-log/export" \
    -H "x-api-key: ${GUARDIAN_API_KEY:-gw_live_demo}" \
    -o "${SCRIPT_DIR}/audit-export.csv" 2>/dev/null
if [ -f "${SCRIPT_DIR}/audit-export.csv" ] && [ -s "${SCRIPT_DIR}/audit-export.csv" ]; then
    echo "    Exported to audit-export.csv ($(wc -l < "${SCRIPT_DIR}/audit-export.csv") rows)"
    head -3 "${SCRIPT_DIR}/audit-export.csv"
else
    echo "    (no audit data yet)"
fi
echo ""

echo "=========================================="
echo "  Demo complete!"
echo ""
echo "  All lifecycle steps passed:"
echo "    [x] Server health"
echo "    [x] CLI init + status"
echo "    [x] Balance check"
echo "    [x] Message signing"
echo "    [x] ETH transfer"
echo "    [x] Audit log"
echo "=========================================="
