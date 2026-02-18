import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';
import { fetchWithX402 } from '../../lib/x402-client.js';

export function registerX402Fetch(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_x402_fetch',
		{
			description:
				'Fetch a 402-protected resource, automatically paying with the Guardian threshold signer via the x402 exact scheme (ERC-3009/Permit2). The network and asset are auto-detected from the 402 payment requirements. The full private key never exists.',
			inputSchema: {
				url: z.string().url().describe('URL to fetch (may require x402 payment)'),
				maxAmount: z
					.string()
					.optional()
					.describe(
						'Maximum amount willing to pay in atomic units (e.g., "1000000" = 1 USDC). If omitted, any amount is accepted.',
					),
			},
		},
		async ({ url, maxAmount }) => {
			try {
				const signer = await signerManager.getSigner();

				const result = await fetchWithX402(url, signer, {
					maxAmount,
				});

				const lines: string[] = [];
				if (result.paid) {
					lines.push(`Paid via ${result.scheme || 'exact'} scheme`);
					if (result.transaction) lines.push(`Transaction: ${result.transaction}`);
					if (result.payer) lines.push(`Payer: ${result.payer}`);
				} else {
					lines.push('Fetched (no payment needed)');
				}
				lines.push(`Status: ${result.status}`);
				if (result.contentType) lines.push(`Content-Type: ${result.contentType}`);
				lines.push('');

				// Truncate long bodies
				const body =
					result.body.length > 4000 ? `${result.body.slice(0, 4000)}\n...(truncated)` : result.body;
				lines.push(body);

				return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
			} catch (error) {
				return formatError(error, 'x402 fetch failed');
			}
		},
	);
}
