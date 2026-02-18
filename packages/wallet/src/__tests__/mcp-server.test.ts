import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const EXPECTED_TOOLS = [
	// Discovery
	'guardian_wallet_overview',
	'guardian_list_networks',
	'guardian_list_signers',
	'guardian_resolve_address',
	// Common operations
	'guardian_send_eth',
	'guardian_send_token',
	'guardian_get_balances',
	// Advanced
	'guardian_call_contract',
	'guardian_read_contract',
	'guardian_execute',
	'guardian_simulate',
	// Signing
	'guardian_sign_message',
	'guardian_sign_typed_data',
	// Management
	'guardian_get_status',
	'guardian_get_audit_log',
	// x402
	'guardian_x402_check',
	'guardian_x402_discover',
	'guardian_x402_fetch',
];

describe('Guardian Terminal MCP Server', () => {
	let client: Client;
	let transport: StdioClientTransport;

	beforeAll(async () => {
		transport = new StdioClientTransport({
			command: 'node',
			args: ['dist/index.js'],
			cwd: new URL('../../', import.meta.url).pathname,
			env: {
				...process.env,
				// Dummy values — tools/list doesn't invoke the signer
				GUARDIAN_API_SECRET: 'dGVzdA==',
				GUARDIAN_API_KEY: 'gw_test_dummy',
				GUARDIAN_SERVER: 'http://localhost:8080',
			},
		});

		client = new Client({ name: 'test-client', version: '1.0.0' });
		await client.connect(transport);
	}, 15_000);

	afterAll(async () => {
		await client?.close();
	});

	it(`lists exactly ${EXPECTED_TOOLS.length} tools`, async () => {
		const { tools } = await client.listTools();
		expect(tools).toHaveLength(EXPECTED_TOOLS.length);
	});

	it('registers all expected tool names', async () => {
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual([...EXPECTED_TOOLS].sort());
	});

	it('each tool has a description longer than 10 chars', async () => {
		const { tools } = await client.listTools();
		for (const tool of tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.description!.length).toBeGreaterThan(10);
		}
	});

	it('x402 tools have correct input schema', async () => {
		const { tools } = await client.listTools();

		const check = tools.find((t) => t.name === 'guardian_x402_check');
		expect(check).toBeDefined();
		const checkProps = check!.inputSchema.properties as Record<string, unknown>;
		expect(checkProps).toHaveProperty('url');

		const discover = tools.find((t) => t.name === 'guardian_x402_discover');
		expect(discover).toBeDefined();
		const discoverProps = discover!.inputSchema.properties as Record<string, unknown>;
		expect(discoverProps).toHaveProperty('domain');

		const fetchTool = tools.find((t) => t.name === 'guardian_x402_fetch');
		expect(fetchTool).toBeDefined();
		const fetchProps = fetchTool!.inputSchema.properties as Record<string, unknown>;
		expect(fetchProps).toHaveProperty('url');
		expect(fetchProps).toHaveProperty('maxAmount');
	});
});
