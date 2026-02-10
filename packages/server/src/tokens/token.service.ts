import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { EthereumChain } from '@agentokratia/guardian-chains';
import { ChainRegistryService } from '../common/chain.module.js';
import { NetworkService } from '../networks/network.service.js';
import { type TokenInfo, TokenRepository } from './token.repository.js';

export interface TokenWithBalance extends TokenInfo {
	balance: string;
}

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
		const tokens = await this.getTokensForSigner(signerId, chainId);
		const chain = await this.chainRegistry.getChain(chainId);
		const ethChain = chain as EthereumChain;

		const tokensWithBalances = await Promise.all(
			tokens.map(async (token): Promise<TokenWithBalance> => {
				try {
					let balance: bigint;
					if (token.isNative) {
						balance = await chain.getBalance(ethAddress);
					} else if (token.address) {
						balance = await ethChain.getTokenBalance(token.address, ethAddress);
					} else {
						balance = 0n;
					}
					return { ...token, balance: balance.toString() };
				} catch (err) {
					this.logger.warn(`Failed to fetch balance for ${token.symbol}: ${err}`);
					return { ...token, balance: '0' };
				}
			}),
		);

		return { address: ethAddress, chainId, tokens: tokensWithBalances };
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
			return await this.repo.addSignerToken(signerId, chainId, symbol, name, address, decimals);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to add token';
			if (message.includes('already tracked')) {
				throw new ConflictException(message);
			}
			throw err;
		}
	}

	async removeToken(tokenId: string, signerId: string): Promise<boolean> {
		return this.repo.removeSignerToken(tokenId, signerId);
	}
}
