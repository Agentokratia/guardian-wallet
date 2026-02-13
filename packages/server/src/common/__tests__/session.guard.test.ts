import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../../auth/session.service.js';
import type { AppConfig } from '../config.js';
import { APP_CONFIG } from '../config.js';
import { SessionGuard } from '../session.guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret-key-min-16-chars';

function makeConfig(): AppConfig {
	return {
		NODE_ENV: 'test',
		PORT: 8080,
		SUPABASE_URL: 'http://localhost:54321',
		SUPABASE_SERVICE_KEY: 'test-service-key',
		VAULT_ADDR: 'http://localhost:8200',
		VAULT_TOKEN: 'test-vault-token',
		VAULT_KV_MOUNT: 'secret',
		VAULT_SHARE_PREFIX: 'threshold/shares',
		JWT_SECRET,
		JWT_EXPIRY: '24h',
		AUXINFO_POOL_TARGET: 5,
		AUXINFO_POOL_LOW_WATERMARK: 2,
		AUXINFO_POOL_MAX_GENERATORS: 2,
	};
}

function createSessionService(): SessionService {
	const config = makeConfig();
	// SessionService expects @Inject(APP_CONFIG) — instantiate manually for tests
	return new (SessionService as unknown as new (config: AppConfig) => SessionService)(config);
}

function createJwt(payload: { sub: string; iat: number; exp: number }, secret: string): string {
	const header = { alg: 'HS256', typ: 'JWT' };
	const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
	const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const signature = createHmac('sha256', secret)
		.update(`${headerB64}.${payloadB64}`)
		.digest('base64url');
	return `${headerB64}.${payloadB64}.${signature}`;
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
		const now = Math.floor(Date.now() / 1000);
		const token = createJwt({ sub: 'user-123', iat: now, exp: now + 3600 }, JWT_SECRET);

		const request: Record<string, unknown> = {
			cookies: { session: token },
			headers: {},
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUser).toBe('user-123');
	});

	it('allows valid Bearer token', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createJwt({ sub: 'user-456', iat: now, exp: now + 3600 }, JWT_SECRET);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { authorization: `Bearer ${token}` },
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUser).toBe('user-456');
	});

	it('throws UnauthorizedException for missing token', async () => {
		const request: Record<string, unknown> = {
			cookies: {},
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('throws UnauthorizedException for expired JWT', async () => {
		const past = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
		const token = createJwt({ sub: 'user-123', iat: past, exp: past + 3600 }, JWT_SECRET);

		const request: Record<string, unknown> = {
			cookies: { session: token },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('throws UnauthorizedException for tampered JWT signature', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createJwt({ sub: 'user-123', iat: now, exp: now + 3600 }, JWT_SECRET);

		// Tamper with the signature
		const parts = token.split('.');
		const tamperedToken = `${parts[0]}.${parts[1]}.tampered-signature`;

		const request: Record<string, unknown> = {
			cookies: { session: tamperedToken },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('throws UnauthorizedException for malformed JWT (wrong number of parts)', async () => {
		const request: Record<string, unknown> = {
			cookies: { session: 'only.two' },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('throws UnauthorizedException for single-part token', async () => {
		const request: Record<string, unknown> = {
			cookies: { session: 'not-a-jwt' },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('throws UnauthorizedException for JWT signed with wrong secret', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createJwt({ sub: 'user-123', iat: now, exp: now + 3600 }, 'wrong-secret-key-min-16');

		const request: Record<string, unknown> = {
			cookies: { session: token },
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('prefers session cookie over Bearer token', async () => {
		const now = Math.floor(Date.now() / 1000);
		const cookieToken = createJwt({ sub: 'cookie-user', iat: now, exp: now + 3600 }, JWT_SECRET);
		const bearerToken = createJwt({ sub: 'bearer-user', iat: now, exp: now + 3600 }, JWT_SECRET);

		const request: Record<string, unknown> = {
			cookies: { session: cookieToken },
			headers: { authorization: `Bearer ${bearerToken}` },
		};

		await guard.canActivate(makeContext(request));

		expect(request.sessionUser).toBe('cookie-user');
	});
});
