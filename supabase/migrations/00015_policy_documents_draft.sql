-- Add draft/active status to policy_documents for draft/deploy workflow.
-- Replaces: 00015, partial 00023 (activate + upsert RPCs).

-- ─── 1. Draft status + activated_at ─────────────────────────────────────────

ALTER TABLE policy_documents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active')),
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Drop old 1:1 unique constraint (now can have draft + active)
ALTER TABLE policy_documents
  DROP CONSTRAINT IF EXISTS policy_documents_signer_id_key;

-- One doc per signer per status
CREATE UNIQUE INDEX IF NOT EXISTS policy_documents_signer_status_idx
  ON policy_documents (signer_id, status);

-- ─── 2. Atomic policy activation RPC ────────────────────────────────────────

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

-- ─── 3. Atomic policy upsert RPC ────────────────────────────────────────────

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
