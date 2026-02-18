import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { discoverX402 } from '../../lib/x402-client.js';

export function registerX402Discover(server: McpServer) {
	server.tool(
		'guardian_x402_discover',
		'Discover x402-protected endpoints on a domain. Probes common paths and the .well-known/x402 endpoint to find paid resources.',
		{
			domain: z
				.string()
				.describe('Domain to probe (e.g. "api.example.com" or "https://api.example.com")'),
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
					lines.push(`  Scheme: ${ep.scheme}  Amount: ${ep.maxAmount}`);
					if (ep.description) lines.push(`  ${ep.description}`);
					lines.push('');
				}

				return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: 'text' as const, text: `x402 discovery failed: ${msg}` }],
					isError: true,
				};
			}
		},
	);
}
