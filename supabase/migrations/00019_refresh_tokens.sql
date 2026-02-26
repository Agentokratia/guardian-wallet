-- Migration: refresh_tokens table for DB-backed token revocation
-- Replaces in-memory revocation map (lost on server restart)

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (service_key bypasses; anon/authenticated keys cannot access directly)
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Active tokens by user (logout revokes all)
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- Token lookup by hash (validate/rotate) — UNIQUE among active tokens
CREATE UNIQUE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;

-- Cleanup expired tokens
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Cleanup function: delete expired/revoked tokens older than 1 day.
-- Schedule with pg_cron (if available):
--   SELECT cron.schedule('cleanup-refresh-tokens', '0 3 * * *',
--     $$SELECT cleanup_expired_refresh_tokens()$$);
-- Or call periodically from the application layer.
CREATE OR REPLACE FUNCTION cleanup_expired_refresh_tokens()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM refresh_tokens
  WHERE expires_at < NOW() - INTERVAL '1 day'
     OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day');
$$;

-- Lock down cleanup function to service_role only (consistent with 00017 pattern)
REVOKE ALL ON FUNCTION cleanup_expired_refresh_tokens() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_refresh_tokens() TO service_role;
