-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 1: Enable RLS on tables that were missing it
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE network_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE signer_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_documents ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 2: RLS policies for network_tokens (public config — read-only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "network_tokens_select_all" ON network_tokens
  FOR SELECT USING (true);
-- Only service_role can insert/update/delete (RLS is bypassed for service_role).

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 3: RLS policies for signer_tokens (owner-scoped)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "signer_tokens_select_own" ON signer_tokens
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

CREATE POLICY "signer_tokens_insert_own" ON signer_tokens
  FOR INSERT WITH CHECK (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

CREATE POLICY "signer_tokens_update_own" ON signer_tokens
  FOR UPDATE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

CREATE POLICY "signer_tokens_delete_own" ON signer_tokens
  FOR DELETE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 4: RLS policies for policy_documents (owner-scoped)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "policy_documents_select_own" ON policy_documents
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

CREATE POLICY "policy_documents_insert_own" ON policy_documents
  FOR INSERT WITH CHECK (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

CREATE POLICY "policy_documents_update_own" ON policy_documents
  FOR UPDATE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

CREATE POLICY "policy_documents_delete_own" ON policy_documents
  FOR DELETE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 5: Optimize existing RLS policies — wrap current_setting in (SELECT)
--         so the function is evaluated once per query, not per row.
-- ═══════════════════════════════════════════════════════════════════════════

-- Signers
DROP POLICY IF EXISTS "signers_select_own" ON signers;
DROP POLICY IF EXISTS "signers_insert_own" ON signers;
DROP POLICY IF EXISTS "signers_update_own" ON signers;
DROP POLICY IF EXISTS "signers_delete_own" ON signers;

CREATE POLICY "signers_select_own" ON signers
  FOR SELECT USING (
    owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
  );
CREATE POLICY "signers_insert_own" ON signers
  FOR INSERT WITH CHECK (
    owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
  );
CREATE POLICY "signers_update_own" ON signers
  FOR UPDATE USING (
    owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
  );
CREATE POLICY "signers_delete_own" ON signers
  FOR DELETE USING (
    owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
  );

-- Policies
DROP POLICY IF EXISTS "policies_select_own" ON policies;
DROP POLICY IF EXISTS "policies_insert_own" ON policies;
DROP POLICY IF EXISTS "policies_update_own" ON policies;
DROP POLICY IF EXISTS "policies_delete_own" ON policies;

CREATE POLICY "policies_select_own" ON policies
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );
CREATE POLICY "policies_insert_own" ON policies
  FOR INSERT WITH CHECK (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );
CREATE POLICY "policies_update_own" ON policies
  FOR UPDATE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );
CREATE POLICY "policies_delete_own" ON policies
  FOR DELETE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

-- Signing requests
DROP POLICY IF EXISTS "signing_requests_select_own" ON signing_requests;

CREATE POLICY "signing_requests_select_own" ON signing_requests
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = (SELECT current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );

-- Passkey credentials
DROP POLICY IF EXISTS "passkeys_select_own" ON passkey_credentials;

CREATE POLICY "passkeys_select_own" ON passkey_credentials
  FOR SELECT USING (
    user_id = (SELECT (current_setting('request.jwt.claims', true)::json->>'sub')::uuid)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 6: Composite index for windowed queries on signing_requests
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_signing_requests_signer_status_created
  ON signing_requests (signer_id, status, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 7: increment_policy_triggered RPC function (atomic counter update)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_policy_triggered(policy_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE policies
  SET times_triggered = times_triggered + 1,
      updated_at = NOW()
  WHERE id = policy_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 8: sum_value_by_signer_in_window RPC (server-side aggregation)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sum_value_by_signer_in_window(
  p_signer_id UUID,
  p_window_start TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(SUM(value_wei::numeric), 0)::text
  FROM signing_requests
  WHERE signer_id = p_signer_id
    AND status IN ('approved', 'broadcast')
    AND created_at >= p_window_start;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 9: Foreign key indexes on auth tables
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id
  ON passkey_credentials (user_id);

CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id
  ON email_verifications (user_id);
