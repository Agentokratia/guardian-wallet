import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseEther } from 'viem';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerSendEth(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_send_eth',
		'Send ETH to any address or ENS name (e.g. "vitalik.eth"). Uses Guardian threshold signing — the full private key never exists. Policy-enforced by the server.',
		{
			to: z.string().describe('Recipient — 0x address or ENS name (e.g. "vitalik.eth")'),
			value: z.string().describe('Amount in ETH (e.g. "0.01", "1.5")'),
			network: z
				.string()
				.optional()
				.describe(
					'Network to send on (e.g. "base-sepolia", "mainnet"). Call guardian_list_networks to see options.',
				),
		},
		async ({ to, value, network }) => {
			const api = signerManager.getApi();
			const signer = await signerManager.getSigner();
			const targetNetwork = signerManager.requireNetwork(network);

			try {
				const resolved = await api.resolveAddress(to);

				const result = await signer.signTransaction({
					to: resolved.address,
					value: parseEther(value).toString(),
					network: targetNetwork,
				});

				const explorer = await api.getExplorerTxUrl(targetNetwork, result.txHash);
				const recipientDisplay = resolved.isEns
					? `${resolved.ensName} (${resolved.address})`
					: resolved.address;

				return {
					content: [
						{
							type: 'text' as const,
							text: [
								`Sent ${value} ETH successfully.`,
								`To: ${recipientDisplay}`,
								`Tx Hash: ${result.txHash}`,
								`Network: ${targetNetwork}`,
								explorer !== result.txHash ? `Explorer: ${explorer}` : '',
							]
								.filter(Boolean)
								.join('\n'),
						},
					],
				};
			} catch (error) {
				return formatError(error, 'ETH send failed');
			}
		},
	);
}
