import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerResolveAddress(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_resolve_address',
		{
			description:
				'Resolve an ENS name (e.g. "vitalik.eth") to an Ethereum address. Useful before sending transactions to human-readable names.',
			inputSchema: {
				addressOrEns: z.string().describe('ENS name (e.g. "vitalik.eth") or 0x address to resolve'),
			},
		},
		async ({ addressOrEns }) => {
			const api = signerManager.getApi();

			try {
				const result = await api.resolveAddress(addressOrEns);

				if (result.isEns) {
					return {
						content: [
							{
								type: 'text' as const,
								text: `${result.ensName} → ${result.address}`,
							},
						],
					};
				}

				return {
					content: [
						{
							type: 'text' as const,
							text: `${result.address} (already a valid address)`,
						},
					],
				};
			} catch (error) {
				return formatError(error, 'Address resolution failed');
			}
		},
	);
}
