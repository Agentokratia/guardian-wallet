import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatError } from '../../lib/errors.js';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerSignMessage(server: McpServer, signerManager: SignerManager) {
	server.registerTool(
		'guardian_sign_message',
		{
			description:
				'Sign an arbitrary message using Guardian threshold signing (2-of-3 MPC). Returns an EIP-191 personal signature. No gas is spent.',
			inputSchema: {
				message: z.string().min(1).describe('The message to sign (plain text string)'),
			},
		},
		async ({ message }) => {
			const signer = await signerManager.getSigner();
			try {
				const result = await signer.signMessage(message);
				const preview = message.length > 100 ? `${message.slice(0, 100)}...` : message;
				return {
					content: [
						{
							type: 'text' as const,
							text: [
								'Message signed successfully.',
								`Message: "${preview}"`,
								`Signature: ${result.signature}`,
								`v: ${result.v}  r: ${result.r}  s: ${result.s}`,
							].join('\n'),
						},
					],
				};
			} catch (error) {
				return formatError(error, 'Message signing failed');
			}
		},
	);
}
