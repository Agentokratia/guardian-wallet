import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';

export interface NetworkRow {
	id: string;
	name: string;
	display_name: string;
	chain_id: number;
	rpc_url: string;
	explorer_url: string | null;
	native_currency: string;
	is_testnet: boolean;
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

export interface Network {
	id: string;
	name: string;
	displayName: string;
	chainId: number;
	rpcUrl: string;
	explorerUrl: string | null;
	nativeCurrency: string;
	isTestnet: boolean;
	enabled: boolean;
}

function rowToDomain(row: NetworkRow): Network {
	return {
		id: row.id,
		name: row.name,
		displayName: row.display_name,
		chainId: row.chain_id,
		rpcUrl: row.rpc_url,
		explorerUrl: row.explorer_url,
		nativeCurrency: row.native_currency,
		isTestnet: row.is_testnet,
		enabled: row.enabled,
	};
}

@Injectable()
export class NetworkRepository {
	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findAllEnabled(): Promise<Network[]> {
		const { data, error } = await this.supabase.client
			.from('networks')
			.select('*')
			.eq('enabled', true)
			.order('name', { ascending: true });

		if (error || !data) return [];
		return (data as NetworkRow[]).map(rowToDomain);
	}

	async findByChainId(chainId: number): Promise<Network | null> {
		const { data, error } = await this.supabase.client
			.from('networks')
			.select('*')
			.eq('chain_id', chainId)
			.eq('enabled', true)
			.single();

		if (error || !data) return null;
		return rowToDomain(data as NetworkRow);
	}

	async findByName(name: string): Promise<Network | null> {
		const { data, error } = await this.supabase.client
			.from('networks')
			.select('*')
			.eq('name', name)
			.eq('enabled', true)
			.single();

		if (error || !data) return null;
		return rowToDomain(data as NetworkRow);
	}
}
