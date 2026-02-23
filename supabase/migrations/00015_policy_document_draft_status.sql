-- Add draft/active status to policy_documents for draft/deploy workflow.
-- A signer can have one draft and one active policy at the same time.

ALTER TABLE policy_documents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active')),
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Drop old unique constraint on signer_id (was 1:1, now can have draft + active)
ALTER TABLE policy_documents
  DROP CONSTRAINT IF EXISTS policy_documents_signer_id_key;

-- New unique: one doc per signer per status
CREATE UNIQUE INDEX IF NOT EXISTS policy_documents_signer_status_idx
  ON policy_documents (signer_id, status);
