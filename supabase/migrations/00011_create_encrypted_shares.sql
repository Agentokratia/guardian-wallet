-- Envelope-encrypted share storage (PRD-24: KMS Envelope Encryption)
-- Replaces direct Vault KV for share storage when using envelope encryption.
-- Master key stays in a pluggable KMS; encrypted shares live here.

CREATE TABLE IF NOT EXISTS encrypted_shares (
    path        TEXT PRIMARY KEY,
    envelope    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_encrypted_shares_prefix ON encrypted_shares (path text_pattern_ops);

ALTER TABLE encrypted_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON encrypted_shares
    FOR ALL USING (auth.role() = 'service_role');
