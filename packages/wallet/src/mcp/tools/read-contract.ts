import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { http, createPublicClient } from 'viem';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

function bigIntReplacer(_key: string, value: unknown) {
	return typeof value === 'bigint' ? value.toString() : value;
}

export function registerReadContract(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_read_contract',
		{
			description:
				'Read data from a smart contract (view/pure functions). No gas spent, no signing needed. Use this for checking balances, prices, allowances, or any on-chain state.',
			inputSchema: {
				contractAddress: z
					.string()
					.regex(/^0x[0-9a-fA-F]{40}$/)
					.describe('Contract address (0x...)'),
				abi: z
					.array(z.record(z.unknown()))
					.describe('Contract ABI (JSON array). Can be just the relevant function fragment.'),
				functionName: z
					.string()
					.describe('Name of the view/pure function to call (e.g. "balanceOf", "totalSupply")'),
				args: z
					.array(z.unknown())
					.optional()
					.default([])
					.describe('Function arguments as an ordered array'),
				network: z
					.string()
					.optional()
					.describe(
						'Network name from guardian_list_networks (e.g. "base-sepolia", "mainnet", "arbitrum"). Required — call guardian_list_networks first if unknown.',
					),
			},
		},
		async ({ contractAddress, abi, functionName, args, network }) => {
			const api = signerManager.getApi();
			const targetNetwork = signerManager.requireNetwork(network);
			const rpcUrl = await api.getRpcUrl(targetNetwork);
			const client = createPublicClient({ transport: http(rpcUrl) });

			try {
				const result = await client.readContract({
					address: contractAddress as `0x${string}`,
					abi,
					functionName,
					args,
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: [
								'Contract read successful.',
								`Function: ${functionName}`,
								`Contract: ${contractAddress}`,
								`Result: ${JSON.stringify(result, bigIntReplacer)}`,
							].join('\n'),
						},
					],
				};
			} catch (error) {
				return formatError(error, 'Read failed');
			}
		},
	);
}
