import {
	type FunctionDeclarationSchemaProperty,
	GoogleGenerativeAI,
	SchemaType,
} from '@google/generative-ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

function convertProperties(
	props: Record<string, Record<string, unknown>>,
): Record<string, FunctionDeclarationSchemaProperty> {
	const result: Record<string, FunctionDeclarationSchemaProperty> = {};
	for (const [key, value] of Object.entries(props)) {
		const prop: FunctionDeclarationSchemaProperty = {
			type: toSchemaType((value.type as string) || 'string'),
			description: (value.description as string) || '',
		};
		if (value.enum) prop.enum = value.enum as string[];
		if (value.items && value.type === 'array')
			prop.items = {
				type: toSchemaType(((value.items as Record<string, unknown>).type as string) || 'string'),
			};
		result[key] = prop;
	}
	return result;
}

const transport = new StdioClientTransport({
	command: 'node',
	args: ['packages/wallet/dist/index.js'],
	env: { ...process.env },
});
const mcpClient = new Client({ name: 'guardian-agent', version: '1.0.0' });
await mcpClient.connect(transport);
const { tools: mcpTools } = await mcpClient.listTools();

const functionDeclarations = mcpTools.map((t) => ({
	name: t.name,
	description: t.description || '',
	parameters: {
		type: SchemaType.OBJECT,
		properties: convertProperties(
			((t.inputSchema as Record<string, unknown>).properties as Record<
				string,
				Record<string, unknown>
			>) || {},
		),
		required: ((t.inputSchema as Record<string, unknown>).required as string[]) || [],
	},
}));

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY as string);
const model = genAI.getGenerativeModel({
	model: 'gemini-2.0-flash',
	tools: [{ functionDeclarations }],
	systemInstruction:
		'You are an autonomous agent with Guardian threshold wallet tools via MCP. Use tools to answer blockchain questions, read contracts, and manage the wallet. The wallet uses 2-of-3 MPC threshold signing — the private key never exists. Be concise in your final summary.',
});

const prompt =
	process.argv[2] ||
	`You are managing a treasury. Do this in order:
1) List available networks.
2) Check wallet balance on base-sepolia.
3) Read the USDC contract symbol and decimals on base-sepolia (0x036CbD53842c5426634e7929541eC2318f3dCF7e).
4) Send 0.000001 ETH to 0x0000000000000000000000000000000000000001.
5) Sign the message 'treasury-audit-ok'.
6) Check the audit log (last 3 entries).
Report everything.`;

console.log(`USER:\n${prompt}\n`);
console.log(`${'='.repeat(70)}\n`);

const chat = model.startChat();
let result = await chat.sendMessage(prompt);

for (let step = 0; step < 10; step++) {
	const calls = result.response.functionCalls();
	if (!calls?.length) break;

	console.log(`GEMINI → ${calls.length} tool call(s):\n`);
	const functionResponses = [];
	for (const call of calls) {
		console.log(`  CALL: ${call.name}(${JSON.stringify(call.args)})`);
		const r = await mcpClient.callTool({
			name: call.name,
			arguments: (call.args as Record<string, unknown>) || {},
		});
		const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
		console.log('  RESULT:');
		for (const line of text.split('\n')) console.log(`    ${line}`);
		console.log();
		functionResponses.push({ functionResponse: { name: call.name, response: { result: text } } });
	}
	console.log(`${'='.repeat(70)}\n`);
	result = await chat.sendMessage(functionResponses);
}

console.log('GEMINI FINAL ANSWER:\n');
console.log(result.response.text());
await mcpClient.close();
