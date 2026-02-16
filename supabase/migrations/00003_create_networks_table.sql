-- Networks table — runtime-configurable chain/RPC configuration.
-- Replaces hardcoded chain config in env vars and code.

CREATE TABLE networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  chain_id INTEGER UNIQUE NOT NULL,
  rpc_url TEXT NOT NULL,
  explorer_url TEXT,
  native_currency TEXT NOT NULL DEFAULT 'ETH',
  is_testnet BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_networks_chain_id ON networks(chain_id);
CREATE INDEX idx_networks_enabled ON networks(enabled) WHERE enabled = TRUE;

CREATE TRIGGER set_networks_updated_at
  BEFORE UPDATE ON networks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE networks ENABLE ROW LEVEL SECURITY;

-- Seed default networks
INSERT INTO networks (name, display_name, chain_id, rpc_url, explorer_url, is_testnet) VALUES
  ('mainnet', 'Ethereum Mainnet', 1, 'https://ethereum-rpc.publicnode.com', 'https://etherscan.io', FALSE),
  ('sepolia', 'Sepolia Testnet', 11155111, 'https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.etherscan.io', TRUE),
  ('base', 'Base', 8453, 'https://mainnet.base.org', 'https://basescan.org', FALSE),
  ('base-sepolia', 'Base Sepolia', 84532, 'https://sepolia.base.org', 'https://sepolia.basescan.org', TRUE),
  ('arbitrum', 'Arbitrum One', 42161, 'https://arb1.arbitrum.io/rpc', 'https://arbiscan.io', FALSE),
  ('arbitrum-sepolia', 'Arbitrum Sepolia', 421614, 'https://sepolia-rollup.arbitrum.io/rpc', 'https://sepolia.arbiscan.io', TRUE);
