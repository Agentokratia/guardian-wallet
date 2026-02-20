import {
	type CanActivate,
	type ExecutionContext,
	Inject,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import { SignerRepository } from '../signers/signer.repository.js';
import { AnonAuthGuard } from './anon-auth.guard.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { extractBearerToken } from './extract-bearer-token.js';
import { SessionGuard } from './session.guard.js';

/**
 * Accepts either session auth (dashboard signers) or anonymous admin auth
 * (CLI signers via X-Admin-Token header — raw hash or short-lived JWT).
 *
 * Tries SessionGuard first, then AnonAuthGuard.
 * Guards constructed manually — NestJS @UseGuards auto-resolves DI,
 * but @Inject requires explicit provider registration.
 */
@Injectable()
export class EitherAdminGuard implements CanActivate {
	private readonly sessionGuard: SessionGuard;
	private readonly anonGuard: AnonAuthGuard;

	constructor(
		@Inject(SessionService) sessionService: SessionService,
		@Inject(SignerRepository) signerRepo: SignerRepository,
	) {
		this.sessionGuard = new SessionGuard(sessionService);
		this.anonGuard = new AnonAuthGuard(signerRepo, sessionService);
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

		// Try session auth first (dashboard)
		const token = request.cookies?.session || extractBearerToken(request.headers.authorization);
		if (token) {
			try {
				return await this.sessionGuard.canActivate(context);
			} catch {
				// Session auth failed — fall through to anon auth
			}
		}

		// Try anonymous admin auth (CLI — X-Admin-Token header)
		const adminToken = request.headers['x-admin-token'];
		if (adminToken) {
			try {
				return await this.anonGuard.canActivate(context);
			} catch {
				// Anon auth failed — fall through to error
			}
		}

		throw new UnauthorizedException('Missing or invalid authentication');
	}
}
