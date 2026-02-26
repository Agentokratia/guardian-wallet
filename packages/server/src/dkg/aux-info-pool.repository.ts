import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service.js';

@Injectable()
export class AuxInfoPoolRepository {
	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	/** Insert a new unclaimed pool entry. Returns the row UUID. */
	async insert(auxInfoJson: string): Promise<string> {
		const { data, error } = await this.supabase.client
			.from('auxinfo_pool')
			.insert({ aux_info_json: auxInfoJson })
			.select('id')
			.single();

		if (error || !data) {
			throw new Error(`Failed to insert auxinfo pool entry: ${error?.message ?? 'unknown'}`);
		}

		return (data as { id: string }).id;
	}

	/**
	 * Atomically claim one unclaimed entry (FIFO, skip-locked).
	 * Returns the aux_info_json string, or null if pool is empty.
	 */
	async claimOne(): Promise<string | null> {
		const { data, error } = await this.supabase.client.rpc('claim_auxinfo_entry');

		if (error) {
			throw new Error(`claim_auxinfo_entry RPC failed: ${error.message}`);
		}

		return (data as string) ?? null;
	}

	/** Count of unclaimed entries. */
	async countUnclaimed(): Promise<number> {
		const { data, error } = await this.supabase.client.rpc('auxinfo_pool_count');

		if (error) {
			throw new Error(`auxinfo_pool_count RPC failed: ${error.message}`);
		}

		return Number(data) || 0;
	}

	/** Delete claimed entries older than 7 days to prevent table bloat. */
	async pruneOldClaimed(): Promise<number> {
		const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

		const { count, error } = await this.supabase.client
			.from('auxinfo_pool')
			.delete({ count: 'exact' })
			.not('claimed_at', 'is', null)
			.lt('claimed_at', cutoff);

		if (error) {
			throw new Error(`Failed to prune old claimed entries: ${error.message}`);
		}

		return count ?? 0;
	}
}
