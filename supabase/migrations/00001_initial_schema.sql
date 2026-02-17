-- Threshold Wallet — Initial Schema
-- 4 tables. NO shares stored in the database — ever.

-- Signers table
CREATE TABLE signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN (
    'ai_agent', 'deploy_script', 'backend_service', 'team_member', 'trading_bot', 'custom'
  )),
  eth_address TEXT UNIQUE NOT NULL,
  chain TEXT NOT NULL DEFAULT 'ethereum',
  scheme TEXT NOT NULL DEFAULT 'cggmp24',
  network TEXT NOT NULL DEFAULT 'mainnet',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  api_key_hash TEXT NOT NULL,
  vault_share_path TEXT NOT NULL,
  dkg_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Policies table
CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id UUID NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'spending_limit', 'daily_limit', 'monthly_limit',
    'allowed_contracts', 'allowed_functions', 'blocked_addresses',
    'rate_limit', 'time_window', 'passkey_threshold'
  )),
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  applies_to TEXT[] DEFAULT '{}',
  times_triggered INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Signing requests (audit log)
CREATE TABLE signing_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id UUID NOT NULL REFERENCES signers(id),
  request_type TEXT NOT NULL,
  signing_path TEXT NOT NULL CHECK (signing_path IN ('signer+server', 'user+server', 'signer+user')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked', 'failed')),
  to_address TEXT,
  value_wei TEXT,
  chain_id INTEGER,
  tx_data TEXT,
  decoded_action TEXT,
  tx_hash TEXT,
  nonce INTEGER,
  policy_violations JSONB DEFAULT '[]',
  policies_evaluated INTEGER DEFAULT 0,
  evaluation_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Passkeys table
CREATE TABLE passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default',
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_signers_status ON signers(status);
CREATE INDEX idx_signers_eth_address ON signers(eth_address);
CREATE INDEX idx_policies_signer_id ON policies(signer_id);
CREATE INDEX idx_policies_signer_enabled ON policies(signer_id) WHERE enabled = TRUE;
CREATE INDEX idx_signing_requests_signer_id ON signing_requests(signer_id);
CREATE INDEX idx_signing_requests_created_at ON signing_requests(created_at DESC);
CREATE INDEX idx_signing_requests_status ON signing_requests(status);
CREATE INDEX idx_passkeys_credential_id ON passkeys(credential_id);

-- Enable RLS (server uses service_role key which bypasses RLS)
ALTER TABLE signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signers_updated_at BEFORE UPDATE ON signers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER policies_updated_at BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
