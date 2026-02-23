-- Signing requests enhancements: value_usd, status fix, RPC functions, indexes.
-- Replaces: 00014, partial 00023 (status CHECK, RPC functions, index fixes), partial 00024 (api_key_hash unique).

-- ─── 1. Add USD value column ─────────────────────────────────────────────────

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS value_usd NUMERIC;

-- ─── 2. Fix status CHECK constraint ─────────────────────────────────────────
-- Original only allows pending/approved/blocked/failed; add broadcast + completed.

ALTER TABLE signing_requests DROP CONSTRAINT IF EXISTS signing_requests_status_check;
ALTER TABLE signing_requests ADD CONSTRAINT signing_requests_status_check
  CHECK (status IN ('pending', 'approved', 'blocked', 'failed', 'broadcast', 'completed'));

-- ─── 3. UNIQUE constraint on api_key_hash (covers auth lookups) ─────────────

ALTER TABLE signers ADD CONSTRAINT signers_api_key_hash_unique UNIQUE (api_key_hash);

-- ─── 4. Drop redundant indexes (duplicate UNIQUE constraint implicit indexes)

DROP INDEX IF EXISTS idx_signers_eth_address;
DROP INDEX IF EXISTS idx_networks_chain_id;
DROP INDEX IF EXISTS idx_passkeys_credential_id;

-- ─── 5. Composite index for audit log queries ───────────────────────────────

CREATE INDEX IF NOT EXISTS idx_signing_requests_owner_created
  ON signing_requests (owner_address, created_at DESC);

-- ─── 6. RPC functions (all with SECURITY DEFINER + pinned search_path) ──────
-- DROP first: 00012 created these with different return types/languages.
-- Postgres does not allow CREATE OR REPLACE to change return type.

DROP FUNCTION IF EXISTS sum_value_by_signer_in_window(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS increment_policy_triggered(UUID);

CREATE OR REPLACE FUNCTION sum_value_by_signer_in_window(
  p_signer_id UUID,
  p_window_start TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(value_wei::numeric), 0)
  FROM signing_requests
  WHERE signer_id = p_signer_id
    AND status IN ('approved', 'broadcast', 'completed')
    AND created_at >= p_window_start;
$$;

CREATE OR REPLACE FUNCTION sum_usd_by_signer_in_window(
  p_signer_id UUID,
  p_window_start TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(value_usd), 0)
  FROM signing_requests
  WHERE signer_id = p_signer_id
    AND status IN ('approved', 'broadcast', 'completed')
    AND created_at >= p_window_start
    AND value_usd IS NOT NULL;
$$;

-- Pin search_path on existing functions from earlier migrations

CREATE OR REPLACE FUNCTION increment_policy_triggered(policy_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE policies
  SET times_triggered = times_triggered + 1
  WHERE id = policy_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;
