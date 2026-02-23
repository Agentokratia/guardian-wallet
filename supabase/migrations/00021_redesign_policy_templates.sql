-- Redesign policy templates based on real user workflows.
--
-- Changes:
--   1. DELETE "deploy-only" — target users are traders/agents, not CI/CD pipelines
--   2. UPDATE "conservative" → "Treasury" with tighter limits
--   3. UPDATE "trading-bot" → expanded DEX whitelist (was only 6 addresses, now 14)
--   4. UPDATE "backend-service" → "Payment Bot" with clearer description
--   5. UPDATE "ai-agent" → refined limits + block deployments
--   6. UPDATE "team-member" → unchanged rules, clearer description
--   7. INSERT "defi-manager" — yield farming, lending, staking protocols
--   8. Prediction market templates unchanged

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Remove deploy-only (not relevant for target audience)
-- ═══════════════════════════════════════════════════════════════════════════════

DELETE FROM policy_templates WHERE slug = 'deploy-only';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Conservative → Treasury
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE policy_templates
SET
  name = 'Treasury',
  description = 'Ultra-conservative. Low daily caps, tight rate limits, no DeFi interactions. For cold storage or reserve wallets that only send to known addresses.',
  sort_order = 6,
  rules = '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 1000 }],
      "description": "Max $1,000 per day"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 500 }],
      "description": "Max $500 per transaction"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 5000 }],
      "description": "Max $5,000 per month"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 5 }],
      "description": "Max 5 transactions per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited token approvals"
    },
    {
      "action": "accept",
      "criteria": [],
      "description": "Allow everything that passes above checks"
    }
  ]'::jsonb
WHERE slug = 'conservative';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Trading Bot — expanded DEX whitelist
--    Includes: Uniswap V3 + Universal (all 5 chains), 1inch, 0x, Paraswap,
--    WETH (all chains) for wrapping/unwrapping
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE policy_templates
SET
  description = 'DEX-only. Whitelists major swap routers across all chains — Uniswap, 1inch, 0x, Paraswap. Spend caps and slippage protection. Use Quick Add to include chain-specific DEXes like Aerodrome or Velodrome.',
  chain_ids = '{1,42161,8453,10,137}',
  rules = '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 25000 }],
      "description": "Max $25,000 per day"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 5000 }],
      "description": "Max $5,000 per trade"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 200 }],
      "description": "Max 200 trades per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxSlippage", "maxPercent": 2 }],
      "description": "Block swaps over 2% slippage"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited token approvals"
    },
    {
      "action": "accept",
      "criteria": [
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": [
            "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
            "0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5",
            "0x198EF79F1F515F02dFE9e3115eD9fC07A3a63800",
            "0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8",
            "0x643770E279d5D0733F21d6DC03A8efbABf3255B4",
            "0x111111125421cA6dc452d289314280a0f8842A65",
            "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",
            "0x6A000F20005980200259B80c5102003040001068",
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            "0x4200000000000000000000000000000000000006",
            "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
          ]
        }
      ],
      "description": "Allow Uniswap, 1inch, 0x, Paraswap, and WETH/WPOL"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
WHERE slug = 'trading-bot';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Backend Service → Payment Bot
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE policy_templates
SET
  name = 'Payment Bot',
  slug = 'payment-bot',
  description = 'Whitelist-only recipients. High throughput for payroll, subscriptions, or vendor payments. Add your recipient addresses after applying.',
  icon = 'zap',
  sort_order = 5,
  rules = '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 50000 }],
      "description": "Max $50,000 per day"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 10000 }],
      "description": "Max $10,000 per payment"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 250000 }],
      "description": "Max $250,000 per month"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 500 }],
      "description": "Max 500 payments per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited token approvals"
    },
    {
      "action": "accept",
      "criteria": [
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": []
        }
      ],
      "description": "Allow only your whitelisted recipients (add addresses after applying)"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
WHERE slug = 'backend-service';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. AI Agent — refined with deployment blocking
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE policy_templates
SET
  description = 'Broad access with guardrails. Spend caps and rate limits prevent runaway loops. Blocks infinite approvals. Good for general-purpose autonomous agents.',
  chain_ids = '{1,42161,8453,10,137}',
  rules = '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 5000 }],
      "description": "Max $5,000 per day"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 2000 }],
      "description": "Max $2,000 per transaction"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 50000 }],
      "description": "Max $50,000 per month"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 60 }],
      "description": "Max 60 transactions per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxSlippage", "maxPercent": 3 }],
      "description": "Block swaps over 3% slippage"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited token approvals"
    },
    {
      "action": "accept",
      "criteria": [],
      "description": "Allow all transactions that pass above checks"
    }
  ]'::jsonb
WHERE slug = 'ai-agent';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Team Member — clearer description
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE policy_templates
SET
  description = 'Business-hours only (8 AM - 8 PM UTC). Human-scale rate limits and daily caps. For team members who sign transactions manually from the dashboard.',
  chain_ids = '{1,42161,8453,10,137}'
WHERE slug = 'team-member';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. NEW: DeFi Manager — yield farming, lending, staking
--    Whitelists: Aave V3 (ETH/Arb/Base/OP), Compound V3 (ETH/Arb/Base),
--    Lido stETH+wstETH, WETH, plus major DEX routers for rebalancing
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO policy_templates (slug, name, description, icon, sort_order, chain_ids, rules)
VALUES (
  'defi-manager',
  'DeFi Manager',
  'Yield farming, lending, and staking. Whitelists Aave, Compound, Lido, and major DEXes for rebalancing. Higher per-tx limits for large deposits.',
  'server',
  3,
  '{1,42161,8453,10,137}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 100000 }],
      "description": "Max $100,000 per day"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 50000 }],
      "description": "Max $50,000 per transaction"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 500000 }],
      "description": "Max $500,000 per month"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 30 }],
      "description": "Max 30 transactions per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxSlippage", "maxPercent": 1 }],
      "description": "Block swaps over 1% slippage"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited token approvals"
    },
    {
      "action": "accept",
      "criteria": [
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": [
            "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
            "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
            "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
            "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA",
            "0x46e6b214b524310239732D51387075E0e70970bf",
            "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
            "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
            "0x5979D7b546E38E414F7E9822514be443A4800529",
            "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
            "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            "0x111111125421cA6dc452d289314280a0f8842A65",
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            "0x4200000000000000000000000000000000000006"
          ]
        }
      ],
      "description": "Allow Aave, Compound, Lido, Uniswap, 1inch, and WETH"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Update prediction market templates — add Optimism/Polygon to chain_ids
-- ═══════════════════════════════════════════════════════════════════════════════

-- No changes needed — prediction market templates are correct as-is.
