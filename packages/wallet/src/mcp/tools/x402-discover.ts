import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import { discoverX402 } from '../../lib/x402-client.js';

export function registerX402Discover(server: McpServer) {
	server.registerTool(
		'guardian_x402_discover',
		{
			description:
				'Discover x402-protected endpoints on a domain. Probes common paths and the .well-known/x402 endpoint to find paid resources. Returns scheme, network, amount, and asset for each endpoint.',
			inputSchema: {
				domain: z
					.string()
					.describe('Domain to probe (e.g., "api.example.com" or "https://api.example.com")'),
			},
		},
		async ({ domain }) => {
			try {
				const result = await discoverX402(domain);

				if (result.endpoints.length === 0) {
					return {
						content: [{ type: 'text' as const, text: `No x402 endpoints found on ${domain}.` }],
					};
				}

				const lines = [`Found ${result.endpoints.length} x402 endpoint(s) on ${domain}:`, ''];
				for (const ep of result.endpoints) {
					lines.push(`${ep.method} ${ep.path}`);
					if (ep.scheme) lines.push(`  Scheme: ${ep.scheme}`);
					if (ep.network) lines.push(`  Network: ${ep.network}`);
					if (ep.amount) lines.push(`  Amount: ${ep.amount}`);
					if (ep.asset) lines.push(`  Asset: ${ep.asset}`);
					if (ep.description) lines.push(`  ${ep.description}`);
					lines.push('');
				}

				return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
			} catch (error) {
				return formatError(error, 'x402 discovery failed');
			}
		},
	);
}
