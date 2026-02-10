-- Multi-tenancy: scope all entities by the wallet address that created them.
-- Tenant key = owner_address (the SIWE-authenticated wallet).

-- 1. Signers: add owner_address (direct tenant ownership)
ALTER TABLE signers ADD COLUMN owner_address TEXT;

UPDATE signers
SET owner_address = '0x0000000000000000000000000000000000000000'
WHERE owner_address IS NULL;

ALTER TABLE signers ALTER COLUMN owner_address SET NOT NULL;

CREATE INDEX idx_signers_owner_address ON signers(owner_address);

-- 2. Passkeys: add owner_address
ALTER TABLE passkeys ADD COLUMN owner_address TEXT;

UPDATE passkeys
SET owner_address = '0x0000000000000000000000000000000000000000'
WHERE owner_address IS NULL;

ALTER TABLE passkeys ALTER COLUMN owner_address SET NOT NULL;

CREATE INDEX idx_passkeys_owner_address ON passkeys(owner_address);

-- 3. Signing requests: denormalized owner_address for fast tenant-scoped audit queries
ALTER TABLE signing_requests ADD COLUMN owner_address TEXT;

UPDATE signing_requests
SET owner_address = COALESCE(
  (SELECT s.owner_address FROM signers s WHERE s.id = signing_requests.signer_id),
  '0x0000000000000000000000000000000000000000'
);

ALTER TABLE signing_requests ALTER COLUMN owner_address SET NOT NULL;

CREATE INDEX idx_signing_requests_owner_address ON signing_requests(owner_address);
