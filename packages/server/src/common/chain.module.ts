import { EthereumChain } from '@agentokratia/guardian-chains';
import type { IChain } from '@agentokratia/guardian-core';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { NetworkService } from '../networks/network.service.js';

@Injectable()
export class ChainRegistryService {
	private readonly chains = new Map<number, EthereumChain>();

	constructor(@Inject(NetworkService) private readonly networkService: NetworkService) {}

	async getChain(chainId: number): Promise<IChain> {
		const cached = this.chains.get(chainId);
		if (cached) return cached;

		const network = await this.networkService.getByChainId(chainId);
		const chain = new EthereumChain(network.chainId, network.name, network.rpcUrl);
		this.chains.set(chainId, chain);
		return chain;
	}

	async getChainByName(networkName: string): Promise<IChain> {
		const network = await this.networkService.getByName(networkName);
		const cached = this.chains.get(network.chainId);
		if (cached) return cached;

		const chain = new EthereumChain(network.chainId, network.name, network.rpcUrl);
		this.chains.set(network.chainId, chain);
		return chain;
	}

	invalidateCache(chainId?: number): void {
		if (chainId !== undefined) {
			this.chains.delete(chainId);
		} else {
			this.chains.clear();
		}
	}
}

@Global()
@Module({
	providers: [ChainRegistryService],
	exports: [ChainRegistryService],
})
export class ChainModule {}
