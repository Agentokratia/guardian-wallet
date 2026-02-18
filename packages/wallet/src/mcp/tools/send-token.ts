import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { http, createPublicClient, encodeFunctionData, parseUnits } from 'viem';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

const ERC20_ABI = [
	{
		name: 'transfer',
		type: 'function',
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ type: 'bool' }],
		stateMutability: 'nonpayable',
	},
	{
		name: 'decimals',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint8' }],
		stateMutability: 'view',
	},
	{
		name: 'symbol',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'string' }],
		stateMutability: 'view',
	},
] as const;

export function registerSendToken(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_send_token',
		'Send ERC-20 tokens by symbol (e.g. "USDC", "WETH") or contract address. Supports ENS names for recipients. Automatically handles decimal conversion. The full private key never exists.',
		{
			token: z
				.string()
				.describe(
					'Token symbol (e.g. "USDC", "WETH") or contract address (0x...). Symbols are resolved from the server\'s tracked token list.',
				),
			to: z.string().describe('Recipient — 0x address or ENS name (e.g. "vitalik.eth")'),
			amount: z
				.string()
				.describe('Amount in human-readable units (e.g. "100" for 100 USDC, "0.5" for 0.5 WETH)'),
			network: z
				.string()
				.optional()
				.describe(
					'Network to send on (e.g. "base-sepolia", "mainnet"). Call guardian_list_networks to see options.',
				),
		},
		async ({ token, to, amount, network }) => {
			const api = signerManager.getApi();
			const signer = await signerManager.getSigner();
			const targetNetwork = signerManager.requireNetwork(network);

			try {
				// Resolve recipient (ENS or 0x)
				const resolved = await api.resolveAddress(to);

				// Get default signer for token resolution
				const defaultSigner = await api.getDefaultSigner();

				// Get chainId for this network
				const chainId = await api.getChainId(targetNetwork);

				let tokenAddress: `0x${string}`;
				let symbol: string;
				let decimals: number;

				const tokenResolved = await api.resolveToken(token, defaultSigner.id, chainId);
				tokenAddress = tokenResolved.address;

				if (tokenResolved.resolvedBySymbol) {
					// Got everything from server registry
					symbol = tokenResolved.symbol;
					decimals = tokenResolved.decimals;
				} else {
					// Raw address — read decimals & symbol from chain
					const rpcUrl = await api.getRpcUrl(targetNetwork);
					const publicClient = createPublicClient({
						transport: http(rpcUrl),
					});

					[decimals, symbol] = await Promise.all([
						publicClient.readContract({
							address: tokenAddress,
							abi: ERC20_ABI,
							functionName: 'decimals',
						}),
						publicClient
							.readContract({
								address: tokenAddress,
								abi: ERC20_ABI,
								functionName: 'symbol',
							})
							.catch(() => 'TOKEN'),
					]);
				}

				const rawAmount = parseUnits(amount, decimals);
				const data = encodeFunctionData({
					abi: ERC20_ABI,
					functionName: 'transfer',
					args: [resolved.address, rawAmount],
				});

				const result = await signer.signTransaction({
					to: tokenAddress,
					data,
					value: '0',
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
								`Sent ${amount} ${symbol} successfully.`,
								`To: ${recipientDisplay}`,
								`Token: ${symbol} (${tokenAddress})`,
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
				return formatError(error, 'Token send failed');
			}
		},
	);
}
