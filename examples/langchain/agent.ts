/**
 * Guardian Wallet + LangChain
 *
 * A LangChain agent using Guardian.connect() for threshold signing.
 * The full private key never exists — signing is 2-of-3 MPC.
 *
 * Usage:
 *   pnpm example:langchain
 *   pnpm example:langchain "Check my wallet balance"
 */

import { Guardian } from '@agentokratia/guardian-signer';
import { type BaseMessageLike, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { http, createPublicClient, formatEther, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import { z } from 'zod';

// ── LLM — Gemini via OpenAI-compatible endpoint ─────────────────────
const llm = new ChatOpenAI({
	model: 'gemini-2.0-flash',
	apiKey: process.env.GOOGLE_API_KEY,
	configuration: {
		baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
	},
	temperature: 0,
});
// ─────────────────────────────────────────────────────────────────────

const gw = await Guardian.connect({
	apiSecret: process.env.GUARDIAN_API_SECRET as string,
	serverUrl: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
	apiKey: process.env.GUARDIAN_API_KEY as string,
});

const account = gw.toViemAccount();
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

// ── Tools ────────────────────────────────────────────────────────────

const tools = [
	new DynamicStructuredTool({
		name: 'get_balance',
		description: 'Get the ETH balance of the threshold wallet',
		schema: z.object({
			address: z.string().describe('Wallet address to check, or "self"'),
		}),
		func: async () => {
			const balance = await publicClient.getBalance({ address: account.address });
			return `Balance: ${formatEther(balance)} ETH (address: ${account.address})`;
		},
	}),
	new DynamicStructuredTool({
		name: 'send_transaction',
		description: 'Send ETH using threshold signing (2-of-3 MPC)',
		schema: z.object({
			to: z.string().describe('Recipient Ethereum address'),
			value: z.string().describe('Amount in ETH (e.g. "0.001")'),
		}),
		func: async ({ to, value }) => {
			const result = await gw.signTransaction({
				to,
				value: parseEther(value).toString(),
				chainId: baseSepolia.id,
			});
			return `Sent! Hash: ${result.txHash}\nhttps://sepolia.basescan.org/tx/${result.txHash}`;
		},
	}),
	new DynamicStructuredTool({
		name: 'sign_message',
		description: 'Sign a message using threshold signing (2-of-3 MPC)',
		schema: z.object({
			message: z.string().describe('Message to sign'),
		}),
		func: async ({ message }) => {
			const result = await gw.signMessage(message);
			return `Signed! Signature: ${result.signature}`;
		},
	}),
];

// ── Agent loop ───────────────────────────────────────────────────────

const model = llm.bindTools(tools);

const input =
	process.argv[2] ||
	`Run a startup health check: verify the wallet has funds, then sign the message "guardian-agent-online::${new Date().toISOString()}" as a proof-of-liveness attestation.`;

console.log(`\n🤖 Agent input: ${input}\n`);

const messages: BaseMessageLike[] = [new HumanMessage(input)];

for (let step = 0; step < 5; step++) {
	const response = await model.invoke(messages);
	messages.push(response);

	if (!response.tool_calls?.length) {
		console.log(response.content);
		break;
	}

	for (const call of response.tool_calls) {
		const t = tools.find((t) => t.name === call.name);
		if (!t) continue;
		console.log(`  → ${call.name}`);
		const result = await t.invoke(call.args);
		console.log(`    ${result}\n`);
		messages.push(
			new ToolMessage({ content: result, tool_call_id: call.id as string, name: call.name }),
		);
	}
}

gw.destroy();
