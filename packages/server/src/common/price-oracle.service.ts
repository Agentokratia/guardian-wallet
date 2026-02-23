/**
 * Price oracle — fetches USD prices for native tokens and ERC-20s.
 *
 * Uses NetworkService to resolve chainId → CoinGecko IDs dynamically.
 * Testnets reuse their mainnet token prices (ETH testnet → ETH price).
 *
 * Primary: CoinGecko simple API (free, no key, 30 calls/min).
 * Cache: 5-minute TTL in-memory.
 * Fallback: cache (5min) → CoinGecko fetch → last known price (max 1h stale) → fail-closed.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Network } from '../networks/network.repository.js';
import { NetworkService } from '../networks/network.service.js';

interface CacheEntry {
	price: number;
	fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_MAX_MS = 60 * 60 * 1000; // 1 hour — after this, fail-closed
const CACHE_MAX_ENTRIES = 500; // prevent unbounded memory growth
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Map native currency symbol → CoinGecko token id for price lookups. */
const CURRENCY_TO_COINGECKO_ID: Record<string, string> = {
	ETH: 'ethereum',
	POL: 'matic-network',
	MATIC: 'matic-network',
	BNB: 'binancecoin',
	AVAX: 'avalanche-2',
	FTM: 'fantom',
	SOL: 'solana',
};

/** Map network name → CoinGecko platform id for ERC-20 token price lookups. */
const NETWORK_TO_PLATFORM: Record<string, string> = {
	mainnet: 'ethereum',
	base: 'base',
	arbitrum: 'arbitrum-one',
	optimism: 'optimistic-ethereum',
	polygon: 'polygon-pos',
	// Testnets use their mainnet platform for ERC-20 lookups
	sepolia: 'ethereum',
	'base-sepolia': 'base',
	'arbitrum-sepolia': 'arbitrum-one',
	'optimism-sepolia': 'optimistic-ethereum',
	'polygon-amoy': 'polygon-pos',
};

@Injectable()
export class PriceOracleService {
	private readonly logger = new Logger(PriceOracleService.name);
	private readonly cache = new Map<string, CacheEntry>();

	constructor(@Inject(NetworkService) private readonly networkService: NetworkService) {}

	/**
	 * Get USD price of the chain's native token (ETH, MATIC, etc).
	 * Returns null if price unavailable and no stale cache.
	 */
	async getNativePrice(chainId: number): Promise<number | null> {
		let network: Network;
		try {
			network = await this.networkService.getByChainId(chainId);
		} catch {
			return null; // unknown chain
		}

		const tokenId = CURRENCY_TO_COINGECKO_ID[network.nativeCurrency];
		if (!tokenId) return null;

		const cacheKey = `native:${tokenId}`;
		return this.getPriceWithCache(cacheKey, () => this.fetchNativePrice(tokenId));
	}

	/**
	 * Get USD price of an ERC-20 token by contract address.
	 * Returns null if price unavailable.
	 */
	async getTokenPrice(chainId: number, contractAddress: string): Promise<number | null> {
		let network: Network;
		try {
			network = await this.networkService.getByChainId(chainId);
		} catch {
			return null;
		}

		const platform = NETWORK_TO_PLATFORM[network.name];
		if (!platform) return null;

		const cacheKey = `token:${platform}:${contractAddress.toLowerCase()}`;
		return this.getPriceWithCache(cacheKey, () => this.fetchTokenPrice(platform, contractAddress));
	}

	private async getPriceWithCache(
		key: string,
		fetcher: () => Promise<number | null>,
	): Promise<number | null> {
		const cached = this.cache.get(key);
		const now = Date.now();

		// Fresh cache hit
		if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
			return cached.price;
		}

		// Try fetch
		try {
			const price = await fetcher();
			if (price !== null && price > 0) {
				// Evict oldest entries if cache is full
				if (this.cache.size >= CACHE_MAX_ENTRIES) {
					const firstKey = this.cache.keys().next().value;
					if (firstKey !== undefined) this.cache.delete(firstKey);
				}
				this.cache.set(key, { price, fetchedAt: now });
				return price;
			}
		} catch (err) {
			this.logger.warn(`Price fetch failed for ${key}: ${String(err)}`);
		}

		// Stale cache fallback (max 1h)
		if (cached && now - cached.fetchedAt < STALE_MAX_MS) {
			this.logger.warn(
				`Using stale price for ${key} (age: ${Math.round((now - cached.fetchedAt) / 1000)}s)`,
			);
			return cached.price;
		}

		// Fail-closed: no price available
		return null;
	}

	private async fetchNativePrice(tokenId: string): Promise<number | null> {
		const url = `${COINGECKO_BASE}/simple/price?ids=${tokenId}&vs_currencies=usd`;
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;

		const data = (await res.json()) as Record<string, { usd?: number }>;
		return data[tokenId]?.usd ?? null;
	}

	private async fetchTokenPrice(platform: string, contractAddress: string): Promise<number | null> {
		const addr = contractAddress.toLowerCase();
		const url = `${COINGECKO_BASE}/simple/token_price/${platform}?contract_addresses=${addr}&vs_currencies=usd`;
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;

		const data = (await res.json()) as Record<string, { usd?: number }>;
		return data[addr]?.usd ?? null;
	}
}
