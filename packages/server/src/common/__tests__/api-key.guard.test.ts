import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyGuard } from '../api-key.guard.js';
import { hashApiKey } from '../crypto-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(headers: Record<string, string | undefined>): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				headers,
			}),
		}),
	} as unknown as ExecutionContext;
}

function createMockSupabase(
	queryResult: { data: unknown; error: unknown } = { data: null, error: null },
) {
	const singleFn = vi.fn().mockResolvedValue(queryResult);
	const eqFns: ReturnType<typeof vi.fn>[] = [];

	const eqFn = vi.fn().mockImplementation(() => ({
		single: singleFn,
	}));
	eqFns.push(eqFn);

	const selectFn = vi.fn().mockImplementation(() => ({
		eq: eqFn,
	}));

	const fromFn = vi.fn().mockImplementation(() => ({
		select: selectFn,
	}));

	return {
		client: { from: fromFn },
		fromFn,
		selectFn,
		eqFn,
		singleFn,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiKeyGuard', () => {
	let guard: ApiKeyGuard;
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('throws UnauthorizedException when x-api-key header is missing', async () => {
		mockSupabase = createMockSupabase();
		guard = new ApiKeyGuard(mockSupabase as never);

		const ctx = makeContext({});

		await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
		await expect(guard.canActivate(ctx)).rejects.toThrow('Missing x-api-key header');
	});

	it('throws UnauthorizedException when API key is not found in DB', async () => {
		mockSupabase = createMockSupabase({ data: null, error: { message: 'not found' } });
		guard = new ApiKeyGuard(mockSupabase as never);

		const ctx = makeContext({ 'x-api-key': 'gw_live_invalid_key' });

		await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
		await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');
	});

	it('throws UnauthorizedException when signer is paused', async () => {
		mockSupabase = createMockSupabase({
			data: { id: 'signer-1', status: 'paused' },
			error: null,
		});
		guard = new ApiKeyGuard(mockSupabase as never);

		const ctx = makeContext({ 'x-api-key': 'gw_live_test_key' });

		await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
		await expect(guard.canActivate(ctx)).rejects.toThrow('Signer is paused');
	});

	it('throws UnauthorizedException when signer is revoked', async () => {
		mockSupabase = createMockSupabase({
			data: { id: 'signer-1', status: 'revoked' },
			error: null,
		});
		guard = new ApiKeyGuard(mockSupabase as never);

		const ctx = makeContext({ 'x-api-key': 'gw_live_test_key' });

		await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
		await expect(guard.canActivate(ctx)).rejects.toThrow('Signer is revoked');
	});

	it('allows active signer and sets signerId on request', async () => {
		mockSupabase = createMockSupabase({
			data: { id: 'signer-abc', status: 'active' },
			error: null,
		});
		guard = new ApiKeyGuard(mockSupabase as never);

		const request = { headers: { 'x-api-key': 'gw_live_valid_key' } };
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => request,
			}),
		} as unknown as ExecutionContext;

		const result = await guard.canActivate(ctx);

		expect(result).toBe(true);
		expect((request as Record<string, unknown>).signerId).toBe('signer-abc');
	});

	it('hashes the API key with SHA-256 before DB lookup', async () => {
		const apiKey = 'gw_live_test_lookup_key';
		const expectedHash = hashApiKey(apiKey);

		mockSupabase = createMockSupabase({
			data: { id: 'signer-1', status: 'active' },
			error: null,
		});
		guard = new ApiKeyGuard(mockSupabase as never);

		const ctx = makeContext({ 'x-api-key': apiKey });
		await guard.canActivate(ctx);

		// Verify the guard queried with the hash, not the raw key
		expect(mockSupabase.eqFn).toHaveBeenCalledWith('api_key_hash', expectedHash);
	});
});
