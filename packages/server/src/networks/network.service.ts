import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { type Network, NetworkRepository } from './network.repository.js';

const CACHE_TTL_MS = 60_000;

@Injectable()
export class NetworkService implements OnModuleInit {
	private readonly logger = new Logger(NetworkService.name);
	private cache: Network[] = [];
	private byChainId = new Map<number, Network>();
	private byName = new Map<string, Network>();
	private lastRefresh = 0;

	constructor(@Inject(NetworkRepository) private readonly repo: NetworkRepository) {}

	async onModuleInit(): Promise<void> {
		await this.refresh();
		this.logger.log(`Loaded ${this.cache.length} networks`);
	}

	async listEnabled(): Promise<Network[]> {
		await this.refreshIfStale();
		return this.cache;
	}

	async getByChainId(chainId: number): Promise<Network> {
		await this.refreshIfStale();
		const network = this.byChainId.get(chainId);
		if (!network) {
			throw new NotFoundException(`No enabled network with chainId ${chainId}`);
		}
		return network;
	}

	async getByName(name: string): Promise<Network> {
		await this.refreshIfStale();
		const network = this.byName.get(name);
		if (!network) {
			throw new NotFoundException(`No enabled network named "${name}"`);
		}
		return network;
	}

	private async refreshIfStale(): Promise<void> {
		if (Date.now() - this.lastRefresh > CACHE_TTL_MS) {
			await this.refresh();
		}
	}

	private async refresh(): Promise<void> {
		try {
			const networks = await this.repo.findAllEnabled();
			this.cache = networks;
			this.byChainId = new Map(networks.map((n) => [n.chainId, n]));
			this.byName = new Map(networks.map((n) => [n.name, n]));
			this.lastRefresh = Date.now();
		} catch (err) {
			this.logger.error(`Failed to refresh networks cache: ${err}`);
			// Keep stale cache on error
		}
	}
}
