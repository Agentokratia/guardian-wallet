import { Inject, Injectable } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { APP_CONFIG, type AppConfig } from './config.js';

@Injectable()
export class SupabaseService {
	public readonly client: SupabaseClient;

	constructor(@Inject(APP_CONFIG) config: AppConfig) {
		this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
	}

	async healthCheck(): Promise<boolean> {
		try {
			const { error } = await this.client.from('signers').select('id').limit(1);
			return !error;
		} catch {
			return false;
		}
	}
}
