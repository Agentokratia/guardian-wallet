import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { SignerManager } from '../lib/signer-manager.js';

import { registerListNetworks } from './tools/list-networks.js';
import { registerListSigners } from './tools/list-signers.js';
import { registerResolveAddress } from './tools/resolve-address.js';
// Discovery
import { registerWalletOverview } from './tools/wallet-overview.js';

import { registerGetBalances } from './tools/get-balances.js';
// Common operations
import { registerSendEth } from './tools/send-eth.js';
import { registerSendToken } from './tools/send-token.js';

// Advanced — contract interaction
import { registerCallContract } from './tools/call-contract.js';
import { registerExecute } from './tools/execute.js';
import { registerReadContract } from './tools/read-contract.js';
import { registerSimulate } from './tools/simulate.js';

// Signing
import { registerSignMessage } from './tools/sign-message.js';
import { registerSignTypedData } from './tools/sign-typed-data.js';

import { registerGetAuditLog } from './tools/get-audit-log.js';
// Management & Audit
import { registerGetStatus } from './tools/get-status.js';

// x402 payment tools
import { registerX402Check } from './tools/x402-check.js';
import { registerX402Discover } from './tools/x402-discover.js';
import { registerX402Fetch } from './tools/x402-fetch.js';

/**
 * Start the Guardian MCP server with all tools.
 * Connects via stdio transport.
 */
export async function runMcp() {
	const server = new McpServer({
		name: 'guardian',
		version: '0.1.0',
	});

	const signerManager = new SignerManager();

	// Discovery — the LLM should call these first
	registerWalletOverview(server, signerManager);
	registerListNetworks(server, signerManager);
	registerListSigners(server, signerManager);
	registerResolveAddress(server, signerManager);

	// Common operations — web2-style
	registerSendEth(server, signerManager);
	registerSendToken(server, signerManager);
	registerGetBalances(server, signerManager);

	// Advanced — arbitrary contract interaction
	registerCallContract(server, signerManager);
	registerReadContract(server, signerManager);
	registerExecute(server, signerManager);
	registerSimulate(server, signerManager);

	// Signing
	registerSignMessage(server, signerManager);
	registerSignTypedData(server, signerManager);

	// Management & Audit
	registerGetStatus(server, signerManager);
	registerGetAuditLog(server, signerManager);

	// x402 payment tools
	registerX402Check(server);
	registerX402Discover(server);
	registerX402Fetch(server, signerManager);

	// Graceful shutdown — wipe key material
	const shutdown = () => {
		signerManager.destroy();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	// Connect via stdio
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
