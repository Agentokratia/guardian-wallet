-- Critical database hardening fixes:
-- C1: Add 'broadcast' to signing_requests.status CHECK constraint
-- C2: Atomic activate_policy_draft() RPC to eliminate race condition
-- C3: Atomic upsert_policy_document() RPC to eliminate race condition
-- M6: Add SET search_path to all SECURITY DEFINER functions
-- m1: Drop redundant indexes (eth_address, networks.chain_id, passkeys.credential_id)

-- ─── C1: Fix status CHECK constraint ───────────────────────────────────────────
-- The CHECK only allows 'pending','approved','blocked','failed' but queries
-- reference 'broadcast'. Add it.

ALTER TABLE signing_requests DROP CONSTRAINT IF EXISTS signing_requests_status_check;
ALTER TABLE signing_requests ADD CONSTRAINT signing_requests_status_check
  CHECK (status IN ('pending', 'approved', 'blocked', 'failed', 'broadcast', 'completed'));

-- ─── C2: Atomic policy activation ──────────────────────────────────────────────
-- Eliminates race condition where crash between delete + update leaves signer
-- with no active policy.

CREATE OR REPLACE FUNCTION activate_policy_draft(p_signer_id UUID)
RETURNS SETOF policy_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete previous active policy
  DELETE FROM policy_documents
  WHERE signer_id = p_signer_id AND status = 'active';

  -- Promote draft to active
  RETURN QUERY
  UPDATE policy_documents
  SET status = 'active',
      activated_at = NOW(),
      version = version + 1,
      updated_at = NOW()
  WHERE signer_id = p_signer_id AND status = 'draft'
  RETURNING *;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No draft policy to activate for signer %', p_signer_id;
  END IF;
END;
$$;

-- ─── C3: Atomic policy upsert ──────────────────────────────────────────────────
-- INSERT ... ON CONFLICT instead of update-then-insert to avoid race conditions.

CREATE OR REPLACE FUNCTION upsert_policy_document(
  p_signer_id UUID,
  p_rules JSONB,
  p_status TEXT DEFAULT 'active',
  p_description TEXT DEFAULT NULL
)
RETURNS SETOF policy_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_activated TIMESTAMPTZ := CASE WHEN p_status = 'active' THEN v_now ELSE NULL END;
BEGIN
  RETURN QUERY
  INSERT INTO policy_documents (signer_id, rules, description, version, status, activated_at)
  VALUES (p_signer_id, p_rules, p_description, 1, p_status, v_activated)
  ON CONFLICT (signer_id, status) DO UPDATE SET
    rules = EXCLUDED.rules,
    description = EXCLUDED.description,
    activated_at = CASE WHEN p_status = 'active' THEN v_now ELSE NULL END,
    updated_at = v_now
  RETURNING *;
END;
$$;

-- ─── M6: Fix search_path on existing SECURITY DEFINER functions ────────────────

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
SET search_path = public
AS $$
  SELECT COALESCE(SUM(value_usd), 0)
  FROM signing_requests
  WHERE signer_id = p_signer_id
    AND status IN ('approved', 'broadcast', 'completed')
    AND created_at >= p_window_start;
$$;

-- ─── m1: Drop redundant indexes ────────────────────────────────────────────────
-- These duplicate UNIQUE constraint implicit indexes.

DROP INDEX IF EXISTS idx_signers_eth_address;
DROP INDEX IF EXISTS idx_networks_chain_id;
DROP INDEX IF EXISTS idx_passkeys_credential_id;

-- ─── M3: Add composite index for audit log queries ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_signing_requests_owner_created
  ON signing_requests (owner_address, created_at DESC);
