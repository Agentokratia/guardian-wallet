import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatUnits } from 'viem';
import { z } from 'zod';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerGetAuditLog(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_get_audit_log',
		'Get recent signing activity from the Guardian audit log. Shows past transactions, policy evaluations, decoded function calls, and gas costs. Use this to check spending history or verify past actions.',
		{
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.default(20)
				.describe('Number of entries to return (default: 20, max: 100)'),
			status: z
				.enum(['all', 'completed', 'blocked', 'failed'])
				.optional()
				.default('all')
				.describe(
					'Filter by status: "all", "completed", "blocked" (policy violation), or "failed"',
				),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.default(1)
				.describe('Page number for pagination (default: 1)'),
		},
		async ({ limit, status, page }) => {
			const api = signerManager.getApi();

			try {
				const result = await api.getAuditLog({
					limit,
					page,
					status: status === 'all' ? undefined : status,
				});

				const { entries, meta } = result;

				if (!entries.length) {
					return {
						content: [
							{
								type: 'text' as const,
								text: 'No signing activity found.',
							},
						],
					};
				}

				const lines: string[] = [];

				if (meta) {
					lines.push(
						`Showing ${entries.length} of ${meta.total} entries (page ${meta.page}/${meta.totalPages})`,
						'',
					);
				}

				for (const e of entries) {
					const parts = [
						`[${e.createdAt}] ${e.status}`,
						`  Type: ${e.requestType} | Path: ${e.signingPath}`,
					];
					if (e.toAddress) parts.push(`  To: ${e.toAddress}`);
					if (e.valueWei && e.valueWei !== '0') {
						try {
							parts.push(`  Value: ${formatUnits(BigInt(e.valueWei), 18)} ETH`);
						} catch {
							parts.push(`  Value: ${e.valueWei} wei`);
						}
					}
					if (e.decodedAction) parts.push(`  Action: ${e.decodedAction}`);
					if (e.txHash) parts.push(`  Tx: ${e.txHash}`);
					if (e.policyViolations?.length) {
						parts.push(`  Violations: ${e.policyViolations.map((v) => v.type).join(', ')}`);
					}
					lines.push(parts.join('\n'));
				}

				return {
					content: [{ type: 'text' as const, text: lines.join('\n\n') }],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Audit log fetch failed: ${msg}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
