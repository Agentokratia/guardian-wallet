import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerSignTypedData(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_sign_typed_data',
		'Sign EIP-712 typed data using Guardian threshold signing. Used for x402 payments, Permit2 approvals, ERC-3009 transfers, and off-chain structured signatures. No gas is spent.',
		{
			domain: z
				.record(z.unknown())
				.describe(
					'EIP-712 domain (e.g. { name: "USD Coin", version: "2", chainId: 84532, verifyingContract: "0x..." })',
				),
			types: z
				.record(z.array(z.object({ name: z.string(), type: z.string() })))
				.describe('EIP-712 type definitions'),
			primaryType: z
				.string()
				.describe('Primary type name (e.g. "ReceiveWithAuthorization", "PermitTransferFrom")'),
			message: z.record(z.unknown()).describe('The structured message data to sign'),
		},
		async ({ domain, types, primaryType, message }) => {
			const signer = await signerManager.getSigner();
			try {
				const result = await signer.signMessage({
					domain,
					types,
					primaryType,
					message,
				});
				const domainName = typeof domain.name === 'string' ? domain.name : 'unnamed';
				return {
					content: [
						{
							type: 'text' as const,
							text: [
								'Typed data signed successfully.',
								`Primary type: ${primaryType}`,
								`Domain: ${domainName}`,
								`Signature: ${result.signature}`,
								`v: ${result.v}  r: ${result.r}  s: ${result.s}`,
							].join('\n'),
						},
					],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Typed data signing failed: ${msg}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
