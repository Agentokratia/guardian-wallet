-- PRD-67: Auth Simplification — schema additions
-- Replaces owner_address (SIWE wallet-based) with owner_id (user-based)

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 1: Drop all RLS policies that depend on owner_address
-- ═══════════════════════════════════════════════════════════════════════════

-- From 00010
DROP POLICY IF EXISTS "signers_select_own" ON signers;
DROP POLICY IF EXISTS "signers_insert_own" ON signers;
DROP POLICY IF EXISTS "signers_update_own" ON signers;
DROP POLICY IF EXISTS "signers_delete_own" ON signers;
DROP POLICY IF EXISTS "policies_select_own" ON policies;
DROP POLICY IF EXISTS "policies_insert_own" ON policies;
DROP POLICY IF EXISTS "policies_update_own" ON policies;
DROP POLICY IF EXISTS "policies_delete_own" ON policies;
DROP POLICY IF EXISTS "signing_requests_select_own" ON signing_requests;

-- From 00011
DROP POLICY IF EXISTS "Service role only" ON encrypted_shares;

-- From 00012 (replacements of the above + extras)
DROP POLICY IF EXISTS "encrypted_shares_select_own" ON encrypted_shares;
DROP POLICY IF EXISTS "encrypted_shares_insert_own" ON encrypted_shares;
DROP POLICY IF EXISTS "encrypted_shares_update_own" ON encrypted_shares;
DROP POLICY IF EXISTS "encrypted_shares_delete_own" ON encrypted_shares;
DROP POLICY IF EXISTS "signer_tokens_select_own" ON signer_tokens;
DROP POLICY IF EXISTS "signer_tokens_insert_own" ON signer_tokens;
DROP POLICY IF EXISTS "signer_tokens_update_own" ON signer_tokens;
DROP POLICY IF EXISTS "signer_tokens_delete_own" ON signer_tokens;
DROP POLICY IF EXISTS "policy_documents_select_own" ON policy_documents;
DROP POLICY IF EXISTS "policy_documents_insert_own" ON policy_documents;
DROP POLICY IF EXISTS "policy_documents_update_own" ON policy_documents;
DROP POLICY IF EXISTS "policy_documents_delete_own" ON policy_documents;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 2: Drop legacy owner_address columns + indexes
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop indexes first (signing_requests has a composite one from 00014)
DROP INDEX IF EXISTS idx_signers_owner_address;
DROP INDEX IF EXISTS idx_signing_requests_owner_address;
DROP INDEX IF EXISTS idx_passkeys_owner_address;
DROP INDEX IF EXISTS idx_signing_requests_owner_created;

ALTER TABLE signers DROP COLUMN IF EXISTS owner_address;
ALTER TABLE signing_requests DROP COLUMN IF EXISTS owner_address;
ALTER TABLE passkeys DROP COLUMN IF EXISTS owner_address;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 3: Add new columns
-- ═══════════════════════════════════════════════════════════════════════════

-- owner_id on signers (links signer to authenticated user)
ALTER TABLE signers ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_signers_owner_id ON signers(owner_id);

-- has_passkey on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_passkey BOOLEAN DEFAULT FALSE;

-- owner_id on signing_requests (audit log filtering by user)
ALTER TABLE signing_requests ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_signing_requests_owner_id ON signing_requests(owner_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 4: Recreate RLS policies using owner_id
-- ═══════════════════════════════════════════════════════════════════════════

-- Signers: owner can only see/modify their own signers
CREATE POLICY "signers_select_own" ON signers
  FOR SELECT USING (
    owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

CREATE POLICY "signers_insert_own" ON signers
  FOR INSERT WITH CHECK (
    owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

CREATE POLICY "signers_update_own" ON signers
  FOR UPDATE USING (
    owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

CREATE POLICY "signers_delete_own" ON signers
  FOR DELETE USING (
    owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

-- Policies: only the signer's owner can manage policies
CREATE POLICY "policies_select_own" ON policies
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "policies_insert_own" ON policies
  FOR INSERT WITH CHECK (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "policies_update_own" ON policies
  FOR UPDATE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "policies_delete_own" ON policies
  FOR DELETE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

-- Signing requests: audit log visible only to signer owner
CREATE POLICY "signing_requests_select_own" ON signing_requests
  FOR SELECT USING (
    owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

-- Encrypted shares: service_role only (table uses path PK, no signer_id column)
CREATE POLICY "encrypted_shares_service_only" ON encrypted_shares
  FOR ALL USING (auth.role() = 'service_role');

-- Signer tokens: scoped to signer owner
CREATE POLICY "signer_tokens_select_own" ON signer_tokens
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "signer_tokens_insert_own" ON signer_tokens
  FOR INSERT WITH CHECK (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "signer_tokens_update_own" ON signer_tokens
  FOR UPDATE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "signer_tokens_delete_own" ON signer_tokens
  FOR DELETE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

-- Policy documents: scoped to signer owner
CREATE POLICY "policy_documents_select_own" ON policy_documents
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "policy_documents_insert_own" ON policy_documents
  FOR INSERT WITH CHECK (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "policy_documents_update_own" ON policy_documents
  FOR UPDATE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

CREATE POLICY "policy_documents_delete_own" ON policy_documents
  FOR DELETE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 5: Share transfers table (CLI ↔ dashboard share linking)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS share_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id UUID NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  initiator_id UUID NOT NULL REFERENCES users(id),
  encrypted_payload TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('cli_to_dashboard', 'dashboard_to_cli')),
  expires_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES users(id),
  claimed_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_transfers_signer_id ON share_transfers(signer_id);
CREATE INDEX IF NOT EXISTS idx_share_transfers_expires ON share_transfers(expires_at) WHERE claimed_at IS NULL;

ALTER TABLE share_transfers ENABLE ROW LEVEL SECURITY;

-- Only the server (service_role) accesses share_transfers; no direct client access.
CREATE POLICY "service_role_all" ON share_transfers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Lock SECURITY DEFINER functions to service_role only ─────────────────────
-- These RPCs bypass RLS. Without REVOKE, any authenticated user could call them
-- against any signer_id via PostgREST `.rpc()`.

REVOKE ALL ON FUNCTION increment_policy_triggered(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_policy_triggered(UUID) TO service_role;

REVOKE ALL ON FUNCTION sum_value_by_signer_in_window(UUID, TIMESTAMPTZ) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION sum_value_by_signer_in_window(UUID, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION sum_usd_by_signer_in_window(UUID, TIMESTAMPTZ) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION sum_usd_by_signer_in_window(UUID, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION activate_policy_draft(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_policy_draft(UUID) TO service_role;

REVOKE ALL ON FUNCTION upsert_policy_document(UUID, JSONB, TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_policy_document(UUID, JSONB, TEXT, TEXT) TO service_role;
