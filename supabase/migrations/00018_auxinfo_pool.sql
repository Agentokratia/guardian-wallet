-- AuxInfo Pool: persistent pre-generated Paillier keypairs + ZK proofs
-- Survives restarts, supports atomic claiming across instances.

-- ═══════════════════════════════════════════════════════════════════════════
-- Table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE auxinfo_pool (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aux_info_json TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at    TIMESTAMPTZ
);

CREATE INDEX idx_auxinfo_pool_unclaimed
  ON auxinfo_pool (created_at) WHERE claimed_at IS NULL;

ALTER TABLE auxinfo_pool ENABLE ROW LEVEL SECURITY;

-- Service-role only (same pattern as encrypted_shares)
CREATE POLICY "auxinfo_pool_service_only" ON auxinfo_pool
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: claim_auxinfo_entry() — atomic FOR UPDATE SKIP LOCKED
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION claim_auxinfo_entry()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _row auxinfo_pool%ROWTYPE;
BEGIN
  SELECT * INTO _row
    FROM auxinfo_pool
   WHERE claimed_at IS NULL
   ORDER BY created_at
   LIMIT 1
     FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE auxinfo_pool
     SET claimed_at = NOW()
   WHERE id = _row.id;

  RETURN _row.aux_info_json;
END;
$$;

REVOKE ALL ON FUNCTION claim_auxinfo_entry() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_auxinfo_entry() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: auxinfo_pool_count() — fast count of unclaimed entries
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auxinfo_pool_count()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*) FROM auxinfo_pool WHERE claimed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION auxinfo_pool_count() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION auxinfo_pool_count() TO service_role;
