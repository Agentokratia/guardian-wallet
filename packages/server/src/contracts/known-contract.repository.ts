import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';

export interface KnownContractRow {
	id: string;
	protocol: string;
	name: string;
	address: string;
	chain_id: number;
	contract_type: string;
	verified: boolean;
	source: string | null;
	tags: string[];
	added_by: string | null;
	created_at: string;
}

export interface KnownContract {
	id: string;
	protocol: string;
	name: string;
	address: string;
	chainId: number;
	contractType: string;
	verified: boolean;
	source: string | null;
	tags: string[];
	addedBy: string | null;
	createdAt: string;
}

@Injectable()
export class KnownContractRepository {
	private readonly tableName = 'known_contracts';

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findByChain(chainId: number): Promise<KnownContract[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('chain_id', chainId)
			.order('protocol', { ascending: true });

		if (error || !data) return [];
		return (data as KnownContractRow[]).map((row) => this.toDomain(row));
	}

	async findAll(): Promise<KnownContract[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.order('protocol', { ascending: true });

		if (error || !data) return [];
		return (data as KnownContractRow[]).map((row) => this.toDomain(row));
	}

	async create(dto: {
		protocol: string;
		name: string;
		address: string;
		chainId: number;
		contractType?: string;
		source?: string;
		tags?: string[];
		addedBy?: string;
	}): Promise<KnownContract> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.insert({
				protocol: dto.protocol,
				name: dto.name,
				address: dto.address,
				chain_id: dto.chainId,
				contract_type: dto.contractType ?? 'router',
				source: dto.source ?? null,
				tags: dto.tags ?? [],
				added_by: dto.addedBy ?? null,
			})
			.select('*')
			.single();

		if (error || !data) {
			if (error?.code === '23505') {
				throw new Error('Contract already exists for this chain');
			}
			throw new Error(`Failed to create known contract: ${error?.message ?? 'unknown'}`);
		}
		return this.toDomain(data as KnownContractRow);
	}

	async delete(id: string): Promise<void> {
		const { error } = await this.supabase.client.from(this.tableName).delete().eq('id', id);

		if (error) {
			throw new Error(`Failed to delete known contract: ${error.message}`);
		}
	}

	private toDomain(row: KnownContractRow): KnownContract {
		return {
			id: row.id,
			protocol: row.protocol,
			name: row.name,
			address: row.address,
			chainId: row.chain_id,
			contractType: row.contract_type,
			verified: row.verified,
			source: row.source,
			tags: row.tags ?? [],
			addedBy: row.added_by,
			createdAt: row.created_at,
		};
	}
}
