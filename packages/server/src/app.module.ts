import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ChainModule } from './common/chain.module.js';
import { ConfigModule } from './common/config.module.js';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';
import { ShareStoreModule } from './common/share-store.module.js';
import { SupabaseModule } from './common/supabase.module.js';
import { DKGModule } from './dkg/dkg.module.js';
import { HealthController } from './health.controller.js';
import { NetworkModule } from './networks/network.module.js';
import { PolicyModule } from './policies/policy.module.js';
import { SignerModule } from './signers/signer.module.js';
import { SigningModule } from './signing/signing.module.js';
import { TokenModule } from './tokens/token.module.js';

@Module({
	imports: [
		ConfigModule,
		SupabaseModule,
		ShareStoreModule,
		NetworkModule,
		ChainModule,
		AuthModule,
		SignerModule,
		DKGModule,
		PolicyModule,
		AuditModule,
		SigningModule,
		TokenModule,
	],
	controllers: [HealthController],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
export class AppModule {}
