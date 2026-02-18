import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SignerManager } from '../../lib/signer-manager.js';

export function registerSimulate(server: McpServer, signerManager: SignerManager) {
	server.tool(
		'guardian_simulate',
		'Simulate a transaction to estimate gas cost before sending. No signing, no broadcast. Use this before guardian_send_eth or guardian_call_contract to verify the transaction will succeed and see gas estimates. Note: policy evaluation only happens during actual signing.',
		{
			to: z
				.string()
				.regex(/^0x[0-9a-fA-F]{40}$/)
				.describe('Target address (0x...)'),
			value: z
				.string()
				.optional()
				.describe('ETH value in ETH units (e.g. "0.1"). Defaults to "0".'),
			data: z
				.string()
				.optional()
				.describe('Calldata as hex string (0x...). Omit for simple ETH transfers.'),
			network: z
				.string()
				.optional()
				.describe("Network (defaults to the signer's configured network)"),
		},
		async ({ to, value, data, network }) => {
			const api = signerManager.getApi();
			const targetNetwork = signerManager.requireNetwork(network);

			try {
				const defaultSigner = await api.getDefaultSigner();

				const result = await api.simulate(defaultSigner.id, {
					to,
					value: value || '0',
					data: data || '0x',
					network: targetNetwork,
				});

				const lines = [
					'Simulation result:',
					`  Would succeed: ${result.success ? 'yes' : 'no'}`,
					`  Estimated gas: ${result.estimatedGas}`,
					`  Gas cost: ~${result.gasCostEth} ETH`,
					`  Network: ${targetNetwork}`,
				];

				if (!result.success && result.error) {
					lines.push(`  Error: ${result.error}`);
				}

				return {
					content: [{ type: 'text' as const, text: lines.join('\n') }],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Simulation failed: ${msg}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
