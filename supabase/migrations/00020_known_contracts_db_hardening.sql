-- DB hardening for known_contracts and policy_templates.
-- Fixes: CHAR(42)→TEXT with CHECK, missing indexes, missing RLS policies.

-- ─── 1. Fix address column: CHAR(42) → TEXT with CHECK ─────────────────────
-- CHAR pads with spaces and causes subtle comparison bugs.
-- TEXT with CHECK is the Postgres best practice.

ALTER TABLE known_contracts
  ALTER COLUMN address TYPE TEXT;

ALTER TABLE known_contracts
  ADD CONSTRAINT chk_known_contracts_address
  CHECK (length(address) = 42 AND address ~ '^0x[0-9a-fA-F]{40}$');

-- ─── 2. Missing indexes ────────────────────────────────────────────────────
-- address: used in lookups ("is this contract known?")
-- tags: array column needs GIN for @> and && operators

CREATE INDEX IF NOT EXISTS idx_known_contracts_address
  ON known_contracts (address);

CREATE INDEX IF NOT EXISTS idx_known_contracts_tags
  ON known_contracts USING GIN (tags);

-- ─── 3. RLS policies for known_contracts (read-only public data) ───────────
-- RLS is enabled but NO policies exist → non-superuser roles are locked out.
-- These are reference tables: everyone can read, only service_role can write.

CREATE POLICY known_contracts_select_all
  ON known_contracts FOR SELECT
  TO public
  USING (true);

-- ─── 4. RLS policies for policy_templates (read-only public data) ──────────

CREATE POLICY policy_templates_select_all
  ON policy_templates FOR SELECT
  TO public
  USING (true);
