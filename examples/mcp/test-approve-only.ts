import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
	command: 'node',
	args: ['packages/wallet/dist/index.js'],
	env: { ...process.env },
});

const client = new Client({ name: 'test-approve', version: '1.0.0' });
await client.connect(transport);

console.log('==> guardian_call_contract (approve USDC)');
const r = await client.callTool({
	name: 'guardian_call_contract',
	arguments: {
		contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
		abi: [
			{
				name: 'approve',
				type: 'function',
				inputs: [
					{ name: 'spender', type: 'address' },
					{ name: 'amount', type: 'uint256' },
				],
				outputs: [{ type: 'bool' }],
				stateMutability: 'nonpayable',
			},
		],
		functionName: 'approve',
		args: ['0x0000000000000000000000000000000000000001', '1000000'],
		network: 'base-sepolia',
	},
});
console.log((r.content as Array<{ text: string }>)[0]?.text);
await client.close();
