-- Per-account custom tokens added by users (beyond network defaults).

CREATE TABLE signer_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id UUID NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  chain_id INT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  decimals INT NOT NULL DEFAULT 18,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(signer_id, chain_id, address)
);

CREATE INDEX idx_signer_tokens_signer ON signer_tokens(signer_id);
