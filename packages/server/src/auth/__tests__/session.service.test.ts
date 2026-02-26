import { createHash, randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../session.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret-key-at-least-32-characters-long';

function createJwtService(): JwtService {
	return new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '15m' as never } });
}

/**
 * Build a mock Supabase client with chainable query builder.
 * Callers override `.from()` per-test to control DB behavior.
 */
function createMockSupabase() {
	const singleFn = vi.fn().mockResolvedValue({ data: null, error: null });
	const isFn = vi
		.fn()
		.mockReturnValue({ single: singleFn, select: vi.fn().mockReturnValue({ single: singleFn }) });
	const eqFn = vi.fn().mockReturnValue({
		is: isFn,
		single: singleFn,
		select: vi.fn().mockReturnValue({ single: singleFn }),
	});
	const gteFn = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn }) });
	const insertFn = vi.fn().mockResolvedValue({ error: null });
	const updateFn = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			is: vi.fn().mockReturnValue({
				gte: gteFn,
				select: vi.fn().mockReturnValue({ single: singleFn }),
			}),
		}),
	});
	const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
	const fromFn = vi.fn().mockReturnValue({
		insert: insertFn,
		update: updateFn,
		select: selectFn,
	});

	return { client: { from: fromFn }, fromFn, insertFn, singleFn };
}

function createService(mockSupabase?: ReturnType<typeof createMockSupabase>) {
	const jwtService = createJwtService();
	const supabase = mockSupabase ?? createMockSupabase();
	return {
		service: new (
			SessionService as unknown as new (
				jwtService: JwtService,
				supabase: unknown,
			) => SessionService
		)(jwtService, supabase as never),
		supabase,
		jwtService,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionService', () => {
	describe('createAccessToken / validateAccessToken', () => {
		it('creates a valid token that can be verified', () => {
			const { service } = createService();

			const token = service.createAccessToken({
				userId: 'user-1',
				email: 'test@example.com',
				address: '0xabc',
			});

			expect(token).toBeTruthy();
			expect(typeof token).toBe('string');

			const payload = service.validateAccessToken(token);
			expect(payload).not.toBeNull();
			expect(payload!.sub).toBe('user-1');
			expect(payload!.email).toBe('test@example.com');
			expect(payload!.address).toBe('0xabc');
			expect(payload!.type).toBe('session');
		});

		it('rejects token with wrong type', () => {
			const { jwtService, service } = createService();

			// Sign a token with wrong type
			const token = jwtService.sign({ sub: 'user-1', type: 'api' });
			const payload = service.validateAccessToken(token);
			expect(payload).toBeNull();
		});

		it('rejects expired token', async () => {
			const jwtService = new JwtService({
				secret: JWT_SECRET,
				signOptions: { expiresIn: '0s' as never },
			});
			const supabase = createMockSupabase();
			const service = new (
				SessionService as unknown as new (
					jwtService: JwtService,
					supabase: unknown,
				) => SessionService
			)(jwtService, supabase as never);

			const token = service.createAccessToken({ userId: 'user-1' });
			await new Promise((r) => setTimeout(r, 10));

			expect(service.validateAccessToken(token)).toBeNull();
		});

		it('rejects tampered token', () => {
			const { service } = createService();
			const token = service.createAccessToken({ userId: 'user-1' });
			const parts = token.split('.');
			const tampered = `${parts[0]}.${parts[1]}.tampered`;
			expect(service.validateAccessToken(tampered)).toBeNull();
		});

		it('backward-compat aliases work', () => {
			const { service } = createService();

			const token = service.createToken({ userId: 'user-1' });
			expect(token).toBeTruthy();

			const payload = service.validateToken(token);
			expect(payload).not.toBeNull();
			expect(payload!.sub).toBe('user-1');
		});
	});

	describe('createRefreshToken', () => {
		it('returns a base64url string and inserts hash into DB', async () => {
			const supabase = createMockSupabase();
			const { service } = createService(supabase);

			const token = await service.createRefreshToken('user-1');

			expect(typeof token).toBe('string');
			expect(token.length).toBeGreaterThan(20); // base64url of 32 bytes

			// Verify insert was called with the hash, not the raw token
			expect(supabase.client.from).toHaveBeenCalledWith('refresh_tokens');
			const insertCall = supabase.insertFn.mock.calls[0]?.[0] as Record<string, unknown>;
			expect(insertCall.user_id).toBe('user-1');
			expect(insertCall.token_hash).toBeTruthy();
			expect(insertCall.expires_at).toBeTruthy();

			// Verify the hash is SHA-256 of the token
			const expectedHash = createHash('sha256').update(token).digest('hex');
			expect(insertCall.token_hash).toBe(expectedHash);
		});
	});

	describe('validateRefreshToken', () => {
		it('returns userId for valid token', async () => {
			const token = randomBytes(32).toString('base64url');
			const hash = createHash('sha256').update(token).digest('hex');
			const futureDate = new Date(Date.now() + 86400 * 1000).toISOString();

			const supabase = createMockSupabase();
			// Override the chain to return data
			const singleMock = vi.fn().mockResolvedValue({
				data: { id: 'rt-1', user_id: 'user-1', expires_at: futureDate },
				error: null,
			});
			supabase.client.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						is: vi.fn().mockReturnValue({
							single: singleMock,
						}),
					}),
				}),
			});

			const { service } = createService(supabase);
			const result = await service.validateRefreshToken(token);

			expect(result).toEqual({ userId: 'user-1' });
		});

		it('returns null for unknown token', async () => {
			const supabase = createMockSupabase();
			supabase.client.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						is: vi.fn().mockReturnValue({
							single: vi.fn().mockResolvedValue({ data: null, error: null }),
						}),
					}),
				}),
			});

			const { service } = createService(supabase);
			const result = await service.validateRefreshToken('nonexistent-token');
			expect(result).toBeNull();
		});

		it('returns null for expired token', async () => {
			const token = randomBytes(32).toString('base64url');
			const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

			const supabase = createMockSupabase();
			supabase.client.from = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						is: vi.fn().mockReturnValue({
							single: vi.fn().mockResolvedValue({
								data: { id: 'rt-1', user_id: 'user-1', expires_at: pastDate },
								error: null,
							}),
						}),
					}),
				}),
			});

			const { service } = createService(supabase);
			const result = await service.validateRefreshToken(token);
			expect(result).toBeNull();
		});
	});

	describe('rotateRefreshToken', () => {
		it('revokes old token and returns new token + userId', async () => {
			const oldToken = randomBytes(32).toString('base64url');

			const supabase = createMockSupabase();
			// Mock the atomic update (revoke old)
			const updateSingleMock = vi.fn().mockResolvedValue({
				data: { user_id: 'user-1' },
				error: null,
			});
			// Mock the insert (create new)
			const insertMock = vi.fn().mockResolvedValue({ error: null });

			let callCount = 0;
			supabase.client.from = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					// rotateRefreshToken: update query
					return {
						update: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								is: vi.fn().mockReturnValue({
									gte: vi.fn().mockReturnValue({
										select: vi.fn().mockReturnValue({
											single: updateSingleMock,
										}),
									}),
								}),
							}),
						}),
					};
				}
				// createRefreshToken: insert query
				return { insert: insertMock };
			});

			const { service } = createService(supabase);
			const result = await service.rotateRefreshToken(oldToken);

			expect(result).not.toBeNull();
			expect(result!.userId).toBe('user-1');
			expect(typeof result!.newToken).toBe('string');
			expect(result!.newToken.length).toBeGreaterThan(20);
		});

		it('returns null for already-revoked token', async () => {
			const supabase = createMockSupabase();
			supabase.client.from = vi.fn().mockReturnValue({
				update: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						is: vi.fn().mockReturnValue({
							gte: vi.fn().mockReturnValue({
								select: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: null, error: null }),
								}),
							}),
						}),
					}),
				}),
			});

			const { service } = createService(supabase);
			const result = await service.rotateRefreshToken('already-revoked');
			expect(result).toBeNull();
		});
	});

	describe('revokeAllTokens', () => {
		it('updates all active tokens for the user', async () => {
			const updateMock = vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					is: vi.fn().mockResolvedValue({ error: null }),
				}),
			});
			const supabase = createMockSupabase();
			supabase.client.from = vi.fn().mockReturnValue({ update: updateMock });

			const { service } = createService(supabase);
			await service.revokeAllTokens('user-1');

			expect(supabase.client.from).toHaveBeenCalledWith('refresh_tokens');
			expect(updateMock).toHaveBeenCalled();
		});
	});
});
