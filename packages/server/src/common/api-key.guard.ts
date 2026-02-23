import {
	type CanActivate,
	type ExecutionContext,
	Inject,
	Injectable,
	Logger,
	UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { hashApiKey } from './crypto-utils.js';
import { SupabaseService } from './supabase.service.js';

@Injectable()
export class ApiKeyGuard implements CanActivate {
	private readonly logger = new Logger(ApiKeyGuard.name);

	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const apiKey = request.headers['x-api-key'];

		if (!apiKey || typeof apiKey !== 'string') {
			this.logger.warn(`Auth failed: missing x-api-key header (${request.method} ${request.url})`);
			throw new UnauthorizedException('Missing x-api-key header');
		}

		const hash = hashApiKey(apiKey);

		const { data, error } = await this.supabase.client
			.from('signers')
			.select('id, status')
			.eq('api_key_hash', hash)
			.single();

		if (error || !data) {
			this.logger.warn(
				`Auth failed: no signer found for key hash ${hash.slice(0, 12)}... (${request.method} ${request.url})`,
			);
			throw new UnauthorizedException('Invalid API key');
		}

		if (data.status !== 'active') {
			this.logger.warn(`Auth failed: signer ${(data.id as string).slice(0, 8)} is ${data.status}`);
			throw new UnauthorizedException(`Signer is ${data.status}`);
		}

		this.logger.debug(
			`Auth OK: signer=${(data.id as string).slice(0, 8)} (${request.method} ${request.url})`,
		);
		request.signerId = data.id as string;

		return true;
	}
}
