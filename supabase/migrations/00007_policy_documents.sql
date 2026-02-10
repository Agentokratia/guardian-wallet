-- CDP-style policy documents: one ordered-rules document per signer.
CREATE TABLE policy_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signer_id UUID NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
    description TEXT,
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    version INTEGER NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(signer_id)
);

-- Index for fast lookup by signer
CREATE INDEX idx_policy_documents_signer_id ON policy_documents(signer_id);

-- Auto-update updated_at on row change
CREATE TRIGGER set_policy_documents_updated_at
    BEFORE UPDATE ON policy_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
