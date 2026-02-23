-- Add Polygon network support, FK constraint on known_contracts, and prediction market templates.
-- Polymarket (Polygon): CTF Exchange, Neg Risk CTF Exchange, Conditional Tokens, USDC.

-- ─── Add Polygon networks ──────────────────────────────────────────────────

INSERT INTO networks (name, display_name, chain_id, rpc_url, explorer_url, native_currency, is_testnet, tokens)
VALUES
  ('polygon', 'Polygon', 137,
   'https://polygon-rpc.com',
   'https://polygonscan.com',
   'POL', FALSE,
   '[{"symbol":"USDC","address":"0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359","decimals":6},{"symbol":"USDC.e","address":"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174","decimals":6}]'::jsonb
  ),
  ('polygon-amoy', 'Polygon Amoy', 80002,
   'https://rpc-amoy.polygon.technology',
   'https://amoy.polygonscan.com',
   'POL', TRUE,
   '[{"symbol":"USDC","address":"0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582","decimals":6}]'::jsonb
  );

-- ─── Add FK: known_contracts.chain_id → networks.chain_id ──────────────────

ALTER TABLE known_contracts
  ADD CONSTRAINT fk_known_contracts_network
  FOREIGN KEY (chain_id) REFERENCES networks(chain_id);

-- ─── Polymarket known contracts (Polygon) ──────────────────────────────────

INSERT INTO known_contracts (protocol, name, address, chain_id, contract_type, source, tags) VALUES
  ('Polymarket', 'CTF Exchange',            '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', 137, 'exchange', 'verified', '{prediction-market,exchange,polymarket}'),
  ('Polymarket', 'Neg Risk CTF Exchange',   '0xC5d563A36AE78145C45a50134d48A1215220f80a', 137, 'exchange', 'verified', '{prediction-market,exchange,polymarket}'),
  ('Polymarket', 'Conditional Tokens (CTF)', '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045', 137, 'token',    'verified', '{prediction-market,erc1155,polymarket}'),
  ('USDC',       'USDC (PoS Bridge)',       '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 137, 'token',    'verified', '{stablecoin,usdc}'),
  ('USDC',       'USDC (Native)',           '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 137, 'token',    'verified', '{stablecoin,usdc}');

-- ─── Prediction market policy templates ─────────────────────────────────────

INSERT INTO policy_templates (slug, name, description, icon, sort_order, chain_ids, rules) VALUES
(
  'prediction-market-conservative',
  'Prediction Market — Conservative',
  'Tight per-bet and daily caps. Whitelisted to Polymarket contracts only. Blocks infinite approvals, enforces 1% slippage. For cautious prediction market agents.',
  'shield',
  7,
  '{137}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 500 }],
      "description": "Max $500 per bet"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 2000 }],
      "description": "Max $2,000 daily exposure"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 15000 }],
      "description": "Max $15,000 monthly exposure"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 30 }],
      "description": "Max 30 trades per hour — prevents overtrading"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxSlippage", "maxPercent": 1 }],
      "description": "Block orders with more than 1% slippage"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited token approvals — approve only what you need"
    },
    {
      "action": "accept",
      "criteria": [
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": [
            "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
            "0xC5d563A36AE78145C45a50134d48A1215220f80a",
            "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
            "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
          ]
        }
      ],
      "description": "Allow Polymarket CTF Exchange, Neg Risk Exchange, Conditional Tokens, USDC (PoS + native)"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Reject all other transactions"
    }
  ]'::jsonb
),
(
  'prediction-market-active',
  'Prediction Market — Active Agent',
  'Higher limits for autonomous prediction market agents. Whitelisted to Polymarket contracts, rate-limited, 2% slippage cap. For agents running strategies across many markets.',
  'zap',
  8,
  '{137}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 2000 }],
      "description": "Max $2,000 per bet — fractional Kelly sizing"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 10000 }],
      "description": "Max $10,000 daily exposure"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 75000 }],
      "description": "Max $75,000 monthly exposure"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 120 }],
      "description": "Max 120 trades per hour — allows active market-making"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxSlippage", "maxPercent": 2 }],
      "description": "Block orders with more than 2% slippage"
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
            "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
            "0xC5d563A36AE78145C45a50134d48A1215220f80a",
            "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
            "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
          ]
        }
      ],
      "description": "Allow Polymarket CTF Exchange, Neg Risk Exchange, Conditional Tokens, USDC (PoS + native)"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Reject all other transactions"
    }
  ]'::jsonb
);
