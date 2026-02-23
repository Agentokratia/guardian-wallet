-- Add Permit2 and token infrastructure contracts across all supported chains.
-- Permit2 is deployed at the same CREATE2 address on every EVM chain.
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO known_contracts (protocol, name, address, chain_id, contract_type, source, tags)
VALUES

  -- ─── Uniswap Permit2 (canonical address on all chains) ────────────────────

  ('Uniswap', 'Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3', 1,     'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3', 42161, 'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3', 8453,  'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3', 10,    'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3', 137,   'approval', 'verified', '{permit2,approval,uniswap}'),

  -- ─── WETH (canonical addresses per chain) ──────────────────────────────────
  -- Included because approve() on WETH is common in DeFi flows

  ('WETH', 'Wrapped Ether',   '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 1,     'token', 'verified', '{weth,token}'),
  ('WETH', 'Wrapped Ether',   '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 42161, 'token', 'verified', '{weth,token}'),
  ('WETH', 'Wrapped Ether',   '0x4200000000000000000000000000000000000006', 8453,  'token', 'verified', '{weth,token}'),
  ('WETH', 'Wrapped Ether',   '0x4200000000000000000000000000000000000006', 10,    'token', 'verified', '{weth,token}'),
  ('WPOL', 'Wrapped POL',     '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 137,   'token', 'verified', '{wpol,wmatic,token}')

ON CONFLICT (address, chain_id) DO NOTHING;
