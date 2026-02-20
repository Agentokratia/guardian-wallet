import {
	type CanActivate,
	type ExecutionContext,
	Inject,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { hashApiKey } from './crypto-utils.js';
import { extractBearerToken } from './extract-bearer-token.js';
import { SupabaseService } from './supabase.service.js';

/**
 * Accepts either a valid session token (JWT cookie / Bearer)
 * or a valid x-api-key header. At least one must be present.
 */
@Injectable()
export class EitherAuthGuard implements CanActivate {
	constructor(
		@Inject(SessionService) private readonly sessionService: SessionService,
		@Inject(SupabaseService) private readonly supabase: SupabaseService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

		// Try session auth first (dashboard)
		const token = request.cookies?.session || extractBearerToken(request.headers.authorization);
		if (token) {
			const payload = this.sessionService.validateToken(token);
			if (payload) {
				request.sessionUser = payload.address?.toLowerCase() ?? payload.sub.toLowerCase();
				request.sessionEmail = payload.email;
				request.sessionUserId = payload.sub;
				return true;
			}
		}

		// Try API key auth (CLI / SDK)
		const apiKey = request.headers['x-api-key'];
		if (apiKey && typeof apiKey === 'string') {
			const hash = hashApiKey(apiKey);
			const { data, error } = await this.supabase.client
				.from('signers')
				.select('id, status')
				.eq('api_key_hash', hash)
				.single();

			if (!error && data) {
				if (data.status !== 'active') {
					throw new UnauthorizedException(`Signer is ${data.status}`);
				}
				request.signerId = data.id as string;
				return true;
			}
		}

		throw new UnauthorizedException('Missing or invalid authentication');
	}
}
