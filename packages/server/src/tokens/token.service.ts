import type { EthereumChain } from '@agentokratia/guardian-chains';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ChainRegistryService } from '../common/chain.module.js';
import { NetworkService } from '../networks/network.service.js';
import { type TokenInfo, TokenRepository } from './token.repository.js';

export interface TokenWithBalance extends TokenInfo {
	balance: string;
}

const TOKEN_BALANCE_CACHE_TTL = 15_000;
const tokenBalanceCache = new Map<
	string,
	{ data: { address: string; chainId: number; tokens: TokenWithBalance[] }; ts: number }
>();

@Injectable()
export class TokenService {
	private readonly logger = new Logger(TokenService.name);

	constructor(
		@Inject(TokenRepository) private readonly repo: TokenRepository,
		@Inject(NetworkService) private readonly networkService: NetworkService,
		@Inject(ChainRegistryService) private readonly chainRegistry: ChainRegistryService,
	) {}

	async getTokensForSigner(signerId: string, chainId: number): Promise<TokenInfo[]> {
		const network = await this.networkService.getByChainId(chainId);
		const networkTokens = await this.repo.findNetworkTokens(network.id);
		const signerTokens = await this.repo.findSignerTokens(signerId, chainId);

		// Merge and deduplicate by address (network defaults first)
		const seen = new Set<string>();
		const merged: TokenInfo[] = [];

		for (const token of networkTokens) {
			const key = token.address?.toLowerCase() ?? '__native__';
			if (!seen.has(key)) {
				seen.add(key);
				merged.push(token);
			}
		}

		for (const token of signerTokens) {
			const key = token.address?.toLowerCase() ?? '__native__';
			if (!seen.has(key)) {
				seen.add(key);
				merged.push(token);
			}
		}

		return merged;
	}

	async getTokenBalances(
		signerId: string,
		ethAddress: string,
		chainId: number,
	): Promise<{ address: string; chainId: number; tokens: TokenWithBalance[] }> {
		const cacheKey = `${signerId}:${ethAddress}:${chainId}`;
		const cached = tokenBalanceCache.get(cacheKey);
		if (cached && Date.now() - cached.ts < TOKEN_BALANCE_CACHE_TTL) {
			return cached.data;
		}

		const tokens = await this.getTokensForSigner(signerId, chainId);
		const chain = await this.chainRegistry.getChain(chainId);
		const ethChain = chain as EthereumChain;

		const RPC_TIMEOUT = 3_000;
		const timeout = (ms: number) =>
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

		const results = await Promise.allSettled(
			tokens.map(async (token): Promise<TokenWithBalance> => {
				let balance: bigint;
				if (token.isNative) {
					balance = await Promise.race([chain.getBalance(ethAddress), timeout(RPC_TIMEOUT)]);
				} else if (token.address) {
					balance = await Promise.race([
						ethChain.getTokenBalance(token.address, ethAddress),
						timeout(RPC_TIMEOUT),
					]);
				} else {
					balance = 0n;
				}
				return { ...token, balance: balance.toString() };
			}),
		);

		const tokensWithBalances: TokenWithBalance[] = results.map((r, i) =>
			r.status === 'fulfilled' ? r.value : { ...tokens[i]!, balance: '0' },
		);

		const response = { address: ethAddress, chainId, tokens: tokensWithBalances };
		tokenBalanceCache.set(cacheKey, { data: response, ts: Date.now() });
		return response;
	}

	async addToken(
		signerId: string,
		chainId: number,
		symbol: string,
		name: string,
		address: string,
		decimals: number,
	): Promise<TokenInfo> {
		try {
			const result = await this.repo.addSignerToken(
				signerId,
				chainId,
				symbol,
				name,
				address,
				decimals,
			);
			this.invalidateBalanceCache(signerId, chainId);
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to add token';
			if (message.includes('already tracked')) {
				throw new ConflictException(message);
			}
			throw err;
		}
	}

	async removeToken(tokenId: string, signerId: string): Promise<boolean> {
		const result = await this.repo.removeSignerToken(tokenId, signerId);
		// Invalidate all cache entries for this signer
		for (const key of tokenBalanceCache.keys()) {
			if (key.startsWith(`${signerId}:`)) {
				tokenBalanceCache.delete(key);
			}
		}
		return result;
	}

	private invalidateBalanceCache(signerId: string, chainId?: number): void {
		for (const key of tokenBalanceCache.keys()) {
			if (chainId) {
				if (key.startsWith(`${signerId}:`) && key.endsWith(`:${chainId}`)) {
					tokenBalanceCache.delete(key);
				}
			} else if (key.startsWith(`${signerId}:`)) {
				tokenBalanceCache.delete(key);
			}
		}
	}
}
