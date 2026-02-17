/**
 * Guardian Wallet + Vercel AI SDK
 *
 * An AI agent that signs Ethereum transactions using Guardian's threshold
 * wallet. The full private key never exists — signing is 2-of-3 MPC.
 *
 * Usage:
 *   pnpm example:vercel-ai
 *   pnpm example:vercel-ai "Check my wallet balance"
 */

import { ThresholdSigner } from '@agentokratia/guardian-signer';
import { generateText, tool } from 'ai';
import { http, createPublicClient, formatEther, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import { z } from 'zod';

// ── LLM — Gemini via OpenAI-compatible endpoint ─────────────────────
import { createOpenAI } from '@ai-sdk/openai';
const gemini = createOpenAI({
	apiKey: process.env.GOOGLE_API_KEY,
	baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});
const model = gemini('gemini-2.0-flash');
// ─────────────────────────────────────────────────────────────────────

const signer = await ThresholdSigner.fromSecret({
	apiSecret: process.env.GUARDIAN_API_SECRET as string,
	serverUrl: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	apiKey: process.env.GUARDIAN_API_KEY as string,
});

const account = signer.toViemAccount();
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

const tools = {
	get_balance: tool({
		description: 'Get the ETH balance of the threshold wallet',
		parameters: z.object({
			address: z.string().describe('The wallet address to check, or "self" for this wallet'),
		}),
		execute: async () => {
			const balance = await publicClient.getBalance({ address: account.address });
			return `Balance: ${formatEther(balance)} ETH (address: ${account.address})`;
		},
	}),

	send_transaction: tool({
		description: 'Send ETH to an address using threshold signing (2-of-3 MPC)',
		parameters: z.object({
			to: z.string().describe('Recipient Ethereum address'),
			value: z.string().describe('Amount in ETH (e.g. "0.001")'),
		}),
		execute: async ({ to, value }) => {
			const result = await signer.signTransaction({
				to,
				value: parseEther(value).toString(),
				chainId: baseSepolia.id,
			});
			return `Sent! Hash: ${result.txHash}\nhttps://sepolia.basescan.org/tx/${result.txHash}`;
		},
	}),

	sign_message: tool({
		description: 'Sign a message using threshold signing (2-of-3 MPC)',
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
	`You're an AI agent starting up. Check your wallet balance to confirm you're funded. Then sign the message "guardian-agent-online::${new Date().toISOString()}" as proof-of-liveness. Report your status.`;

console.log(`\n🤖 Agent prompt: ${prompt}\n`);

const { text } = await generateText({
	model,
	system:
		'You are an autonomous agent with a threshold-signing Ethereum wallet. The private key never exists — signing is 2-of-3 MPC.',
	tools,
	maxSteps: 5,
	prompt,
	onStepFinish: ({ toolCalls }) => {
		for (const call of toolCalls) {
			console.log(`  → ${call.toolName}`);
		}
	},
});

console.log(`\n${text}`);
signer.destroy();
