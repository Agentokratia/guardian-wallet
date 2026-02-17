import type { IShareStore } from '@agentokratia/guardian-core';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from './common/config.js';
import { SHARE_STORE } from './common/share-store.module.js';
import { SupabaseService } from './common/supabase.service.js';
import { AuxInfoPoolService } from './dkg/aux-info-pool.service.js';

@Controller('health')
export class HealthController {
	constructor(
		@Inject(SupabaseService) private readonly supabase: SupabaseService,
		@Inject(SHARE_STORE) private readonly shareStore: IShareStore,
		@Inject(AuxInfoPoolService) private readonly auxInfoPool: AuxInfoPoolService,
		@Inject(APP_CONFIG) private readonly config: AppConfig,
	) {}

	@Get()
	async check(@Res() res: Response) {
		const [shareStoreOk, dbOk] = await Promise.all([
			this.shareStore.healthCheck(),
			this.supabase.healthCheck(),
		]);

		const healthy = shareStoreOk && dbOk;
		const poolStatus = this.auxInfoPool.getStatus();

		res.status(healthy ? 200 : 503).json({
			status: healthy ? 'ok' : 'degraded',
			uptime: Math.floor(process.uptime()),
			shareStore: {
				provider: this.config.KMS_PROVIDER,
				connected: shareStoreOk,
			},
			vault: { connected: shareStoreOk },
			db: dbOk,
			auxInfoPool: poolStatus,
			timestamp: new Date().toISOString(),
		});
	}
}
