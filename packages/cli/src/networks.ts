// ---------------------------------------------------------------------------
// Shared network constants for the CLI.
// ---------------------------------------------------------------------------

/** Block explorer base URLs keyed by network name. */
const EXPLORER_BASE_URLS: Record<string, string> = {
	mainnet: 'https://etherscan.io',
	sepolia: 'https://sepolia.etherscan.io',
	base: 'https://basescan.org',
	'base-sepolia': 'https://sepolia.basescan.org',
	arbitrum: 'https://arbiscan.io',
};

/** Default public RPC endpoints keyed by network name. Override via RPC_URL env var. */
const DEFAULT_RPC_URLS: Record<string, string> = {
	'base-sepolia': 'https://sepolia.base.org',
	base: 'https://mainnet.base.org',
	sepolia: 'https://rpc.sepolia.org',
	mainnet: 'https://eth.llamarpc.com',
	arbitrum: 'https://arb1.arbitrum.io/rpc',
};

/** Returns the RPC URL for a network. Checks RPC_URL env var first, then defaults. */
export function getRpcUrl(network: string): string {
	if (process.env.RPC_URL) return process.env.RPC_URL;
	const url = DEFAULT_RPC_URLS[network];
	if (!url) throw new Error(`Unknown network: ${network}. Known: ${Object.keys(DEFAULT_RPC_URLS).join(', ')}`);
	return url;
}

/**
 * Return a block explorer URL for a transaction hash, or the raw hash if no
 * explorer is configured for the given network.
 */
export function getExplorerTxUrl(network: string, hash: string): string {
	const base = EXPLORER_BASE_URLS[network];
	return base ? `${base}/tx/${hash}` : hash;
}

/**
 * Return a block explorer URL for an address, or the raw address if no
 * explorer is configured for the given network.
 */
export function getExplorerAddressUrl(network: string, address: string): string {
	const base = EXPLORER_BASE_URLS[network];
	return base ? `${base}/address/${address}` : address;
}
