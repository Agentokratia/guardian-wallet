/**
 * Guardian MCP Server — Full Tool Test (all 19 tools)
 *
 * Usage: tsx --env-file=examples/.env examples/mcp/test-all-tools.ts
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

const client = new Client({ name: 'guardian-full-test', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\n  Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);
console.log('='.repeat(70));

async function call(name: string, args: Record<string, unknown> = {}) {
	console.log(`\n==> ${name}`);
	console.log(`    args: ${JSON.stringify(args)}`);
	try {
		const result = await client.callTool({ name, arguments: args });
		const text = (result.content as Array<{ text: string }>)[0]?.text ?? '(no text)';
		for (const line of text.split('\n')) {
			console.log(`    ${line}`);
		}
		return text;
	} catch (err: unknown) {
		console.log(`    ERROR: ${(err as Error).message}`);
		return null;
	}
}

// ── 1. wallet_overview ──────────────────────────────────────────────
await call('guardian_wallet_overview');

// ── 2. list_networks ────────────────────────────────────────────────
await call('guardian_list_networks');

// ── 3. list_signers ─────────────────────────────────────────────────
await call('guardian_list_signers');

// ── 4. get_status ───────────────────────────────────────────────────
await call('guardian_get_status');

// ── 5. get_balances ─────────────────────────────────────────────────
await call('guardian_get_balances', { network: 'base-sepolia' });

// ── 6. get_policies ─────────────────────────────────────────────────
await call('guardian_get_policies');

// ── 7. get_audit_log ────────────────────────────────────────────────
await call('guardian_get_audit_log', { limit: 3 });

// ── 8. resolve_address ──────────────────────────────────────────────
await call('guardian_resolve_address', {
	addressOrEns: '0x0000000000000000000000000000000000000001',
});

// ── 9. simulate ─────────────────────────────────────────────────────
await call('guardian_simulate', {
	to: '0x0000000000000000000000000000000000000001',
	value: '0.001',
	network: 'base-sepolia',
});

// ── 10. read_contract ───────────────────────────────────────────────
await call('guardian_read_contract', {
	contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
	abi: [
		{
			name: 'symbol',
			type: 'function',
			inputs: [],
			outputs: [{ type: 'string' }],
			stateMutability: 'view',
		},
	],
	functionName: 'symbol',
	network: 'base-sepolia',
});

// ── 11. read_contract (decimals) ────────────────────────────────────
await call('guardian_read_contract', {
	contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
	abi: [
		{
			name: 'decimals',
			type: 'function',
			inputs: [],
			outputs: [{ type: 'uint8' }],
			stateMutability: 'view',
		},
	],
	functionName: 'decimals',
	network: 'base-sepolia',
});

// ── 12. sign_message ────────────────────────────────────────────────
await call('guardian_sign_message', {
	message: `full-test::${new Date().toISOString()}`,
});

// ── 13. sign_typed_data ─────────────────────────────────────────────
await call('guardian_sign_typed_data', {
	domain: {
		name: 'GuardianTest',
		version: '1',
		chainId: 84532,
	},
	types: {
		Test: [{ name: 'message', type: 'string' }],
	},
	primaryType: 'Test',
	message: { message: 'hello from guardian' },
});

// ── 14. send_eth ────────────────────────────────────────────────────
await call('guardian_send_eth', {
	to: '0x0000000000000000000000000000000000000001',
	value: '0.000001',
	network: 'base-sepolia',
});

// ── 15. send_token (will likely fail — no token balance) ────────────
await call('guardian_send_token', {
	token: 'USDC',
	to: '0x0000000000000000000000000000000000000001',
	amount: '0.01',
	network: 'base-sepolia',
});

// ── 16. call_contract (approve USDC — state-changing write call) ────
await call('guardian_call_contract', {
	contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
	abi: [
		{
			name: 'approve',
			type: 'function',
			inputs: [
				{ name: 'spender', type: 'address' },
				{ name: 'amount', type: 'uint256' },
			],
			outputs: [{ type: 'bool' }],
			stateMutability: 'nonpayable',
		},
	],
	functionName: 'approve',
	args: ['0x0000000000000000000000000000000000000001', '1000000'],
	network: 'base-sepolia',
});

// ── 17. execute (raw tx) ────────────────────────────────────────────
await call('guardian_execute', {
	to: '0x0000000000000000000000000000000000000001',
	value: '0.000001',
	data: '0x',
	network: 'base-sepolia',
});

// ── 18. x402_check ──────────────────────────────────────────────────
await call('guardian_x402_check', {
	url: 'https://example.com',
});

// ── 19. x402_discover ───────────────────────────────────────────────
await call('guardian_x402_discover', {
	domain: 'example.com',
});

// ── 20. x402_fetch (will fail — no x402 server) ────────────────────
await call('guardian_x402_fetch', {
	url: 'https://example.com',
	maxAmount: '0.001',
});

console.log(`\n${'='.repeat(70)}`);
console.log(`  Done — tested all ${tools.length} tools.`);
await client.close();
