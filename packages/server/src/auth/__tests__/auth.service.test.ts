import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { AuthService } from '../auth.service.js';
import type { ChallengeStore } from '../challenge-store.js';
import type { SessionService } from '../session.service.js';

// ---------------------------------------------------------------------------
// Test wallet (deterministic for reproducibility)
// ---------------------------------------------------------------------------

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_ADDRESS = testAccount.address;

function buildSiweMessage(nonce: string, address: string): string {
	return `Sign in to Guardian\nAddress: ${address}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
}

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

	return { challengeStore, sessionService };
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
		);
	});

	// -----------------------------------------------------------------------
	// generateNonce
	// -----------------------------------------------------------------------

	describe('generateNonce', () => {
		it('returns a hex string', () => {
			const nonce = service.generateNonce();

			expect(nonce).toMatch(/^[0-9a-f]{64}$/);
		});

		it('stores nonce in challenge store', () => {
			const nonce = service.generateNonce();

			expect(mocks.challengeStore.set).toHaveBeenCalledWith(nonce, nonce);
		});

		it('returns different nonces on each call', () => {
			const nonce1 = service.generateNonce();
			const nonce2 = service.generateNonce();

			expect(nonce1).not.toBe(nonce2);
		});
	});

	// -----------------------------------------------------------------------
	// verifyWalletSignature
	// -----------------------------------------------------------------------

	describe('verifyWalletSignature', () => {
		it('returns token and address for valid signature', async () => {
			const nonce = 'a'.repeat(64);
			const message = buildSiweMessage(nonce, TEST_ADDRESS);
			const signature = await testAccount.signMessage({ message });

			mocks.challengeStore.get.mockReturnValue(nonce);

			const result = await service.verifyWalletSignature(message, signature);

			expect(result.verified).toBe(true);
			expect(result.address).toBe(TEST_ADDRESS.toLowerCase());
			expect(result.token).toBe('jwt-token-abc');
			expect(mocks.sessionService.createToken).toHaveBeenCalledWith(TEST_ADDRESS.toLowerCase());
		});

		it('deletes nonce after use', async () => {
			const nonce = 'b'.repeat(64);
			const message = buildSiweMessage(nonce, TEST_ADDRESS);
			const signature = await testAccount.signMessage({ message });

			mocks.challengeStore.get.mockReturnValue(nonce);

			await service.verifyWalletSignature(message, signature);

			expect(mocks.challengeStore.delete).toHaveBeenCalledWith(nonce);
		});

		it('throws BadRequestException for expired/missing nonce', async () => {
			const nonce = 'c'.repeat(64);
			const message = buildSiweMessage(nonce, TEST_ADDRESS);
			const signature = await testAccount.signMessage({ message });

			mocks.challengeStore.get.mockReturnValue(null);

			await expect(
				service.verifyWalletSignature(message, signature),
			).rejects.toThrow(BadRequestException);
			await expect(
				service.verifyWalletSignature(message, signature),
			).rejects.toThrow('Nonce expired or not found');
		});

		it('throws UnauthorizedException for invalid signature', async () => {
			const nonce = 'd'.repeat(64);
			const message = buildSiweMessage(nonce, TEST_ADDRESS);
			// Sign a different message to produce an invalid signature for this message
			const wrongSignature = await testAccount.signMessage({ message: 'wrong message' });

			mocks.challengeStore.get.mockReturnValue(nonce);

			await expect(
				service.verifyWalletSignature(message, wrongSignature),
			).rejects.toThrow(UnauthorizedException);
			await expect(
				service.verifyWalletSignature(message, wrongSignature),
			).rejects.toThrow('Invalid wallet signature');
		});

		it('throws BadRequestException for message missing nonce', async () => {
			const message = 'Sign in to Guardian\nAddress: 0x1234\nIssued At: 2024-01-01T00:00:00.000Z';
			const signature = await testAccount.signMessage({ message });

			await expect(
				service.verifyWalletSignature(message, signature),
			).rejects.toThrow('Invalid message format: missing nonce');
		});

		it('throws BadRequestException for message missing address', async () => {
			const message = 'Sign in to Guardian\nNonce: abcdef\nIssued At: 2024-01-01T00:00:00.000Z';
			const signature = await testAccount.signMessage({ message });

			await expect(
				service.verifyWalletSignature(message, signature),
			).rejects.toThrow('Invalid message format: missing address');
		});
	});
});
