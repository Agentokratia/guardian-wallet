/**
 * Guardian Wallet + LangChain
 *
 * A LangChain agent with a threshold signing tool.
 * The full private key never exists — signing is 2-of-3 MPC.
 *
 * Prerequisites:
 *   - Guardian server running (docker compose up -d)
 *   - Signer created with share file + API key
 *   - ANTHROPIC_API_KEY set
 *
 * Usage:
 *   npx tsx agent.ts
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatAnthropic } from '@langchain/anthropic';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
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

const getBalanceTool = new DynamicStructuredTool({
	name: 'get_balance',
	description: 'Get the ETH balance of the threshold wallet',
	schema: z.object({}),
	func: async () => {
		const balance = await publicClient.getBalance({
			address: signer.address as `0x${string}`,
		});
		return `Balance: ${formatEther(balance)} ETH (address: ${signer.address})`;
	},
});

const sendTxTool = new DynamicStructuredTool({
	name: 'send_transaction',
	description:
		'Send ETH using threshold signing (2-of-3 MPC). The key never exists.',
	schema: z.object({
		to: z.string().describe('Recipient Ethereum address'),
		value: z.string().describe('Amount in ETH (e.g. "0.01")'),
	}),
	func: async ({ to, value }) => {
		const result = await signer.signTransaction({
			to,
			value: parseEther(value).toString(),
		});
		return `Transaction sent! Hash: ${result.txHash}`;
	},
});

const signMessageTool = new DynamicStructuredTool({
	name: 'sign_message',
	description: 'Sign a message using threshold signing (2-of-3 MPC)',
	schema: z.object({
		message: z.string().describe('Message to sign'),
	}),
	func: async ({ message }) => {
		const result = await signer.signMessage(message);
		return `Signed! Signature: ${result.signature}`;
	},
});

const tools = [getBalanceTool, sendTxTool, signMessageTool];

const model = new ChatAnthropic({
	model: 'claude-sonnet-4-5-20250929',
	temperature: 0,
});

const prompt = ChatPromptTemplate.fromMessages([
	[
		'system',
		'You are an AI agent with access to a threshold-signing Ethereum wallet. The full private key never exists — all signing is done via 2-of-3 MPC. Use the tools to interact with the wallet.',
	],
	['human', '{input}'],
	['placeholder', '{agent_scratchpad}'],
]);

const agent = createToolCallingAgent({ llm: model, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

const input =
	process.argv[2] ||
	'Check my wallet balance and tell me the address';

console.log(`Agent input: ${input}\n`);

const result = await executor.invoke({ input });
console.log(result.output);
