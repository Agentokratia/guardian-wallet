-- Seed data: networks, known contracts, and policy templates.
-- All data in FINAL form — no insert-then-update patterns.
-- Replaces: 00016-00022 (seeds, contract additions, template redesigns).

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Networks (Polygon + Optimism — Ethereum/Base/Arbitrum/Sepolia in 00003)
-- ═══════════════════════════════════════════════════════════════════════════════

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
  ),
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Known Contracts — all chains, all protocols, final addresses
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO known_contracts (protocol, name, address, chain_id, contract_type, source, tags) VALUES

  -- ─── Uniswap ────────────────────────────────────────────────────────────────

  -- V2 Router (Ethereum only)
  ('Uniswap', 'V2 Router',        '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', 1,     'router',   'verified', '{dex,swap}'),
  -- V3 SwapRouter
  ('Uniswap', 'V3 SwapRouter',    '0xE592427A0AEce92De3Edee1F18E0157C05861564', 1,     'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'V3 SwapRouter',    '0xE592427A0AEce92De3Edee1F18E0157C05861564', 42161, 'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'V3 SwapRouter',    '0xE592427A0AEce92De3Edee1F18E0157C05861564', 8453,  'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'V3 SwapRouter',    '0xE592427A0AEce92De3Edee1F18E0157C05861564', 10,    'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'V3 SwapRouter',    '0xE592427A0AEce92De3Edee1F18E0157C05861564', 137,   'router',   'verified', '{dex,swap}'),
  -- Universal Router
  ('Uniswap', 'Universal Router', '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', 1,     'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router', '0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5', 42161, 'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router', '0x198EF79F1F515F02dFE9e3115eD9fC07A3a63800', 8453,  'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router', '0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8', 10,    'router',   'verified', '{dex,swap}'),
  ('Uniswap', 'Universal Router', '0x643770E279d5D0733F21d6DC03A8efbABf3255B4', 137,   'router',   'verified', '{dex,swap}'),
  -- Permit2 (canonical CREATE2 address on all chains)
  ('Uniswap', 'Permit2',          '0x000000000022D473030F116dDEE9F6B43aC78BA3', 1,     'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2',          '0x000000000022D473030F116dDEE9F6B43aC78BA3', 42161, 'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2',          '0x000000000022D473030F116dDEE9F6B43aC78BA3', 8453,  'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2',          '0x000000000022D473030F116dDEE9F6B43aC78BA3', 10,    'approval', 'verified', '{permit2,approval,uniswap}'),
  ('Uniswap', 'Permit2',          '0x000000000022D473030F116dDEE9F6B43aC78BA3', 137,   'approval', 'verified', '{permit2,approval,uniswap}'),

  -- ─── Aave V3 ───────────────────────────────────────────────────────────────

  ('Aave', 'V3 Pool',             '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', 1,     'lending',  'verified', '{lending,defi,aave}'),
  ('Aave', 'V3 Pool',             '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 42161, 'lending',  'verified', '{lending,defi,aave}'),
  ('Aave', 'V3 Pool',             '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', 8453,  'lending',  'verified', '{lending,defi,aave}'),
  ('Aave', 'V3 Pool',             '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 10,    'lending',  'verified', '{lending,defi,aave}'),
  ('Aave', 'V3 Pool',             '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 137,   'lending',  'verified', '{lending,defi,aave}'),

  -- ─── 1inch Router V6 ───────────────────────────────────────────────────────

  ('1inch', 'Router V6',          '0x111111125421cA6dc452d289314280a0f8842A65', 1,     'router',   'verified', '{dex,swap,aggregator}'),
  ('1inch', 'Router V6',          '0x111111125421cA6dc452d289314280a0f8842A65', 42161, 'router',   'verified', '{dex,swap,aggregator}'),
  ('1inch', 'Router V6',          '0x111111125421cA6dc452d289314280a0f8842A65', 8453,  'router',   'verified', '{dex,swap,aggregator}'),
  ('1inch', 'Router V6',          '0x111111125421cA6dc452d289314280a0f8842A65', 10,    'router',   'verified', '{dex,swap,aggregator}'),

  -- ─── 0x Exchange Proxy ─────────────────────────────────────────────────────

  ('0x', 'Exchange Proxy',        '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 1,     'router',   'verified', '{dex,swap,aggregator,0x}'),
  ('0x', 'Exchange Proxy',        '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 42161, 'router',   'verified', '{dex,swap,aggregator,0x}'),
  ('0x', 'Exchange Proxy',        '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 8453,  'router',   'verified', '{dex,swap,aggregator,0x}'),
  ('0x', 'Exchange Proxy',        '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 10,    'router',   'verified', '{dex,swap,aggregator,0x}'),
  ('0x', 'Exchange Proxy',        '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 137,   'router',   'verified', '{dex,swap,aggregator,0x}'),

  -- ─── Paraswap Augustus V6.2 ────────────────────────────────────────────────

  ('Paraswap', 'Augustus V6.2',   '0x6A000F20005980200259B80c5102003040001068', 1,     'router',   'verified', '{dex,swap,aggregator,paraswap}'),
  ('Paraswap', 'Augustus V6.2',   '0x6A000F20005980200259B80c5102003040001068', 42161, 'router',   'verified', '{dex,swap,aggregator,paraswap}'),
  ('Paraswap', 'Augustus V6.2',   '0x6A000F20005980200259B80c5102003040001068', 8453,  'router',   'verified', '{dex,swap,aggregator,paraswap}'),
  ('Paraswap', 'Augustus V6.2',   '0x6A000F20005980200259B80c5102003040001068', 10,    'router',   'verified', '{dex,swap,aggregator,paraswap}'),
  ('Paraswap', 'Augustus V6.2',   '0x6A000F20005980200259B80c5102003040001068', 137,   'router',   'verified', '{dex,swap,aggregator,paraswap}'),

  -- ─── Odos Router V2 ────────────────────────────────────────────────────────

  ('Odos', 'Router V2',           '0xCf5540fFFCdC3d510B18bFcA6d2b9987b0772559', 8453,  'router',   'verified', '{dex,swap,aggregator,odos}'),
  ('Odos', 'Router V2',           '0xa669e7A0d4b3e4Fa48af2dE86BD4CD7126Be4e13', 42161, 'router',   'verified', '{dex,swap,aggregator,odos}'),
  ('Odos', 'Router V2',           '0x4E3288c9ca110bCC82bf38F09A7b425c095d92Bf', 137,   'router',   'verified', '{dex,swap,aggregator,odos}'),

  -- ─── WETH / WPOL (canonical per chain) ─────────────────────────────────────

  ('WETH', 'Wrapped Ether',       '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 1,     'token',    'verified', '{token,weth}'),
  ('WETH', 'Wrapped Ether',       '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 42161, 'token',    'verified', '{token,weth}'),
  ('WETH', 'Wrapped Ether',       '0x4200000000000000000000000000000000000006', 8453,  'token',    'verified', '{token,weth}'),
  ('WETH', 'Wrapped Ether',       '0x4200000000000000000000000000000000000006', 10,    'token',    'verified', '{token,weth}'),
  ('WPOL', 'Wrapped POL',         '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 137,   'token',    'verified', '{token,wpol,wmatic}'),

  -- ─── Lido (Ethereum, Arbitrum, Base) ────────────────────────────────────────

  ('Lido', 'stETH',               '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 1,     'staking',  'verified', '{staking,lsd}'),
  ('Lido', 'wstETH',              '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 1,     'staking',  'verified', '{staking,lsd}'),
  ('Lido', 'wstETH',              '0x5979D7b546E38E414F7E9822514be443A4800529', 42161, 'staking',  'verified', '{staking,lsd}'),
  ('Lido', 'wstETH',              '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', 8453,  'staking',  'verified', '{staking,lsd}'),

  -- ─── Curve ──────────────────────────────────────────────────────────────────

  ('Curve', 'Router',             '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 1,     'router',   'verified', '{dex,swap,curve}'),
  ('Curve', 'TriCrypto Pool',     '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46', 1,     'pool',     'verified', '{dex,swap,curve}'),
  ('Curve', '3pool',              '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', 1,     'pool',     'verified', '{dex,swap,curve,stablecoin}'),
  ('Curve', 'Router',             '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 42161, 'router',   'verified', '{dex,swap,curve}'),
  ('Curve', 'Router',             '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 137,   'router',   'verified', '{dex,swap,curve}'),
  ('Curve', 'Router',             '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 10,    'router',   'verified', '{dex,swap,curve}'),

  -- ─── Compound V3 ───────────────────────────────────────────────────────────

  ('Compound', 'cUSDCv3 Comet',   '0xc3d688B66703497DAA19211EEdff47f25384cdc3', 1,     'lending',  'verified', '{lending,defi,compound}'),
  ('Compound', 'cUSDCv3 Comet',   '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf', 8453,  'lending',  'verified', '{lending,defi,compound}'),
  ('Compound', 'cUSDCv3 Comet',   '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA', 42161, 'lending',  'verified', '{lending,defi,compound}'),

  -- ─── MakerDAO / Sky ─────────────────────────────────────────────────────────

  ('MakerDAO', 'DSR Manager',     '0x373238337Bfe1146fb49989fc222523f83081dDb', 1,     'lending',  'verified', '{lending,defi,maker,dsr}'),
  ('MakerDAO', 'DAI Token',       '0x6B175474E89094C44Da98b954EedeAC495271d0F', 1,     'token',    'verified', '{stablecoin,dai,maker}'),

  -- ─── Pendle ─────────────────────────────────────────────────────────────────

  ('Pendle', 'Router V4',         '0x888888888889758F76e7103c6CbF23ABbF58F946', 1,     'router',   'verified', '{defi,yield,pendle}'),
  ('Pendle', 'Router V4',         '0x888888888889758F76e7103c6CbF23ABbF58F946', 42161, 'router',   'verified', '{defi,yield,pendle}'),

  -- ─── EigenLayer ─────────────────────────────────────────────────────────────

  ('EigenLayer', 'Strategy Manager',  '0x858646372CC42E1A627fcE94aa7A7033e7CF075A', 1, 'staking',  'verified', '{restaking,eigenlayer}'),
  ('EigenLayer', 'Delegation Manager','0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A', 1, 'staking',  'verified', '{restaking,eigenlayer}'),

  -- ─── Aerodrome (Base) ───────────────────────────────────────────────────────

  ('Aerodrome', 'Router',         '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43', 8453,  'router',   'verified', '{dex,swap,aerodrome}'),
  ('Aerodrome', 'Voter',          '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5', 8453,  'staking',  'verified', '{dex,gauge,aerodrome}'),

  -- ─── Velodrome (Optimism) ──────────────────────────────────────────────────

  ('Velodrome', 'Router V2',      '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858', 10,    'router',   'verified', '{dex,swap,velodrome}'),
  ('Velodrome', 'Voter',          '0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C', 10,    'staking',  'verified', '{dex,gauge,velodrome}'),

  -- ─── Morpho (Base) ─────────────────────────────────────────────────────────

  ('Morpho', 'Morpho Blue',       '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', 8453,  'lending',  'verified', '{lending,defi,morpho}'),

  -- ─── Moonwell (Base) ───────────────────────────────────────────────────────

  ('Moonwell', 'Comptroller',     '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C', 8453,  'lending',  'verified', '{lending,defi,moonwell}'),

  -- ─── BaseSwap (Base) ───────────────────────────────────────────────────────

  ('BaseSwap', 'Router',          '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86', 8453,  'router',   'verified', '{dex,swap,baseswap}'),

  -- ─── SushiSwap ─────────────────────────────────────────────────────────────

  ('SushiSwap', 'RouteProcessor3','0x83eC81Ae54dD8dca17C3Dd4703141599090751D1', 8453,  'router',   'verified', '{dex,swap,sushi}'),
  ('SushiSwap', 'RouteProcessor3','0x0a6e511Fe663827b9cA7e2D2542b20B37fC217A6', 137,   'router',   'verified', '{dex,swap,sushi}'),

  -- ─── GMX (Arbitrum) ────────────────────────────────────────────────────────

  ('GMX', 'Exchange Router V2',   '0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8', 42161, 'router',   'verified', '{perps,dex,gmx}'),
  ('GMX', 'Vault',                '0x489ee077994B6658eAfA855C308275EAd8097C4A', 42161, 'router',   'verified', '{perps,dex,gmx}'),

  -- ─── Camelot (Arbitrum) ────────────────────────────────────────────────────

  ('Camelot', 'Router',           '0xc873fEcbd354f5A56E00E710B90EF4201db2448d', 42161, 'router',   'verified', '{dex,swap,camelot}'),

  -- ─── Radiant Capital (Arbitrum) ────────────────────────────────────────────

  ('Radiant', 'Lending Pool V2',  '0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1', 42161, 'lending',  'verified', '{lending,defi,radiant}'),

  -- ─── Trader Joe (Arbitrum) ─────────────────────────────────────────────────

  ('Trader Joe', 'LB Router V2.1','0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30', 42161, 'router',   'verified', '{dex,swap,traderjoe}'),

  -- ─── QuickSwap (Polygon) ───────────────────────────────────────────────────

  ('QuickSwap', 'V3 Router',      '0xf5b509bB0909a69B1c207E495f687a596C168E12', 137,   'router',   'verified', '{dex,swap,quickswap}'),

  -- ─── Balancer ──────────────────────────────────────────────────────────────

  ('Balancer', 'Vault',           '0xBA12222222228d8Ba445958a75a0704d566BF2C8', 42161, 'router',   'verified', '{dex,swap,balancer}'),
  ('Balancer', 'Vault',           '0xBA12222222228d8Ba445958a75a0704d566BF2C8', 137,   'router',   'verified', '{dex,swap,balancer}'),

  -- ─── Synthetix (Optimism) ──────────────────────────────────────────────────

  ('Synthetix', 'Core Proxy V3',  '0xffffffaEff0B96Ea8e4f94b2253f31abdD875847', 10,    'router',   'verified', '{perps,defi,synthetix}'),

  -- ─── Stargate (Optimism) ───────────────────────────────────────────────────

  ('Stargate', 'Router',          '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b', 10,    'router',   'verified', '{bridge,stargate}'),

  -- ─── Sonne Finance (Optimism) ──────────────────────────────────────────────

  ('Sonne', 'Comptroller',        '0x60CF091cD3f50420d50fD7f707414d0DF4751C58', 10,    'lending',  'verified', '{lending,defi,sonne}'),

  -- ─── USDC (Polygon, Optimism) ──────────────────────────────────────────────

  ('USDC', 'USDC (PoS Bridge)',   '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 137,   'token',    'verified', '{stablecoin,usdc}'),
  ('USDC', 'USDC (Native)',       '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 137,   'token',    'verified', '{stablecoin,usdc}'),
  ('USDC', 'USDC (Native)',       '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 10,    'token',    'verified', '{stablecoin,usdc}'),

  -- ─── Polymarket (Polygon) ──────────────────────────────────────────────────

  ('Polymarket', 'CTF Exchange',            '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', 137, 'exchange', 'verified', '{prediction-market,exchange,polymarket}'),
  ('Polymarket', 'Neg Risk CTF Exchange',   '0xC5d563A36AE78145C45a50134d48A1215220f80a', 137, 'exchange', 'verified', '{prediction-market,exchange,polymarket}'),
  ('Polymarket', 'Conditional Tokens (CTF)','0x4D97DCd97eC945f40cF65F87097ACe5EA0476045', 137, 'token',    'verified', '{prediction-market,erc1155,polymarket}')

ON CONFLICT (address, chain_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Policy Templates — FINAL form (no insert-then-update-then-delete)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO policy_templates (slug, name, description, icon, sort_order, chain_ids, rules) VALUES

-- ─── 1. Trading Bot ──────────────────────────────────────────────────────────
(
  'trading-bot',
  'Trading Bot',
  'DEX-only. Approved swap routers across all chains — Uniswap, 1inch, 0x, Paraswap. Spend caps and slippage protection. Use Quick Add to include chain-specific DEXes like Aerodrome or Velodrome.',
  'bot',
  1,
  '{1,42161,8453,10,137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "dailyLimitUsd", "maxUsd": 25000 },
        { "type": "maxPerTxUsd", "maxUsd": 5000 },
        { "type": "rateLimit", "maxPerHour": 200 },
        { "type": "maxSlippage", "maxPercent": 2 },
        { "type": "blockInfiniteApprovals", "enabled": true },
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
      "description": "Allow trading within limits on approved DEXes"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
),

-- ─── 2. AI Agent ─────────────────────────────────────────────────────────────
(
  'ai-agent',
  'AI Agent',
  'Broad access with guardrails. Spend caps and rate limits prevent runaway loops. Blocks infinite approvals. Good for general-purpose autonomous agents.',
  'bot',
  2,
  '{1,42161,8453,10,137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "dailyLimitUsd", "maxUsd": 5000 },
        { "type": "maxPerTxUsd", "maxUsd": 2000 },
        { "type": "monthlyLimitUsd", "maxUsd": 50000 },
        { "type": "rateLimit", "maxPerHour": 60 },
        { "type": "maxSlippage", "maxPercent": 3 },
        { "type": "blockInfiniteApprovals", "enabled": true }
      ],
      "description": "Allow all transactions within safety limits"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block transactions that exceed limits"
    }
  ]'::jsonb
),

-- ─── 3. DeFi Manager ────────────────────────────────────────────────────────
(
  'defi-manager',
  'DeFi Manager',
  'Yield farming, lending, and staking. Approved for Aave, Compound, Lido, and major DEXes for rebalancing. Higher per-tx limits for large deposits.',
  'server',
  3,
  '{1,42161,8453,10,137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "dailyLimitUsd", "maxUsd": 100000 },
        { "type": "maxPerTxUsd", "maxUsd": 50000 },
        { "type": "monthlyLimitUsd", "maxUsd": 500000 },
        { "type": "rateLimit", "maxPerHour": 30 },
        { "type": "maxSlippage", "maxPercent": 1 },
        { "type": "blockInfiniteApprovals", "enabled": true },
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": [
            "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
            "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
            "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
            "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA",
            "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
            "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
            "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
            "0x5979D7b546E38E414F7E9822514be443A4800529",
            "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
            "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            "0x111111125421cA6dc452d289314280a0f8842A65",
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            "0x4200000000000000000000000000000000000006",
            "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
          ]
        }
      ],
      "description": "Allow DeFi operations within limits on approved protocols"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
),

-- ─── 4. Team Member ──────────────────────────────────────────────────────────
(
  'team-member',
  'Team Member',
  'Business-hours only (8 AM - 8 PM UTC). Human-scale rate limits and daily caps. For team members who sign transactions manually from the dashboard.',
  'users',
  4,
  '{1,42161,8453,10,137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "dailyLimitUsd", "maxUsd": 5000 },
        { "type": "maxPerTxUsd", "maxUsd": 1000 },
        { "type": "monthlyLimitUsd", "maxUsd": 25000 },
        { "type": "rateLimit", "maxPerHour": 20 },
        { "type": "timeWindow", "startHour": 8, "endHour": 20 },
        { "type": "blockInfiniteApprovals", "enabled": true }
      ],
      "description": "Allow transactions within limits during business hours"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block transactions outside limits or hours"
    }
  ]'::jsonb
),

-- ─── 5. Payment Bot ──────────────────────────────────────────────────────────
(
  'payment-bot',
  'Payment Bot',
  'Approved recipients only. High throughput for payroll, subscriptions, or vendor payments. Add your recipient addresses after applying.',
  'zap',
  5,
  '{1,42161,8453,10,137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "dailyLimitUsd", "maxUsd": 50000 },
        { "type": "maxPerTxUsd", "maxUsd": 10000 },
        { "type": "monthlyLimitUsd", "maxUsd": 250000 },
        { "type": "rateLimit", "maxPerHour": 500 },
        { "type": "blockInfiniteApprovals", "enabled": true },
        {
          "type": "evmAddress",
          "operator": "in",
          "addresses": []
        }
      ],
      "description": "Allow payments within limits to approved recipients"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
),

-- ─── 6. Treasury ─────────────────────────────────────────────────────────────
(
  'conservative',
  'Treasury',
  'Ultra-conservative. Low daily caps, tight rate limits, no DeFi interactions. For cold storage or reserve wallets that only send to known addresses.',
  'shield',
  6,
  '{1,42161,8453,10,137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "dailyLimitUsd", "maxUsd": 1000 },
        { "type": "maxPerTxUsd", "maxUsd": 500 },
        { "type": "monthlyLimitUsd", "maxUsd": 5000 },
        { "type": "rateLimit", "maxPerHour": 5 },
        { "type": "blockInfiniteApprovals", "enabled": true }
      ],
      "description": "Allow transactions within conservative limits"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block transactions that exceed limits"
    }
  ]'::jsonb
),

-- ─── 7. Prediction Market — Conservative ─────────────────────────────────────
(
  'prediction-market-conservative',
  'Prediction Market — Conservative',
  'Tight per-bet and daily caps. Polymarket contracts only. Blocks infinite approvals, enforces 1% slippage. For cautious prediction market agents.',
  'shield',
  7,
  '{137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "maxPerTxUsd", "maxUsd": 500 },
        { "type": "dailyLimitUsd", "maxUsd": 2000 },
        { "type": "monthlyLimitUsd", "maxUsd": 15000 },
        { "type": "rateLimit", "maxPerHour": 30 },
        { "type": "maxSlippage", "maxPercent": 1 },
        { "type": "blockInfiniteApprovals", "enabled": true },
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
      "description": "Allow Polymarket trading within conservative limits"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
),

-- ─── 8. Prediction Market — Active Agent ─────────────────────────────────────
(
  'prediction-market-active',
  'Prediction Market — Active Agent',
  'Higher limits for autonomous prediction market agents. Polymarket contracts only, rate-limited, 2% slippage cap. For agents running strategies across many markets.',
  'zap',
  8,
  '{137}',
  '[
    {
      "action": "accept",
      "criteria": [
        { "type": "maxPerTxUsd", "maxUsd": 2000 },
        { "type": "dailyLimitUsd", "maxUsd": 10000 },
        { "type": "monthlyLimitUsd", "maxUsd": 75000 },
        { "type": "rateLimit", "maxPerHour": 120 },
        { "type": "maxSlippage", "maxPercent": 2 },
        { "type": "blockInfiniteApprovals", "enabled": true },
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
      "description": "Allow Polymarket trading within limits"
    },
    {
      "action": "reject",
      "criteria": [],
      "description": "Block everything else"
    }
  ]'::jsonb
);
