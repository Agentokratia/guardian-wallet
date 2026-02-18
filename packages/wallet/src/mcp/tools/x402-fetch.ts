import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SignerManager } from '../../lib/signer-manager.js';
import { fetchWithX402 } from '../../lib/x402-client.js';

export function registerX402Fetch(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_x402_fetch',
		'Fetch a 402-protected resource, automatically paying with the Guardian threshold signer. If the URL returns HTTP 402, signs a payment authorization and retries. The full private key never exists.',
		{
			url: z.string().url().describe('URL to fetch (may require x402 payment)'),
			maxAmount: z
				.string()
				.optional()
				.describe('Maximum amount willing to pay in token units (default: "1000000" = 1 USDC)'),
			network: z
				.string()
				.optional()
				.describe('Network for payment (e.g. "base-sepolia"). Defaults to GUARDIAN_NETWORK env.'),
		},
		async ({ url, maxAmount, network }) => {
			try {
				const signer = await signerManager.getSigner();
				const targetNetwork = network || signerManager.getNetwork() || 'base-sepolia';

				const result = await fetchWithX402(url, signer, {
					maxAmount,
					network: targetNetwork,
				});

				const lines: string[] = [];
				if (result.paid) {
					lines.push(`Fetched with payment (${result.paymentHash})`);
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
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: 'text' as const, text: `x402 fetch failed: ${msg}` }],
					isError: true,
				};
			}
		},
	);
}
