-- Fix broken RPC endpoints: Alchemy key revoked, LlamaRPC rate-limited, Sepolia.org down.
-- Replace with reliable public RPCs (PublicNode for ETH, Base's own for Base Sepolia).

UPDATE networks SET rpc_url = 'https://ethereum-rpc.publicnode.com'
  WHERE name = 'mainnet';

UPDATE networks SET rpc_url = 'https://ethereum-sepolia-rpc.publicnode.com'
  WHERE name = 'sepolia';

UPDATE networks SET rpc_url = 'https://sepolia.base.org'
  WHERE name = 'base-sepolia';
