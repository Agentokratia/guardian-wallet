import { Global, Module } from '@nestjs/common';
import { VaultStoreProvider } from './vault-store.provider.js';

export const VAULT_STORE = Symbol('VAULT_STORE');

@Global()
@Module({
	providers: [
		{
			provide: VAULT_STORE,
			useClass: VaultStoreProvider,
		},
	],
	exports: [VAULT_STORE],
})
export class VaultModule {}
