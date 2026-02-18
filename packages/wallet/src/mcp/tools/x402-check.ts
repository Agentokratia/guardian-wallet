import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import { checkX402 } from '../../lib/x402-client.js';

export function registerX402Check(server: McpServer) {
	server.registerTool(
		'guardian_x402_check',
		{
			description:
				'Check if a URL requires x402 payment. Returns payment requirements (scheme, network, amount, asset) for each accepted payment option.',
			inputSchema: {
				url: z.string().url().describe('URL to check for x402 payment requirements'),
			},
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

				if (result.paymentRequired?.accepts?.length) {
					lines.push(`${result.paymentRequired.accepts.length} payment option(s):`);
					lines.push('');
					for (const req of result.paymentRequired.accepts) {
						lines.push(`  Scheme: ${req.scheme}`);
						lines.push(`  Network: ${req.network}`);
						lines.push(`  Amount: ${req.amount}`);
						lines.push(`  Asset: ${req.asset}`);
						lines.push(`  Pay to: ${req.payTo}`);
						if (req.extra && Object.keys(req.extra).length > 0) {
							lines.push(`  Extra: ${JSON.stringify(req.extra)}`);
						}
						lines.push('');
					}
				} else {
					lines.push('Could not parse payment details from response.');
				}

				return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
			} catch (error) {
				return formatError(error, 'x402 check failed');
			}
		},
	);
}
