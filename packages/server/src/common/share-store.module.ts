import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import type { IKmsProvider } from '@agentokratia/guardian-core';
import { APP_CONFIG, type AppConfig } from './config.js';
import { VaultKvShareStore } from './vault-kv-share-store.js';
import { SupabaseService } from './supabase.service.js';
import { LocalFileKmsProvider } from '../kms/local-file.provider.js';
import { EnvelopeStoreProvider } from '../kms/envelope-store.provider.js';

export const SHARE_STORE = Symbol('SHARE_STORE');

function createKmsProvider(config: AppConfig): IKmsProvider {
	switch (config.KMS_PROVIDER) {
		case 'local-file':
			return new LocalFileKmsProvider({ keyFilePath: config.KMS_LOCAL_KEY_FILE });
		default:
			throw new Error(`Unknown KMS provider: ${config.KMS_PROVIDER}`);
	}
}

let activeKms: IKmsProvider | null = null;

@Global()
@Module({
	providers: [
		{
			provide: SHARE_STORE,
			useFactory: (config: AppConfig, supabase: SupabaseService) => {
				if (config.KMS_PROVIDER === 'vault-kv') {
					activeKms = null;
					return new VaultKvShareStore(config);
				}
				activeKms = createKmsProvider(config);
				return new EnvelopeStoreProvider(activeKms, supabase.client);
			},
			inject: [APP_CONFIG, SupabaseService],
		},
	],
	exports: [SHARE_STORE],
})
export class ShareStoreModule implements OnModuleDestroy {
	async onModuleDestroy() {
		await activeKms?.destroy();
		activeKms = null;
	}
}
