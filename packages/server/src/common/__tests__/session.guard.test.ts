import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../../auth/session.service.js';
import { SessionGuard } from '../session.guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret-key-at-least-32-characters-long';

function createJwtService(): JwtService {
	return new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '15m' } });
}

function createSessionService(): SessionService {
	const jwtService = createJwtService();
	const mockSupabase = { client: { from: () => ({}) } } as never;
	return new (
		SessionService as unknown as new (
			jwtService: JwtService,
			supabase: unknown,
		) => SessionService
	)(jwtService, mockSupabase);
}

function signToken(
	payload: Record<string, unknown>,
	secret = JWT_SECRET,
	options?: { expiresIn?: string | number },
): string {
	const svc = new JwtService({
		secret,
		signOptions: options ? { expiresIn: options.expiresIn as never } : { expiresIn: '1h' as never },
	});
	return svc.sign(payload);
}

function makeContext(request: Record<string, unknown>): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => request,
		}),
	} as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionGuard', () => {
	let guard: SessionGuard;

	beforeEach(() => {
		const sessionService = createSessionService();
		guard = new SessionGuard(sessionService);
	});

	it('allows valid session cookie', async () => {
		const token = signToken({ sub: 'user-123', type: 'session' });

		const request: Record<string, unknown> = {
			cookies: { session: token },
			headers: {},
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUserId).toBe('user-123');
	});

	it('allows valid Bearer token', async () => {
		const token = signToken({ sub: 'user-456', type: 'session' });

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { authorization: `Bearer ${token}` },
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUserId).toBe('user-456');
	});

	it('throws UnauthorizedException for missing token', async () => {
		const request: Record<string, unknown> = {
			cookies: {},
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('throws UnauthorizedException for expired JWT', async () => {
		// Sign a token that's already expired
		const token = signToken({ sub: 'user-123', type: 'session' }, JWT_SECRET, {
			expiresIn: '0s',
		});
		// Wait a tick for it to expire
		await new Promise((r) => setTimeout(r, 10));

		const request: Record<string, unknown> = {
			cookies: { session: token },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('throws UnauthorizedException for tampered JWT signature', async () => {
		const token = signToken({ sub: 'user-123', type: 'session' });
		// Tamper with the signature
		const parts = token.split('.');
		const tamperedToken = `${parts[0]}.${parts[1]}.tampered-signature`;

		const request: Record<string, unknown> = {
			cookies: { session: tamperedToken },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('throws UnauthorizedException for malformed JWT (wrong number of parts)', async () => {
		const request: Record<string, unknown> = {
			cookies: { session: 'only.two' },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('throws UnauthorizedException for single-part token', async () => {
		const request: Record<string, unknown> = {
			cookies: { session: 'not-a-jwt' },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('throws UnauthorizedException for JWT signed with wrong secret', async () => {
		const token = signToken({ sub: 'user-123', type: 'session' }, 'wrong-secret-key-min-16');

		const request: Record<string, unknown> = {
			cookies: { session: token },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('prefers session cookie over Bearer token', async () => {
		const cookieToken = signToken({ sub: 'cookie-user', type: 'session' });
		const bearerToken = signToken({ sub: 'bearer-user', type: 'session' });

		const request: Record<string, unknown> = {
			cookies: { session: cookieToken },
			headers: { authorization: `Bearer ${bearerToken}` },
		};

		await guard.canActivate(makeContext(request));

		expect(request.sessionUserId).toBe('cookie-user');
	});
});
