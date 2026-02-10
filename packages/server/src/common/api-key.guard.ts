import {
	type CanActivate,
	type ExecutionContext,
	Inject,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { hashApiKey } from './crypto-utils.js';
import { SupabaseService } from './supabase.service.js';

@Injectable()
export class ApiKeyGuard implements CanActivate {
	constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const apiKey = request.headers['x-api-key'];

		if (!apiKey || typeof apiKey !== 'string') {
			throw new UnauthorizedException('Missing x-api-key header');
		}

		const hash = hashApiKey(apiKey);

		const { data, error } = await this.supabase.client
			.from('signers')
			.select('id, status')
			.eq('api_key_hash', hash)
			.single();

		if (error || !data) {
			throw new UnauthorizedException('Invalid API key');
		}

		if (data.status !== 'active') {
			throw new UnauthorizedException(`Signer is ${data.status}`);
		}

		request.signerId = data.id as string;

		return true;
	}
}
