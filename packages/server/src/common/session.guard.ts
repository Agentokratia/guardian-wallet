import {
	type CanActivate,
	type ExecutionContext,
	Inject,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

@Injectable()
export class SessionGuard implements CanActivate {
	constructor(@Inject(SessionService) private readonly sessionService: SessionService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const token =
			request.cookies?.session || this.extractBearerToken(request.headers.authorization);

		if (!token) {
			throw new UnauthorizedException('Missing session token');
		}

		const payload = this.sessionService.validateToken(token);
		if (!payload) {
			throw new UnauthorizedException('Invalid or expired session');
		}

		request.sessionUser = payload.sub.toLowerCase();

		return true;
	}

	private extractBearerToken(header: string | undefined): string | undefined {
		if (!header?.startsWith('Bearer ')) return undefined;
		return header.slice(7);
	}
}
