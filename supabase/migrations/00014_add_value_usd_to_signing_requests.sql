-- Add USD value tracking to signing_requests for accurate historical spend aggregation.
-- Stores the USD value at time of signing so rolling limits use consistent prices.

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS value_usd NUMERIC;

-- RPC function for server-side USD spend aggregation
CREATE OR REPLACE FUNCTION sum_usd_by_signer_in_window(
  p_signer_id UUID,
  p_window_start TIMESTAMPTZ
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(value_usd), 0)
  FROM signing_requests
  WHERE signer_id = p_signer_id
    AND status IN ('approved', 'broadcast')
    AND created_at >= p_window_start
    AND value_usd IS NOT NULL;
$$ LANGUAGE sql STABLE;
