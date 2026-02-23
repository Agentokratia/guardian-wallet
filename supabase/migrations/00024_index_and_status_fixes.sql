-- 00024: Index and status fixes from review
-- 1. UNIQUE index on signers.api_key_hash (C1: full table scan on every API auth)
-- 2. GIN index on policy_templates.chain_ids (M3: sequential scan for @> operator)
-- 3. Pin search_path on update_updated_at_column() trigger

-- 1. api_key_hash: uniqueness + index in one shot
-- The UNIQUE constraint implicitly creates a btree index
ALTER TABLE signers ADD CONSTRAINT signers_api_key_hash_unique UNIQUE (api_key_hash);

-- 2. GIN index for array containment queries on chain_ids
CREATE INDEX IF NOT EXISTS idx_policy_templates_chain_ids
  ON policy_templates USING GIN (chain_ids);

-- 3. Pin search_path on trigger function (defense-in-depth)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;
