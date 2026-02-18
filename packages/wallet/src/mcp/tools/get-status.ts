import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerGetStatus(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_get_status',
		{
			description:
				'Get the Guardian server health status and signer information. Use this to verify the server is running and the signer is configured.',
		},
		async () => {
			const api = signerManager.getApi();
			const lines: string[] = [];

			try {
				const health = await api.getHealth();

				lines.push(`Server: ${health.status === 'ok' ? 'connected' : 'degraded'}`);
				if (typeof health.uptime === 'number') {
					lines.push(`Uptime: ${health.uptime}s`);
				}

				// Vault / share store status
				if (health.shareStore) {
					lines.push(
						`Share store: ${health.shareStore.connected ? 'connected' : 'disconnected'} (${health.shareStore.provider || 'unknown'})`,
					);
				} else if (health.vault) {
					lines.push(`Vault: ${health.vault.connected ? 'connected' : 'disconnected'}`);
				}

				// Database
				if (typeof health.db === 'boolean') {
					lines.push(`Database: ${health.db ? 'connected' : 'error'}`);
				} else if (health.database) {
					lines.push(
						`Database: ${health.database.connected ?? health.database.status ?? 'unknown'}`,
					);
				}

				// Aux info pool
				if (health.auxInfoPool) {
					if (
						typeof health.auxInfoPool.ready === 'number' &&
						typeof health.auxInfoPool.total === 'number'
					) {
						lines.push(
							`Aux info pool: ${health.auxInfoPool.ready}/${health.auxInfoPool.total} ready`,
						);
					}
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				lines.push(`Server: unreachable (${msg})`);
			}

			try {
				const signers = await api.listSigners();
				if (signers.length) {
					for (const s of signers) {
						lines.push('');
						lines.push(`Signer: ${s.name || 'unnamed'} [${s.id}]`);
						lines.push(`  Address: ${s.ethAddress}`);
						lines.push(`  Chain: ${s.chain || 'ethereum'}`);
						lines.push(`  Network: ${s.network || 'any (specify per request)'}`);
						lines.push(`  Status: ${s.status || 'unknown'}`);
						lines.push(`  DKG: ${s.dkgCompleted ? 'completed' : 'pending'}`);
					}
				} else {
					lines.push('');
					lines.push('No signers found.');
				}
			} catch {
				lines.push('');
				lines.push('Signers: unable to fetch');
			}

			return {
				content: [{ type: 'text' as const, text: lines.join('\n') }],
			};
		},
	);
}
