/**
 * Guardian Wallet + Vercel AI SDK
 *
 * An AI agent that can check balances, send ETH, and sign messages
 * using threshold signing (2-of-3 MPC). The full private key never exists.
 *
 * Prerequisites:
 *   - Guardian server running (docker compose up -d)
 *   - Signer created with share file + API key
 *   - ANTHROPIC_API_KEY set
 *
 * Usage:
 *   npx tsx agent.ts
 */

import { generateText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { createPublicClient, http, formatEther, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import { z } from 'zod';

const signer = await ThresholdSigner.fromFile({
	sharePath: process.env.SHARE_PATH || './my-agent.share.enc',
	passphrase: process.env.SHARE_PASSPHRASE!,
	serverUrl: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	apiKey: process.env.GUARDIAN_API_KEY!,
});

const publicClient = createPublicClient({
	chain: baseSepolia,
	transport: http(),
});

const tools = {
	get_balance: tool({
		description: 'Get the ETH balance of the threshold wallet',
		parameters: z.object({}),
		execute: async () => {
			const balance = await publicClient.getBalance({
				address: signer.address as `0x${string}`,
			});
			return `Balance: ${formatEther(balance)} ETH (address: ${signer.address})`;
		},
	}),

	send_transaction: tool({
		description:
			'Send ETH to an address using threshold signing (2-of-3 MPC)',
		parameters: z.object({
			to: z.string().describe('Recipient Ethereum address'),
			value: z.string().describe('Amount in ETH (e.g. "0.01")'),
		}),
		execute: async ({ to, value }) => {
			const result = await signer.signTransaction({
				to,
				value: parseEther(value).toString(),
			});
			return `Transaction sent! Hash: ${result.txHash}`;
		},
	}),

	sign_message: tool({
		description: 'Sign a message using threshold signing',
		parameters: z.object({
			message: z.string().describe('Message to sign'),
		}),
		execute: async ({ message }) => {
			const result = await signer.signMessage(message);
			return `Signed! Signature: ${result.signature}`;
		},
	}),
};

const prompt =
	process.argv[2] ||
	'Check my wallet balance, then send 0.001 ETH to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

console.log(`Agent prompt: ${prompt}\n`);

const { text } = await generateText({
	model: anthropic('claude-sonnet-4-5-20250929'),
	tools,
	maxSteps: 5,
	prompt,
});

console.log(text);
