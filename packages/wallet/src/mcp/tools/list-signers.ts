import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerListSigners(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_list_signers',
		'List all signers accessible with the current API key. Shows name, ID, address, chain, network, and status.',
		{},
		async () => {
			const api = signerManager.getApi();

			try {
				const signers = await api.listSigners();

				if (!signers.length) {
					return {
						content: [{ type: 'text' as const, text: 'No signers found.' }],
					};
				}

				const lines = signers.map((s) =>
					[
						`${s.name || 'unnamed'} (${s.status || 'unknown'})`,
						`  ID: ${s.id}`,
						`  Address: ${s.ethAddress}`,
						`  Chain: ${s.chain || 'ethereum'}`,
						`  Network: ${s.network || 'unknown'}`,
						`  DKG: ${s.dkgCompleted ? 'completed' : 'pending'}`,
					].join('\n'),
				);

				return {
					content: [
						{
							type: 'text' as const,
							text: `${signers.length} signer(s):\n\n${lines.join('\n\n')}`,
						},
					],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to list signers: ${msg}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
