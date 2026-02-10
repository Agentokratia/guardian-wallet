import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';

export interface NetworkTokenRow {
	id: string;
	network_id: string;
	symbol: string;
	name: string;
	address: string | null;
	decimals: number;
	is_native: boolean;
	logo_url: string | null;
	sort_order: number;
}

export interface SignerTokenRow {
	id: string;
	signer_id: string;
	chain_id: number;
	symbol: string;
	name: string;
	address: string;
	decimals: number;
	logo_url: string | null;
	created_at: string;
}

export interface TokenInfo {
	id: string;
	symbol: string;
	name: string;
	address: string | null;
	decimals: number;
	isNative: boolean;
	logoUrl: string | null;
	source: 'network' | 'custom';
}

@Injectable()
export class TokenRepository {
	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async findNetworkTokens(networkId: string): Promise<TokenInfo[]> {
		const { data, error } = await this.supabase.client
			.from('network_tokens')
			.select('*')
			.eq('network_id', networkId)
			.order('sort_order', { ascending: true });

		if (error || !data) return [];
		return (data as NetworkTokenRow[]).map((row) => ({
			id: row.id,
			symbol: row.symbol,
			name: row.name,
			address: row.address,
			decimals: row.decimals,
			isNative: row.is_native,
			logoUrl: row.logo_url,
			source: 'network' as const,
		}));
	}

	async findSignerTokens(signerId: string, chainId: number): Promise<TokenInfo[]> {
		const { data, error } = await this.supabase.client
			.from('signer_tokens')
			.select('*')
			.eq('signer_id', signerId)
			.eq('chain_id', chainId)
			.order('created_at', { ascending: true });

		if (error || !data) return [];
		return (data as SignerTokenRow[]).map((row) => ({
			id: row.id,
			symbol: row.symbol,
			name: row.name,
			address: row.address,
			decimals: row.decimals,
			isNative: false,
			logoUrl: row.logo_url,
			source: 'custom' as const,
		}));
	}

	async addSignerToken(
		signerId: string,
		chainId: number,
		symbol: string,
		name: string,
		address: string,
		decimals: number,
	): Promise<TokenInfo> {
		const { data, error } = await this.supabase.client
			.from('signer_tokens')
			.insert({
				signer_id: signerId,
				chain_id: chainId,
				symbol,
				name,
				address,
				decimals,
			})
			.select('*')
			.single();

		if (error) {
			if (error.code === '23505') {
				throw new Error('Token already tracked for this account');
			}
			throw new Error(`Failed to add token: ${error.message}`);
		}
		const row = data as SignerTokenRow;
		return {
			id: row.id,
			symbol: row.symbol,
			name: row.name,
			address: row.address,
			decimals: row.decimals,
			isNative: false,
			logoUrl: row.logo_url,
			source: 'custom',
		};
	}

	async removeSignerToken(tokenId: string, signerId: string): Promise<boolean> {
		const { error } = await this.supabase.client
			.from('signer_tokens')
			.delete()
			.eq('id', tokenId)
			.eq('signer_id', signerId);

		return !error;
	}
}
