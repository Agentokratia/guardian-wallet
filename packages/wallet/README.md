# @agentokratia/guardian-wallet

**Guardian Wallet CLI + MCP Server -- threshold signing for AI agents.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](../../LICENSE-APACHE)
[![npm](https://img.shields.io/npm/v/@agentokratia/guardian-wallet)](https://www.npmjs.com/package/@agentokratia/guardian-wallet)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933.svg)](https://nodejs.org)

CLI and [MCP](https://modelcontextprotocol.io/) server for [Guardian Wallet](https://github.com/agentokratia/guardian-wallet). Gives AI agents (Claude, GPT, custom) secure on-chain spending power through threshold ECDSA -- the full private key never exists.

## Install

```bash
npm install -g @agentokratia/guardian-wallet
# or
npx @agentokratia/guardian-wallet --help
```

## Quick Start

```bash
# Create a new signer (no dashboard required)
gw init

# Check status
gw status

# Send ETH
gw send 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 0.001

# Manage policies
gw admin unlock
gw admin policies
```

`gw init` walks you through everything interactively -- create a new signer on the server, or import an existing one from the dashboard.

## CLI

```bash
gw --help
```

### Commands

| Command | Description |
|---------|-------------|
| `gw init` | Create a new signer or import an existing one |
| `gw status` | Show signer info, server health, and balances |
| `gw info` | Show raw signer config (debug) |
| `gw balance` | Show ETH and token balances |
| `gw send <to> <amount>` | Send ETH to an address |
| `gw sign-message <message>` | Sign a message (EIP-191) |
| `gw deploy <bytecode>` | Deploy a contract |
| `gw proxy` | Start a JSON-RPC signing proxy for Foundry/Hardhat |
| `gw admin` | Admin commands (policies, pause/resume, audit) |

### Multi-Signer

Each signer gets its own config file under `~/.guardian-wallet/signers/`.

```bash
# Create multiple signers
gw init               # creates "my-agent"
gw init               # creates "trading-bot"

# Use a specific signer
gw --signer trading-bot send 0x... 0.01
gw --signer my-agent balance

# Default signer is auto-detected (single signer) or set during init
```

### Admin Commands

Manage policies, pause/resume, and view audit logs for your signers. Requires an admin unlock (user share from OS keychain).

```bash
# Unlock admin access (retrieves user share from keychain, computes auth token)
gw admin unlock

# Policy management
gw admin policies                    # list policies
gw admin policies add                # interactive policy creation
gw admin policies remove <id>        # remove a policy
gw admin policies toggle <id>        # enable/disable a policy

# Signer control
gw admin pause                       # pause signer (blocks all signing)
gw admin resume                      # resume signer

# Audit log
gw admin audit                       # last 20 signing requests
gw admin audit --limit 50            # more results
gw admin audit --status blocked      # filter by status

# Lock admin (remove token from disk)
gw admin lock
```

### Config Layout

```
~/.guardian-wallet/
  signers/
    my-agent.json           # { serverUrl, apiKey, apiSecret, network, ... }
    trading-bot.json
  admin/
    my-agent.token          # SHA-256(userShare) -- admin auth credential
  .default                  # default signer name

OS Keychain (service: guardian-wallet):
  my-agent/user-share       # user share for admin auth + backup signing
```

## MCP Server

When invoked with no arguments, runs as an MCP server over stdio. This lets AI agents interact with the wallet through the [Model Context Protocol](https://modelcontextprotocol.io/).

### 18 Tools

| Tool | Description |
|------|-------------|
| `guardian_wallet_overview` | Wallet address, balances, recent activity |
| `guardian_list_signers` | List all signers |
| `guardian_get_status` | Server health and vault connectivity |
| `guardian_list_networks` | Available networks and chain IDs |
| `guardian_get_balances` | ETH and token balances |
| `guardian_get_audit_log` | Transaction history and audit trail |
| `guardian_resolve_address` | Resolve ENS names or validate addresses |
| `guardian_simulate` | Simulate a transaction (gas estimate) |
| `guardian_read_contract` | Read from any smart contract |
| `guardian_sign_message` | Sign an EIP-191 message |
| `guardian_sign_typed_data` | Sign EIP-712 typed data |
| `guardian_send_eth` | Send ETH to an address |
| `guardian_send_token` | Send ERC-20 tokens |
| `guardian_call_contract` | Call any smart contract function |
| `guardian_execute` | Execute a raw transaction |
| `guardian_x402_check` | Check if a URL requires x402 payment |
| `guardian_x402_discover` | Discover x402-protected endpoints |
| `guardian_x402_fetch` | Fetch a 402-protected resource with auto-payment |

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "guardian-wallet": {
      "command": "npx",
      "args": ["@agentokratia/guardian-wallet"],
      "env": {
        "GUARDIAN_API_SECRET": "your-base64-share",
        "GUARDIAN_API_KEY": "gw_live_...",
        "GUARDIAN_SERVER": "http://localhost:8080"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "guardian-wallet": {
      "command": "npx",
      "args": ["@agentokratia/guardian-wallet"],
      "env": {
        "GUARDIAN_API_SECRET": "your-base64-share",
        "GUARDIAN_API_KEY": "gw_live_...",
        "GUARDIAN_SERVER": "http://localhost:8080"
      }
    }
  }
}
```

### From Source (development)

```json
{
  "mcpServers": {
    "guardian-wallet": {
      "command": "node",
      "args": ["packages/wallet/dist/index.js"],
      "env": {
        "GUARDIAN_API_SECRET": "your-base64-share",
        "GUARDIAN_API_KEY": "gw_live_...",
        "GUARDIAN_SERVER": "http://localhost:8080"
      }
    }
  }
}
```

## JSON-RPC Proxy

The `gw proxy` command starts a local HTTP server that acts as an Ethereum JSON-RPC endpoint. It intercepts signing methods (`eth_sendTransaction`, `eth_signTransaction`, `eth_sign`, `personal_sign`) and routes them through Guardian's threshold signing, while forwarding all other calls to the upstream RPC.

```bash
gw proxy --port 8545 --rpc-url https://sepolia.base.org

# Use with Foundry
forge script Deploy.s.sol --rpc-url http://localhost:8545

# Use with cast
cast send 0x... "transfer(address,uint256)" 0x... 1000000 --rpc-url http://localhost:8545
```

## x402 Payment Support

Built-in support for the [x402 payment protocol](https://www.x402.org/). AI agents can discover, check, and pay for 402-protected resources automatically.

```bash
# Check if a URL requires payment
# (via MCP: guardian_x402_check)

# Discover protected endpoints on a domain
# (via MCP: guardian_x402_discover)

# Fetch and auto-pay
# (via MCP: guardian_x402_fetch)
```

## Environment Variables

Environment variables are an alternative to file-based config. Useful for CI/CD, Docker, or MCP server mode.

| Variable | Description | Required |
|----------|-------------|----------|
| `GUARDIAN_API_SECRET` | Base64-encoded signer key share | Yes |
| `GUARDIAN_SERVER` | Server URL (e.g. `http://localhost:8080`) | Yes |
| `GUARDIAN_API_KEY` | API key for authentication | Yes |
| `GUARDIAN_NETWORK` | Default network name (e.g. `base-sepolia`, `mainnet`) | No |

## Security

- The full private key **never exists** -- not in memory, not on disk, not ever
- Signing is a distributed MPC protocol between your signer share and the server share
- Signer share stored in config file (`chmod 600`)
- User share stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret)
- Admin auth uses a Bitwarden-model double hash -- server never stores raw credentials
- Server shares wiped from memory after every operation

## License

Apache-2.0 -- see [LICENSE-APACHE](../../LICENSE-APACHE).
