import type { Network } from '@/hooks/use-networks';

// Hardcoded fallbacks — used before networks are fetched from the API
const FALLBACK_CHAIN_IDS: Record<string, number> = {
	mainnet: 1,
	sepolia: 11155111,
	base: 8453,
	'base-sepolia': 84532,
	arbitrum: 42161,
	'arbitrum-sepolia': 421614,
};

const FALLBACK_EXPLORER_URLS: Record<string, string> = {
	mainnet: 'https://etherscan.io',
	sepolia: 'https://sepolia.etherscan.io',
	base: 'https://basescan.org',
	'base-sepolia': 'https://sepolia.basescan.org',
	arbitrum: 'https://arbiscan.io',
	'arbitrum-sepolia': 'https://sepolia.arbiscan.io',
};

// Mutable lookups — populated from API data via initChainLookups()
let chainIds: Record<string, number> = { ...FALLBACK_CHAIN_IDS };
let explorerUrls: Record<string, string> = { ...FALLBACK_EXPLORER_URLS };
let chainIdToExplorer: Record<number, string> = buildChainIdToExplorer(chainIds, explorerUrls);

function buildChainIdToExplorer(
	ids: Record<string, number>,
	explorers: Record<string, string>,
): Record<number, string> {
	return Object.fromEntries(
		Object.entries(ids)
			.map(([network, id]) => [id, explorers[network]])
			.filter(([, url]) => url),
	);
}

/** Call once after fetching networks from API to populate lookups from DB data. */
export function initChainLookups(networks: Network[]): void {
	chainIds = { ...FALLBACK_CHAIN_IDS };
	explorerUrls = { ...FALLBACK_EXPLORER_URLS };
	for (const n of networks) {
		chainIds[n.name] = n.chainId;
		if (n.explorerUrl) {
			explorerUrls[n.name] = n.explorerUrl;
		}
	}
	chainIdToExplorer = buildChainIdToExplorer(chainIds, explorerUrls);
}

export function getChainId(network: string): number {
	const id = chainIds[network];
	if (id === undefined) {
		throw new Error(`Unknown network: ${network}`);
	}
	return id;
}

export function getExplorerTxUrl(network: string, txHash: string): string {
	const base = explorerUrls[network];
	if (!base) {
		throw new Error(`Unknown network: ${network}`);
	}
	return `${base}/tx/${txHash}`;
}

/** Get explorer tx URL from chainId + txHash. Returns null if chain unknown. */
export function getExplorerTxUrlByChainId(chainId: number, txHash: string): string | null {
	const base = chainIdToExplorer[chainId];
	if (!base) return null;
	return `${base}/tx/${txHash}`;
}
