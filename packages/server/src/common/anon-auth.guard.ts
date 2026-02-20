import {
	type CanActivate,
	type ExecutionContext,
	Inject,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import { SignerRepository } from '../signers/signer.repository.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { hashApiKey, timingSafeCompare } from './crypto-utils.js';

/**
 * Validates anonymous admin auth via X-Admin-Token header.
 *
 * Supports two token formats:
 * 1. **Short-lived JWT** (preferred) — issued by POST /auth/admin-token.
 *    Detected by `eyJ` prefix. Verified via SessionService. Limits replay window to 5 min.
 * 2. **Raw hash** (fallback) — SHA256(userShareBase64). Server double-hashes
 *    and compares against stored owner_address (prefixed with 'sha256:').
 *
 * Sets req.signerId on success — same as ApiKeyGuard.
 *
 * Always throws UnauthorizedException on failure — never reveals signer existence.
 */
@Injectable()
export class AnonAuthGuard implements CanActivate {
	constructor(
		@Inject(SignerRepository) private readonly signerRepo: SignerRepository,
		@Inject(SessionService) private readonly sessionService: SessionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const adminToken = req.headers['x-admin-token'] as string | undefined;

		if (!adminToken) {
			throw new UnauthorizedException('Missing X-Admin-Token header');
		}

		// Short-lived admin JWT — preferred path (limits replay window)
		if (adminToken.startsWith('eyJ')) {
			const payload = this.sessionService.validateToken(adminToken);
			if (!payload || payload.type !== 'anon-admin') {
				throw new UnauthorizedException('Invalid or expired admin token');
			}

			const signer = await this.signerRepo.findById(payload.sub);
			if (!signer) {
				throw new UnauthorizedException('Invalid credential');
			}

			req.signerId = payload.sub;
			return true;
		}

		// Raw hash fallback — used for initial token exchange and backward compat
		const signerId =
			(req.headers['x-signer-id'] as string | undefined) ?? (req.params.id as string | undefined);

		if (!signerId) {
			throw new UnauthorizedException('Missing signer ID (X-Signer-Id header or URL param)');
		}

		const doubleHash = hashApiKey(adminToken);
		const signer = await this.signerRepo.findById(signerId);

		// Same error for missing signer and wrong credential — don't leak signer existence
		if (!signer || !timingSafeCompare(signer.ownerAddress, `sha256:${doubleHash}`)) {
			throw new UnauthorizedException('Invalid credential');
		}

		req.signerId = signerId;
		return true;
	}
}
