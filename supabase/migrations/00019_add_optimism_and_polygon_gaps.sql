-- Add Optimism network + fill Polygon contract gaps + Optimism contracts.

-- ─── Add Optimism networks ─────────────────────────────────────────────────

INSERT INTO networks (name, display_name, chain_id, rpc_url, explorer_url, native_currency, is_testnet, tokens)
VALUES
  ('optimism', 'Optimism', 10,
   'https://mainnet.optimism.io',
   'https://optimistic.etherscan.io',
   'ETH', FALSE,
   '[{"symbol":"USDC","address":"0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85","decimals":6},{"symbol":"USDC.e","address":"0x7F5c764cBc14f9669B88837ca1490cCa17c31607","decimals":6},{"symbol":"USDT","address":"0x94b008aA00579c1307B0EF2c499aD98a8ce58e58","decimals":6},{"symbol":"DAI","address":"0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1","decimals":18}]'::jsonb
  ),
  ('optimism-sepolia', 'Optimism Sepolia', 11155420,
   'https://sepolia.optimism.io',
   'https://sepolia-optimistic.etherscan.io',
   'ETH', TRUE,
   '[{"symbol":"USDC","address":"0x5fd84259d66Cd46123540766Be93DFE6D43130D7","decimals":6}]'::jsonb
  );

-- ─── Polygon gaps ──────────────────────────────────────────────────────────

INSERT INTO known_contracts (protocol, name, address, chain_id, contract_type, source, tags)
VALUES
  -- WPOL (Wrapped POL, formerly WMATIC)
  ('WPOL', 'Wrapped POL',           '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 137, 'token',   'verified', '{token,wpol,wmatic}'),
  -- Uniswap V3 on Polygon
  ('Uniswap', 'V3 SwapRouter',      '0xE592427A0AEce92De3Edee1F18E0157C05861564', 137, 'router',  'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router',   '0x643770E279d5D0733F21d6DC03A8efbABf3255B4', 137, 'router',  'verified', '{dex,swap}')

ON CONFLICT (address, chain_id) DO NOTHING;

-- ─── Optimism contracts ────────────────────────────────────────────────────

INSERT INTO known_contracts (protocol, name, address, chain_id, contract_type, source, tags)
VALUES
  -- Velodrome (Optimism's primary DEX — same team as Aerodrome on Base)
  ('Velodrome', 'Router V2',        '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858', 10, 'router',  'verified', '{dex,swap,velodrome}'),
  ('Velodrome', 'Voter',            '0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C', 10, 'staking', 'verified', '{dex,gauge,velodrome}'),

  -- Uniswap V3 on Optimism
  ('Uniswap', 'V3 SwapRouter',      '0xE592427A0AEce92De3Edee1F18E0157C05861564', 10, 'router',  'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router',   '0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8', 10, 'router',  'verified', '{dex,swap}'),

  -- Aave V3 on Optimism
  ('Aave', 'V3 Pool',               '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 10, 'lending', 'verified', '{lending,defi,aave}'),

  -- Synthetix V3 Core Proxy
  ('Synthetix', 'Core Proxy V3',    '0xffffffaEff0B96Ea8e4f94b2253f31abdD875847', 10, 'router',  'verified', '{perps,defi,synthetix}'),

  -- 1inch on Optimism
  ('1inch', 'Router V6',            '0x111111125421cA6dc452d289314280a0f8842A65', 10, 'router',  'verified', '{dex,swap,aggregator}'),

  -- 0x Exchange Proxy on Optimism
  ('0x', 'Exchange Proxy',          '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 10, 'router',  'verified', '{dex,swap,aggregator,0x}'),

  -- Paraswap on Optimism
  ('Paraswap', 'Augustus V6.2',     '0x6A000F20005980200259B80c5102003040001068', 10, 'router',  'verified', '{dex,swap,aggregator,paraswap}'),

  -- WETH on Optimism
  ('WETH', 'Wrapped Ether',         '0x4200000000000000000000000000000000000006', 10, 'token',   'verified', '{token,weth}'),

  -- USDC on Optimism (native)
  ('USDC', 'USDC (Native)',         '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 10, 'token',   'verified', '{stablecoin,usdc}'),

  -- Stargate (cross-chain bridge, major on OP)
  ('Stargate', 'Router',            '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b', 10, 'router',  'verified', '{bridge,stargate}'),

  -- Curve on Optimism
  ('Curve', 'Router',               '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 10, 'router',  'verified', '{dex,swap,curve}'),

  -- Sonne Finance (Compound fork on OP)
  ('Sonne', 'Comptroller',          '0x60CF091cD3f50420d50fD7f707414d0DF4751C58', 10, 'lending', 'verified', '{lending,defi,sonne}')

ON CONFLICT (address, chain_id) DO NOTHING;
