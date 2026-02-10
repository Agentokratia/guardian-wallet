-- Add tokens column to networks table for ERC-20 token tracking per chain.
-- tokens is a JSONB array of { symbol, address, decimals }.

ALTER TABLE networks ADD COLUMN tokens JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Seed USDC addresses for supported networks
UPDATE networks SET tokens = '[{"symbol":"USDC","address":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","decimals":6}]' WHERE name = 'base-sepolia';
UPDATE networks SET tokens = '[{"symbol":"USDC","address":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","decimals":6}]' WHERE name = 'base';
UPDATE networks SET tokens = '[{"symbol":"USDC","address":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","decimals":6}]' WHERE name = 'mainnet';
UPDATE networks SET tokens = '[{"symbol":"USDC","address":"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238","decimals":6}]' WHERE name = 'sepolia';
UPDATE networks SET tokens = '[{"symbol":"USDC","address":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","decimals":6}]' WHERE name = 'arbitrum';
UPDATE networks SET tokens = '[{"symbol":"USDC","address":"0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d","decimals":6}]' WHERE name = 'arbitrum-sepolia';
