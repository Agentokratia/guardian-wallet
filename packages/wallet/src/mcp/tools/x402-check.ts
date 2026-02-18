import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkX402 } from '../../lib/x402-client.js';

export function registerX402Check(server: McpServer) {
	server.tool(
		'guardian_x402_check',
		'Check if a URL requires x402 payment. Returns payment requirements (scheme, network, amount) if 402 is returned, or confirms the URL is freely accessible.',
		{
			url: z.string().url().describe('URL to check for x402 payment requirements'),
		},
		async ({ url }) => {
			try {
				const result = await checkX402(url);

				if (!result.requires402) {
					return {
						content: [{ type: 'text' as const, text: `${url} is freely accessible (no 402).` }],
					};
				}

				const lines = ['Payment required (HTTP 402):'];
				if (result.paymentDetails) {
					const pd = result.paymentDetails;
					lines.push(`Scheme: ${pd.scheme}`);
					lines.push(`Network: ${pd.network}`);
					lines.push(`Amount: ${pd.maxAmountRequired}`);
					if (pd.payTo) lines.push(`Pay to: ${pd.payTo}`);
					if (pd.description) lines.push(`Description: ${pd.description}`);
				}

				return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: 'text' as const, text: `x402 check failed: ${msg}` }],
					isError: true,
				};
			}
		},
	);
}
