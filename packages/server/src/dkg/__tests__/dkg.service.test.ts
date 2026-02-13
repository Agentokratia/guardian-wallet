import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { IVaultStore, Signer } from '@agentokratia/guardian-core';
import {
	ChainName,
	NetworkName,
	SchemeName,
	SignerStatus,
	SignerType,
} from '@agentokratia/guardian-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cryptoUtils from '../../common/crypto-utils.js';
import type { SignerRepository } from '../../signers/signer.repository.js';
import type { AuxInfoPoolService } from '../aux-info-pool.service.js';
import { DKGService } from '../dkg.service.js';

// ---------------------------------------------------------------------------
// Mock CGGMP24Scheme and WASM dependencies
// ---------------------------------------------------------------------------

const mockScheme = {
	runDkg: vi.fn(),
	deriveAddress: vi.fn().mockReturnValue('0xDerivedAddress123'),
};

vi.mock('@agentokratia/guardian-schemes', () => ({
	CGGMP24Scheme: vi.fn(() => mockScheme),
}));

// Spy on wipeBuffer
vi.mock('../../common/crypto-utils.js', async () => {
	const actual = await vi.importActual<typeof cryptoUtils>('../../common/crypto-utils.js');
	return {
		...actual,
		wipeBuffer: vi.fn(actual.wipeBuffer),
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSigner(overrides: Partial<Signer> = {}): Signer {
	return {
		id: 'signer-1',
		name: 'Test Agent',
		type: SignerType.AI_AGENT,
		ethAddress: '',
		chain: ChainName.ETHEREUM,
		scheme: SchemeName.CGGMP24,
		network: NetworkName.SEPOLIA,
		status: SignerStatus.ACTIVE,
		ownerAddress: '0xTestOwner',
		apiKeyHash: 'hash123',
		vaultSharePath: '',
		dkgCompleted: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function createMocks() {
	const signerRepo = {
		findById: vi.fn(),
		findByApiKeyHash: vi.fn(),
		findAll: vi.fn(),
		create: vi.fn(),
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn(),
	};

	const vault = {
		getShare: vi.fn(),
		storeShare: vi.fn().mockResolvedValue(undefined),
		deleteShare: vi.fn(),
	};

	const auxInfoPool = {
		take: vi.fn().mockResolvedValue(null),
		getStatus: vi.fn().mockReturnValue({
			size: 0,
			target: 5,
			lowWatermark: 2,
			activeGenerators: 0,
			maxGenerators: 2,
			healthy: true,
		}),
	};

	return { signerRepo, vault, auxInfoPool };
}

/**
 * Helper: set up mock for single-call DKG via scheme.runDkg().
 *
 * CGGMP24 DKG runs as a single WASM call that returns all shares + publicKey.
 */
function setupRunDkg(
	options: {
		coreShares?: Uint8Array[];
		auxInfos?: Uint8Array[];
		publicKey?: Uint8Array;
	} = {},
) {
	const {
		coreShares = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])],
		auxInfos = [new Uint8Array([11, 12]), new Uint8Array([13, 14]), new Uint8Array([15, 16])],
		publicKey = new Uint8Array([10, 20]),
	} = options;

	const shares = coreShares.map((cs, i) => ({
		coreShare: cs,
		auxInfo: auxInfos[i]!,
	}));

	mockScheme.runDkg.mockResolvedValueOnce({ shares, publicKey });

	return { coreShares, auxInfos, publicKey, shares };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DKGService', () => {
	let service: DKGService;
	let mocks: ReturnType<typeof createMocks>;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks = createMocks();

		service = new DKGService(
			mocks.signerRepo as unknown as SignerRepository,
			mocks.vault as unknown as IVaultStore,
			mocks.auxInfoPool as unknown as AuxInfoPoolService,
		);
	});

	// -----------------------------------------------------------------------
	// init
	// -----------------------------------------------------------------------

	describe('init', () => {
		it('throws NotFoundException when signer does not exist', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(service.init({ signerId: 'nonexistent' })).rejects.toThrow(
				NotFoundException,
			);
		});

		it('throws BadRequestException when DKG already completed', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner({ dkgCompleted: true }));

			await expect(service.init({ signerId: 'signer-1' })).rejects.toThrow(
				BadRequestException,
			);
		});

		it('creates a new session and returns sessionId + signerId', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const result = await service.init({ signerId: 'signer-1' });

			expect(result.sessionId).toBeDefined();
			expect(result.signerId).toBe('signer-1');
		});
	});

	// -----------------------------------------------------------------------
	// finalize (single-call WASM DKG)
	// -----------------------------------------------------------------------

	describe('finalize', () => {
		it('throws NotFoundException when signer does not exist', async () => {
			mocks.signerRepo.findById.mockResolvedValue(null);

			await expect(
				service.finalize({
					sessionId: 'session-1',
					signerId: 'nonexistent',
				}),
			).rejects.toThrow(NotFoundException);
		});

		it('throws BadRequestException when no pending session exists', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			await expect(
				service.finalize({
					sessionId: 'nonexistent-session',
					signerId: 'signer-1',
				}),
			).rejects.toThrow(BadRequestException);
		});

		it('throws BadRequestException on session/signer mismatch', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			const initResult = await service.init({ signerId: 'signer-1' });

			mocks.signerRepo.findById.mockResolvedValue(makeSigner({ id: 'signer-2' }));

			await expect(
				service.finalize({
					sessionId: initResult.sessionId,
					signerId: 'signer-2',
				}),
			).rejects.toThrow('Session/signer mismatch');
		});

		it('runs single-call DKG via WASM and stores server share in vault', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			setupRunDkg();

			const initResult = await service.init({ signerId: 'signer-1' });
			await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			// runDkg called exactly once with (3, 2)
			expect(mockScheme.runDkg).toHaveBeenCalledTimes(1);
			expect(mockScheme.runDkg).toHaveBeenCalledWith(3, 2);
			// Server share stored in Vault (bundled as JSON key material)
			expect(mocks.vault.storeShare).toHaveBeenCalledTimes(1);
			expect(mocks.vault.storeShare).toHaveBeenCalledWith(
				'signer-1',
				expect.any(Uint8Array),
			);
		});

		it('updates signer record with ethAddress and dkgCompleted', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			setupRunDkg();

			const initResult = await service.init({ signerId: 'signer-1' });
			await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			expect(mocks.signerRepo.update).toHaveBeenCalledWith('signer-1', {
				ethAddress: '0xDerivedAddress123',
				dkgCompleted: true,
				vaultSharePath: 'signer-1',
			});
		});

		it('returns signerShare and userShare as base64', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			setupRunDkg();

			const initResult = await service.init({ signerId: 'signer-1' });
			const result = await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			expect(result.ethAddress).toBe('0xDerivedAddress123');
			expect(typeof result.signerShare).toBe('string');
			expect(typeof result.userShare).toBe('string');

			// Signer share is base64-encoded JSON { coreShare, auxInfo }
			const signerKm = JSON.parse(
				Buffer.from(result.signerShare, 'base64').toString('utf-8'),
			);
			expect(signerKm).toHaveProperty('coreShare');
			expect(signerKm).toHaveProperty('auxInfo');
		});

		it('throws when fewer than 3 shares', async () => {
			mocks.signerRepo.findById.mockResolvedValue(makeSigner());

			// runDkg returns only 2 shares
			mockScheme.runDkg.mockResolvedValueOnce({
				shares: [
					{ coreShare: new Uint8Array([1]), auxInfo: new Uint8Array([2]) },
					{ coreShare: new Uint8Array([3]), auxInfo: new Uint8Array([4]) },
				],
				publicKey: new Uint8Array([99]),
			});

			const initResult = await service.init({ signerId: 'signer-1' });

			await expect(
				service.finalize({
					sessionId: initResult.sessionId,
					signerId: 'signer-1',
				}),
			).rejects.toThrow('Expected 3 shares');
		});

		it('wipes all key material buffers in finally block', async () => {
			const coreShares = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])];
			const auxInfos = [new Uint8Array([11, 12]), new Uint8Array([13, 14]), new Uint8Array([15, 16])];
			const publicKey = new Uint8Array([10, 20]);

			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			setupRunDkg({ coreShares, auxInfos, publicKey });

			const initResult = await service.init({ signerId: 'signer-1' });
			await service.finalize({
				sessionId: initResult.sessionId,
				signerId: 'signer-1',
			});

			// wipeBuffer called for: 3 bundled key materials + 3 coreShares + 3 auxInfos + 1 publicKey = 10 calls
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(publicKey);
			for (const share of coreShares) {
				expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(share);
			}
			for (const aux of auxInfos) {
				expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(aux);
			}
		});

		it('wipes buffers even when vault store fails', async () => {
			const coreShares = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])];
			const auxInfos = [new Uint8Array([11, 12]), new Uint8Array([13, 14]), new Uint8Array([15, 16])];
			const publicKey = new Uint8Array([10, 20]);

			mocks.signerRepo.findById.mockResolvedValue(makeSigner());
			setupRunDkg({ coreShares, auxInfos, publicKey });
			mocks.vault.storeShare.mockRejectedValue(new Error('Vault down'));

			const initResult = await service.init({ signerId: 'signer-1' });
			await expect(
				service.finalize({
					sessionId: initResult.sessionId,
					signerId: 'signer-1',
				}),
			).rejects.toThrow('Vault down');

			// Buffers still wiped despite error
			for (const share of coreShares) {
				expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(share);
			}
			for (const aux of auxInfos) {
				expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(aux);
			}
			expect(cryptoUtils.wipeBuffer).toHaveBeenCalledWith(publicKey);
		});
	});
});
