# NOTE: This config is ignored when Vault runs in dev mode (VAULT_DEV_ROOT_TOKEN_ID set).
# The docker-compose.yml runs Vault in dev mode for local development.
# For production, remove the VAULT_DEV_* env vars and Vault will use this config instead.

storage "file" {
  path = "/vault/data"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}

api_addr = "http://0.0.0.0:8200"
ui       = true
