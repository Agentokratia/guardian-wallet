-- Network-level default tokens (ETH + common ERC-20s per chain).
-- These are shared across all signers on a network.

CREATE TABLE network_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  decimals INT NOT NULL DEFAULT 18,
  is_native BOOLEAN NOT NULL DEFAULT FALSE,
  logo_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(network_id, address)
);

CREATE INDEX idx_network_tokens_network ON network_tokens(network_id);

-- Seed native ETH for all networks
INSERT INTO network_tokens (network_id, symbol, name, address, decimals, is_native, sort_order)
SELECT id, 'ETH', 'Ethereum', NULL, 18, TRUE, 0 FROM networks;

-- Seed USDC per network
INSERT INTO network_tokens (network_id, symbol, name, address, decimals, is_native, sort_order)
SELECT id, 'USDC', 'USD Coin', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 6, FALSE, 1
FROM networks WHERE name = 'base-sepolia';

INSERT INTO network_tokens (network_id, symbol, name, address, decimals, is_native, sort_order)
SELECT id, 'USDC', 'USD Coin', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, FALSE, 1
FROM networks WHERE name = 'base';

INSERT INTO network_tokens (network_id, symbol, name, address, decimals, is_native, sort_order)
SELECT id, 'USDC', 'USD Coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, FALSE, 1
FROM networks WHERE name = 'mainnet';

INSERT INTO network_tokens (network_id, symbol, name, address, decimals, is_native, sort_order)
SELECT id, 'USDC', 'USD Coin', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 6, FALSE, 1
FROM networks WHERE name = 'sepolia';

INSERT INTO network_tokens (network_id, symbol, name, address, decimals, is_native, sort_order)
SELECT id, 'USDC', 'USD Coin', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, FALSE, 1
FROM networks WHERE name = 'arbitrum';

INSERT INTO network_tokens (network_id, symbol, name, address, decimals, is_native, sort_order)
SELECT id, 'USDC', 'USD Coin', '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 6, FALSE, 1
FROM networks WHERE name = 'arbitrum-sepolia';
