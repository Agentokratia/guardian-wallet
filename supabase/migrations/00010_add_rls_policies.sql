-- Row-Level Security policies for all tables.
-- The server uses the service_role key (bypasses RLS), so these protect
-- against any direct Supabase client access or future browser-side queries.

-- ═══════════════════════════════════════════════════════════════════════════
-- SIGNERS: owner can only see/modify their own signers
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "signers_select_own" ON signers
  FOR SELECT USING (
    owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
  );

CREATE POLICY "signers_insert_own" ON signers
  FOR INSERT WITH CHECK (
    owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
  );

CREATE POLICY "signers_update_own" ON signers
  FOR UPDATE USING (
    owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
  );

CREATE POLICY "signers_delete_own" ON signers
  FOR DELETE USING (
    owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- POLICIES: only the signer's owner can manage policies
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "policies_select_own" ON policies
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

CREATE POLICY "policies_insert_own" ON policies
  FOR INSERT WITH CHECK (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

CREATE POLICY "policies_update_own" ON policies
  FOR UPDATE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

CREATE POLICY "policies_delete_own" ON policies
  FOR DELETE USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- SIGNING_REQUESTS: audit log visible only to signer owner
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "signing_requests_select_own" ON signing_requests
  FOR SELECT USING (
    signer_id IN (
      SELECT id FROM signers
      WHERE owner_address = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- Only the server inserts signing requests (service_role bypasses RLS)
-- No insert/update/delete policies needed for authenticated role.

-- ═══════════════════════════════════════════════════════════════════════════
-- AUTH TABLES: enable RLS
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkey_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
-- PASSKEYS: users can only see their own passkeys
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "passkeys_select_own" ON passkey_credentials
  FOR SELECT USING (
    user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- NETWORKS: readable by all authenticated users (public config)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "networks_select_all" ON networks
  FOR SELECT USING (true);

-- Only admins (service_role) can modify networks.
