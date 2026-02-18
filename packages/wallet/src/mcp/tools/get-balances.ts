import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { http, createPublicClient, formatUnits } from 'viem';
import { z } from 'zod';
import { ERC20_ABI } from '../../lib/erc20-abi.js';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerGetBalances(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_get_balances',
		{
			description:
				'Get the ETH balance and optionally ERC-20 token balances of the Guardian threshold wallet. Returns balances across all configured networks.',
			inputSchema: {
				tokens: z
					.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/))
					.optional()
					.describe(
						'Optional list of ERC-20 token addresses to check (0x...). If omitted, returns ETH balance only.',
					),
				network: z
					.string()
					.optional()
					.describe(
						'Network name from guardian_list_networks (e.g. "base-sepolia", "mainnet", "arbitrum"). Required — call guardian_list_networks first if unknown.',
					),
			},
		},
		async ({ tokens, network }) => {
			const api = signerManager.getApi();
			const targetNetwork = signerManager.requireNetwork(network);

			try {
				const defaultSigner = await api.getDefaultSigner();
				const lines = [`Address: ${defaultSigner.ethAddress}`, `Network: ${targetNetwork}`];

				try {
					const balance = await api.getBalance(defaultSigner.id, targetNetwork);

					for (const nb of balance.balances) {
						const label = balance.balances.length > 1 ? `ETH (${nb.network})` : 'ETH';
						if (nb.rpcError) {
							lines.push(`${label}: RPC error`);
						} else {
							lines.push(`${label}: ${formatUnits(BigInt(nb.balance), 18)}`);
						}
					}
				} catch {
					lines.push('ETH: unable to fetch balance');
				}

				if (tokens?.length) {
					const rpcUrl = await api.getRpcUrl(targetNetwork);
					const publicClient = createPublicClient({
						transport: http(rpcUrl),
					});
					const signerAddress = defaultSigner.ethAddress as `0x${string}`;

					for (const tokenAddr of tokens) {
						const typedAddr = tokenAddr as `0x${string}`;
						try {
							const [bal, decimals, symbol] = await Promise.all([
								publicClient.readContract({
									address: typedAddr,
									abi: ERC20_ABI,
									functionName: 'balanceOf',
									args: [signerAddress],
								}),
								publicClient.readContract({
									address: typedAddr,
									abi: ERC20_ABI,
									functionName: 'decimals',
								}),
								publicClient
									.readContract({
										address: typedAddr,
										abi: ERC20_ABI,
										functionName: 'symbol',
									})
									.catch(() => tokenAddr.slice(0, 10)),
							]);
							lines.push(`${symbol}: ${formatUnits(bal, decimals)}`);
						} catch {
							lines.push(`${tokenAddr.slice(0, 10)}...: error reading balance`);
						}
					}
				}

				return {
					content: [{ type: 'text' as const, text: lines.join('\n') }],
				};
			} catch (error) {
				return formatError(error, 'Balance check failed');
			}
		},
	);
}
