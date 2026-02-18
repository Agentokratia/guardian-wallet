export const ERC20_ABI = [
	{
		name: 'transfer',
		type: 'function',
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ type: 'bool' }],
		stateMutability: 'nonpayable',
	},
	{
		name: 'balanceOf',
		type: 'function',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
	},
	{
		name: 'decimals',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'uint8' }],
		stateMutability: 'view',
	},
	{
		name: 'symbol',
		type: 'function',
		inputs: [],
		outputs: [{ type: 'string' }],
		stateMutability: 'view',
	},
] as const;
