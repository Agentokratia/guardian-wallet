const KNOWN_SELECTORS: Record<string, string> = {
	a9059cbb: 'transfer(address,uint256)',
	'095ea7b3': 'approve(address,uint256)',
	'23b872dd': 'transferFrom(address,address,uint256)',
	'40c10f19': 'mint(address,uint256)',
	'42966c68': 'burn(uint256)',
	a0712d68: 'mint(uint256)',
	'70a08231': 'balanceOf(address)',
	dd62ed3e: 'allowance(address,address)',
	'18160ddd': 'totalSupply()',
	d0e30db0: 'deposit()',
	'2e1a7d4d': 'withdraw(uint256)',
	'3593564c': 'execute(bytes,bytes[],uint256)',
};

export interface DecodedCalldata {
	readonly selector: string;
	readonly name: string;
}

export function decodeCalldata(data: Uint8Array): DecodedCalldata | undefined {
	if (data.length < 4) {
		return undefined;
	}

	const selectorHex = Array.from(data.slice(0, 4))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	const name = KNOWN_SELECTORS[selectorHex] ?? `unknown(0x${selectorHex})`;

	return {
		selector: `0x${selectorHex}`,
		name,
	};
}
