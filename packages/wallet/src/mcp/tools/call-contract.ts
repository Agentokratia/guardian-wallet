import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { encodeFunctionData, parseEther } from 'viem';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerCallContract(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_call_contract',
		{
			description:
				'Call a function on any smart contract using Guardian threshold signing (2-of-3 MPC). Provide the contract ABI, function name, and arguments. The full private key never exists. Use guardian_simulate first to estimate gas.',
			inputSchema: {
				contractAddress: z
					.string()
					.regex(/^0x[0-9a-fA-F]{40}$/)
					.describe('Contract address (0x...)'),
				abi: z
					.array(z.record(z.unknown()))
					.describe('Contract ABI (JSON array of function/event definitions)'),
				functionName: z
					.string()
					.describe('Name of the function to call (e.g. "swap", "approve", "mint")'),
				args: z
					.array(z.unknown())
					.optional()
					.default([])
					.describe('Function arguments as an ordered array'),
				value: z
					.string()
					.optional()
					.describe('ETH value to send with the call, in ETH (e.g. "0.1"). Defaults to "0".'),
				network: z
					.string()
					.optional()
					.describe(
						'Network name from guardian_list_networks (e.g. "base-sepolia", "mainnet", "arbitrum"). Required — call guardian_list_networks first if unknown.',
					),
			},
		},
		async ({ contractAddress, abi, functionName, args, value, network }) => {
			const api = signerManager.getApi();
			const signer = await signerManager.getSigner();
			const targetNetwork = signerManager.requireNetwork(network);

			try {
				const data = encodeFunctionData({ abi, functionName, args });

				const result = await signer.signTransaction({
					to: contractAddress,
					data,
					network: targetNetwork,
					value: value ? parseEther(value).toString() : '0',
				});

				const explorer = await api.getExplorerTxUrl(targetNetwork, result.txHash);
				return {
					content: [
						{
							type: 'text' as const,
							text: [
								'Contract call successful.',
								`Function: ${functionName}`,
								`Contract: ${contractAddress}`,
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
				return formatError(error, `Contract call ${functionName}() failed`);
			}
		},
	);
}
