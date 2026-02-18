import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerListNetworks(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_list_networks',
		{
			description:
				'List all available networks configured on the Guardian server. Returns network name, CAIP-2 networkId (e.g. "eip155:84532"), chain ID, testnet status, and native currency. Pass the "name" value as the "network" parameter to other tools.',
		},
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
						`  Network ID: ${n.networkId}`,
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
				return formatError(error, 'Failed to list networks');
			}
		},
	);
}
