import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth.service.js';
import type { ChallengeStore } from '../challenge-store.js';
import type { SessionService } from '../session.service.js';

// Mock the guardian-auth server module
vi.mock('@agentokratia/guardian-auth/server', () => ({
	generateOTP: vi.fn().mockReturnValue({
		code: '123456',
		expiresAt: new Date(Date.now() + 600_000),
	}),
	generateRegistrationChallenge: vi.fn().mockResolvedValue({
		challenge: 'test-challenge',
		rp: { id: 'localhost', name: 'Guardian Wallet' },
		user: { id: 'user-123', name: 'test@example.com', displayName: 'test@example.com' },
	}),
	verifyRegistration: vi.fn().mockResolvedValue({
		verified: true,
		registrationInfo: {
			credential: {
				id: 'cred-123',
				publicKey: new Uint8Array([1, 2, 3]),
				counter: 0,
			},
		},
	}),
	generateAuthChallenge: vi.fn().mockResolvedValue({
		challenge: 'auth-challenge',
		rpId: 'localhost',
		allowCredentials: [{ id: 'cred-123' }],
	}),
	verifyAuthentication: vi.fn().mockResolvedValue({
		credentialId: 'cred-123',
		newCounter: 1,
	}),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
	const challengeStore = {
		set: vi.fn(),
		get: vi.fn(),
		consume: vi.fn(),
		delete: vi.fn(),
		cleanup: vi.fn(),
	};

	const sessionService = {
		createToken: vi.fn().mockReturnValue('jwt-token-abc'),
		createAccessToken: vi.fn().mockReturnValue('jwt-token-abc'),
		validateToken: vi.fn(),
		validateAccessToken: vi.fn(),
		createRefreshToken: vi.fn().mockResolvedValue('refresh-token-abc'),
		rotateRefreshToken: vi.fn(),
		revokeAllTokens: vi.fn(),
	};

	const supabaseService = {
		client: {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				gte: vi.fn().mockReturnThis(),
				maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
			}),
		},
	};

	const config = {
		NODE_ENV: 'test',
		PORT: 8080,
		SUPABASE_URL: 'http://localhost:54321',
		SUPABASE_SERVICE_KEY: 'test-service-key',
		VAULT_ADDR: 'http://localhost:8200',
		VAULT_TOKEN: 'test-vault-token',
		VAULT_KV_MOUNT: 'secret',
		VAULT_SHARE_PREFIX: 'threshold/shares',
		JWT_SECRET: 'test-secret-key-at-least-32-characters-long',
		JWT_EXPIRY: '15m',
		JWT_EXPIRY_MS: 15 * 60 * 1000,
		AUXINFO_POOL_TARGET: 5,
		AUXINFO_POOL_LOW_WATERMARK: 2,
		AUXINFO_POOL_MAX_GENERATORS: 2,
		RP_ID: 'localhost',
		RP_NAME: 'Guardian Wallet',
		ALLOWED_ORIGINS: ['http://localhost:3000'],
		EMAIL_PROVIDER: 'console' as const,
		RESEND_API_KEY: '',
	};

	return { challengeStore, sessionService, supabaseService, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
	let service: AuthService;
	let mocks: ReturnType<typeof createMocks>;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks = createMocks();

		service = new AuthService(
			mocks.challengeStore as unknown as ChallengeStore,
			mocks.sessionService as unknown as SessionService,
			mocks.supabaseService as never,
			mocks.config as never,
		);
	});

	// -----------------------------------------------------------------------
	// loginOrRegister
	// -----------------------------------------------------------------------

	describe('loginOrRegister', () => {
		it('creates new user and sends OTP for new email', async () => {
			const fromMock = vi.fn();
			const selectChain = {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
			};
			const insertChain = {
				insert: vi.fn().mockReturnThis(),
				select: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'new-user-id', email: 'test@example.com' },
					error: null,
				}),
			};
			const verifyInsertChain = {
				insert: vi.fn().mockResolvedValue({ error: null }),
			};

			let callCount = 0;
			fromMock.mockImplementation((table: string) => {
				if (table === 'users') {
					callCount++;
					return callCount === 1 ? selectChain : insertChain;
				}
				if (table === 'email_verifications') {
					return verifyInsertChain;
				}
				return selectChain;
			});

			mocks.supabaseService.client.from = fromMock;

			const result = await service.loginOrRegister('test@example.com');
			expect(result.userId).toBe('new-user-id');
			expect(result.isNewUser).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// verifyOTPAndLogin
	// -----------------------------------------------------------------------

	describe('verifyOTPAndLogin', () => {
		it('throws BadRequestException for invalid code format', async () => {
			await expect(
				service.verifyOTPAndLogin('test@example.com', '12345'), // 5 digits instead of 6
			).rejects.toThrow(BadRequestException);
		});
	});

	// -----------------------------------------------------------------------
	// getPasskeyLoginChallenge
	// -----------------------------------------------------------------------

	describe('getPasskeyLoginChallenge', () => {
		it('returns auth challenge for user with passkey', async () => {
			const fromMock = vi.fn();
			const userSelectChain = {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'user-123', status: 'active', has_passkey: true },
					error: null,
				}),
			};
			const credsChain = {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn(),
			};
			// Return array (not single) for credentials — uses defineProperty
			// to add thenable behavior without triggering Biome's noThenProperty
			(credsChain.eq as ReturnType<typeof vi.fn>).mockImplementation(() => {
				const result = {
					...credsChain,
					data: [{ credential_id: 'cred-abc' }],
				};
				Object.defineProperty(result, 'then', {
					value: (cb: (v: unknown) => void) =>
						cb({ data: [{ credential_id: 'cred-abc' }], error: null }),
					enumerable: false,
				});
				return result;
			});

			let callCount = 0;
			fromMock.mockImplementation((table: string) => {
				if (table === 'users') return userSelectChain;
				if (table === 'passkey_credentials') {
					callCount++;
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								data: [{ credential_id: 'cred-abc' }],
								error: null,
							}),
						}),
					};
				}
				return userSelectChain;
			});

			mocks.supabaseService.client.from = fromMock;

			const result = await service.getPasskeyLoginChallenge('test@example.com');
			expect(result.authOptions).toBeDefined();
			expect(mocks.challengeStore.set).toHaveBeenCalledWith(
				'login:test@example.com',
				'auth-challenge',
			);
		});

		it('throws generic error for non-existent user', async () => {
			const fromMock = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
			});
			mocks.supabaseService.client.from = fromMock;

			await expect(service.getPasskeyLoginChallenge('noone@example.com')).rejects.toThrow(
				BadRequestException,
			);
		});

		it('throws generic error for user without passkey', async () => {
			const fromMock = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'user-123', status: 'active', has_passkey: false },
					error: null,
				}),
			});
			mocks.supabaseService.client.from = fromMock;

			await expect(service.getPasskeyLoginChallenge('nopk@example.com')).rejects.toThrow(
				BadRequestException,
			);
		});

		it('throws generic error for banned user with passkey', async () => {
			const fromMock = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'user-123', status: 'banned', has_passkey: true },
					error: null,
				}),
			});
			mocks.supabaseService.client.from = fromMock;

			await expect(service.getPasskeyLoginChallenge('banned@example.com')).rejects.toThrow(
				BadRequestException,
			);
		});

		it('uses same error message for all failure paths — no enumeration', async () => {
			// No user
			const fromMock1 = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
			});
			mocks.supabaseService.client.from = fromMock1;

			let err1: BadRequestException | null = null;
			try {
				await service.getPasskeyLoginChallenge('a@b.com');
			} catch (e) {
				err1 = e as BadRequestException;
			}

			// Banned user
			const fromMock2 = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'u', status: 'banned', has_passkey: true },
					error: null,
				}),
			});
			mocks.supabaseService.client.from = fromMock2;

			let err2: BadRequestException | null = null;
			try {
				await service.getPasskeyLoginChallenge('b@b.com');
			} catch (e) {
				err2 = e as BadRequestException;
			}

			// Same error message for both
			expect(err1?.message).toBe('Authentication failed');
			expect(err2?.message).toBe('Authentication failed');
		});
	});

	// -----------------------------------------------------------------------
	// verifyPasskeyLogin
	// -----------------------------------------------------------------------

	describe('verifyPasskeyLogin', () => {
		it('throws when challenge is expired/missing', async () => {
			mocks.challengeStore.consume.mockReturnValue(null);

			await expect(
				service.verifyPasskeyLogin('test@example.com', { id: 'cred-123' }),
			).rejects.toThrow(BadRequestException);
		});

		it('throws generic error for non-existent user', async () => {
			mocks.challengeStore.consume.mockReturnValue('challenge-xyz');
			const fromMock = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
			});
			mocks.supabaseService.client.from = fromMock;

			await expect(
				service.verifyPasskeyLogin('noone@example.com', { id: 'cred-123' }),
			).rejects.toThrow(BadRequestException);
		});

		it('throws generic error for banned user', async () => {
			mocks.challengeStore.consume.mockReturnValue('challenge-xyz');

			let fromCallCount = 0;
			const fromMock = vi.fn().mockImplementation(() => {
				fromCallCount++;
				if (fromCallCount === 1) {
					// users table
					return {
						select: vi.fn().mockReturnThis(),
						eq: vi.fn().mockReturnThis(),
						single: vi.fn().mockResolvedValue({
							data: { id: 'user-123', status: 'banned', eth_address: '0x123' },
							error: null,
						}),
					};
				}
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: null, error: null }),
				};
			});
			mocks.supabaseService.client.from = fromMock;

			await expect(
				service.verifyPasskeyLogin('banned@example.com', { id: 'cred-123' }),
			).rejects.toThrow(BadRequestException);
		});

		it('throws when response has no credential ID', async () => {
			mocks.challengeStore.consume.mockReturnValue('challenge-xyz');
			const fromMock = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'user-123', status: 'active', eth_address: null },
					error: null,
				}),
			});
			mocks.supabaseService.client.from = fromMock;

			await expect(
				service.verifyPasskeyLogin('test@example.com', {}), // no id field
			).rejects.toThrow(BadRequestException);
		});

		it('issues JWT and updates counter on successful verification', async () => {
			mocks.challengeStore.consume.mockReturnValue('challenge-xyz');

			const updateMock = vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockResolvedValue({ error: null }),
				}),
			});

			let fromCallCount = 0;
			const fromMock = vi.fn().mockImplementation(() => {
				fromCallCount++;
				if (fromCallCount === 1) {
					// users table lookup
					return {
						select: vi.fn().mockReturnThis(),
						eq: vi.fn().mockReturnThis(),
						single: vi.fn().mockResolvedValue({
							data: { id: 'user-123', status: 'active', eth_address: '0xabc' },
							error: null,
						}),
					};
				}
				if (fromCallCount === 2) {
					// passkey_credentials lookup
					return {
						select: vi.fn().mockReturnThis(),
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								single: vi.fn().mockResolvedValue({
									data: {
										credential_id: 'cred-123',
										public_key_cose: Buffer.from([1, 2, 3]).toString('base64'),
										counter: 0,
									},
									error: null,
								}),
							}),
						}),
					};
				}
				// passkey_credentials counter update
				return { update: updateMock };
			});
			mocks.supabaseService.client.from = fromMock;

			const result = await service.verifyPasskeyLogin('test@example.com', {
				id: 'cred-123',
				rawId: 'raw',
				response: {},
				clientExtensionResults: {},
				type: 'public-key',
			});

			expect(result.token).toBe('jwt-token-abc');
			expect(result.userId).toBe('user-123');
			expect(result.email).toBe('test@example.com');
			expect(result.address).toBe('0xabc');
			expect(mocks.sessionService.createToken).toHaveBeenCalledWith({
				userId: 'user-123',
				email: 'test@example.com',
				address: '0xabc',
			});
		});

		it('consumes challenge exactly once (one-time use)', async () => {
			mocks.challengeStore.consume.mockReturnValue(null);

			await expect(
				service.verifyPasskeyLogin('test@example.com', { id: 'cred' }),
			).rejects.toThrow();

			expect(mocks.challengeStore.consume).toHaveBeenCalledTimes(1);
			expect(mocks.challengeStore.consume).toHaveBeenCalledWith('login:test@example.com');
		});
	});

	// -----------------------------------------------------------------------
	// loginOrRegister — hasPasskey field
	// -----------------------------------------------------------------------

	describe('loginOrRegister — hasPasskey', () => {
		it('returns hasPasskey=true for existing user with passkey', async () => {
			const fromMock = vi.fn();
			const userChain = {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'user-123', status: 'active', has_passkey: true },
					error: null,
				}),
			};
			const verifyInsertChain = {
				insert: vi.fn().mockResolvedValue({ error: null }),
			};

			fromMock.mockImplementation((table: string) => {
				if (table === 'email_verifications') return verifyInsertChain;
				return userChain;
			});
			mocks.supabaseService.client.from = fromMock;

			const result = await service.loginOrRegister('test@example.com');
			expect(result.hasPasskey).toBe(true);
			expect(result.isNewUser).toBe(false);
		});

		it('returns hasPasskey=false for new user', async () => {
			const fromMock = vi.fn();
			const selectChain = {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
			};
			const insertChain = {
				insert: vi.fn().mockReturnThis(),
				select: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'new-user-id' },
					error: null,
				}),
			};
			const verifyInsertChain = {
				insert: vi.fn().mockResolvedValue({ error: null }),
			};

			let userCallCount = 0;
			fromMock.mockImplementation((table: string) => {
				if (table === 'users') {
					userCallCount++;
					return userCallCount === 1 ? selectChain : insertChain;
				}
				if (table === 'email_verifications') return verifyInsertChain;
				return selectChain;
			});
			mocks.supabaseService.client.from = fromMock;

			const result = await service.loginOrRegister('new@example.com');
			expect(result.hasPasskey).toBe(false);
			expect(result.isNewUser).toBe(true);
		});

		it('throws ForbiddenException for banned user', async () => {
			const fromMock = vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'user-123', status: 'banned', has_passkey: false },
					error: null,
				}),
			});
			mocks.supabaseService.client.from = fromMock;

			await expect(service.loginOrRegister('banned@example.com')).rejects.toThrow(
				ForbiddenException,
			);
		});
	});
});
