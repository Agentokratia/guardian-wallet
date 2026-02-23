-- New policy templates for AI Agent, Backend Service, and Team Member account types.

INSERT INTO policy_templates (slug, name, description, icon, sort_order, chain_ids, rules) VALUES
(
  'ai-agent',
  'AI Agent',
  'Moderate limits with broad contract access. Rate-limited to prevent runaway loops. Blocks infinite approvals and enforces slippage caps.',
  'bot',
  4,
  '{1,42161,8453}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 5000 }],
      "description": "Block if 24h spend exceeds $5,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 2000 }],
      "description": "Block single transactions over $2,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 50000 }],
      "description": "Block if 30-day spend exceeds $50,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 60 }],
      "description": "Max 60 transactions per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxSlippage", "maxPercent": 3 }],
      "description": "Block swaps with more than 3% slippage"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited ERC-20 approvals"
    },
    {
      "action": "accept",
      "criteria": [],
      "description": "Allow all other transactions"
    }
  ]'::jsonb
),
(
  'backend-service',
  'Backend Service',
  'High throughput, whitelist-only recipients. Designed for payment processors and automated backends that interact with known contracts.',
  'server',
  5,
  '{1,42161,8453}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 25000 }],
      "description": "Block if 24h spend exceeds $25,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 10000 }],
      "description": "Block single transactions over $10,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 200 }],
      "description": "Max 200 transactions per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited ERC-20 approvals"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "mevProtection", "enabled": true }],
      "description": "Reject transactions without MEV protection"
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
      "description": "Allow only whitelisted addresses (add your contracts here)"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Reject everything else"
    }
  ]'::jsonb
),
(
  'team-member',
  'Team Member',
  'Daily spending caps with business-hours restriction. Suitable for team wallets where humans initiate transactions during working hours.',
  'users',
  6,
  '{1,42161,8453}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 5000 }],
      "description": "Block if 24h spend exceeds $5,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 1000 }],
      "description": "Block single transactions over $1,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 25000 }],
      "description": "Block if 30-day spend exceeds $25,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 20 }],
      "description": "Max 20 transactions per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "timeWindow", "startHour": 8, "endHour": 20 }],
      "description": "Only allow transactions 8 AM - 8 PM UTC"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited ERC-20 approvals"
    },
    {
      "action": "accept",
      "criteria": [],
      "description": "Allow all other transactions"
    }
  ]'::jsonb
);
