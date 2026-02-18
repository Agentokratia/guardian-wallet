import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerResolveAddress(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_resolve_address',
		'Resolve an ENS name (e.g. "vitalik.eth") to an Ethereum address. Useful before sending transactions to human-readable names.',
		{
			addressOrEns: z.string().describe('ENS name (e.g. "vitalik.eth") or 0x address to resolve'),
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
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Address resolution failed: ${msg}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
