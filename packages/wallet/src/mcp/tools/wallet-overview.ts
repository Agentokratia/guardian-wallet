import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatUnits } from 'viem';
import { z } from 'zod';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerWalletOverview(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_wallet_overview',
		'Get a complete overview of the Guardian wallet — address, balances, tracked token balances, and recent transactions. This is the best starting tool for any conversation about the wallet. Requires a network to show balances.',
		{
			network: z
				.string()
				.optional()
				.describe(
					'Network to show balances for (e.g. "base-sepolia", "mainnet"). If not set, call guardian_list_networks first.',
				),
		},
		async ({ network }) => {
			const api = signerManager.getApi();
			const lines: string[] = [];

			try {
				// Fetch signer info
				const signers = await api.listSigners();

				if (!signers.length) {
					return {
						content: [
							{
								type: 'text' as const,
								text: 'No wallet found. Create a signer first via the Guardian dashboard.',
							},
						],
					};
				}

				const signer = signers[0] as (typeof signers)[0];

				lines.push(`Wallet: ${signer.name || 'Guardian Wallet'}`);
				lines.push(`Address: ${signer.ethAddress}`);
				lines.push(`Status: ${signer.status || 'active'}`);

				// If no network specified and no env default, list available networks
				const targetNetwork = network || signerManager.getNetwork();
				if (!targetNetwork) {
					lines.push('');
					lines.push(
						'No network specified — call guardian_list_networks to see available networks, then pass "network" to see balances.',
					);
					return {
						content: [{ type: 'text' as const, text: lines.join('\n') }],
					};
				}

				lines.push(`Network: ${targetNetwork}`);
				lines.push('');

				// ETH balance
				try {
					const balance = await api.getBalance(signer.id, targetNetwork);

					for (const nb of balance.balances) {
						if (nb.rpcError) {
							lines.push('ETH: RPC error');
						} else {
							lines.push(`ETH: ${formatUnits(BigInt(nb.balance), 18)}`);
						}
					}
				} catch {
					lines.push('ETH: unable to fetch');
				}

				// Token balances from server's tracked tokens
				try {
					const chainId = await api.getChainId(targetNetwork);

					if (chainId) {
						const tokenBalances = await api.getTokenBalances(signer.id, chainId);

						for (const tb of tokenBalances) {
							const formatted = formatUnits(BigInt(tb.balance), tb.decimals);
							if (formatted !== '0') {
								lines.push(`${tb.symbol}: ${formatted}`);
							}
						}

						if (!tokenBalances.length) {
							lines.push('No tracked tokens. Add tokens via dashboard or guardian_call_contract.');
						}
					}
				} catch {
					// Token balances not available — skip silently
				}

				// Recent activity (last 5)
				lines.push('');
				lines.push('Recent activity:');
				try {
					const audit = await api.getAuditLog({ limit: 5 });
					const entries = audit.entries;

					if (!entries.length) {
						lines.push('  No transactions yet.');
					} else {
						for (const e of entries) {
							const status = e.status === 'completed' ? 'OK' : e.status.toUpperCase();
							const action = e.decodedAction || e.requestType || 'tx';
							const to = e.toAddress ? ` → ${e.toAddress.slice(0, 10)}...` : '';
							lines.push(`  [${status}] ${action}${to}`);
						}
					}
				} catch {
					lines.push('  Unable to fetch activity.');
				}

				return {
					content: [{ type: 'text' as const, text: lines.join('\n') }],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: 'text' as const, text: `Wallet overview failed: ${msg}` }],
					isError: true,
				};
			}
		},
	);
}
