-- Known contracts registry + policy templates for the visual policy builder.
-- Replaces: 00013, 00020 (hardening), partial 00024 (GIN index).

-- ─── Known Contracts ────────────────────────────────────────────────────────

CREATE TABLE known_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL CHECK (length(address) = 42 AND address ~ '^0x[0-9a-fA-F]{40}$'),
    chain_id INTEGER NOT NULL REFERENCES networks(chain_id),
    contract_type TEXT NOT NULL DEFAULT 'router',
    verified BOOLEAN NOT NULL DEFAULT TRUE,
    source TEXT,
    tags TEXT[] DEFAULT '{}',
    added_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A contract address can appear once per chain
ALTER TABLE known_contracts
  ADD CONSTRAINT uq_known_contracts_address_chain UNIQUE (address, chain_id);

CREATE INDEX idx_known_contracts_chain_id ON known_contracts(chain_id);
CREATE INDEX idx_known_contracts_protocol ON known_contracts(protocol);
CREATE INDEX idx_known_contracts_address ON known_contracts(address);
CREATE INDEX idx_known_contracts_tags ON known_contracts USING GIN (tags);

ALTER TABLE known_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY known_contracts_select_all
  ON known_contracts FOR SELECT
  TO public
  USING (true);

-- ─── Policy Templates ───────────────────────────────────────────────────────

CREATE TABLE policy_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    chain_ids INTEGER[] DEFAULT '{}',
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER policy_templates_updated_at
    BEFORE UPDATE ON policy_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_policy_templates_chain_ids
  ON policy_templates USING GIN (chain_ids);

ALTER TABLE policy_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_templates_select_all
  ON policy_templates FOR SELECT
  TO public
  USING (true);
