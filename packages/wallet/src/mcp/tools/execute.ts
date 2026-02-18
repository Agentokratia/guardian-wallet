import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseEther } from 'viem';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerExecute(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_execute',
		{
			description:
				'Execute a raw Ethereum transaction with pre-encoded calldata using Guardian threshold signing. For advanced use cases where you already have the encoded transaction data.',
			inputSchema: {
				to: z
					.string()
					.regex(/^0x[0-9a-fA-F]{40}$/)
					.describe('Target address (0x...)'),
				data: z
					.string()
					.regex(/^0x[0-9a-fA-F]*$/)
					.describe('Pre-encoded calldata as hex string (0x...)'),
				value: z
					.string()
					.optional()
					.describe('ETH value to send, in ETH (e.g. "0.1"). Defaults to "0".'),
				network: z
					.string()
					.optional()
					.describe(
						'Network name from guardian_list_networks (e.g. "base-sepolia", "mainnet", "arbitrum"). Required — call guardian_list_networks first if unknown.',
					),
			},
		},
		async ({ to, data, value, network }) => {
			const api = signerManager.getApi();
			const signer = await signerManager.getSigner();
			const targetNetwork = signerManager.requireNetwork(network);

			try {
				const result = await signer.signTransaction({
					to,
					data,
					value: value ? parseEther(value).toString() : '0',
					network: targetNetwork,
				});

				const explorer = await api.getExplorerTxUrl(targetNetwork, result.txHash);
				return {
					content: [
						{
							type: 'text' as const,
							text: [
								'Transaction executed.',
								`To: ${to}`,
								`Tx Hash: ${result.txHash}`,
								`Network: ${targetNetwork}`,
								explorer ? `Explorer: ${explorer}` : '',
							]
								.filter(Boolean)
								.join('\n'),
						},
					],
				};
			} catch (error) {
				return formatError(error, 'Transaction execution failed');
			}
		},
	);
}
