import { HttpClientError } from '@agentokratia/guardian-signer';

interface PolicyViolation {
	type: string;
	reason: string;
}

/** Matches MCP SDK's CallToolResult — index signature required by the Zod schema. */
interface ToolResult {
	[key: string]: unknown;
	content: Array<{ type: 'text'; text: string }>;
	isError?: boolean;
}

export function formatError(error: unknown, prefix: string): ToolResult {
	if (error instanceof HttpClientError && error.statusCode === 403) {
		const lines = [`${prefix}: policy violation`];
		try {
			const body = JSON.parse(error.body) as { violations?: PolicyViolation[] };
			if (body.violations?.length) {
				lines.push('');
				lines.push('Policy violations:');
				for (const v of body.violations) {
					lines.push(`  - [${v.type}] ${v.reason}`);
				}
			}
		} catch {
			lines.push(error.body);
		}
		return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
	}

	const msg = error instanceof Error ? error.message : String(error);
	return { content: [{ type: 'text', text: `${prefix}: ${msg}` }], isError: true };
}
