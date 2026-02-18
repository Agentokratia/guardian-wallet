/**
 * Guardian MCP Server — Tool Smoke Test
 *
 * Connects to the Guardian MCP server via stdio and exercises tools
 * from all 3 tiers (Universal, Sugar, Signing & Info).
 * Run after starting the Guardian server on :8080.
 *
 * Usage:
 *   pnpm example:mcp
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
	command: 'node',
	args: ['packages/wallet/dist/index.js'],
	env: {
		...process.env,
		GUARDIAN_API_SECRET: process.env.GUARDIAN_API_SECRET as string,
		GUARDIAN_API_KEY: process.env.GUARDIAN_API_KEY as string,
		GUARDIAN_SERVER: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	},
});

const client = new Client({ name: 'guardian-test', version: '1.0.0' });
await client.connect(transport);

// List available tools — should be 19
const { tools } = await client.listTools();
console.log(`\n  Available tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}\n`);

// -- Tier 3: Info -----------------------------------------------------------
console.log('==> guardian_get_status');
const status = await client.callTool({ name: 'guardian_get_status', arguments: {} });
console.log(`    ${(status.content as Array<{ text: string }>)[0]?.text}\n`);

console.log('==> guardian_get_balances (base-sepolia)');
const balance = await client.callTool({
	name: 'guardian_get_balances',
	arguments: { network: 'base-sepolia' },
});
console.log(`    ${(balance.content as Array<{ text: string }>)[0]?.text}\n`);

console.log('==> guardian_list_signers');
const signers = await client.callTool({ name: 'guardian_list_signers', arguments: {} });
console.log(`    ${(signers.content as Array<{ text: string }>)[0]?.text}\n`);

// -- Tier 3: Signing --------------------------------------------------------
console.log('==> guardian_sign_message');
const signed = await client.callTool({
	name: 'guardian_sign_message',
	arguments: { message: `mcp-test::${new Date().toISOString()}` },
});
console.log(`    ${(signed.content as Array<{ text: string }>)[0]?.text}\n`);

// -- Tier 1: Read contract (no signing) -------------------------------------
console.log('==> guardian_read_contract (USDC totalSupply on Base Sepolia)');
const read = await client.callTool({
	name: 'guardian_read_contract',
	arguments: {
		contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on Base Sepolia
		abi: [
			{
				name: 'totalSupply',
				type: 'function',
				inputs: [],
				outputs: [{ type: 'uint256' }],
				stateMutability: 'view',
			},
		],
		functionName: 'totalSupply',
		network: 'base-sepolia',
	},
});
console.log(`    ${(read.content as Array<{ text: string }>)[0]?.text}\n`);

// -- Tier 3: Simulate -------------------------------------------------------
console.log('==> guardian_simulate (0.001 ETH to burn address)');
const sim = await client.callTool({
	name: 'guardian_simulate',
	arguments: {
		to: '0x0000000000000000000000000000000000000001',
		value: '0.001',
		network: 'base-sepolia',
	},
});
console.log(`    ${(sim.content as Array<{ text: string }>)[0]?.text}\n`);

// -- Tier 2: Send ETH -------------------------------------------------------
console.log('==> guardian_send_eth (0.000001 ETH on base-sepolia)');
const tx = await client.callTool({
	name: 'guardian_send_eth',
	arguments: {
		to: '0x0000000000000000000000000000000000000001',
		value: '0.000001',
		network: 'base-sepolia',
	},
});
console.log(`    ${(tx.content as Array<{ text: string }>)[0]?.text}\n`);

await client.close();
console.log('  All MCP tools tested successfully.');
