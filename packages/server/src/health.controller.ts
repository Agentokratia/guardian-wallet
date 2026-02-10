import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { IVaultStore } from '@agentokratia/guardian-core';
import type { Response } from 'express';
import { SupabaseService } from './common/supabase.service.js';
import { VAULT_STORE } from './common/vault.module.js';

@Controller('health')
export class HealthController {
	constructor(
		@Inject(SupabaseService) private readonly supabase: SupabaseService,
		@Inject(VAULT_STORE) private readonly vault: IVaultStore,
	) {}

	@Get()
	async check(@Res() res: Response) {
		const [vaultOk, dbOk] = await Promise.all([
			this.vault.healthCheck(),
			this.supabase.healthCheck(),
		]);

		const healthy = vaultOk && dbOk;

		res.status(healthy ? 200 : 503).json({
			status: healthy ? 'ok' : 'degraded',
			uptime: Math.floor(process.uptime()),
			vault: { connected: vaultOk },
			db: dbOk,
			timestamp: new Date().toISOString(),
		});
	}
}
