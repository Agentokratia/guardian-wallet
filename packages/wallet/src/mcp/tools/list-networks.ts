import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerListNetworks(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_list_networks',
		'List all available networks configured on the Guardian server. Shows network name, chain ID, testnet status, and native currency. Use this to discover valid network names for other tools.',
		{},
		async () => {
			const api = signerManager.getApi();
			const envDefault = signerManager.getNetwork();

			try {
				const networks = await api.listNetworks();

				if (!networks.length) {
					return {
						content: [
							{
								type: 'text' as const,
								text: 'No networks configured on the server.',
							},
						],
					};
				}

				const lines = [`${networks.length} network(s) available:`, ''];

				for (const n of networks) {
					const active = envDefault && n.name === envDefault ? ' (default)' : '';
					const testnet = n.isTestnet ? ' [testnet]' : '';
					lines.push(
						`${n.displayName || n.name}${active}${testnet}`,
						`  Name: ${n.name}`,
						`  Chain ID: ${n.chainId}`,
						`  Currency: ${n.nativeCurrency}`,
						'',
					);
				}

				lines.push('Tip: Pass "network" parameter to any tool to select a network.');

				return {
					content: [{ type: 'text' as const, text: lines.join('\n') }],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to list networks: ${msg}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
