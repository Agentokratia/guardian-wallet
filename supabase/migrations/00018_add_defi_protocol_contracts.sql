-- Seed popular DeFi protocol contracts across Ethereum, Base, Arbitrum, Polygon.
-- Idempotent: ON CONFLICT DO NOTHING (unique constraint: address + chain_id).

INSERT INTO known_contracts (protocol, name, address, chain_id, contract_type, source, tags)
VALUES

  -- ─── Curve (Ethereum, Arbitrum, Polygon) ─────────────────────────────────

  ('Curve', 'Router',              '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 1,     'router',  'verified', '{dex,swap,curve}'),
  ('Curve', 'TriCrypto Pool',      '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46', 1,     'pool',    'verified', '{dex,swap,curve}'),
  ('Curve', '3pool',               '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', 1,     'pool',    'verified', '{dex,swap,curve,stablecoin}'),
  ('Curve', 'Router',              '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 42161, 'router',  'verified', '{dex,swap,curve}'),
  ('Curve', 'Router',              '0xF0d4c12A5768D806021F80a262B4d39d26C58b8D', 137,   'router',  'verified', '{dex,swap,curve}'),

  -- ─── Compound V3 (Ethereum, Base, Arbitrum) ──────────────────────────────

  ('Compound', 'cUSDCv3 Comet',    '0xc3d688B66703497DAA19211EEdff47f25384cdc3', 1,     'lending',  'verified', '{lending,defi,compound}'),
  ('Compound', 'cUSDCv3 Comet',    '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf', 8453,  'lending',  'verified', '{lending,defi,compound}'),
  ('Compound', 'cUSDCv3 Comet',    '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA', 42161, 'lending',  'verified', '{lending,defi,compound}'),

  -- ─── Sky / Maker (Ethereum) ──────────────────────────────────────────────

  ('MakerDAO', 'DSR Manager',      '0x373238337Bfe1146fb49989fc222523f83081dDb', 1,     'lending',  'verified', '{lending,defi,maker,dsr}'),
  ('MakerDAO', 'DAI Token',        '0x6B175474E89094C44Da98b954EedeAC495271d0F', 1,     'token',    'verified', '{stablecoin,dai,maker}'),

  -- ─── Pendle (Ethereum, Arbitrum) ─────────────────────────────────────────

  ('Pendle', 'Router V4',          '0x888888888889758F76e7103c6CbF23ABbF58F946', 1,     'router',  'verified', '{defi,yield,pendle}'),
  ('Pendle', 'Router V4',          '0x888888888889758F76e7103c6CbF23ABbF58F946', 42161, 'router',  'verified', '{defi,yield,pendle}'),

  -- ─── EigenLayer (Ethereum) ───────────────────────────────────────────────

  ('EigenLayer', 'Strategy Manager', '0x858646372CC42E1A627fcE94aa7A7033e7CF075A', 1,    'staking', 'verified', '{restaking,eigenlayer}'),
  ('EigenLayer', 'Delegation Manager','0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A', 1,    'staking', 'verified', '{restaking,eigenlayer}'),

  -- ─── Aerodrome (Base) ────────────────────────────────────────────────────

  ('Aerodrome', 'Router',          '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43', 8453,  'router',  'verified', '{dex,swap,aerodrome}'),
  ('Aerodrome', 'Voter',           '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5', 8453,  'staking', 'verified', '{dex,gauge,aerodrome}'),

  -- ─── Morpho (Base) ──────────────────────────────────────────────────────

  ('Morpho', 'Morpho Blue',        '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', 8453,  'lending',  'verified', '{lending,defi,morpho}'),

  -- ─── Moonwell (Base) ────────────────────────────────────────────────────

  ('Moonwell', 'Comptroller',      '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C', 8453,  'lending',  'verified', '{lending,defi,moonwell}'),

  -- ─── BaseSwap (Base) ────────────────────────────────────────────────────

  ('BaseSwap', 'Router',           '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86', 8453,  'router',  'verified', '{dex,swap,baseswap}'),

  -- ─── SushiSwap (Base, Polygon) ──────────────────────────────────────────

  ('SushiSwap', 'RouteProcessor3', '0x83eC81Ae54dD8dca17C3Dd4703141599090751D1', 8453,  'router',  'verified', '{dex,swap,sushi}'),
  ('SushiSwap', 'RouteProcessor3', '0x0a6e511Fe663827b9cA7e2D2542b20B37fC217A6', 137,   'router',  'verified', '{dex,swap,sushi}'),

  -- ─── GMX (Arbitrum) ─────────────────────────────────────────────────────

  ('GMX', 'Exchange Router V2',    '0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8', 42161, 'router',  'verified', '{perps,dex,gmx}'),
  ('GMX', 'Vault',                 '0x489ee077994B6658eAfA855C308275EAd8097C4A', 42161, 'router',  'verified', '{perps,dex,gmx}'),

  -- ─── Camelot (Arbitrum) ─────────────────────────────────────────────────

  ('Camelot', 'Router',            '0xc873fEcbd354f5A56E00E710B90EF4201db2448d', 42161, 'router',  'verified', '{dex,swap,camelot}'),

  -- ─── Radiant Capital (Arbitrum) ─────────────────────────────────────────

  ('Radiant', 'Lending Pool V2',   '0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1', 42161, 'lending', 'verified', '{lending,defi,radiant}'),

  -- ─── Trader Joe (Arbitrum) ──────────────────────────────────────────────

  ('Trader Joe', 'LB Router V2.1', '0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30', 42161, 'router',  'verified', '{dex,swap,traderjoe}'),

  -- ─── QuickSwap (Polygon) ────────────────────────────────────────────────

  ('QuickSwap', 'V3 Router',       '0xf5b509bB0909a69B1c207E495f687a596C168E12', 137,   'router',  'verified', '{dex,swap,quickswap}'),

  -- ─── Balancer (Arbitrum, Polygon) ───────────────────────────────────────

  ('Balancer', 'Vault',            '0xBA12222222228d8Ba445958a75a0704d566BF2C8', 42161, 'router',  'verified', '{dex,swap,balancer}'),
  ('Balancer', 'Vault',            '0xBA12222222228d8Ba445958a75a0704d566BF2C8', 137,   'router',  'verified', '{dex,swap,balancer}'),

  -- ─── Aave V3 (Polygon) ─────────────────────────────────────────────────

  ('Aave', 'V3 Pool',             '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 137,   'lending', 'verified', '{lending,defi,aave}'),

  -- ─── Aggregators: 0x Exchange Proxy ─────────────────────────────────────

  ('0x', 'Exchange Proxy',         '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 1,     'router',  'verified', '{dex,swap,aggregator,0x}'),
  ('0x', 'Exchange Proxy',         '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 8453,  'router',  'verified', '{dex,swap,aggregator,0x}'),
  ('0x', 'Exchange Proxy',         '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 42161, 'router',  'verified', '{dex,swap,aggregator,0x}'),
  ('0x', 'Exchange Proxy',         '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', 137,   'router',  'verified', '{dex,swap,aggregator,0x}'),

  -- ─── Aggregators: Odos Router V2 ───────────────────────────────────────

  ('Odos', 'Router V2',            '0xCf5540fFFCdC3d510B18bFcA6d2b9987b0772559', 8453,  'router',  'verified', '{dex,swap,aggregator,odos}'),
  ('Odos', 'Router V2',            '0xa669e7A0d4b3e4Fa48af2dE86BD4CD7126Be4e13', 42161, 'router',  'verified', '{dex,swap,aggregator,odos}'),
  ('Odos', 'Router V2',            '0x4E3288c9ca110bCC82bf38F09A7b425c095d92Bf', 137,   'router',  'verified', '{dex,swap,aggregator,odos}'),

  -- ─── Aggregators: Paraswap Augustus V6.2 ───────────────────────────────

  ('Paraswap', 'Augustus V6.2',    '0x6A000F20005980200259B80c5102003040001068', 1,     'router',  'verified', '{dex,swap,aggregator,paraswap}'),
  ('Paraswap', 'Augustus V6.2',    '0x6A000F20005980200259B80c5102003040001068', 8453,  'router',  'verified', '{dex,swap,aggregator,paraswap}'),
  ('Paraswap', 'Augustus V6.2',    '0x6A000F20005980200259B80c5102003040001068', 42161, 'router',  'verified', '{dex,swap,aggregator,paraswap}'),
  ('Paraswap', 'Augustus V6.2',    '0x6A000F20005980200259B80c5102003040001068', 137,   'router',  'verified', '{dex,swap,aggregator,paraswap}')

ON CONFLICT (address, chain_id) DO NOTHING;
