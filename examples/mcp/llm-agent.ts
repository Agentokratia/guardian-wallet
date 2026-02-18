/**
 * Guardian MCP + LLM Agent
 *
 * An AI agent that discovers and uses Guardian wallet tools via MCP.
 * Tools are auto-discovered — the agent sees all 12 tools without hardcoding.
 *
 * Uses Google Gemini with native function calling.
 *
 * Works in two modes:
 *   1. With Guardian server running  → full signing + contract calls
 *   2. Without server (read-only)    → contract reads + status checks
 *
 * Usage:
 *   pnpm example:mcp-agent
 *   pnpm example:mcp-agent "What is the USDC total supply on Base Sepolia?"
 *
 * Requires:
 *   GOOGLE_API_KEY in examples/.env (or environment)
 */

import {
	type FunctionDeclaration,
	type FunctionDeclarationSchemaProperty,
	GoogleGenerativeAI,
	SchemaType,
} from '@google/generative-ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Convert JSON Schema type string → Gemini SchemaType enum. */
function toSchemaType(type: string): SchemaType {
	const map: Record<string, SchemaType> = {
		string: SchemaType.STRING,
		number: SchemaType.NUMBER,
		integer: SchemaType.INTEGER,
		boolean: SchemaType.BOOLEAN,
		array: SchemaType.ARRAY,
		object: SchemaType.OBJECT,
	};
	return map[type] || SchemaType.STRING;
}

/** Convert JSON Schema properties → Gemini FunctionDeclarationSchemaProperty. */
function convertProperties(
	props: Record<string, Record<string, unknown>>,
): Record<string, FunctionDeclarationSchemaProperty> {
	const result: Record<string, FunctionDeclarationSchemaProperty> = {};
	for (const [key, value] of Object.entries(props)) {
		const prop: FunctionDeclarationSchemaProperty = {
			type: toSchemaType((value.type as string) || 'string'),
			description: (value.description as string) || '',
		};
		if (value.enum) {
			prop.enum = value.enum as string[];
		}
		if (value.items && value.type === 'array') {
			prop.items = {
				type: toSchemaType(((value.items as Record<string, unknown>).type as string) || 'string'),
			};
		}
		result[key] = prop;
	}
	return result;
}

/** Convert an MCP tool schema → Gemini FunctionDeclaration. */
function toGeminiFn(
	name: string,
	description: string,
	inputSchema: Record<string, unknown>,
): FunctionDeclaration {
	const properties = (inputSchema.properties as Record<string, Record<string, unknown>>) || {};
	const required = (inputSchema.required as string[]) || [];

	return {
		name,
		description,
		parameters: {
			type: SchemaType.OBJECT,
			properties: convertProperties(properties),
			required,
		},
	};
}

/** Retry-aware sendMessage — backs off on 429 rate limits. */
async function sendWithRetry(
	chat: ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['startChat']>,
	content: Parameters<typeof chat.sendMessage>[0],
	maxRetries = 3,
) {
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await chat.sendMessage(content);
		} catch (err: unknown) {
			const status = (err as { status?: number }).status;
			if (status === 429 && attempt < maxRetries) {
				const delay = (attempt + 1) * 10;
				console.log(`  (rate limited — waiting ${delay}s...)`);
				await new Promise((r) => setTimeout(r, delay * 1000));
				continue;
			}
			throw err;
		}
	}
	throw new Error('unreachable');
}

async function main() {
	// ── Connect to Guardian MCP server ──────────────────────────────────

	const transport = new StdioClientTransport({
		command: 'node',
		args: ['packages/wallet/dist/index.js'],
		env: {
			...process.env,
			GUARDIAN_API_SECRET: process.env.GUARDIAN_API_SECRET || 'dGVzdA==',
			GUARDIAN_API_KEY: process.env.GUARDIAN_API_KEY || 'gw_test_dummy',
			GUARDIAN_SERVER: process.env.GUARDIAN_SERVER || 'http://localhost:8080',
		},
	});

	const mcpClient = new Client({ name: 'guardian-agent', version: '1.0.0' });
	await mcpClient.connect(transport);

	// ── Auto-discover tools from MCP ────────────────────────────────────

	const { tools: mcpTools } = await mcpClient.listTools();
	console.log(
		`\n  Discovered ${mcpTools.length} MCP tools:\n  ${mcpTools.map((t) => t.name).join(', ')}\n`,
	);

	// Convert MCP tool schemas → Gemini function declarations
	const functionDeclarations = mcpTools.map((t) =>
		toGeminiFn(t.name, t.description || '', t.inputSchema as Record<string, unknown>),
	);

	// ── Gemini model with tools ─────────────────────────────────────────

	const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY as string);
	const model = genAI.getGenerativeModel({
		model: 'gemini-2.0-flash',
		tools: [{ functionDeclarations }],
		systemInstruction:
			'You are an autonomous agent with Guardian threshold wallet tools via MCP. ' +
			'Use tools to answer blockchain questions, read contracts, and manage the wallet. ' +
			'The wallet uses 2-of-3 MPC threshold signing — the private key never exists. ' +
			'Be concise in your final summary.',
	});

	const prompt =
		process.argv[2] ||
		[
			'Do a quick blockchain check:',
			'1. Read the USDC contract on Base Sepolia (0x036CbD53842c5426634e7929541eC2318f3dCF7e) — get the symbol, decimals, and total supply.',
			'2. Check the Guardian server status.',
			'Summarize everything concisely.',
		].join('\n');

	console.log(`  Prompt: ${prompt}\n`);

	const chat = model.startChat();

	// ── Agent loop ──────────────────────────────────────────────────────

	let result = await sendWithRetry(chat, prompt);

	for (let step = 0; step < 10; step++) {
		const calls = result.response.functionCalls();
		if (!calls?.length) break;

		// Forward each tool call to the MCP server
		const functionResponses = [];

		for (const call of calls) {
			console.log(`  -> ${call.name}`);

			const result = await mcpClient.callTool({
				name: call.name,
				arguments: (call.args as Record<string, unknown>) || {},
			});

			const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
			const preview = text.split('\n')[0];
			if (preview) console.log(`     ${preview}`);
			console.log();

			functionResponses.push({
				functionResponse: { name: call.name, response: { result: text } },
			});
		}

		// Send tool results back to Gemini
		result = await sendWithRetry(chat, functionResponses);
	}

	// Print final text
	console.log(result.response.text());
	await mcpClient.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
