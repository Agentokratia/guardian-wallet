import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../../auth/session.service.js';
import { hashApiKey } from '../crypto-utils.js';
import { EitherAuthGuard } from '../either-auth.guard.js';

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

function validJwt(sub = 'user-123'): string {
	return signToken({ sub, email: 'test@example.com', type: 'session' });
}

function expiredJwt(sub = 'user-123'): string {
	return signToken({ sub, email: 'test@example.com', type: 'session' }, JWT_SECRET, {
		expiresIn: '0s',
	});
}

function createMockSupabase(
	queryResult: { data: unknown; error: unknown } = { data: null, error: null },
) {
	const singleFn = vi.fn().mockResolvedValue(queryResult);
	const eqFn = vi.fn().mockImplementation(() => ({ single: singleFn }));
	const selectFn = vi.fn().mockImplementation(() => ({ eq: eqFn }));
	const fromFn = vi.fn().mockImplementation(() => ({ select: selectFn }));
	return { client: { from: fromFn }, eqFn, singleFn };
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

describe('EitherAuthGuard', () => {
	let sessionService: SessionService;

	beforeEach(() => {
		vi.clearAllMocks();
		sessionService = createSessionService();
	});

	// -- Session auth (JWT) ------------------------------------------------

	it('allows valid JWT via Bearer header', async () => {
		const mockSupabase = createMockSupabase();
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { authorization: `Bearer ${validJwt('user-jwt')}` },
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUserId).toBe('user-jwt');
		expect(request.sessionEmail).toBe('test@example.com');
		expect(request.signerId).toBeUndefined();
	});

	it('allows valid JWT via session cookie', async () => {
		const mockSupabase = createMockSupabase();
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: { session: validJwt('user-cookie') },
			headers: {},
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUserId).toBe('user-cookie');
	});

	it('allows lowercase "bearer" (RFC 7235 compliance)', async () => {
		const mockSupabase = createMockSupabase();
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { authorization: `bearer ${validJwt('user-lower')}` },
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUserId).toBe('user-lower');
	});

	// -- API key auth ------------------------------------------------------

	it('falls back to API key when no JWT is present', async () => {
		const mockSupabase = createMockSupabase({
			data: { id: 'signer-abc', status: 'active' },
			error: null,
		});
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { 'x-api-key': 'gw_live_test_key' },
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.signerId).toBe('signer-abc');
		expect(request.sessionUserId).toBeUndefined();
	});

	it('hashes API key with SHA-256 before DB lookup', async () => {
		const apiKey = 'gw_live_hash_check';
		const expectedHash = hashApiKey(apiKey);
		const mockSupabase = createMockSupabase({
			data: { id: 'signer-1', status: 'active' },
			error: null,
		});
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { 'x-api-key': apiKey },
		};

		await guard.canActivate(makeContext(request));

		expect(mockSupabase.eqFn).toHaveBeenCalledWith('api_key_hash', expectedHash);
	});

	it('rejects paused signer via API key', async () => {
		const mockSupabase = createMockSupabase({
			data: { id: 'signer-1', status: 'paused' },
			error: null,
		});
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { 'x-api-key': 'gw_live_paused' },
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow('Signer is paused');
	});

	it('rejects revoked signer via API key', async () => {
		const mockSupabase = createMockSupabase({
			data: { id: 'signer-1', status: 'revoked' },
			error: null,
		});
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { 'x-api-key': 'gw_live_revoked' },
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow('Signer is revoked');
	});

	// -- Fallback: expired JWT → valid API key -----------------------------

	it('falls back to API key when JWT is expired', async () => {
		const mockSupabase = createMockSupabase({
			data: { id: 'signer-fallback', status: 'active' },
			error: null,
		});
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		// Wait a tick so the 0s-expiry token is actually expired
		const token = expiredJwt();
		await new Promise((r) => setTimeout(r, 10));

		const request: Record<string, unknown> = {
			cookies: {},
			headers: {
				authorization: `Bearer ${token}`,
				'x-api-key': 'gw_live_fallback_key',
			},
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.signerId).toBe('signer-fallback');
		// Session fields should NOT be set — API key won, not JWT
		expect(request.sessionUserId).toBeUndefined();
	});

	// -- JWT wins when both are present ------------------------------------

	it('prefers JWT over API key when both are valid', async () => {
		const mockSupabase = createMockSupabase({
			data: { id: 'signer-ignored', status: 'active' },
			error: null,
		});
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: {
				authorization: `Bearer ${validJwt('jwt-user')}`,
				'x-api-key': 'gw_live_should_not_be_used',
			},
		};

		const result = await guard.canActivate(makeContext(request));

		expect(result).toBe(true);
		expect(request.sessionUserId).toBe('jwt-user');
		// signerId must NOT be set — JWT took precedence
		expect(request.signerId).toBeUndefined();
		// DB should not have been queried at all
		expect(mockSupabase.eqFn).not.toHaveBeenCalled();
	});

	// -- Neither present → 401 --------------------------------------------

	it('throws UnauthorizedException when neither JWT nor API key is present', async () => {
		const mockSupabase = createMockSupabase();
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: {},
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	// -- Edge cases --------------------------------------------------------

	it('rejects empty string API key', async () => {
		const mockSupabase = createMockSupabase();
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { 'x-api-key': '' },
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('rejects malformed Bearer token (not a JWT)', async () => {
		const mockSupabase = createMockSupabase();
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { authorization: 'Bearer not-a-jwt' },
		};

		// Malformed JWT → session auth fails → no API key → 401
		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});

	it('rejects when API key is not found in DB', async () => {
		const mockSupabase = createMockSupabase({ data: null, error: { message: 'not found' } });
		const guard = new EitherAuthGuard(sessionService, mockSupabase as never);

		const request: Record<string, unknown> = {
			cookies: {},
			headers: { 'x-api-key': 'gw_live_nonexistent' },
		};

		await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
	});
});
