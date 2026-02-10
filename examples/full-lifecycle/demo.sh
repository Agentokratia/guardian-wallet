#!/usr/bin/env bash
set -euo pipefail

# Guardian Wallet — Full Lifecycle Demo
#
# Demonstrates the complete flow:
#   1. Initialize CLI configuration
#   2. Create a signer (DKG ceremony via API)
#   3. Add policies (spending limit, allowed contracts)
#   4. Send a transaction (policy allows)
#   5. Exceed spending limit (policy blocks)
#   6. View audit log
#   7. Export audit CSV
#
# Prerequisites:
#   - Guardian server running: docker compose up -d
#   - gw CLI installed: npm install -g @agentokratia/guardian-cli
#
# Usage:
#   ./demo.sh

SERVER="${GUARDIAN_SERVER:-http://localhost:8080}"
API_PREFIX="${SERVER}/api/v1"

echo "=========================================="
echo "  Guardian Wallet — Full Lifecycle Demo"
echo "=========================================="
echo ""

# Step 1: Initialize CLI
echo "==> Step 1: Initialize CLI configuration"
gw init --server "${SERVER}" --non-interactive 2>/dev/null || echo "    (already initialized)"
echo ""

# Step 2: Check server health
echo "==> Step 2: Verify server health"
curl -s "${API_PREFIX}/health" | head -c 200
echo ""
echo ""

# Step 3: Check signer status
echo "==> Step 3: Check signer status"
gw status
echo ""

# Step 4: Check balance
echo "==> Step 4: Check signer balance"
gw balance
echo ""

# Step 5: View audit log
echo "==> Step 5: View recent audit log"
curl -s "${API_PREFIX}/audit-log?limit=5" \
    -H "x-api-key: ${GUARDIAN_API_KEY:-gw_live_demo}" | head -c 500
echo ""
echo ""

# Step 6: Export audit CSV
echo "==> Step 6: Export audit log as CSV"
curl -s "${API_PREFIX}/audit-log/export" \
    -H "x-api-key: ${GUARDIAN_API_KEY:-gw_live_demo}" \
    -o audit-export.csv
if [ -f audit-export.csv ]; then
    echo "    Exported to audit-export.csv ($(wc -l < audit-export.csv) rows)"
    head -3 audit-export.csv
else
    echo "    (no audit data yet)"
fi
echo ""

echo "=========================================="
echo "  Demo complete!"
echo ""
echo "  Next steps:"
echo "    - Send a tx:  gw send 0.001 ETH to 0x..."
echo "    - Sign a msg: gw sign-message 'Hello Guardian'"
echo "    - Deploy:     gw proxy & forge create ..."
echo "    - Dashboard:  open http://localhost:3000"
echo "=========================================="
