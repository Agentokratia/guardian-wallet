-- Known contracts registry + policy templates for the visual policy builder.

-- ─── Known Contracts ────────────────────────────────────────────────────────

CREATE TABLE known_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol TEXT NOT NULL,
    name TEXT NOT NULL,
    address CHAR(42) NOT NULL,
    chain_id INTEGER NOT NULL,
    contract_type TEXT NOT NULL DEFAULT 'router',
    verified BOOLEAN NOT NULL DEFAULT TRUE,
    source TEXT,
    tags TEXT[] DEFAULT '{}',
    added_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A contract address can appear once per chain
ALTER TABLE known_contracts ADD CONSTRAINT uq_known_contracts_address_chain UNIQUE (address, chain_id);

CREATE INDEX idx_known_contracts_chain_id ON known_contracts(chain_id);
CREATE INDEX idx_known_contracts_protocol ON known_contracts(protocol);

ALTER TABLE known_contracts ENABLE ROW LEVEL SECURITY;

-- ─── Policy Templates ───────────────────────────────────────────────────────

CREATE TABLE policy_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    chain_ids INTEGER[] DEFAULT '{}',
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER policy_templates_updated_at
    BEFORE UPDATE ON policy_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE policy_templates ENABLE ROW LEVEL SECURITY;

-- ─── Seed: Known Contracts ──────────────────────────────────────────────────

INSERT INTO known_contracts (protocol, name, address, chain_id, contract_type, source, tags) VALUES
  -- Uniswap V2 Router (Ethereum)
  ('Uniswap', 'V2 Router', '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', 1, 'router', 'verified', '{dex,swap}'),
  -- Uniswap V3 SwapRouter
  ('Uniswap', 'V3 SwapRouter', '0xE592427A0AEce92De3Edee1F18E0157C05861564', 1, 'router', 'verified', '{dex,swap}'),
  ('Uniswap', 'V3 SwapRouter', '0xE592427A0AEce92De3Edee1F18E0157C05861564', 42161, 'router', 'verified', '{dex,swap}'),
  ('Uniswap', 'V3 SwapRouter', '0xE592427A0AEce92De3Edee1F18E0157C05861564', 8453, 'router', 'verified', '{dex,swap}'),
  -- Uniswap Universal Router
  ('Uniswap', 'Universal Router', '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', 1, 'router', 'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router', '0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5', 42161, 'router', 'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router', '0x198EF79F1F515F02dFE9e3115eD9fC07A3a63800', 8453, 'router', 'verified', '{dex,swap}'),
  -- Aave V3 Pool
  ('Aave', 'V3 Pool', '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', 1, 'lending', 'verified', '{lending,defi}'),
  ('Aave', 'V3 Pool', '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 42161, 'lending', 'verified', '{lending,defi}'),
  ('Aave', 'V3 Pool', '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', 8453, 'lending', 'verified', '{lending,defi}'),
  -- 1inch Router V6
  ('1inch', 'Router V6', '0x111111125421cA6dc452d289314280a0f8842A65', 1, 'router', 'verified', '{dex,swap,aggregator}'),
  ('1inch', 'Router V6', '0x111111125421cA6dc452d289314280a0f8842A65', 42161, 'router', 'verified', '{dex,swap,aggregator}'),
  ('1inch', 'Router V6', '0x111111125421cA6dc452d289314280a0f8842A65', 8453, 'router', 'verified', '{dex,swap,aggregator}'),
  -- WETH
  ('WETH', 'Wrapped Ether', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 1, 'token', 'verified', '{token,weth}'),
  ('WETH', 'Wrapped Ether', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 42161, 'token', 'verified', '{token,weth}'),
  ('WETH', 'Wrapped Ether', '0x4200000000000000000000000000000000000006', 8453, 'token', 'verified', '{token,weth}'),
  -- Lido stETH (Ethereum only)
  ('Lido', 'stETH', '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 1, 'staking', 'verified', '{staking,lsd}'),
  -- Lido wstETH
  ('Lido', 'wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 1, 'staking', 'verified', '{staking,lsd}'),
  ('Lido', 'wstETH', '0x5979D7b546E38E414F7E9822514be443A4800529', 42161, 'staking', 'verified', '{staking,lsd}'),
  ('Lido', 'wstETH', '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', 8453, 'staking', 'verified', '{staking,lsd}');

-- ─── Seed: Policy Templates ────────────────────────────────────────────────

INSERT INTO policy_templates (slug, name, description, icon, sort_order, chain_ids, rules) VALUES
(
  'conservative',
  'Conservative',
  'Low daily limits, whitelist-only recipients, all DeFi safety checks enabled. Ideal for treasury or cold-storage signers.',
  'shield',
  1,
  '{1,42161,8453}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 1000 }],
      "description": "Block if 24h spend exceeds $1,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "monthlyLimitUsd", "maxUsd": 10000 }],
      "description": "Block if 30-day spend exceeds $10,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 10 }],
      "description": "Max 10 transactions per hour"
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
      "criteria": [],
      "description": "Allow everything else that passes above checks"
    }
  ]'::jsonb
),
(
  'trading-bot',
  'Trading Bot',
  'Higher limits for automated trading. Allows known DEX routers, enforces slippage cap, 24/7 operation.',
  'bot',
  2,
  '{1,42161,8453}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "dailyLimitUsd", "maxUsd": 10000 }],
      "description": "Block if 24h spend exceeds $10,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 5000 }],
      "description": "Block single transactions over $5,000"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 100 }],
      "description": "Max 100 transactions per hour"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "maxSlippage", "maxPercent": 2 }],
      "description": "Block swaps with more than 2% slippage"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "blockInfiniteApprovals", "enabled": true }],
      "description": "Block unlimited ERC-20 approvals"
    },
    {
      "action": "accept",
      "criteria": [
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": [
            "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
            "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
            "0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5",
            "0x198EF79F1F515F02dFE9e3115eD9fC07A3a63800",
            "0x111111125421cA6dc452d289314280a0f8842A65"
          ]
        }
      ],
      "description": "Allow transactions to known DEX routers"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Reject everything else"
    }
  ]'::jsonb
),
(
  'deploy-only',
  'Deploy Only',
  'Zero-value transactions only. Allows contract deployment, restricts by IP. Ideal for CI/CD deploy scripts.',
  'rocket',
  3,
  '{1,42161,8453}',
  '[
    {
      "action": "reject",
      "criteria": [{ "type": "maxPerTxUsd", "maxUsd": 0 }],
      "description": "Block any transaction that transfers value"
    },
    {
      "action": "reject",
      "criteria": [{ "type": "rateLimit", "maxPerHour": 20 }],
      "description": "Max 20 deploys per hour"
    },
    {
      "action": "accept",
      "criteria": [
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": [],
          "allowDeploy": true
        }
      ],
      "description": "Allow contract deployments (to=null)"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Reject all other transactions"
    }
  ]'::jsonb
);
