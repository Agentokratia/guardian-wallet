import { Inject, Injectable } from '@nestjs/common';
import type { Signer } from '@agentokratia/guardian-core';
import { SupabaseService } from '../common/supabase.service.js';
import {
	type CreateSignerData,
	type SignerRow,
	signerDomainToRow,
	signerRowToDomain,
} from './signer.types.js';

@Injectable()
export class SignerRepository {
	private readonly tableName = 'signers';

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findById(id: string): Promise<Signer | null> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('id', id)
			.single();

		if (error || !data) return null;
		return signerRowToDomain(data as SignerRow);
	}

	async findAll(): Promise<Signer[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.order('created_at', { ascending: false });

		if (error || !data) return [];
		return (data as SignerRow[]).map((row) => signerRowToDomain(row));
	}

	async findByOwner(ownerAddress: string): Promise<Signer[]> {
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.select('*')
			.eq('owner_address', ownerAddress.toLowerCase())
			.order('created_at', { ascending: false });

		if (error || !data) return [];
		return (data as SignerRow[]).map((row) => signerRowToDomain(row));
	}

	async create(input: CreateSignerData): Promise<Signer> {
		const row: Record<string, unknown> = {
			name: input.name,
			description: input.description ?? null,
			type: input.type,
			eth_address: input.ethAddress,
			chain: input.chain,
			scheme: input.scheme,
			owner_address: input.ownerAddress.toLowerCase(),
			api_key_hash: input.apiKeyHash,
			vault_share_path: input.vaultSharePath,
		};
		if (input.network) {
			row.network = input.network;
		}
		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.insert(row)
			.select('*')
			.single();

		if (error || !data) {
			throw new Error(`Failed to create signer: ${error?.message ?? 'unknown'}`);
		}

		return signerRowToDomain(data as SignerRow);
	}

	async update(id: string, partial: Partial<Signer>): Promise<Signer> {
		const row = signerDomainToRow(partial);

		const { data, error } = await this.supabase.client
			.from(this.tableName)
			.update(row)
			.eq('id', id)
			.select('*')
			.single();

		if (error || !data) {
			throw new Error(`Failed to update signer: ${error?.message ?? 'unknown'}`);
		}

		return signerRowToDomain(data as SignerRow);
	}

}
