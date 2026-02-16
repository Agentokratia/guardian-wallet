import { BadRequestException, NotFoundException } from '@nestjs/common';
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
		verified: true,
		authenticationInfo: {
			newCounter: 1,
		},
	}),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
	const challengeStore = {
		set: vi.fn(),
		get: vi.fn(),
		delete: vi.fn(),
		cleanup: vi.fn(),
	};

	const sessionService = {
		createToken: vi.fn().mockReturnValue('jwt-token-abc'),
		validateToken: vi.fn(),
		getExpirySeconds: vi.fn().mockReturnValue(86400),
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
		JWT_SECRET: 'test-secret-key-min-16-chars',
		JWT_EXPIRY: '24h',
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
	// registerEmail
	// -----------------------------------------------------------------------

	describe('registerEmail', () => {
		it('creates new user and returns userId for new email', async () => {
			// First query: user lookup returns null (new user)
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

			const result = await service.registerEmail('test@example.com');
			expect(result.userId).toBe('new-user-id');
			expect(result.isNewUser).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// verifyEmailOTP
	// -----------------------------------------------------------------------

	describe('verifyEmailOTP', () => {
		it('throws BadRequestException for invalid code format', async () => {
			await expect(
				service.verifyEmailOTP('test@example.com', '12345'), // 5 digits instead of 6
			).rejects.toThrow(BadRequestException);
		});
	});
});
