import type { Network } from '@/hooks/use-networks';

/* ========================================================================== */
/*  Network branding — colors, abbreviations, icons                            */
/* ========================================================================== */

export interface NetworkMeta {
	/** Tailwind bg color class for the icon circle */
	bg: string;
	/** Tailwind text color class for the abbreviation */
	text: string;
	/** 1–3 letter abbreviation shown inside the circle */
	abbr: string;
	/** Hex color used for the ring/accent */
	hex: string;
}

const META: Record<string, NetworkMeta> = {
	mainnet: { bg: 'bg-[#627EEA]/15', text: 'text-[#627EEA]', abbr: 'E', hex: '#627EEA' },
	sepolia: { bg: 'bg-[#627EEA]/10', text: 'text-[#627EEA]/70', abbr: 'E', hex: '#627EEA' },
	base: { bg: 'bg-[#0052FF]/15', text: 'text-[#0052FF]', abbr: 'B', hex: '#0052FF' },
	'base-sepolia': { bg: 'bg-[#0052FF]/10', text: 'text-[#0052FF]/70', abbr: 'B', hex: '#0052FF' },
	arbitrum: { bg: 'bg-[#28A0F0]/15', text: 'text-[#28A0F0]', abbr: 'A', hex: '#28A0F0' },
	'arbitrum-sepolia': { bg: 'bg-[#28A0F0]/10', text: 'text-[#28A0F0]/70', abbr: 'A', hex: '#28A0F0' },
};

const DEFAULT_META: NetworkMeta = {
	bg: 'bg-stone-500/15',
	text: 'text-stone-400',
	abbr: '?',
	hex: '#78716c',
};

export function getNetworkMeta(networkName: string): NetworkMeta {
	return META[networkName] ?? DEFAULT_META;
}

/* ========================================================================== */
/*  Static fallback networks — used when API is unavailable                     */
/* ========================================================================== */

export const FALLBACK_NETWORKS: Network[] = [
	{
		id: 'fallback-mainnet',
		name: 'mainnet',
		displayName: 'Ethereum',
		chainId: 1,
		rpcUrl: 'https://eth.llamarpc.com',
		explorerUrl: 'https://etherscan.io',
		nativeCurrency: 'ETH',
		isTestnet: false,
		enabled: true,
	},
	{
		id: 'fallback-base',
		name: 'base',
		displayName: 'Base',
		chainId: 8453,
		rpcUrl: 'https://mainnet.base.org',
		explorerUrl: 'https://basescan.org',
		nativeCurrency: 'ETH',
		isTestnet: false,
		enabled: true,
	},
	{
		id: 'fallback-arbitrum',
		name: 'arbitrum',
		displayName: 'Arbitrum One',
		chainId: 42161,
		rpcUrl: 'https://arb1.arbitrum.io/rpc',
		explorerUrl: 'https://arbiscan.io',
		nativeCurrency: 'ETH',
		isTestnet: false,
		enabled: true,
	},
	{
		id: 'fallback-sepolia',
		name: 'sepolia',
		displayName: 'Sepolia',
		chainId: 11155111,
		rpcUrl: 'https://rpc.sepolia.org',
		explorerUrl: 'https://sepolia.etherscan.io',
		nativeCurrency: 'ETH',
		isTestnet: true,
		enabled: true,
	},
	{
		id: 'fallback-base-sepolia',
		name: 'base-sepolia',
		displayName: 'Base Sepolia',
		chainId: 84532,
		rpcUrl: 'https://sepolia.base.org',
		explorerUrl: 'https://sepolia.basescan.org',
		nativeCurrency: 'ETH',
		isTestnet: true,
		enabled: true,
	},
	{
		id: 'fallback-arbitrum-sepolia',
		name: 'arbitrum-sepolia',
		displayName: 'Arbitrum Sepolia',
		chainId: 421614,
		rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
		explorerUrl: 'https://sepolia.arbiscan.io',
		nativeCurrency: 'ETH',
		isTestnet: true,
		enabled: true,
	},
];
